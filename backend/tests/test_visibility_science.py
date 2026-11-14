"""Controlled scientific cases for visibility, time integration and LunaDiff."""

import math
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from itertools import pairwise

import numpy as np
import pytest
from pydantic import ValidationError
from pyproj import Geod

from backend.engine.analysis import build_analysis
from backend.engine.ephemeris import EphemerisRequest, Observer
from backend.engine.lunadiff import calculate_luna_diff
from backend.engine.metrics import (
    calculate_metrics,
    validate_timeline,
    visibility_intervals,
)
from backend.engine.terrain_horizon import compute_horizon
from backend.engine.visibility import (
    HorizonPoint,
    HorizonProfile,
    evaluate_visibility,
    solar_disc_fraction,
)
from scripts.validate_fixtures import validate_document

SYNTHETIC = {
    "data_kind": "synthetic",
    "model_version": "controlled-test-v1",
    "sources": [],
    "assumptions": ["Synthetic test geometry."],
}


@pytest.fixture
def observer():
    return Observer(
        site_id="test-observer",
        latitude_deg=-89,
        longitude_deg=-138,
        elevation_m=0,
        observer_height_m=2,
    )


def profile(observer, elevations=(0, 0, 0, 0)):
    return HorizonProfile(
        observer=observer,
        points=tuple(
            HorizonPoint(
                azimuth_deg=index * 90,
                elevation_deg=value,
                coverage="unknown" if value is None else "complete",
            )
            for index, value in enumerate(elevations)
        ),
        provenance=SYNTHETIC,
        method="synthetic-test-skyline",
    )


def sample(met, sun=True, earth=True, fraction=None, start=None):
    start = start or datetime(2026, 11, 15, tzinfo=UTC)
    if fraction is None and sun is not None:
        fraction = float(sun)
    return {
        "utc": (start + timedelta(hours=met)).isoformat().replace("+00:00", "Z"),
        "met_hours": met,
        "sun": {
            "azimuth_deg": 0.0,
            "elevation_deg": 2.0 if sun else -2.0,
            "angular_diameter_deg": 0.5,
            "horizon_deg": None if sun is None else 0.0,
            "visible": sun,
            "illumination_fraction": fraction,
        },
        "earth": {
            "azimuth_deg": 0.0,
            "elevation_deg": 2.0 if earth else -2.0,
            "angular_diameter_deg": 1.9,
            "horizon_deg": None if earth is None else 0.0,
            "visible": earth,
        },
    }


def bundle(observer, sun_elevation=1, earth_elevation=1):
    request = EphemerisRequest(
        observer=observer,
        start_utc="2026-11-15T00:00:00Z",
        duration_hours=2,
        sample_minutes=30,
    )
    samples = []
    for index, instant in enumerate(request.times()):
        entry = sample(index * 0.5, start=instant - timedelta(hours=index * 0.5))
        entry["sun"]["elevation_deg"] = sun_elevation
        entry["earth"]["elevation_deg"] = earth_elevation
        samples.append(entry)
    return {
        "request": request.model_dump(mode="json"),
        "samples": samples,
        "provenance": SYNTHETIC,
    }


def scenario(samples, name):
    return {
        "analysis_id": name,
        "samples": samples,
        "start_utc": samples[0]["utc"],
        "end_utc": samples[-1]["utc"],
        "provenance": SYNTHETIC,
    }


@pytest.mark.parametrize(
    "clearance,expected",
    [(-1, 0), (-0.25, 0), (0, 0.5), (0.25, 1), (1, 1), (0.125, 0.8044988905221147)],
)
def test_uniform_circular_solar_disc(clearance, expected):
    assert solar_disc_fraction(clearance, 0.5) == pytest.approx(expected)


@pytest.mark.parametrize(
    "clearance,diameter", [(float("nan"), 0.5), (0, 0), (0, -1), (0, float("inf"))]
)
def test_invalid_disc_geometry_rejected(clearance, diameter):
    with pytest.raises(ValueError):
        solar_disc_fraction(clearance, diameter)


def test_disc_fraction_is_bounded_monotonic_and_symmetric():
    values = [
        solar_disc_fraction(float(clearance), 0.5)
        for clearance in np.linspace(-0.25, 0.25, 1001)
    ]
    assert all(0 <= value <= 1 for value in values)
    assert all(a <= b for a, b in pairwise(values))
    assert np.asarray(values) + np.asarray(values[::-1]) == pytest.approx(
        np.ones(1001), abs=1e-12
    )


def test_circular_horizon_seam_and_unknown_wedge(observer):
    known = profile(observer, (0, 1, 2, 3))
    assert known.at(315) == pytest.approx(1.5)
    assert known.at(-45) == known.at(315)
    assert known.at(360) == 0
    unknown = profile(observer, (0, None, 2, 3))
    assert unknown.at(0) == 0
    assert unknown.at(45) is None and unknown.at(90) is None and unknown.at(135) is None
    assert unknown.at(225) == 2.5


