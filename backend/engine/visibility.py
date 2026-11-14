"""Terrain skyline interpolation and sampled apparent Sun/Earth visibility."""

import math
from bisect import bisect_left
from copy import deepcopy

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.engine.ephemeris import EphemerisRequest, Observer


class HorizonPoint(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    azimuth_deg: float = Field(ge=0, lt=360)
    elevation_deg: float | None = Field(ge=-90, le=90)
    coverage: str

    @model_validator(mode="after")
    def consistent_coverage(self):
        if self.coverage not in {"complete", "unknown"}:
            raise ValueError("Unsupported horizon coverage")
        if (self.coverage == "unknown") != (self.elevation_deg is None):
            raise ValueError("Unknown coverage must have a null elevation")
        return self


class HorizonProfile(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    observer: Observer
    points: tuple[HorizonPoint, ...] = Field(min_length=2)
    provenance: dict
    method: str
    parameters: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def increasing_azimuths(self):
        if any(
            a.azimuth_deg >= b.azimuth_deg for a, b in zip(self.points, self.points[1:])
        ):
            raise ValueError("Horizon azimuths must be unique and strictly increasing")
        if self.provenance.get("data_kind") not in {
            "synthetic",
            "cached_real",
            "live_real",
        }:
            raise ValueError("Horizon must identify its data kind")
        if self.provenance["data_kind"] != "synthetic" and not self.provenance.get(
            "sources"
        ):
            raise ValueError("Real horizons require source provenance")
        return self

    def at(self, azimuth_deg: float) -> float | None:
        """Circular piecewise-linear skyline; never bridge unknown endpoints."""
        if not math.isfinite(azimuth_deg):
            raise ValueError("Azimuth must be finite")
        azimuth = azimuth_deg % 360
        angles = [point.azimuth_deg for point in self.points]
        index = bisect_left(angles, azimuth)
        if index < len(angles) and angles[index] == azimuth:
            return self.points[index].elevation_deg
        left = self.points[(index - 1) % len(angles)]
        right = self.points[index % len(angles)]
        if left.elevation_deg is None or right.elevation_deg is None:
            return None
        span = (right.azimuth_deg - left.azimuth_deg) % 360
        fraction = ((azimuth - left.azimuth_deg) % 360) / span
        return left.elevation_deg + fraction * (
            right.elevation_deg - left.elevation_deg
        )


def solar_disc_fraction(clearance_deg: float, angular_diameter_deg: float) -> float:
    """Area fraction of a uniform circular disc above a locally straight horizon."""
    if not math.isfinite(clearance_deg) or not math.isfinite(angular_diameter_deg):
        raise ValueError("Disc geometry must be finite")
    if not 0 < angular_diameter_deg <= 180:
        raise ValueError("Angular diameter must be in (0, 180] degrees")
    normalized = clearance_deg / (angular_diameter_deg / 2)
    if normalized <= -1:
        return 0.0
    if normalized >= 1:
        return 1.0
    fraction = (
        math.acos(-normalized) + normalized * math.sqrt(1 - normalized**2)
    ) / math.pi
    return min(1.0, max(0.0, fraction))


def evaluate_visibility(ephemeris: dict, profile: HorizonProfile) -> list[dict]:
    """Evaluate all requested timestamps with a fixed, matching observer."""
    from backend.engine.metrics import validate_timeline

    request = EphemerisRequest(**ephemeris["request"])
    if request.observer != profile.observer:
        raise ValueError(
            "Horizon and ephemeris must use the same coordinates, frame and height"
        )
    samples = deepcopy(ephemeris["samples"])
    times = validate_timeline(samples)
    if len(samples) != request.sample_count:
        raise ValueError("Ephemeris samples do not cover the requested grid")
    for index, (sample, expected) in enumerate(
        zip(samples, request.times(), strict=True)
    ):
        if (
            times[index] != expected
            or sample["met_hours"] != index * request.sample_minutes / 60
        ):
            raise ValueError("Ephemeris does not match the requested UTC/MET sampling")
        for name in ("sun", "earth"):
            body = sample[name]
            azimuth = body["azimuth_deg"]
            elevation = body["elevation_deg"]
            diameter = body["angular_diameter_deg"]
            if not all(
                not isinstance(value, bool)
                and isinstance(value, (int, float))
                and math.isfinite(value)
                for value in (azimuth, elevation, diameter)
            ):
                raise ValueError("Body angles must be finite")
            if (
                not 0 <= azimuth < 360
                or not -90 <= elevation <= 90
                or not 0 < diameter <= 180
            ):
                raise ValueError("Body angles are outside their supported ranges")
            horizon = profile.at(azimuth)
            body["horizon_deg"] = horizon
            if horizon is None:
                body["visible"] = None
                if name == "sun":
                    body["illumination_fraction"] = None
            elif name == "sun":
                fraction = solar_disc_fraction(elevation - horizon, diameter)
                body["illumination_fraction"] = fraction
                body["visible"] = fraction > 0
            else:
                # DTE is body-centre geometric visibility, not a radio-link promise.
                body["visible"] = elevation > horizon
    return samples
