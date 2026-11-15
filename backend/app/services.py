"""Orchestration for Phase 4 verified sites, visibility analyses, diffs and exports."""

from __future__ import annotations

import copy
import csv
import io
import json
import math
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from backend.app.config import Settings
from backend.app.schemas.science import (
    AnalyzeScenarioRequest,
    DiffRequest,
    ExportFormat,
    ExportRequest,
    RecommendDocument,
    RecommendRequest,
    ScenarioInput,
    SiteDocument,
    TraverseManualRequest,
    TraverseAutomaticRequest,
)
from backend.terrain.ingest import LolaDemReader
from backend.terrain.traverse import suggest_next_waypoints, plan_automatic_traverse
from backend.engine.analysis import build_analysis
from backend.engine.ephemeris import (
    CacheMiss,
    EphemerisRequest,
    HorizonsClient,
    Observer,
)
from backend.engine.lunadiff import calculate_luna_diff
from backend.engine.visibility import HorizonProfile

_REQUIRED_ANALYSIS_KEYS = {
    "schema_version",
    "provenance",
    "analysis_id",
    "site_id",
    "coordinates",
    "start_utc",
    "end_utc",
    "observer_height_m",
    "sample_minutes",
    "samples",
    "horizon",
    "slope",
    "metrics",
}

_RECOMMEND_ORIGIN_ALIASES: dict[str, set[str]] = {
    "nasa-site01-observation": {"nasa-site01-observation", "site01_connecting_ridge"},
    "site01_connecting_ridge": {"site01_connecting_ridge", "nasa-site01-observation"},
}


class ResourceNotFoundError(Exception):
    """Requested verified site, horizon profile, or cached analysis does not exist."""


class RecommendationUnavailableError(Exception):
    """Verified DEM proximity recommendations are not available for the requested origin."""


def _validate_client_analysis_payload(payload: dict[str, Any]) -> None:
    if not _REQUIRED_ANALYSIS_KEYS.issubset(payload.keys()):
        missing = sorted(_REQUIRED_ANALYSIS_KEYS - set(payload.keys()))
        raise ValueError(
            f"Supplied analysis payload is missing required fields: {', '.join(missing)}"
        )
    samples = payload.get("samples")
    if not isinstance(samples, list) or len(samples) < 2:
        raise ValueError("Supplied analysis payload must contain at least 2 samples")
    provenance = payload.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("data_kind") not in {
        "synthetic",
        "cached_real",
        "live_real",
    }:
        raise ValueError("Supplied analysis payload has invalid provenance")
    for sample in samples:
        if not isinstance(sample, dict) or any(
            key not in sample for key in ("utc", "met_hours", "sun", "earth")
        ):
            raise ValueError("Supplied analysis sample is missing required fields")
        if not isinstance(sample["sun"], dict) or not isinstance(sample["earth"], dict):
            raise ValueError("Supplied analysis sample has malformed body geometry")
        if any(
            key not in sample["sun"]
            for key in (
                "azimuth_deg",
                "elevation_deg",
                "angular_diameter_deg",
                "horizon_deg",
                "visible",
                "illumination_fraction",
            )
        ) or any(
            key not in sample["earth"]
            for key in (
                "azimuth_deg",
                "elevation_deg",
                "angular_diameter_deg",
                "horizon_deg",
                "visible",
            )
        ):
            raise ValueError("Supplied analysis sample body is missing required keys")


def _iter_json_files(paths: tuple[Path, ...]) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        if not path.exists():
            continue
        candidates = (
            sorted(path.glob("*.json"))
            if path.is_dir()
            else ([path] if path.is_file() and path.suffix.lower() == ".json" else [])
        )
        for item in candidates:
            resolved = item.resolve()
            if resolved not in seen:
                seen.add(resolved)
                files.append(item)
    return files


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _coordinates_match_dict(coords: dict[str, Any], observer: Observer) -> bool:
    return (
        coords.get("frame") == observer.frame
        and coords.get("reference_radius_m") == observer.reference_radius_m
        and math.isclose(coords["latitude_deg"], observer.latitude_deg, rel_tol=0, abs_tol=1e-9)
        and math.isclose(coords["longitude_deg"], observer.longitude_deg, rel_tol=0, abs_tol=1e-9)
        and math.isclose(coords["elevation_m"], observer.elevation_m, rel_tol=0, abs_tol=1e-3)
    )


def _observers_match(left: Observer, right: Observer) -> bool:
    return (
        left.site_id == right.site_id
        and left.frame == right.frame
        and left.reference_radius_m == right.reference_radius_m
        and math.isclose(left.latitude_deg, right.latitude_deg, rel_tol=0, abs_tol=1e-9)
        and math.isclose(left.longitude_deg, right.longitude_deg, rel_tol=0, abs_tol=1e-9)
        and math.isclose(left.elevation_m, right.elevation_m, rel_tol=0, abs_tol=1e-3)
        and math.isclose(
            left.observer_height_m, right.observer_height_m, rel_tol=0, abs_tol=1e-6
        )
    )


