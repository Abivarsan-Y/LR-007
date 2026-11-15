"""
Unit and integration tests for Rover Traverse Engine (Manual & Automatic Modes).
Verifies slope constraints, solar regeneration, battery budget, and Base Pod LOS.
"""

from pathlib import Path
import numpy as np
import pytest

from backend.terrain.ingest import LolaDemReader
from backend.terrain.traverse import (
    compute_point_slope_deg,
    check_surface_los,
    estimate_solar_illumination,
    compute_leg_power,
    suggest_next_waypoints,
    plan_automatic_traverse,
    DEFAULT_BATTERY_CAPACITY_WH,
)

DEM_TIF_PATH = Path("data/raw/LDEM_80S_80MPP_ADJ.TIF")


@pytest.fixture(scope="module")
def real_dem_reader():
    if not DEM_TIF_PATH.exists():
        pytest.skip("Full LOLA GeoTIFF DEM not found")
    reader = LolaDemReader(DEM_TIF_PATH)
    yield reader
    reader.close()


def test_compute_leg_power_flat_sunlit():
    # 300 m on flat ground in full sunlight
    new_bat, delta, reserve = compute_leg_power(
        distance_m=300.0,
        slope_deg=0.0,
        illumination_fraction=1.0,
        current_battery_wh=1000.0,
    )
    # Travel time: 300 / (0.5 * 3600) = 0.1667 h
    # Drive power: 150 W, Gen power: 350 W -> Net: +200 W
    # Delta: +33.33 Wh
    assert delta > 0.0
    assert new_bat > 1000.0
    assert reserve > (1000.0 / DEFAULT_BATTERY_CAPACITY_WH) * 100.0


def test_compute_leg_power_uphill_shadow():
    # 300 m uphill (10 deg) in complete shadow
    new_bat, delta, reserve = compute_leg_power(
        distance_m=300.0,
        slope_deg=10.0,
        illumination_fraction=0.0,
        current_battery_wh=1000.0,
    )
    # Drive power: 150 * (1 + 1.8 * sin(10 deg)) > 150 W
    # Gen power: 0 W -> Net negative
    assert delta < 0.0
    assert new_bat < 1000.0


def test_check_surface_los_same_point(real_dem_reader):
    has_los, clearance = check_surface_los(
        real_dem_reader,
        base_lat=-89.5,
        base_lon=120.0,
        rover_lat=-89.5,
        rover_lon=120.0,
    )
    assert has_los is True
    assert clearance >= 0.0


def test_manual_mode_suggest_next_waypoints(real_dem_reader):
    # Origin near Connecting Ridge, Target 1 km away
    start_lat = -89.465
    start_lon = -137.86
    target_lat = -89.475
    target_lon = -137.80

    result = suggest_next_waypoints(
        reader=real_dem_reader,
        current_lat=start_lat,
        current_lon=start_lon,
        target_lat=target_lat,
        target_lon=target_lon,
        base_lat=start_lat,
        base_lon=start_lon,
        current_battery_wh=1000.0,
        step_distance_m=250.0,
        num_candidates=8,
    )

    assert result["mode"] == "manual"
    assert len(result["candidates"]) == 8
    assert result["target_destination"]["initial_distance_to_target_m"] > 0

    best = result["candidates"][0]
    assert "coordinates" in best
    assert "slope_deg" in best
    assert "slope_band" in best
    assert "illumination_fraction" in best
    assert "battery_wh" in best
    assert "los_to_base" in best
    assert "distance_to_target_m" in best
    # The best candidate should make forward distance progress towards target
    assert best["distance_to_target_m"] < result["target_destination"]["initial_distance_to_target_m"]


def test_automatic_mode_traverse_planning(real_dem_reader):
    # Short traverse: 800 m route
    start_lat = -89.465
    start_lon = -137.86
    target_lat = -89.472
    target_lon = -137.84

    plan = plan_automatic_traverse(
        reader=real_dem_reader,
        start_lat=start_lat,
        start_lon=start_lon,
        target_lat=target_lat,
        target_lon=target_lon,
        initial_battery_wh=1000.0,
        step_m=200.0,
        max_steps=10,
    )

    assert plan["mode"] == "automatic"
    assert plan["status"] in {"OPTIMAL", "FEASIBLE"}
    assert len(plan["waypoints"]) >= 2
    assert plan["summary"]["total_traverse_distance_m"] > 0
    assert plan["summary"]["max_slope_deg"] <= 15.0  # Respects trafficability limit

    # Initial waypoint is start
    assert plan["waypoints"][0]["action"] == "START_BASE_POD"
    # Final waypoint is research destination
    assert plan["waypoints"][-1]["action"] in {"ARRIVE_RESEARCH_TARGET", "STEP_10"}


def test_api_traverse_manual_endpoint():
    from starlette.testclient import TestClient
    from backend.app.main import create_app

    client = TestClient(create_app())
    response = client.post(
        "/api/traverse/manual",
        json={
            "current_latitude_deg": -89.465,
            "current_longitude_deg": -137.86,
            "target_latitude_deg": -89.475,
            "target_longitude_deg": -137.80,
            "current_battery_wh": 1000.0,
            "step_distance_m": 250.0,
            "num_candidates": 6,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "manual"
    assert len(data["candidates"]) == 6
    assert "target_destination" in data


def test_api_traverse_automatic_endpoint():
    from starlette.testclient import TestClient
    from backend.app.main import create_app

    client = TestClient(create_app())
    response = client.post(
        "/api/traverse/automatic",
        json={
            "start_latitude_deg": -89.465,
            "start_longitude_deg": -137.86,
            "target_latitude_deg": -89.472,
            "target_longitude_deg": -137.84,
            "initial_battery_wh": 1000.0,
            "step_m": 200.0,
            "max_steps": 8,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "automatic"
    assert "summary" in data
    assert len(data["waypoints"]) >= 2

