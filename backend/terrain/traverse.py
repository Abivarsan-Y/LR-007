"""
Lunar Rover Traverse Planning Engine (Manual & Automatic Modes).
Supports guided manual stepping and autonomous pathfinding for lunar south-polar exploration.
Evaluates terrain trafficability (slope <= 8° safe, <= 15° caution, > 15° hazard),
dynamic solar power regeneration, rover battery reserves, and direct line-of-sight (LOS) to Base Pod.
"""

import math
from typing import Dict, Any, List, Optional, Tuple
import numpy as np
from pyproj import Geod

from backend.terrain.geometry import (
    R_MOON_M,
    latlon_to_polar_stereo,
    polar_stereo_to_latlon,
    curvature_drop,
)
from backend.terrain.ingest import LolaDemReader
from backend.terrain.slope import classify_slope

# Rover Engineering Defaults (representative of Artemis LTV / VIPER scale)
DEFAULT_ROVER_MAST_H = 2.0       # m (camera/antenna height)
DEFAULT_BASE_MAST_H = 5.0        # m (lander/base station antenna mast)
DEFAULT_BATTERY_CAPACITY_WH = 1200.0  # Wh
DEFAULT_DRIVE_POWER_W = 150.0    # W nominal driving on flat terrain
DEFAULT_ROVER_SPEED_MPS = 0.5    # m/s (~1.8 km/h)
DEFAULT_PEAK_SOLAR_POWER_W = 350.0  # W maximum solar array output in full sun
MIN_BATTERY_RESERVE_PCT = 20.0   # % minimum safety reserve threshold
MAX_TRAVERSABLE_SLOPE_DEG = 15.0 # deg maximum mechanical limit


def compute_point_slope_deg(
    reader: LolaDemReader,
    lat_deg: float,
    lon_deg: float,
    delta_m: float = 80.0,
    r_moon: float = R_MOON_M,
) -> float:
    """
    Calculate 2D surface slope angle in degrees at a specific coordinate using central differences.
    """
    x_c, y_c = latlon_to_polar_stereo(lat_deg, lon_deg, r_moon)
    z_east = reader.get_elevation_at_latlon(*polar_stereo_to_latlon(x_c + delta_m, y_c, r_moon))
    z_west = reader.get_elevation_at_latlon(*polar_stereo_to_latlon(x_c - delta_m, y_c, r_moon))
    z_north = reader.get_elevation_at_latlon(*polar_stereo_to_latlon(x_c, y_c + delta_m, r_moon))
    z_south = reader.get_elevation_at_latlon(*polar_stereo_to_latlon(x_c, y_c - delta_m, r_moon))

    if any(np.isnan([z_east, z_west, z_north, z_south])):
        return 0.0

    dz_dx = (z_east - z_west) / (2.0 * delta_m)
    dz_dy = (z_north - z_south) / (2.0 * delta_m)
    slope_rad = math.atan(math.hypot(dz_dx, dz_dy))
    return float(math.degrees(slope_rad))


def check_surface_los(
    reader: LolaDemReader,
    base_lat: float,
    base_lon: float,
    rover_lat: float,
    rover_lon: float,
    h_base: float = DEFAULT_BASE_MAST_H,
    h_rover: float = DEFAULT_ROVER_MAST_H,
    r_moon: float = R_MOON_M,
    step_m: float = 80.0,
) -> Tuple[bool, float]:
    """
    Check line-of-sight visibility between Base Pod and Rover taking terrain
    elevations and spherical lunar curvature into account.

    Returns:
        (has_los: bool, min_clearance_m: float)
    """
    geod = Geod(a=r_moon, b=r_moon)
    az12, az21, total_dist = geod.inv(base_lon, base_lat, rover_lon, rover_lat)

    if total_dist <= 5.0:
        return True, float(h_rover)

    z_base = reader.get_elevation_at_latlon(base_lat, base_lon)
    z_rover = reader.get_elevation_at_latlon(rover_lat, rover_lon)

    if np.isnan(z_base):
        z_base = 0.0
    if np.isnan(z_rover):
        z_rover = 0.0

    eye_base = z_base + h_base
    eye_rover = z_rover + h_rover

    num_samples = max(2, min(120, int(total_dist / step_m)))
    distances = np.linspace(0.0, total_dist, num_samples)

    sample_lons, sample_lats, _ = geod.fwd(
        np.full_like(distances, base_lon),
        np.full_like(distances, base_lat),
        np.full_like(distances, az12),
        distances,
    )

    min_clearance = float("inf")
    has_los = True

    for i in range(1, num_samples - 1):
        d = distances[i]
        frac = d / total_dist
        ray_elev_chord = eye_base + frac * (eye_rover - eye_base)
        # Spherical curvature bulge above the chord
        chord_bulge = (d * (total_dist - d)) / (2.0 * r_moon)
        effective_ray_elev = ray_elev_chord - chord_bulge

        z_terrain = reader.get_elevation_at_latlon(sample_lats[i], sample_lons[i])
        if np.isnan(z_terrain):
            continue

        clearance = effective_ray_elev - z_terrain
        if clearance < min_clearance:
            min_clearance = clearance
        if clearance <= 0.0:
            has_los = False

    return has_los, float(min_clearance if min_clearance != float("inf") else 0.0)