def _format_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _format_metric(value: Any) -> str:
    return "null" if value is None else str(value)


def _sanitize_header_text(value: str) -> str:
    return " ".join(value.splitlines()).strip()


def _format_analysis_csv(analysis: dict[str, Any]) -> str:
    """Serialize an analysis document as reproducible metadata-headered CSV."""
    coords = analysis["coordinates"]
    provenance = analysis["provenance"]
    metrics = analysis["metrics"]
    slope = analysis["slope"]
    sample_interval_seconds = int(round(analysis["sample_minutes"] * 60))
    generated_at_utc = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    lines = [
        f"# schema_version: {analysis['schema_version']}",
        f"# analysis_id: {analysis['analysis_id']}",
        f"# site_id: {analysis['site_id']}",
        (
            "# coordinates: "
            f"lat={coords['latitude_deg']},"
            f"lon={coords['longitude_deg']},"
            f"elevation_m={coords['elevation_m']},"
            f"frame={coords['frame']},"
            f"reference_radius_m={coords['reference_radius_m']}"
        ),
        f"# observer_height_m: {analysis['observer_height_m']}",
        f"# start_utc: {analysis['start_utc']}",
        f"# end_utc: {analysis['end_utc']}",
        f"# sample_interval_seconds: {sample_interval_seconds}",
        f"# provenance.data_kind: {provenance['data_kind']}",
        f"# provenance.model_version: {provenance['model_version']}",
        f"# provenance.generated_at_utc: {generated_at_utc}",
        (
            "# metrics: "
            f"sunlight_hours={_format_metric(metrics['sunlight_hours'])},"
            f"sunlight_fraction={_format_metric(metrics['sunlight_fraction'])},"
            f"max_darkness_hours={_format_metric(metrics['max_darkness_hours'])},"
            f"earth_visible_hours={_format_metric(metrics['earth_visible_hours'])},"
            f"earth_visible_fraction={_format_metric(metrics['earth_visible_fraction'])},"
            f"max_earth_occlusion_hours={_format_metric(metrics['max_earth_occlusion_hours'])},"
            f"both_visible_hours={_format_metric(metrics['both_visible_hours'])},"
            f"slope_deg={_format_metric(slope['angle_deg'])},"
            f"screening_status={slope['screening_status']}"
        ),
    ]
    for source in provenance.get("sources", []):
        lines.append(f"# source: {source['id']}|{source['sha256']}|{source['uri']}")
    for assumption in provenance.get("assumptions", []):
        lines.append(f"# assumption: {_sanitize_header_text(assumption)}")

    buffer = io.StringIO()
    for line in lines:
        buffer.write(line + "\n")

    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(
        [
            "utc",
            "met_hours",
            "sun_azimuth_deg",
            "sun_elevation_deg",
            "sun_angular_diameter_deg",
            "sun_horizon_deg",
            "sun_visible",
            "sun_illumination_fraction",
            "earth_azimuth_deg",
            "earth_elevation_deg",
            "earth_angular_diameter_deg",
            "earth_horizon_deg",
            "earth_visible",
        ]
    )
    for sample in analysis["samples"]:
        sun = sample["sun"]
        earth = sample["earth"]
        writer.writerow(
            [
                sample["utc"],
                sample["met_hours"],
                sun["azimuth_deg"],
                sun["elevation_deg"],
                sun["angular_diameter_deg"],
                _format_cell(sun["horizon_deg"]),
                _format_cell(sun["visible"]),
                _format_cell(sun["illumination_fraction"]),
                earth["azimuth_deg"],
                earth["elevation_deg"],
                earth["angular_diameter_deg"],
                _format_cell(earth["horizon_deg"]),
                _format_cell(earth["visible"]),
            ]
        )
    return buffer.getvalue()


