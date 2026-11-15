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
    compute_step_kinematics_and_power,
    evaluate_surface_point,
    suggest_next_waypoints,
    plan_automatic_traverse,
    DEFAULT_BATTERY_CAPACITY_WH,
    REGEN_TARGET_BATTERY_WH,
    MIN_REGEN_ILLUMINATION,
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


def test_regional_crater_and_rim_automatic_traverse(real_dem_reader):
    # Connecting Ridge (Site 01) -> Shackleton Crater Rim (Site 04, ~18.6 km)
    shackleton_plan = plan_automatic_traverse(
        reader=real_dem_reader,
        start_lat=-89.463158,
        start_lon=-137.501985,
        target_lat=-89.90,
        target_lon=0.0,
        initial_battery_wh=1000.0,
        step_m=1500.0,
        max_steps=40,
    )
    assert shackleton_plan["status"] in {"OPTIMAL", "FEASIBLE"}
    assert shackleton_plan["waypoints"][-1]["action"] == "ARRIVE_RESEARCH_TARGET"
    assert shackleton_plan["waypoints"][-1]["distance_to_target_m"] == 0.0

    # Connecting Ridge (Site 01) -> Haworth Crater Interior (Site 09, ~90.7 km)
    haworth_plan = plan_automatic_traverse(
        reader=real_dem_reader,
        start_lat=-89.463158,
        start_lon=-137.501985,
        target_lat=-87.40,
        target_lon=-4.80,
        initial_battery_wh=1000.0,
        step_m=5000.0,
        max_steps=40,
    )
    assert haworth_plan["status"] in {"OPTIMAL", "FEASIBLE"}
    assert haworth_plan["waypoints"][-1]["action"] == "ARRIVE_RESEARCH_TARGET"
    assert haworth_plan["waypoints"][-1]["distance_to_target_m"] == 0.0


def test_variable_length_stepping_and_exact_target_snap(real_dem_reader):
    from pyproj import Geod
    from backend.terrain.geometry import R_MOON_M

    geod = Geod(a=R_MOON_M, b=R_MOON_M)
    start_lat, start_lon = -89.465, -137.86

    # Long target (~1200 m away): candidates across bearings adapt step_distance_m to terrain
    far_lon, far_lat, _ = geod.fwd(start_lon, start_lat, 135.0, 1200.0)
    far_res = suggest_next_waypoints(
        reader=real_dem_reader,
        current_lat=start_lat,
        current_lon=start_lon,
        target_lat=float(far_lat),
        target_lon=float(far_lon),
        base_lat=start_lat,
        base_lon=start_lon,
        current_battery_wh=1000.0,
        step_distance_m=250.0,
        num_candidates=8,
    )
    step_lengths = {c["step_distance_m"] for c in far_res["candidates"]}
    assert len(step_lengths) >= 2

    # Within 1.45x nominal reach (~320 m away with 250 m scale): top candidate snaps directly to target (0m rem)
    near_lon, near_lat, _ = geod.fwd(start_lon, start_lat, 120.0, 320.0)
    snap_res = suggest_next_waypoints(
        reader=real_dem_reader,
        current_lat=start_lat,
        current_lon=start_lon,
        target_lat=float(near_lat),
        target_lon=float(near_lon),
        base_lat=start_lat,
        base_lon=start_lon,
        current_battery_wh=1000.0,
        step_distance_m=250.0,
        num_candidates=8,
    )
    top = snap_res["candidates"][0]
    assert top["distance_to_target_m"] == 0.0
    assert abs(top["step_distance_m"] - 320.0) < 5.0


def test_compute_step_kinematics_solar_regen_hold():
    # Steep 8 deg leg starting below REGEN_TRIGGER_BATTERY_WH (580 Wh) must trigger a stationary regen hold
    kin = compute_step_kinematics_and_power(
        distance_m=450.0,
        slope_deg=8.0,
        illumination_fraction=0.9,
        current_battery_wh=560.0,
        current_met_hours=1.5,
    )
    assert 0.175 <= kin["effective_speed_mps"] < 0.5
    assert kin["drive_duration_hours"] > 0.25
    assert kin["regen_dwell_hours"] > 0.0
    assert kin["regen_energy_wh"] > 0.0
    assert kin["new_battery_wh"] == REGEN_TARGET_BATTERY_WH
    assert kin["arrival_met_hours"] > 1.5
    assert kin["departure_met_hours"] > kin["arrival_met_hours"]