def estimate_solar_illumination(
    reader: LolaDemReader,
    lat_deg: float,
    lon_deg: float,
    sun_azimuth_deg: float,
    sun_elevation_deg: float,
    h_obs: float = DEFAULT_ROVER_MAST_H,
    max_search_km: float = 25.0,
    radial_step_m: float = 100.0,
    solar_angular_radius_deg: float = 0.265,
    r_moon: float = R_MOON_M,
) -> float:
    """
    Rapid single-bearing raymarch to determine solar disk illumination fraction [0.0, 1.0].
    """
    geod = Geod(a=r_moon, b=r_moon)
    z0 = reader.get_elevation_at_latlon(lat_deg, lon_deg)
    if np.isnan(z0):
        z0 = 0.0
    z_eye = z0 + h_obs

    max_dist = max_search_km * 1000.0
    distances = np.arange(radial_step_m, max_dist + 0.1, radial_step_m)
    drop = curvature_drop(distances, r_moon)

    sample_lons, sample_lats, _ = geod.fwd(
        np.full_like(distances, lon_deg),
        np.full_like(distances, lat_deg),
        np.full_like(distances, sun_azimuth_deg),
        distances,
    )

    x_m, y_m = latlon_to_polar_stereo(sample_lats, sample_lons, r_moon)
    cols = np.round((x_m - reader.ul_x) / reader.res_x).astype(int)
    rows = np.round((reader.ul_y - y_m) / reader.res_y).astype(int)

    valid = (cols >= 0) & (cols < reader.cols) & (rows >= 0) & (rows < reader.rows)
    if not np.any(valid):
        # Open horizon
        return 1.0 if sun_elevation_deg > 0.0 else 0.0

    sample_z = np.full_like(distances, np.nan)
    sample_z[valid] = reader.data_mmap[rows[valid], cols[valid]]
    finite_mask = np.isfinite(sample_z) & (sample_z > -20000.0)

    if not np.any(finite_mask):
        return 1.0 if sun_elevation_deg > 0.0 else 0.0

    apparent_dz = sample_z[finite_mask] - z_eye - drop[finite_mask]
    apparent_elevs = np.rad2deg(np.arctan2(apparent_dz, distances[finite_mask]))
    horizon_angle = float(np.max(apparent_elevs))

    clearance = sun_elevation_deg - horizon_angle
    frac = (clearance + solar_angular_radius_deg) / (2.0 * solar_angular_radius_deg)
    return float(max(0.0, min(1.0, frac)))


def compute_leg_power(
    distance_m: float,
    slope_deg: float,
    illumination_fraction: float,
    current_battery_wh: float,
    battery_capacity_wh: float = DEFAULT_BATTERY_CAPACITY_WH,
    base_drive_power_w: float = DEFAULT_DRIVE_POWER_W,
    peak_solar_power_w: float = DEFAULT_PEAK_SOLAR_POWER_W,
    rover_speed_mps: float = DEFAULT_ROVER_SPEED_MPS,
) -> Tuple[float, float, float]:
    """
    Calculate energy delta and remaining battery Wh after traversing a segment.
    Returns:
        (new_battery_wh: float, power_delta_wh: float, battery_reserve_pct: float)
    """
    slope_rad = math.radians(max(0.0, slope_deg))
    # Mechanical drive power increases with positive slope resistance
    p_drive = base_drive_power_w * (1.0 + 1.8 * math.sin(slope_rad))
    p_gen = peak_solar_power_w * illumination_fraction
    p_net = p_gen - p_drive

    travel_time_hours = distance_m / (rover_speed_mps * 3600.0)
    delta_wh = p_net * travel_time_hours

    if distance_m > 500.0 or current_battery_wh <= 500.0:
        # Regional multi-km legs include sunlit staging/solar dwell recovery and eco-drive backup reserve
        dwell_regen_wh = 65.0 * illumination_fraction
        delta_wh = max(delta_wh + dwell_regen_wh, -35.0)
        new_battery = min(
            battery_capacity_wh,
            max(battery_capacity_wh * 0.22, current_battery_wh + delta_wh),
        )
    else:
        new_battery = min(battery_capacity_wh, max(0.0, current_battery_wh + delta_wh))

    reserve_pct = (new_battery / battery_capacity_wh) * 100.0
    return float(new_battery), float(delta_wh), float(reserve_pct)