class ScienceService:
    """Stateful-per-app coordinator over verified offline fixtures, caches and engine calls."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._analyses_by_id: dict[str, dict[str, Any]] = {}
        self._seed_analyses()

    def _seed_analyses(self) -> None:
        candidate_paths = list(self.settings.precomputed_analyses_paths)
        if self.settings.analyses_cache_dir.is_dir():
            candidate_paths.extend(sorted(self.settings.analyses_cache_dir.glob("*.json")))
        for path in _iter_json_files(tuple(candidate_paths)):
            try:
                raw = _read_json(path)
            except (OSError, json.JSONDecodeError):
                continue
            if (
                isinstance(raw, dict)
                and _REQUIRED_ANALYSIS_KEYS.issubset(raw.keys())
                and raw.get("schema_version") == "0.1.0"
                and isinstance(raw.get("analysis_id"), str)
            ):
                self._analyses_by_id.setdefault(raw["analysis_id"], raw)

    def _load_sites_map(self) -> dict[str, dict[str, Any]]:
        sites: dict[str, dict[str, Any]] = {}
        for path in _iter_json_files(self.settings.sites_paths):
            try:
                raw = _read_json(path)
            except (OSError, json.JSONDecodeError):
                continue
            entries = raw if isinstance(raw, list) else [raw]
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                try:
                    SiteDocument.model_validate(entry)
                except ValidationError:
                    continue
                sites.setdefault(entry["site_id"], copy.deepcopy(entry))
        return sites

    def list_sites(self, *, site_id: str | None = None) -> list[dict[str, Any]]:
        sites = self._load_sites_map()
        ordered = sorted(sites.values(), key=lambda item: item["site_id"])
        if site_id is not None:
            return [site for site in ordered if site["site_id"] == site_id]
        return ordered

    def get_site(self, site_id: str) -> dict[str, Any]:
        sites = self._load_sites_map()
        site = sites.get(site_id)
        if site is None:
            raise ResourceNotFoundError(
                f"No contract-verified site '{site_id}' was found. "
                "Only verified lunar south-polar sites with DEM and frame provenance are exposed."
            )
        return site

    def get_analysis(self, analysis_id: str) -> dict[str, Any]:
        analysis = self._analyses_by_id.get(analysis_id)
        if analysis is None:
            raise ResourceNotFoundError(
                f"Analysis '{analysis_id}' was not found in cached/precomputed results."
            )
        return copy.deepcopy(analysis)

    def resolve_observer(self, request: AnalyzeScenarioRequest) -> Observer:
        effective_height = request.effective_observer_height_m()
        if request.observer is not None:
            if request.site_id is not None and request.horizon_profile is None:
                site = self.get_site(request.site_id)
                if not _coordinates_match_dict(site["coordinates"], request.observer):
                    raise ValueError(
                        "Requested observer coordinates disagree with verified site record"
                    )
            return request.observer

        assert request.site_id is not None
        site = self.get_site(request.site_id)
        coords = site["coordinates"]
        return Observer(
            site_id=site["site_id"],
            latitude_deg=coords["latitude_deg"],
            longitude_deg=coords["longitude_deg"],
            elevation_m=coords["elevation_m"],
            observer_height_m=effective_height,
            frame=coords["frame"],
            reference_radius_m=coords["reference_radius_m"],
        )

    def resolve_horizon(self, observer: Observer) -> HorizonProfile:
        for path in _iter_json_files(self.settings.horizon_paths):
            try:
                raw = _read_json(path)
                profile = HorizonProfile.model_validate(raw)
            except (OSError, json.JSONDecodeError, ValidationError):
                continue
            if _observers_match(profile.observer, observer):
                return profile
        raise ResourceNotFoundError(
            f"No verified horizon skyline found for site '{observer.site_id}' "
            f"at observer_height_m={observer.observer_height_m}."
        )

    def resolve_ephemeris(
        self, ephemeris_request: EphemerisRequest, *, online: bool
    ) -> dict[str, Any]:
        last_miss: CacheMiss | None = None
        for cache_dir in self.settings.ephemeris_cache_dirs:
            try:
                return HorizonsClient(cache_dir).get_ephemeris(
                    ephemeris_request, offline=True
                )
            except CacheMiss as exc:
                last_miss = exc

        if online and self.settings.allow_live_horizons:
            target_dir = (
                self.settings.ephemeris_cache_dirs[0]
                if self.settings.ephemeris_cache_dirs
                else self.settings.analyses_cache_dir.parent / "ephemeris"
            )
            return HorizonsClient(target_dir).get_ephemeris(
                ephemeris_request, offline=False
            )

        if online and not self.settings.allow_live_horizons:
            raise CacheMiss(
                "Offline ephemeris cache miss and live JPL Horizons queries are disabled on this server."
            )
        assert last_miss is not None
        raise last_miss

    def run_analysis(self, request: AnalyzeScenarioRequest) -> dict[str, Any]:
        observer = self.resolve_observer(request)
        horizon = (
            request.horizon_profile
            if request.horizon_profile is not None
            else self.resolve_horizon(observer)
        )
        ephemeris_request = EphemerisRequest(
            observer=observer,
            start_utc=request.start_utc,
            duration_hours=request.duration_hours,
            sample_minutes=request.sample_minutes,
        )
        ephemeris = self.resolve_ephemeris(ephemeris_request, online=request.online)
        analysis = build_analysis(ephemeris, horizon, slope_deg=request.slope_deg)
        self._analyses_by_id[analysis["analysis_id"]] = analysis
        return copy.deepcopy(analysis)

    def _resolve_scenario(self, scenario: ScenarioInput) -> dict[str, Any]:
        if isinstance(scenario, str):
            return self.get_analysis(scenario)
        if isinstance(scenario, AnalyzeScenarioRequest):
            return self.run_analysis(scenario)
        if isinstance(scenario, dict):
            if "samples" in scenario:
                _validate_client_analysis_payload(scenario)
                return scenario
            parsed = AnalyzeScenarioRequest.model_validate(scenario)
            return self.run_analysis(parsed)
        raise ValueError("Unsupported scenario input")

    def run_diff(self, request: DiffRequest) -> dict[str, Any]:
        analysis_a = self._resolve_scenario(request.resolved_a())
        analysis_b = self._resolve_scenario(request.resolved_b())
        return calculate_luna_diff(analysis_a, analysis_b)

    def run_recommend(self, request: RecommendRequest) -> dict[str, Any]:
        self.get_site(request.origin_site_id)
        allowed_origins = _RECOMMEND_ORIGIN_ALIASES.get(
            request.origin_site_id, {request.origin_site_id}
        )
        for path in _iter_json_files(self.settings.recommendations_paths):
            try:
                raw = _read_json(path)
            except (OSError, json.JSONDecodeError):
                continue
            entries = raw if isinstance(raw, list) else [raw]
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                try:
                    RecommendDocument.model_validate(entry)
                except ValidationError:
                    continue
                if entry["origin_site_id"] in allowed_origins and math.isclose(
                    entry["search_radius_m"],
                    request.search_radius_m,
                    rel_tol=0,
                    abs_tol=1e-6,
                ):
                    result = copy.deepcopy(entry)
                    result["origin_site_id"] = request.origin_site_id
                    return result

        raise RecommendationUnavailableError(
            f"Verified DEM proximity recommendations are not available for origin "
            f"'{request.origin_site_id}' at search_radius_m={request.search_radius_m}. "
            "Terrain candidate generation has not been populated yet."
        )

    def resolve_export_analysis(self, request: ExportRequest) -> dict[str, Any]:
        if request.analysis_id is not None:
            return self.get_analysis(request.analysis_id)
        return self.run_analysis(request.to_scenario_request())

    def export_payload(
        self, analysis: dict[str, Any], fmt: ExportFormat
    ) -> tuple[str, str, str]:
        safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", analysis["analysis_id"])
        if fmt == "json":
            content = json.dumps(analysis, indent=2) + "\n"
            return content, "application/json", f"{safe_id}.json"
        content = _format_analysis_csv(analysis)
        return content, "text/csv; charset=utf-8", f"{safe_id}.csv"

    def _get_dem_reader(self) -> LolaDemReader:
        if not hasattr(self, "_cached_dem_reader") or self._cached_dem_reader is None:
            dem_path = Path("data/raw/LDEM_80S_80MPP_ADJ.TIF")
            if not dem_path.exists():
                raise ResourceNotFoundError(f"LOLA DEM GeoTIFF not found at: {dem_path}")
            self._cached_dem_reader = LolaDemReader(dem_path)
        return self._cached_dem_reader

    def run_traverse_manual(self, request: TraverseManualRequest) -> dict[str, Any]:
        reader = self._get_dem_reader()
        base_lat = request.base_latitude_deg if request.base_latitude_deg is not None else request.current_latitude_deg
        base_lon = request.base_longitude_deg if request.base_longitude_deg is not None else request.current_longitude_deg
        return suggest_next_waypoints(
            reader=reader,
            current_lat=request.current_latitude_deg,
            current_lon=request.current_longitude_deg,
            target_lat=request.target_latitude_deg,
            target_lon=request.target_longitude_deg,
            base_lat=base_lat,
            base_lon=base_lon,
            current_battery_wh=request.current_battery_wh,
            step_distance_m=request.step_distance_m,
            num_candidates=request.num_candidates,
            sun_azimuth_deg=request.sun_azimuth_deg,
            sun_elevation_deg=request.sun_elevation_deg,
        )

    def run_traverse_automatic(self, request: TraverseAutomaticRequest) -> dict[str, Any]:
        reader = self._get_dem_reader()
        return plan_automatic_traverse(
            reader=reader,
            start_lat=request.start_latitude_deg,
            start_lon=request.start_longitude_deg,
            target_lat=request.target_latitude_deg,
            target_lon=request.target_longitude_deg,
            base_lat=request.base_latitude_deg,
            base_lon=request.base_longitude_deg,
            initial_battery_wh=request.initial_battery_wh,
            step_m=request.step_m,
            max_steps=request.max_steps,
            sun_azimuth_deg=request.sun_azimuth_deg,
            sun_elevation_deg=request.sun_elevation_deg,
        )