def test_invalid_horizon_points_rejected(observer):
    with pytest.raises(ValidationError):
        HorizonPoint(azimuth_deg=0, elevation_deg=1, coverage="unknown")
    with pytest.raises(ValidationError):
        HorizonPoint(azimuth_deg=360, elevation_deg=0, coverage="complete")
    with pytest.raises(ValidationError):
        HorizonProfile(
            observer=observer,
            points=(HorizonPoint(azimuth_deg=0, elevation_deg=0, coverage="complete"),)
            * 2,
            provenance=SYNTHETIC,
            method="duplicate",
        )


def test_visibility_partial_sun_and_strict_earth_centre(observer):
    ephemeris = bundle(observer, sun_elevation=0, earth_elevation=0)
    original = deepcopy(ephemeris)
    samples = evaluate_visibility(ephemeris, profile(observer))
    assert samples[0]["sun"]["visible"] is True
    assert samples[0]["sun"]["illumination_fraction"] == 0.5
    assert samples[0]["earth"]["visible"] is False
    assert ephemeris == original


def test_unknown_horizon_remains_unknown(observer):
    samples = evaluate_visibility(bundle(observer), profile(observer, (None, 0, 0, 0)))
    assert samples[0]["sun"]["visible"] is None
    assert samples[0]["sun"]["illumination_fraction"] is None
    assert samples[0]["earth"]["visible"] is None


def test_observer_height_mismatch_is_rejected(observer):
    changed = observer.model_copy(update={"observer_height_m": 5})
    with pytest.raises(ValueError, match="same coordinates"):
        evaluate_visibility(bundle(changed), profile(observer))


def test_missing_ephemeris_endpoint_is_rejected(observer):
    data = bundle(observer)
    data["samples"].pop()
    with pytest.raises(ValueError, match="requested grid"):
        evaluate_visibility(data, profile(observer))


def test_metrics_weight_real_durations_and_exclude_final_endpoint():
    samples = [
        sample(0, False, True),
        sample(0.5, True, False, 0.5),
        sample(2, True, False, 1),
        sample(3, None, None),
    ]
    metrics = calculate_metrics(samples)
    assert metrics["sunlight_hours"] == 1.75
    assert metrics["sunlight_fraction"] == pytest.approx(1.75 / 3)
    assert metrics["max_darkness_hours"] == 0.5
    assert metrics["earth_visible_hours"] == 0.5
    assert metrics["max_earth_occlusion_hours"] == 2.5
    assert metrics["both_visible_hours"] == 0


def test_unknown_time_is_not_classified_as_darkness_or_clear():
    metrics = calculate_metrics(
        [sample(0, None, True), sample(1, False, True), sample(2)]
    )
    assert metrics["sunlight_hours"] is None and metrics["max_darkness_hours"] is None
    assert metrics["earth_visible_hours"] == 2
    assert metrics["both_visible_hours"] is None
    certain_overlap = calculate_metrics([sample(0, None, False), sample(1)])
    assert certain_overlap["both_visible_hours"] == 0


def test_intervals_merge_and_preserve_unknown_gaps():
    samples = [
        sample(0, False),
        sample(0.5, False),
        sample(1, None),
        sample(2, False),
        sample(3),
    ]
    assert visibility_intervals(samples, "sun") == [
        {"start_met_hours": 0, "end_met_hours": 1, "visible": False},
        {"start_met_hours": 1, "end_met_hours": 2, "visible": None},
        {"start_met_hours": 2, "end_met_hours": 3, "visible": False},
    ]


@pytest.mark.parametrize(
    "case", ["duplicate", "nonzero_start", "naive", "utc_mismatch", "nonfinite"]
)
def test_bad_timeline_is_rejected(case):
    samples = [sample(0), sample(1)]
    if case == "duplicate":
        samples[1]["met_hours"] = 0
    elif case == "nonzero_start":
        samples[0]["met_hours"] = 0.5
    elif case == "naive":
        samples[0]["utc"] = "2026-11-15T00:00:00"
    elif case == "utc_mismatch":
        samples[1]["utc"] = "2026-11-15T02:00:00Z"
    else:
        samples[1]["met_hours"] = float("nan")
    with pytest.raises(ValueError):
        validate_timeline(samples)


def test_inconsistent_solar_fraction_is_rejected():
    samples = [sample(0, False), sample(1)]
    samples[0]["sun"]["illumination_fraction"] = 0.5
    with pytest.raises(ValueError, match="disagree"):
        calculate_metrics(samples)


def test_analysis_contract_determinism_and_synthetic_provenance(observer):
    data = bundle(observer, sun_elevation=0, earth_elevation=1)
    analysis = build_analysis(data, profile(observer), slope_deg=9)
    validate_document("analysis", analysis)
    assert analysis["metrics"]["sunlight_hours"] == 1
    assert analysis["metrics"]["both_visible_hours"] == 2
    assert analysis["slope"]["screening_status"] == "CAUTION"
    assert analysis["provenance"]["data_kind"] == "synthetic"
    assert (
        build_analysis(data, profile(observer), slope_deg=9)["analysis_id"]
        == analysis["analysis_id"]
    )
    assert (
        build_analysis(data, profile(observer), slope_deg=10)["analysis_id"]
        != analysis["analysis_id"]
    )