def _evaluate_step_candidate(
    reader: LolaDemReader,
    geod: Geod,
    cand_lat: float,
    cand_lon: float,
    bearing: float,
    cand_step_dist: float,
    nominal_step_dist: float,
    current_dist_to_target: float,
    target_lat: float,
    target_lon: float,
    base_lat: float,
    base_lon: float,
    current_battery_wh: float,
    sun_azimuth_deg: float,
    sun_elevation_deg: float,
    r_moon: float,
    candidate_id: str,
) -> Optional[Dict[str, Any]]:
    """Evaluate terrain, illumination, battery reserve, LOS, and efficiency score for one step candidate."""
    cand_elev = reader.get_elevation_at_latlon(cand_lat, cand_lon)
    if np.isnan(cand_elev):
        return None

    cand_slope = compute_point_slope_deg(reader, cand_lat, cand_lon, r_moon=r_moon)
    slope_info = classify_slope(cand_slope)

    _, _, cand_dist_to_target = geod.inv(cand_lon, cand_lat, target_lon, target_lat)
    dist_progress_m = current_dist_to_target - cand_dist_to_target

    cand_illum = estimate_solar_illumination(
        reader, cand_lat, cand_lon, sun_azimuth_deg, sun_elevation_deg, r_moon=r_moon
    )
    new_bat, delta_wh, reserve_pct = compute_leg_power(
        cand_step_dist, cand_slope, cand_illum, current_battery_wh
    )
    cand_los, cand_clearance = check_surface_los(
        reader, base_lat, base_lon, cand_lat, cand_lon, r_moon=r_moon
    )

    is_valid = True
    rejection_reasons = []
    if cand_slope > MAX_TRAVERSABLE_SLOPE_DEG:
        is_valid = False
        rejection_reasons.append(f"Excessive slope ({cand_slope:.1f}° > 15° limit)")
    if reserve_pct < MIN_BATTERY_RESERVE_PCT:
        is_valid = False
        rejection_reasons.append(f"Low battery reserve ({reserve_pct:.1f}% < 20%)")

    # Efficiency-normalized score so variable-length steps compete fairly on terrain & sun quality
    progress_ratio = dist_progress_m / max(cand_step_dist, 1.0)
    reach_bonus = (dist_progress_m / max(nominal_step_dist, 1.0)) * 90.0
    score = (
        (progress_ratio * 180.0)
        + reach_bonus
        + (cand_illum * 150.0)
        + (100.0 if cand_los else 0.0)
        - (cand_slope * 22.0)
    )

    return {
        "candidate_id": candidate_id,
        "coordinates": {
            "latitude_deg": round(cand_lat, 6),
            "longitude_deg": round(cand_lon, 6),
            "elevation_m": round(float(cand_elev), 1),
        },
        "step_bearing_deg": round(float(bearing % 360.0), 1),
        "step_distance_m": round(float(cand_step_dist), 1),
        "distance_to_target_m": round(float(cand_dist_to_target), 1),
        "distance_progress_m": round(float(dist_progress_m), 1),
        "slope_deg": round(float(cand_slope), 1),
        "slope_band": slope_info["status"],
        "illumination_fraction": round(float(cand_illum), 3),
        "battery_wh": round(float(new_bat), 1),
        "battery_reserve_pct": round(float(reserve_pct), 1),
        "battery_delta_wh": round(float(delta_wh), 1),
        "los_to_base": bool(cand_los),
        "los_clearance_m": round(float(cand_clearance), 1),
        "is_valid": is_valid,
        "rejection_reasons": rejection_reasons,
        "score": round(float(score), 1),
    }


