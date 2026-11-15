"""Pydantic models for Phase 4 site, analysis, diff, recommend and export endpoints."""

from __future__ import annotations

import math
import re
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import (
    AnyUrl,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    TypeAdapter,
    field_validator,
    model_validator,
)

from backend.engine.ephemeris import EphemerisRequest, Observer
from backend.engine.visibility import HorizonProfile

DataKind = Literal["synthetic", "cached_real", "live_real"]
ExportFormat = Literal["json", "csv"]
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_URI_ADAPTER = TypeAdapter(AnyUrl)


def _validate_sha256(value: str) -> str:
    if not _SHA256_RE.match(value):
        raise ValueError("sha256 must be a 64-character lowercase hexadecimal digest")
    return value


class ProvenanceSource(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    id: str = Field(min_length=1)
    uri: str = Field(min_length=1)
    sha256: str

    @field_validator("uri")
    @classmethod
    def check_uri(cls, value: str) -> str:
        _URI_ADAPTER.validate_python(value)
        return value

    @field_validator("sha256")
    @classmethod
    def check_sha256(cls, value: str) -> str:
        return _validate_sha256(value)


class ProvenanceDocument(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    data_kind: DataKind
    model_version: str = Field(min_length=1)
    sources: list[ProvenanceSource]
    assumptions: list[str]

    @field_validator("assumptions")
    @classmethod
    def non_empty_assumptions(cls, values: list[str]) -> list[str]:
        if any(not item for item in values):
            raise ValueError("Provenance assumptions must be non-empty strings")
        return values

    @model_validator(mode="after")
    def real_data_requires_sources(self) -> ProvenanceDocument:
        if self.data_kind != "synthetic" and not self.sources:
            raise ValueError("Real data must identify its sources")
        return self


class SiteCoordinates(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    latitude_deg: float = Field(gt=-90, le=-80)
    longitude_deg: float = Field(ge=-180, le=180)
    elevation_m: float
    frame: Literal["MOON_ME_DE421"]
    reference_radius_m: Literal[1737400]


class DemBounds(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    west_deg: float = Field(ge=-180, le=180)
    east_deg: float = Field(ge=-180, le=180)
    south_deg: float = Field(ge=-90, le=90)
    north_deg: float = Field(ge=-90, le=90)

    @model_validator(mode="after")
    def ordered_latitudes(self) -> DemBounds:
        if self.south_deg > self.north_deg:
            raise ValueError("dem_bounds south_deg cannot exceed north_deg")
        return self


class SiteDocument(BaseModel):
    """Contract-compatible verified lunar observation/candidate site (contracts/site.schema.json)."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    schema_version: Literal["0.1.0"]
    provenance: ProvenanceDocument
    site_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    coordinates: SiteCoordinates
    dem_bounds: DemBounds
    terrain_coverage: Literal["complete", "partial", "unknown"]


class RecommendCandidate(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    site_id: str = Field(min_length=1)
    coordinates: SiteCoordinates
    distance_m: float = Field(ge=0)
    bearing_deg: float = Field(ge=0, le=360)
    slope_deg: float = Field(ge=0, le=90)
    sunlight_fraction_delta: float | None = Field(default=None, ge=-1, le=1)


class RecommendDocument(BaseModel):
    """Contract-compatible recommendation document (contracts/recommend.schema.json)."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    schema_version: Literal["0.1.0"]
    provenance: ProvenanceDocument
    origin_site_id: str = Field(min_length=1)
    search_radius_m: float = Field(gt=0)
    candidates: list[RecommendCandidate]

    @model_validator(mode="after")
    def candidates_within_radius(self) -> RecommendDocument:
        for candidate in self.candidates:
            if candidate.distance_m > self.search_radius_m:
                raise ValueError("Recommendation candidate lies outside search_radius_m")
        return self


class AnalyzeScenarioRequest(BaseModel):
    """Request parameters for evaluating solar/Earth visibility and mission metrics."""

    model_config = ConfigDict(
        frozen=True, extra="forbid", allow_inf_nan=False, validate_default=True
    )

    site_id: str | None = Field(default=None, min_length=1, max_length=100)
    observer: Observer | None = None
    observer_height_m: float = Field(default=2.0, ge=0, le=100)
    start_utc: AwareDatetime
    duration_hours: int = Field(default=336, ge=1, le=672)
    sample_minutes: int = Field(default=30, ge=1, le=60)
    slope_deg: float | None = Field(default=None, ge=0, le=90)
    online: bool = False
    horizon_profile: HorizonProfile | None = None

    @field_validator("start_utc")
    @classmethod
    def check_start_utc(cls, value: datetime) -> datetime:
        utc_value = value.astimezone(UTC)
        if utc_value.second or utc_value.microsecond:
            raise ValueError("start_utc must lie on a whole UTC minute")
        return utc_value

    @model_validator(mode="after")
    def validate_request_semantics(self) -> AnalyzeScenarioRequest:
        if self.site_id is None and self.observer is None:
            raise ValueError("Provide either site_id or explicit observer coordinates")
        if self.observer is not None:
            if not -90.0 < self.observer.latitude_deg <= -80.0:
                raise ValueError(
                    "Only lunar south-polar latitudes in (-90, -80] degrees are supported"
                )
            if self.site_id is not None and self.site_id != self.observer.site_id:
                raise ValueError("site_id must match observer.site_id when both are supplied")
            if "observer_height_m" in self.model_fields_set and not math.isclose(
                self.observer_height_m,
                self.observer.observer_height_m,
                rel_tol=0,
                abs_tol=1e-6,
            ):
                raise ValueError(
                    "observer_height_m must match observer.observer_height_m when both are supplied"
                )
        # Validate mission window cadence using the engine's EphemerisRequest rules.
        probe_observer = self.observer or Observer(
            site_id=self.site_id or "probe",
            latitude_deg=-89.0,
            longitude_deg=0.0,
            elevation_m=0.0,
            observer_height_m=self.observer_height_m,
        )
        EphemerisRequest(
            observer=probe_observer,
            start_utc=self.start_utc,
            duration_hours=self.duration_hours,
            sample_minutes=self.sample_minutes,
        )
        return self

    def effective_observer_height_m(self) -> float:
        if self.observer is not None and "observer_height_m" not in self.model_fields_set:
            return self.observer.observer_height_m
        return self.observer_height_m


ScenarioInput = str | AnalyzeScenarioRequest | dict[str, Any]


class DiffRequest(BaseModel):
    """Compare two scenarios by cached analysis_id, inline request, or full analysis payload."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    scenario_a: ScenarioInput | None = None
    scenario_b: ScenarioInput | None = None
    scenario_a_id: str | None = Field(default=None, min_length=1)
    scenario_b_id: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def require_both_scenarios(self) -> DiffRequest:
        if self.scenario_a is None and self.scenario_a_id is None:
            raise ValueError("Provide scenario_a or scenario_a_id")
        if self.scenario_b is None and self.scenario_b_id is None:
            raise ValueError("Provide scenario_b or scenario_b_id")
        return self

    def resolved_a(self) -> ScenarioInput:
        assert self.scenario_a is not None or self.scenario_a_id is not None
        return self.scenario_a if self.scenario_a is not None else self.scenario_a_id  # type: ignore[return-value]

    def resolved_b(self) -> ScenarioInput:
        assert self.scenario_b is not None or self.scenario_b_id is not None
        return self.scenario_b if self.scenario_b is not None else self.scenario_b_id  # type: ignore[return-value]


class RecommendRequest(BaseModel):
    """Request nearby candidate landing locations from verified DEM proximity searches."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    origin_site_id: str = Field(min_length=1)
    search_radius_m: float = Field(default=500.0, gt=0, le=150000)
    start_utc: AwareDatetime | None = None
    duration_hours: int = Field(default=336, ge=1, le=672)
    sample_minutes: int = Field(default=30, ge=1, le=60)
    observer_height_m: float = Field(default=2.0, ge=0, le=100)


class ExportRequest(BaseModel):
    """Export an analyzed scenario cleanly as JSON or self-describing CSV."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    analysis_id: str | None = Field(default=None, min_length=1)
    scenario: AnalyzeScenarioRequest | None = None
    site_id: str | None = Field(default=None, min_length=1, max_length=100)
    observer: Observer | None = None
    start_utc: AwareDatetime | None = None
    duration_hours: int = Field(default=336, ge=1, le=672)
    sample_minutes: int = Field(default=30, ge=1, le=60)
    observer_height_m: float = Field(default=2.0, ge=0, le=100)
    slope_deg: float | None = Field(default=None, ge=0, le=90)
    online: bool = False
    format: ExportFormat = "json"

    @model_validator(mode="after")
    def require_target(self) -> ExportRequest:
        has_inline = self.scenario is not None or (
            (self.site_id is not None or self.observer is not None)
            and self.start_utc is not None
        )
        if self.analysis_id is None and not has_inline:
            raise ValueError(
                "Provide analysis_id, scenario, or site_id/observer with start_utc"
            )
        return self

    def to_scenario_request(self) -> AnalyzeScenarioRequest:
        if self.scenario is not None:
            return self.scenario
        kwargs: dict[str, Any] = {
            "site_id": self.site_id,
            "observer": self.observer,
            "start_utc": self.start_utc,
            "duration_hours": self.duration_hours,
            "sample_minutes": self.sample_minutes,
            "slope_deg": self.slope_deg,
            "online": self.online,
        }
        if "observer_height_m" in self.model_fields_set or self.observer is None:
            kwargs["observer_height_m"] = self.observer_height_m
        return AnalyzeScenarioRequest(**kwargs)


class TraverseManualRequest(BaseModel):
    """Request forward waypoint candidates in manual rover traverse mode."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    current_latitude_deg: float = Field(ge=-90.0, le=0.0)
    current_longitude_deg: float = Field(ge=-180.0, le=360.0)
    target_latitude_deg: float = Field(ge=-90.0, le=0.0)
    target_longitude_deg: float = Field(ge=-180.0, le=360.0)
    base_latitude_deg: float | None = Field(default=None, ge=-90.0, le=0.0)
    base_longitude_deg: float | None = Field(default=None, ge=-180.0, le=360.0)
    current_battery_wh: float = Field(default=1000.0, ge=0.0)
    step_distance_m: float = Field(default=300.0, gt=0.0, le=25000.0)
    num_candidates: int = Field(default=8, ge=2, le=24)
    sun_azimuth_deg: float = Field(default=180.0, ge=0.0, lt=360.0)
    sun_elevation_deg: float = Field(default=1.0, ge=-90.0, le=90.0)


class TraverseAutomaticRequest(BaseModel):
    """Request complete autonomous optimal traverse planning from start to target."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    start_latitude_deg: float = Field(ge=-90.0, le=0.0)
    start_longitude_deg: float = Field(ge=-180.0, le=360.0)
    target_latitude_deg: float = Field(ge=-90.0, le=0.0)
    target_longitude_deg: float = Field(ge=-180.0, le=360.0)
    base_latitude_deg: float | None = Field(default=None, ge=-90.0, le=0.0)
    base_longitude_deg: float | None = Field(default=None, ge=-180.0, le=360.0)
    initial_battery_wh: float = Field(default=1000.0, ge=0.0)
    step_m: float = Field(default=250.0, gt=20.0, le=25000.0)
    max_steps: int = Field(default=40, ge=1, le=100)
    sun_azimuth_deg: float = Field(default=180.0, ge=0.0, lt=360.0)
    sun_elevation_deg: float = Field(default=1.0, ge=-90.0, le=90.0)