def test_traverse_met_hours_and_sun_propagation(real_dem_reader):
    plan = plan_automatic_traverse(
        reader=real_dem_reader,
        start_lat=-89.463158,
        start_lon=-137.501985,
        target_lat=-89.90,
        target_lon=0.0,
        initial_battery_wh=620.0,
        step_m=2500.0,
        max_steps=20,
        sun_azimuth_deg=180.0,
        sun_elevation_deg=1.0,
        start_met_hours=0.0,
    )
    wps = plan["waypoints"]
    assert wps[0]["met_hours"] == 0.0
    assert wps[0]["arrival_met_hours"] == 0.0
    for idx in range(1, len(wps)):
        assert wps[idx]["arrival_met_hours"] > wps[idx - 1]["met_hours"]
        assert wps[idx]["met_hours"] >= wps[idx]["arrival_met_hours"]
        assert "sun_azimuth_deg" in wps[idx]
    assert plan["summary"]["total_traverse_hours"] > 0.0
    assert "total_regen_hours" in plan["summary"]
    assert "regen_stops_count" in plan["summary"]
    assert plan["summary"]["regen_stops_count"] >= 1


def test_los_enforcement_manual_candidates(real_dem_reader):
    res = suggest_next_waypoints(
        reader=real_dem_reader,
        current_lat=-89.465,
        current_lon=-137.86,
        target_lat=-89.472,
        target_lon=-137.84,
        base_lat=-89.465,
        base_lon=-137.86,
        current_battery_wh=1000.0,
        step_distance_m=300.0,
        num_candidates=8,
        current_met_hours=0.0,
    )
    valid = [c for c in res["candidates"] if c["is_valid"]]
    assert valid
    assert all(c["los_to_base"] for c in valid)


def test_point_evaluate_and_api_endpoint(real_dem_reader):
    from fastapi.testclient import TestClient
    from backend.app.main import create_app

    pt = evaluate_surface_point(
        reader=real_dem_reader,
        lat_deg=-89.463158,
        lon_deg=-137.501985,
        observer_height_m=2.0,
    )
    assert pt["in_dem_coverage"] is True
    assert isinstance(pt["elevation_m"], float)
    assert isinstance(pt["slope_deg"], float)
    assert len(pt["horizon_angles"]) == 360

    app = create_app()
    client = TestClient(app)

    resp_in = client.post(
        "/api/point/evaluate",
        json={"latitude_deg": -89.463158, "longitude_deg": -137.501985, "observer_height_m": 2.0},
    )
    assert resp_in.status_code == 200
    body_in = resp_in.json()
    assert body_in["in_dem_coverage"] is True
    assert len(body_in["horizon_angles"]) == 360

    resp_out = client.post(
        "/api/point/evaluate",
        json={"latitude_deg": 0.0, "longitude_deg": 0.0, "observer_height_m": 2.0},
    )
    assert resp_out.status_code == 200
    assert resp_out.json()["in_dem_coverage"] is False


def test_no_solar_regeneration_in_zero_sunlight_and_full_base_los(real_dem_reader):
    # Batteries must strictly discharge with zero regeneration in 0% sunlight
    dark_kin = compute_step_kinematics_and_power(
        distance_m=450.0,
        slope_deg=8.0,
        illumination_fraction=0.0,
        current_battery_wh=450.0,
        current_met_hours=2.0,
    )
    assert dark_kin["regen_dwell_hours"] == 0.0
    assert dark_kin["regen_energy_wh"] == 0.0
    assert dark_kin["new_battery_wh"] < 450.0

    # Regional traverses into PSR floors & rims must maintain 100% Base Pod LOS, >=20% reserve, and never regen in shadow
    targets = [
        ("Shackleton Floor", -89.6269, 118.7398, 1500.0),
        ("Shackleton Rim", -89.90, 0.0, 1500.0),
        ("Haworth Floor", -87.40, -4.80, 5000.0),
    ]
    for name, tlat, tlon, step_m in targets:
        plan = plan_automatic_traverse(
            reader=real_dem_reader,
            start_lat=-89.463158,
            start_lon=-137.501985,
            target_lat=tlat,
            target_lon=tlon,
            initial_battery_wh=1000.0,
            step_m=step_m,
            max_steps=40,
        )
        assert plan["summary"]["base_los_fraction"] == 1.0, f"{name} lost Base Pod LOS"
        assert all(wp["los_to_base"] for wp in plan["waypoints"]), f"{name} waypoint missing Base Pod LOS"
        assert plan["summary"]["min_battery_wh"] >= 240.0, f"{name} dropped below 20% safety reserve"
        for wp in plan["waypoints"]:
            if wp["illumination_fraction"] < MIN_REGEN_ILLUMINATION:
                assert wp["regen_dwell_hours"] == 0.0, f"{name} regenerated in shadow at WP {wp['waypoint_index']}"
                assert wp["action"] != "SOLAR_REGEN_HOLD", f"{name} set SOLAR_REGEN_HOLD in shadow"