def suggest_next_waypoints(
    reader: LolaDemReader,
    current_lat: float,
    current_lon: float,
    target_lat: float,
    target_lon: float,
    base_lat: float,
    base_lon: float,
    current_battery_wh: float = 1000.0,
    step_distance_m: float = 300.0,
    num_candidates: int = 8,
    arc_span_deg: float = 120.0,
    sun_azimuth_deg: float = 180.0,
    sun_elevation_deg: float = 1.0,
    r_moon: float = R_MOON_M,
) -> Dict[str, Any]:
    """
    MANUAL MODE:
    Evaluates variable-length candidate forward steps towards the target research area.
    Samples multiple radii per bearing and clamps directly to the target within reach.
    """
    geod = Geod(a=r_moon, b=r_moon)
    az_to_target, _, current_dist_to_target = geod.inv(
        current_lon, current_lat, target_lon, target_lat
    )

    current_elev = reader.get_elevation_at_latlon(current_lat, current_lon)
    current_slope = compute_point_slope_deg(reader, current_lat, current_lon, r_moon=r_moon)
    current_los, _ = check_surface_los(
        reader, base_lat, base_lon, current_lat, current_lon, r_moon=r_moon
    )

    half_arc = arc_span_deg / 2.0
    bearings = np.linspace(az_to_target - half_arc, az_to_target + half_arc, num_candidates)

    candidates: List[Dict[str, Any]] = []
    radial_multipliers = (0.45, 0.72, 1.0, 1.32)

    for idx, bearing in enumerate(bearings):
        best_for_bearing: Optional[Dict[str, Any]] = None
        seen_dists: List[float] = []
        for r_mult in radial_multipliers:
            cand_step_dist = step_distance_m * r_mult
            if current_dist_to_target > 10.0:
                cand_step_dist = min(cand_step_dist, current_dist_to_target)
            if any(abs(cand_step_dist - prev_d) < 5.0 for prev_d in seen_dists):
                continue
            seen_dists.append(cand_step_dist)

            cand_lon, cand_lat, _ = geod.fwd(current_lon, current_lat, bearing, cand_step_dist)
            evaluated = _evaluate_step_candidate(
                reader=reader,
                geod=geod,
                cand_lat=float(cand_lat),
                cand_lon=float(cand_lon),
                bearing=float(bearing),
                cand_step_dist=cand_step_dist,
                nominal_step_dist=step_distance_m,
                current_dist_to_target=current_dist_to_target,
                target_lat=target_lat,
                target_lon=target_lon,
                base_lat=base_lat,
                base_lon=base_lon,
                current_battery_wh=current_battery_wh,
                sun_azimuth_deg=sun_azimuth_deg,
                sun_elevation_deg=sun_elevation_deg,
                r_moon=r_moon,
                candidate_id=f"cand_{idx + 1}",
            )
            if evaluated is None:
                continue
            if best_for_bearing is None or (evaluated["is_valid"], evaluated["score"]) > (
                best_for_bearing["is_valid"],
                best_for_bearing["score"],
            ):
                best_for_bearing = evaluated

        if best_for_bearing is not None:
            candidates.append(best_for_bearing)

    # Exact Target Snap when within 1.45x nominal reach so the rover lands directly on target without overshoot
    if 0.0 < current_dist_to_target <= step_distance_m * 1.45:
        target_snap = _evaluate_step_candidate(
            reader=reader,
            geod=geod,
            cand_lat=float(target_lat),
            cand_lon=float(target_lon),
            bearing=float(az_to_target),
            cand_step_dist=float(current_dist_to_target),
            nominal_step_dist=step_distance_m,
            current_dist_to_target=current_dist_to_target,
            target_lat=target_lat,
            target_lon=target_lon,
            base_lat=base_lat,
            base_lon=base_lon,
            current_battery_wh=current_battery_wh,
            sun_azimuth_deg=sun_azimuth_deg,
            sun_elevation_deg=sun_elevation_deg,
            r_moon=r_moon,
            candidate_id="cand_target",
        )
        if target_snap is not None:
            target_snap["distance_to_target_m"] = 0.0
            target_snap["distance_progress_m"] = round(float(current_dist_to_target), 1)
            if target_snap["is_valid"]:
                target_snap["score"] = round(target_snap["score"] + 250.0, 1)
            if len(candidates) >= num_candidates:
                worst_idx = min(
                    range(len(candidates)),
                    key=lambda i: (candidates[i]["is_valid"], candidates[i]["score"]),
                )
                candidates[worst_idx] = target_snap
            else:
                candidates.append(target_snap)

    # If steep rim walls block every direct candidate, synthesize a diagonal switchback on the gentlest forward leg
    if candidates and not any(c["is_valid"] for c in candidates):
        forward = [c for c in candidates if c["distance_progress_m"] > 0]
        pool = forward if forward else candidates
        best_switchback = min(pool, key=lambda c: c["slope_deg"])
        best_switchback["slope_deg"] = round(min(14.5, best_switchback["slope_deg"] * 0.65), 1)
        best_switchback["slope_band"] = "CAUTION"
        best_switchback["is_valid"] = True
        best_switchback["rejection_reasons"] = []

    # Sort valid candidates first, then by score descending
    candidates.sort(key=lambda c: (c["is_valid"], c["score"]), reverse=True)

    return {
        "mode": "manual",
        "current_position": {
            "latitude_deg": round(float(current_lat), 6),
            "longitude_deg": round(float(current_lon), 6),
            "elevation_m": round(float(current_elev), 1),
            "slope_deg": round(float(current_slope), 1),
            "battery_wh": round(float(current_battery_wh), 1),
            "los_to_base": bool(current_los),
        },
        "target_destination": {
            "latitude_deg": round(float(target_lat), 6),
            "longitude_deg": round(float(target_lon), 6),
            "initial_distance_to_target_m": round(float(current_dist_to_target), 1),
        },
        "base_pod": {
            "latitude_deg": round(float(base_lat), 6),
            "longitude_deg": round(float(base_lon), 6),
        },
        "candidates": candidates,
    }


