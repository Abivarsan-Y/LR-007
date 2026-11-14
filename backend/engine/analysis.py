"""Pure contract-shaped analysis assembly; HTTP integration is Phase 4."""

import hashlib
import json
import math

from backend.engine.ephemeris import EphemerisRequest
from backend.engine.metrics import calculate_metrics
from backend.engine.visibility import HorizonProfile, evaluate_visibility


def combine_provenance(
    *items: dict, model_version: str, assumptions: list[str]
) -> dict:
    kinds = [item.get("data_kind") for item in items]
    if any(kind not in {"synthetic", "cached_real", "live_real"} for kind in kinds):
        raise ValueError("All inputs must identify their data kind")
    kind = (
        "synthetic"
        if "synthetic" in kinds
        else "live_real"
        if "live_real" in kinds
        else "cached_real"
    )
    sources = {}
    for item in items:
        if item["data_kind"] != "synthetic" and not item.get("sources"):
            raise ValueError("Real inputs require source provenance")
        for source in item.get("sources", []):
            key = (source["uri"], source["sha256"])
            sources[key] = {
                **source,
                "id": source["id"].split(":sha256:")[0]
                + ":sha256:"
                + source["sha256"][:16],
            }
    return {
        "data_kind": kind,
        "model_version": model_version,
        "sources": list(sources.values()),
        "assumptions": list(
            dict.fromkeys(
                [note for item in items for note in item.get("assumptions", [])]
                + assumptions
            )
        ),
    }


def build_analysis(
    ephemeris: dict, horizon: HorizonProfile, *, slope_deg: float | None = None
) -> dict:
    request = EphemerisRequest(**ephemeris["request"])
    samples = evaluate_visibility(ephemeris, horizon)
    if slope_deg is not None and (
        not math.isfinite(slope_deg) or not 0 <= slope_deg <= 90
    ):
        raise ValueError("Slope must be in [0,90] degrees or null")
    status = (
        "UNKNOWN"
        if slope_deg is None
        else "SAFE"
        if slope_deg < 8
        else "CAUTION"
        if slope_deg <= 15
        else "HAZARD"
    )
    assumptions = [
        "Horizon method and parameters: "
        + horizon.method
        + " "
        + json.dumps(horizon.parameters, sort_keys=True),
        "Horizon angles are circularly interpolated between supplied azimuths; missing endpoints remain unknown.",
        "Sunlight hours are full-sun-equivalent hours from a uniform circular disc above a locally straight horizon.",
        "Sun visible means any positive disc fraction; Earth visible means its apparent centre is strictly above terrain.",
        "Each sample governs [MET_i,MET_i+1); the endpoint adds no duration. Event times are sample-limited, not refined.",
        "Unknown positive-duration intervals make affected whole-mission metrics null; no missing time is silently counted.",
        "Both-visible hours use any sunlight plus Earth-centre visibility; DTE is geometry, not guaranteed radio service.",
        "Slope bands are project screening heuristics, not a lander-specific touchdown certification.",
    ]
    provenance = combine_provenance(
        ephemeris["provenance"],
        horizon.provenance,
        model_version="sampled-visibility-v1",
        assumptions=assumptions,
    )
    identity = {
        "request": request.model_dump(mode="json"),
        "horizon": horizon.model_dump(mode="json"),
        "ephemeris_samples": ephemeris["samples"],
        "sources": provenance["sources"],
        "slope_deg": slope_deg,
        "model_version": provenance["model_version"],
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, allow_nan=False).encode()
    ).hexdigest()
    observer = request.observer
    return {
        "schema_version": "0.1.0",
        "provenance": provenance,
        "analysis_id": "analysis-" + digest[:24],
        "site_id": observer.site_id,
        "coordinates": observer.model_dump(exclude={"site_id", "observer_height_m"}),
        "start_utc": request.start_utc.isoformat().replace("+00:00", "Z"),
        "end_utc": request.end_utc.isoformat().replace("+00:00", "Z"),
        "observer_height_m": observer.observer_height_m,
        "sample_minutes": request.sample_minutes,
        "samples": samples,
        "horizon": [point.model_dump() for point in horizon.points],
        "slope": {"angle_deg": slope_deg, "screening_status": status},
        "metrics": calculate_metrics(samples),
    }
