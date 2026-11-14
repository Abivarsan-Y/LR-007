"""Duration-weighted metrics for an explicitly left-held sampled timeline."""

import math
from datetime import UTC, datetime
from itertools import pairwise


def validate_timeline(samples: list[dict]) -> list[datetime]:
    if len(samples) < 2:
        raise ValueError("A timeline needs at least start and end samples")
    times = []
    previous = -1.0
    for sample in samples:
        met = sample["met_hours"]
        if (
            isinstance(met, bool)
            or not isinstance(met, (int, float))
            or not math.isfinite(met)
        ):
            raise ValueError("Mission elapsed times must be finite numbers")
        if met <= previous:
            raise ValueError("Mission elapsed times must strictly increase")
        instant = datetime.fromisoformat(sample["utc"])
        if instant.tzinfo is None or instant.utcoffset().total_seconds() != 0:
            raise ValueError("Timeline timestamps must be explicit UTC")
        instant = instant.astimezone(UTC)
        if times and not math.isclose(
            (instant - times[0]).total_seconds() / 3600, met, abs_tol=1e-9
        ):
            raise ValueError("Timeline UTC and elapsed times disagree")
        times.append(instant)
        previous = met
    if samples[0]["met_hours"] != 0:
        raise ValueError("Timeline must start at MET zero")
    return times


def _states(samples: list[dict], body: str) -> list[bool | None]:
    states = [sample[body]["visible"] for sample in samples[:-1]]
    if any(state is not None and type(state) is not bool for state in states):
        raise ValueError("Visibility must be true, false or null")
    return states


def _longest_blocked(states: list[bool | None], durations: list[float]) -> float | None:
    if any(state is None for state in states):
        return None
    longest = current = 0.0
    for state, duration in zip(states, durations, strict=True):
        current = 0 if state else current + duration
        longest = max(longest, current)
    return longest


def visibility_intervals(samples: list[dict], body: str) -> list[dict]:
    """Contiguous half-open known/unknown intervals; final endpoint has no duration."""
    validate_timeline(samples)
    if body not in {"sun", "earth"}:
        raise ValueError("Choose sun or earth")
    states = _states(samples, body)
    result = []
    for index, state in enumerate(states):
        start = samples[index]["met_hours"]
        end = samples[index + 1]["met_hours"]
        if result and result[-1]["visible"] is state:
            result[-1]["end_met_hours"] = end
        else:
            result.append(
                {"start_met_hours": start, "end_met_hours": end, "visible": state}
            )
    return result


def calculate_metrics(samples: list[dict]) -> dict:
    validate_timeline(samples)
    durations = [b["met_hours"] - a["met_hours"] for a, b in pairwise(samples)]
    total = samples[-1]["met_hours"]
    sun = _states(samples, "sun")
    earth = _states(samples, "earth")
    fractions = [sample["sun"]["illumination_fraction"] for sample in samples[:-1]]
    for value, visible in zip(fractions, sun, strict=True):
        if value is not None:
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or not 0 <= value <= 1
            ):
                raise ValueError("Illumination must be finite in [0,1] or null")
            if visible is None or visible != (value > 0):
                raise ValueError("Sun visibility and fractional illumination disagree")
    sunlight = (
        None
        if any(value is None for value in fractions)
        else sum(
            value * duration
            for value, duration in zip(fractions, durations, strict=True)
        )
    )
    earth_hours = (
        None
        if any(state is None for state in earth)
        else sum(
            duration for state, duration in zip(earth, durations, strict=True) if state
        )
    )
    both = [
        False if a is False or b is False else True if a is True and b is True else None
        for a, b in zip(sun, earth, strict=True)
    ]
    overlap = (
        None
        if any(state is None for state in both)
        else sum(
            duration for state, duration in zip(both, durations, strict=True) if state
        )
    )
    return {
        "sunlight_hours": sunlight,
        "sunlight_fraction": None if sunlight is None else sunlight / total,
        "max_darkness_hours": _longest_blocked(sun, durations),
        "earth_visible_hours": earth_hours,
        "earth_visible_fraction": None if earth_hours is None else earth_hours / total,
        "max_earth_occlusion_hours": _longest_blocked(earth, durations),
        "both_visible_hours": overlap,
    }