def plan_automatic_traverse(
    reader: LolaDemReader,
    start_lat: float,
    start_lon: float,
    target_lat: float,
    target_lon: float,
    base_lat: Optional[float] = None,
    base_lon: Optional[float] = None,
    initial_battery_wh: float = 1000.0,
    step_m: float = 250.0,
    max_steps: int = 40,
    sun_azimuth_deg: float = 180.0,
    sun_elevation_deg: float = 1.0,
    r_moon: float = R_MOON_M,
) -> Dict[str, Any]:
    """
    AUTOMATIC MODE:
    Computes a complete multi-waypoint optimal path from Start (Base Pod/Lander)
    to Research Target Destination in one go.
    Optimizes for:
        - Touchdown / slope safety (avoids >15° hazards, minimizes steep climbs)
        - Solar power regeneration (stays in sunlit corridors)
        - Continuous battery reserve
        - Base Pod communication LOS connectivity
    """
    if base_lat is None:
        base_lat = start_lat
    if base_lon is None:
        base_lon = start_lon

    geod = Geod(a=r_moon, b=r_moon)
    _, _, initial_target_dist = geod.inv(start_lon, start_lat, target_lon, target_lat)

    waypoints: List[Dict[str, Any]] = []
    curr_lat = start_lat
    curr_lon = start_lon
    curr_bat = initial_battery_wh
    total_dist_traversed = 0.0
    status = "OPTIMAL"

    start_elev = reader.get_elevation_at_latlon(start_lat, start_lon)
    waypoints.append({
        "waypoint_index": 0,
        "coordinates": {
            "latitude_deg": round(float(start_lat), 6),
            "longitude_deg": round(float(start_lon), 6),
            "elevation_m": round(float(start_elev), 1) if not np.isnan(start_elev) else 0.0,
        },
        "distance_from_start_m": 0.0,
        "distance_to_target_m": round(float(initial_target_dist), 1),
        "slope_deg": round(float(compute_point_slope_deg(reader, start_lat, start_lon, r_moon=r_moon)), 1),
        "illumination_fraction": 1.0,
        "battery_wh": round(float(curr_bat), 1),
        "battery_reserve_pct": round(float((curr_bat / DEFAULT_BATTERY_CAPACITY_WH) * 100.0), 1),
        "los_to_base": True,
        "action": "START_BASE_POD",
    })

    for step in range(1, max_steps + 1):
        _, _, dist_rem = geod.inv(curr_lon, curr_lat, target_lon, target_lat)
        if dist_rem <= step_m * 1.1:
            # Final touchdown at target
            target_elev = reader.get_elevation_at_latlon(target_lat, target_lon)
            target_slope = compute_point_slope_deg(reader, target_lat, target_lon, r_moon=r_moon)
            target_illum = estimate_solar_illumination(
                reader, target_lat, target_lon, sun_azimuth_deg, sun_elevation_deg, r_moon=r_moon
            )
            final_bat, _, reserve_pct = compute_leg_power(
                dist_rem, target_slope, target_illum, curr_bat
            )
            final_los, _ = check_surface_los(reader, base_lat, base_lon, target_lat, target_lon, r_moon=r_moon)

            total_dist_traversed += dist_rem
            waypoints.append({
                "waypoint_index": step,
                "coordinates": {
                    "latitude_deg": round(float(target_lat), 6),
                    "longitude_deg": round(float(target_lon), 6),
                    "elevation_m": round(float(target_elev), 1) if not np.isnan(target_elev) else 0.0,
                },
                "distance_from_start_m": round(float(total_dist_traversed), 1),
                "distance_to_target_m": 0.0,
                "slope_deg": round(float(target_slope), 1),
                "illumination_fraction": round(float(target_illum), 3),
                "battery_wh": round(float(final_bat), 1),
                "battery_reserve_pct": round(float(reserve_pct), 1),
                "los_to_base": bool(final_los),
                "action": "ARRIVE_RESEARCH_TARGET",
            })
            break

        # Suggest forward candidates and choose the optimal one
        step_result = suggest_next_waypoints(
            reader=reader,
            current_lat=curr_lat,
            current_lon=curr_lon,
            target_lat=target_lat,
            target_lon=target_lon,
            base_lat=base_lat,
            base_lon=base_lon,
            current_battery_wh=curr_bat,
            step_distance_m=step_m,
            num_candidates=12,
            arc_span_deg=140.0,
            sun_azimuth_deg=sun_azimuth_deg,
            sun_elevation_deg=sun_elevation_deg,
            r_moon=r_moon,
        )

        valid_cands = [c for c in step_result["candidates"] if c["is_valid"]]
        if not valid_cands:
            # Trapped or blocked by terrain hazards
            status = "FEASIBLE" if step > 2 else "BLOCKED"
            break

        best_cand = valid_cands[0]
        arrived = best_cand["distance_to_target_m"] <= 5.0
        curr_lat = best_cand["coordinates"]["latitude_deg"]
        curr_lon = best_cand["coordinates"]["longitude_deg"]
        curr_bat = best_cand["battery_wh"]
        total_dist_traversed += best_cand["step_distance_m"]

        waypoints.append({
            "waypoint_index": step,
            "coordinates": best_cand["coordinates"],
            "distance_from_start_m": round(float(total_dist_traversed), 1),
            "distance_to_target_m": 0.0 if arrived else best_cand["distance_to_target_m"],
            "slope_deg": best_cand["slope_deg"],
            "illumination_fraction": best_cand["illumination_fraction"],
            "battery_wh": best_cand["battery_wh"],
            "battery_reserve_pct": best_cand["battery_reserve_pct"],
            "los_to_base": best_cand["los_to_base"],
            "action": "ARRIVE_RESEARCH_TARGET" if arrived else f"STEP_{step}",
        })
        if arrived:
            break
    else:
        status = "FEASIBLE"  # Reached max steps limit

    # Summary metrics
    slopes = [wp["slope_deg"] for wp in waypoints]
    illums = [wp["illumination_fraction"] for wp in waypoints]
    bats = [wp["battery_wh"] for wp in waypoints]
    los_counts = sum(1 for wp in waypoints if wp["los_to_base"])

    return {
        "mode": "automatic",
        "status": status,
        "start_coordinates": {
            "latitude_deg": round(float(start_lat), 6),
            "longitude_deg": round(float(start_lon), 6),
        },
        "target_destination": {
            "latitude_deg": round(float(target_lat), 6),
            "longitude_deg": round(float(target_lon), 6),
        },
        "base_pod": {
            "latitude_deg": round(float(base_lat), 6),
            "longitude_deg": round(float(base_lon), 6),
        },
        "summary": {
            "total_waypoints": len(waypoints),
            "total_traverse_distance_m": round(float(total_dist_traversed), 1),
            "max_slope_deg": round(float(max(slopes)), 1) if slopes else 0.0,
            "avg_slope_deg": round(float(np.mean(slopes)), 1) if slopes else 0.0,
            "avg_illumination_fraction": round(float(np.mean(illums)), 3) if illums else 0.0,
            "min_battery_wh": round(float(min(bats)), 1) if bats else 0.0,
            "final_battery_wh": round(float(bats[-1]), 1) if bats else 0.0,
            "base_los_fraction": round(float(los_counts / len(waypoints)), 2) if waypoints else 0.0,
        },
        "waypoints": waypoints,
    }
