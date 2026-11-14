"""Compare sampled analyses on a shared elapsed-time axis with explicit gaps."""

import math
from bisect import bisect_right
from datetime import datetime
from itertools import pairwise

from backend.engine.analysis import combine_provenance
from backend.engine.metrics import calculate_metrics, validate_timeline


def _validate_analysis(analysis: dict) -> float:
    times = validate_timeline(analysis["samples"])
    if (
        datetime.fromisoformat(analysis["start_utc"]) != times[0]
        or datetime.fromisoformat(analysis["end_utc"]) != times[-1]
    ):
        raise ValueError("Analysis endpoints and samples disagree")
    calculate_metrics(analysis["samples"])
    for sample in analysis["samples"][:-1]:
        for name in ("sun", "earth"):
            body = sample[name]
            if body["visible"] is not None and any(
                body.get(key) is None or not math.isfinite(body[key])
                for key in ("horizon_deg", "elevation_deg", "azimuth_deg")
            ):
                raise ValueError("Known visibility requires finite causal geometry")
    return analysis["samples"][-1]["met_hours"]


def _reason(a: dict, b: dict, body: str, start: float) -> str:
    label = "Sun" if body == "sun" else "Earth"
    clauses = []
    for name, sample in (("A", a), ("B", b)):
        value = sample[body]
        text = (
            f"{name} {label} centre {value['elevation_deg']:.3f} deg, "
            f"terrain {value['horizon_deg']:.3f} deg at azimuth {value['azimuth_deg']:.3f} deg"
        )
        if body == "sun":
            text += f", exposed disc {value['illumination_fraction']:.3f}"
        clauses.append(text)
    return (
        f"At interval start MET +{start:.6g} h: "
        + "; ".join(clauses)
        + ". Sampled geometry; conditions may vary within the interval."
    )


def calculate_luna_diff(scenario_a: dict, scenario_b: dict) -> dict:
    duration = _validate_analysis(scenario_a)
    if not math.isclose(
        duration, _validate_analysis(scenario_b), rel_tol=0, abs_tol=1e-9
    ):
        raise ValueError("LunaDiff needs equal mission durations")
    samples_a, samples_b = scenario_a["samples"], scenario_b["samples"]
    axis_a = [sample["met_hours"] for sample in samples_a]
    axis_b = [sample["met_hours"] for sample in samples_b]
    common = sorted(set(axis_a + axis_b))
    by_type = {}
    for start, end in pairwise(common):
        a = samples_a[bisect_right(axis_a, start) - 1]
        b = samples_b[bisect_right(axis_b, start) - 1]
        for body, suffix in (("sun", "SUNLIGHT"), ("earth", "EARTH_VISIBILITY")):
            av, bv = a[body]["visible"], b[body]["visible"]
            if av is None or bv is None or av == bv:
                continue
            kind = ("GAINED_" if bv else "LOST_") + suffix
            intervals = by_type.setdefault(kind, [])
            if intervals and intervals[-1]["end_met_hours"] == start:
                intervals[-1]["end_met_hours"] = end
            else:
                intervals.append(
                    {
                        "type": kind,
                        "start_met_hours": start,
                        "end_met_hours": end,
                        "reason": _reason(a, b, body, start),
                    }
                )
    # Recompute metrics instead of trusting possibly stale client-provided summaries.
    metrics_a, metrics_b = calculate_metrics(samples_a), calculate_metrics(samples_b)
    keys = ["sunlight_hours", "max_darkness_hours", "earth_visible_hours"]
    deltas = {
        key: None
        if metrics_a[key] is None or metrics_b[key] is None
        else metrics_b[key] - metrics_a[key]
        for key in keys
    }
    return {
        "schema_version": "0.1.0",
        "provenance": combine_provenance(
            scenario_a["provenance"],
            scenario_b["provenance"],
            model_version="elapsed-lunadiff-v1",
            assumptions=[
                "Align scenarios on the union of elapsed-time sample boundaries, not absolute UTC.",
                "Diagnostic windows describe gained/lost boolean visibility; partial-disc differences also affect sunlight-hour deltas.",
                "Each scenario is left-held between its own samples. Unknown comparisons produce no claimed gain/loss.",
                "Causal text describes geometry at the interval start, not an identified geological feature or a constant obstruction.",
            ],
        ),
        "scenario_a_id": scenario_a["analysis_id"],
        "scenario_b_id": scenario_b["analysis_id"],
        "duration_hours": duration,
        "alignment": "mission_elapsed_time",
        "delta_convention": "B_minus_A",
        "deltas": deltas,
        "diagnostic_intervals": sorted(
            [interval for group in by_type.values() for interval in group],
            key=lambda interval: (interval["start_met_hours"], interval["type"]),
        ),
    }