def test_return_budget_and_regen_spot_protection(real_dem_reader):
    # At ~700m+ from Base Pod with low battery (460 Wh), forward moves cannot safely return to Base Pod
    res = suggest_next_waypoints(
        reader=real_dem_reader,
        current_lat=-89.44,
        current_lon=-137.50,
        base_lat=-89.463158,
        base_lon=-137.501985,
        target_lat=-89.40,
        target_lon=-137.50,
        current_battery_wh=460.0,
        step_distance_m=400.0,
        num_candidates=6,
    )
    cur = res["current_position"]
    for key in (
        "distance_to_base_m",
        "return_to_base_wh",
        "distance_to_sunlit_m",
        "nearest_sunlit_illum_pct",
        "reach_sunlit_wh",
        "required_return_wh",
        "can_return_to_base",
    ):
        assert key in cur
    assert cur["distance_to_base_m"] > 600.0
    assert cur["can_return_to_base"] is True

    cands = res["candidates"]
    assert len(cands) == 6
    assert cands[0]["candidate_id"] == "cand_regen_spot"
    assert cands[0]["is_regen_spot"] is True
    assert cands[0]["candidate_type"] == "REGEN_SPOT"
    assert cands[0]["is_valid"] is True
    assert cands[0]["regen_energy_wh"] > 0.0

    forward = [c for c in cands if not c.get("is_regen_spot")]
    assert len(forward) == 5
    for cand in forward:
        assert cand["can_return_to_base"] is False
        assert cand["is_valid"] is False
        assert any("return to Base Pod" in reason for reason in cand["rejection_reasons"])


def test_dataset_solar_geometry_and_time_varying_illumination(real_dem_reader):
    import json
    from pathlib import Path
    from backend.terrain.traverse import advance_solar_geometry, estimate_solar_illumination

    fixture_path = Path("backend/tests/fixtures/science/site01/analysis_nominal.json")
    samples = json.loads(fixture_path.read_text(encoding="utf-8"))["samples"]
    s0 = samples[0]
    s20 = samples[20]
    az20, el20 = advance_solar_geometry(
        s0["sun"]["azimuth_deg"], s0["sun"]["elevation_deg"], s20["met_hours"]
    )
    assert abs(az20 - s20["sun"]["azimuth_deg"]) < 1e-4
    assert abs(el20 - s20["sun"]["elevation_deg"]) < 1e-4

    # Sunlit/shadowed terrain transitions dynamically as MET advances
    az0, el0 = advance_solar_geometry(s0["sun"]["azimuth_deg"], s0["sun"]["elevation_deg"], 0.0)
    az120, el120 = advance_solar_geometry(s0["sun"]["azimuth_deg"], s0["sun"]["elevation_deg"], 120.0)
    illum_rim_0 = estimate_solar_illumination(real_dem_reader, -89.90, 0.0, az0, el0)
    illum_rim_120 = estimate_solar_illumination(real_dem_reader, -89.90, 0.0, az120, el120)
    assert illum_rim_0 > 0.5 and illum_rim_120 < 0.1

    illum_slope_0 = estimate_solar_illumination(real_dem_reader, -89.55, -137.50, az0, el0)
    illum_slope_120 = estimate_solar_illumination(real_dem_reader, -89.55, -137.50, az120, el120)
    assert illum_slope_0 < 0.1 and illum_slope_120 > 0.5


def test_local_automatic_traverse_executes_regen_hold_and_arrives(real_dem_reader):
    plan = plan_automatic_traverse(
        reader=real_dem_reader,
        start_lat=-89.463158,
        start_lon=-137.501985,
        target_lat=-89.40,
        target_lon=-137.50,
        initial_battery_wh=520.0,
        step_m=400.0,
        max_steps=15,
    )
    assert plan["status"] == "OPTIMAL"
    wps = plan["waypoints"]
    assert wps[-1]["action"] == "ARRIVE_RESEARCH_TARGET"
    assert wps[-1]["distance_to_target_m"] == 0.0
    assert any(wp["action"] == "SOLAR_REGEN_HOLD" and wp["regen_energy_wh"] > 0.0 for wp in wps)
    for wp in wps:
        for key in ("distance_to_base_m", "return_to_base_wh", "distance_to_sunlit_m", "required_return_wh", "can_return_to_base"):
            assert key in wp
    for idx in range(1, len(wps)):
        assert wps[idx]["arrival_met_hours"] > wps[idx - 1]["met_hours"]