def test_lunadiff_aligns_elapsed_time_across_dates_and_merges_windows():
    start = datetime(2026, 11, 17, tzinfo=UTC)
    a = scenario(
        [
            sample(0, True, False),
            sample(1, True, False),
            sample(2, True, False),
            sample(3),
        ],
        "a",
    )
    b = scenario(
        [
            sample(0, False, True, start=start),
            sample(0.5, False, True, start=start),
            sample(2, True, False, start=start),
            sample(3, start=start),
        ],
        "b",
    )
    a["metrics"] = {"sunlight_hours": 99999}
    result = calculate_luna_diff(a, b)
    validate_document("diff", result)
    assert result["deltas"] == {
        "sunlight_hours": -2,
        "max_darkness_hours": 2,
        "earth_visible_hours": 2,
    }
    intervals = {item["type"]: item for item in result["diagnostic_intervals"]}
    assert intervals["LOST_SUNLIGHT"]["start_met_hours"] == 0
    assert intervals["LOST_SUNLIGHT"]["end_met_hours"] == 2
    assert intervals["GAINED_EARTH_VISIBILITY"]["end_met_hours"] == 2
    assert "At interval start MET" in intervals["LOST_SUNLIGHT"]["reason"]


def test_lunadiff_handles_both_directions_and_unknown_gap():
    a = scenario([sample(0, False), sample(1, True), sample(2, True), sample(3)], "a")
    b = scenario([sample(0, True), sample(1, None), sample(2, False), sample(3)], "b")
    diff = calculate_luna_diff(a, b)
    assert [item["type"] for item in diff["diagnostic_intervals"]] == [
        "GAINED_SUNLIGHT",
        "LOST_SUNLIGHT",
    ]
    assert diff["deltas"]["sunlight_hours"] is None
    assert diff["diagnostic_intervals"][1]["start_met_hours"] == 2


def test_partial_disc_difference_changes_hours_without_boolean_window():
    a = scenario([sample(0, True, True, 0.25), sample(1)], "a")
    b = scenario([sample(0, True, True, 0.75), sample(1)], "b")
    diff = calculate_luna_diff(a, b)
    assert diff["deltas"]["sunlight_hours"] == 0.5
    assert diff["diagnostic_intervals"] == []


def test_lunadiff_rejects_different_durations():
    with pytest.raises(ValueError, match="equal mission"):
        calculate_luna_diff(
            scenario([sample(0), sample(1)], "a"), scenario([sample(0), sample(2)], "b")
        )


def test_spherical_flat_surface_matches_analytic_horizon(observer):
    calculated = compute_horizon(
        observer,
        lambda lon, lat: np.zeros(lon.shape),
        provenance=SYNTHETIC,
        azimuth_step_deg=90,
        max_radius_m=10000,
    )
    expected = -math.degrees(math.acos(1737400 / 1737402))
    assert all(
        point.elevation_deg == pytest.approx(expected, abs=1e-5)
        for point in calculated.points
    )
    assert all(point.elevation_deg < 0 for point in calculated.points)


def test_ridge_is_on_true_east_at_nonzero_lunar_longitude(observer):
    geod = Geod(a=1737400, b=1737400)

    def ridge(lon, lat):
        bearing, _, distance = geod.inv(
            np.full(lon.shape, observer.longitude_deg),
            np.full(lat.shape, observer.latitude_deg),
            lon,
            lat,
        )
        return np.where(
            (np.abs(bearing - 90) < 1) & (distance >= 990) & (distance <= 1010),
            100.0,
            0.0,
        )

    calculated = compute_horizon(
        observer, ridge, provenance=SYNTHETIC, azimuth_step_deg=90, max_radius_m=5000
    )
    assert calculated.at(90) > 5
    assert calculated.at(0) < 0 and calculated.at(180) < 0


def test_nodata_ray_stays_unknown(observer):
    def missing(lon, lat):
        heights = np.zeros(lon.shape)
        heights[0] = np.nan
        return heights

    calculated = compute_horizon(
        observer, missing, provenance=SYNTHETIC, azimuth_step_deg=90, max_radius_m=2000
    )
    assert calculated.points[0].coverage == "unknown"
    assert calculated.points[0].elevation_deg is None


@pytest.mark.parametrize(
    "parameters",
    [
        {"radial_step_m": 0},
        {"max_radius_m": -1},
        {"azimuth_step_deg": 7},
        {"batch_size": 0},
        {"radial_step_m": 1e-9},
    ],
)
def test_invalid_horizon_parameters_rejected(observer, parameters):
    with pytest.raises(ValueError):
        compute_horizon(
            observer,
            lambda lon, lat: np.zeros(lon.shape),
            provenance=SYNTHETIC,
            **parameters,
        )
