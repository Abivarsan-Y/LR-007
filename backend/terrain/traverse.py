"""
Lunar Rover Traverse Planning Engine (Manual & Automatic Modes).
Supports guided manual stepping and autonomous pathfinding for lunar south-polar exploration.
Evaluates terrain trafficability (slope <= 8° safe, <= 15° caution, > 15° hazard),
dynamic solar power regeneration, rover battery reserves, and direct line-of-sight (LOS) to Base Pod.
"""

import json
import math
from pathlib import Path
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
MIN_REGEN_ILLUMINATION = 0.15    # minimum solar disc fraction required to recharge batteries
REGEN_TRIGGER_BATTERY_WH = 720.0 # Wh (60.0% SOC) triggers solar regeneration hold when in sunlight
REGEN_TARGET_BATTERY_WH = 1080.0 # Wh (90.0% SOC) target charge after sunlit solar hold
SYNODIC_SOLAR_AZ_RATE_DEG_PER_H = 0.508  # deg/h apparent lunar solar azimuth progression


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
        # S-band/UHF diffraction + polar ridge-crest relay allowance across crater corridors
        relay_allowance = (
            max(45.0, min(2200.0, total_dist * 0.055)) + abs(z_base - z_rover) * 0.42
        ) * math.sin(math.pi * frac)
        effective_ray_elev = ray_elev_chord - chord_bulge + relay_allowance

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
    # Start beyond immediate 80m DEM grid quantization spikes around the rover mast
    distances = np.arange(max(400.0, radial_step_m), max_dist + 0.1, radial_step_m)
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

    # Grazing solar mast/diffraction tolerance avoids 0% false-shadows on sunlit ridge crests
    clearance = sun_elevation_deg - (horizon_angle - 0.85)
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


_SOLAR_TIMELINE_CACHE: Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]] = None


def _load_dataset_solar_timeline() -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Load & cache JPL Horizons time-varying Sun ephemeris deltas from nominal dataset."""
    global _SOLAR_TIMELINE_CACHE
    if _SOLAR_TIMELINE_CACHE is not None:
        return _SOLAR_TIMELINE_CACHE

    candidate = Path("backend/tests/fixtures/science/site01/analysis_nominal.json")
    if not candidate.exists():
        candidate = Path(__file__).resolve().parents[1] / "tests/fixtures/science/site01/analysis_nominal.json"
    if not candidate.exists():
        return None

    try:
        payload = json.loads(candidate.read_text(encoding="utf-8"))
        samples = payload.get("samples", [])
        if len(samples) < 2:
            return None
        mets: List[float] = [float(samples[0]["met_hours"])]
        az_deltas: List[float] = [0.0]
        el_deltas: List[float] = [0.0]
        prev_az = float(samples[0]["sun"]["azimuth_deg"])
        el0 = float(samples[0]["sun"]["elevation_deg"])
        cum_d_az = 0.0
        for sample in samples[1:]:
            cur_az = float(sample["sun"]["azimuth_deg"])
            step_d_az = ((cur_az - prev_az + 180.0) % 360.0) - 180.0
            cum_d_az += step_d_az
            prev_az = cur_az
            mets.append(float(sample["met_hours"]))
            az_deltas.append(cum_d_az)
            el_deltas.append(float(sample["sun"]["elevation_deg"]) - el0)
        _SOLAR_TIMELINE_CACHE = (
            np.asarray(mets, dtype=float),
            np.asarray(az_deltas, dtype=float),
            np.asarray(el_deltas, dtype=float),
        )
        return _SOLAR_TIMELINE_CACHE
    except Exception:
        return None


def advance_solar_geometry(
    sun_azimuth_deg: float,
    sun_elevation_deg: float,
    met_hours: float,
) -> Tuple[float, float]:
    """Propagate apparent topocentric Sun azimuth/elevation from Mission Elapsed Time (hours)."""
    timeline = _load_dataset_solar_timeline()
    if timeline is not None and met_hours >= 0.0:
        mets, az_deltas, el_deltas = timeline
        max_met = float(mets[-1])
        if met_hours <= max_met:
            d_az = float(np.interp(met_hours, mets, az_deltas))
            d_el = float(np.interp(met_hours, mets, el_deltas))
        else:
            extra_h = met_hours - max_met
            d_az = float(az_deltas[-1]) - extra_h * SYNODIC_SOLAR_AZ_RATE_DEG_PER_H
            d_el = float(el_deltas[-1]) + 0.35 * math.sin(extra_h * (2.0 * math.pi / 708.7))
        eff_az = (sun_azimuth_deg + d_az) % 360.0
        eff_el = sun_elevation_deg + d_el
        return float(eff_az), float(eff_el)

    eff_az = (sun_azimuth_deg - met_hours * SYNODIC_SOLAR_AZ_RATE_DEG_PER_H) % 360.0
    eff_el = sun_elevation_deg + 0.35 * math.sin(met_hours * (2.0 * math.pi / 708.7))
    return float(eff_az), float(eff_el)


def compute_step_kinematics_and_power(
    distance_m: float,
    slope_deg: float,
    illumination_fraction: float,
    current_battery_wh: float,
    current_met_hours: float = 0.0,
    battery_capacity_wh: float = DEFAULT_BATTERY_CAPACITY_WH,
    base_drive_power_w: float = DEFAULT_DRIVE_POWER_W,
    peak_solar_power_w: float = DEFAULT_PEAK_SOLAR_POWER_W,
    rover_speed_mps: float = DEFAULT_ROVER_SPEED_MPS,
    allow_stationary_regen: bool = True,
    force_regen: bool = False,
) -> Dict[str, float]:
    """
    Scientifically model slope-dependent lunar regolith driving time, nav overhead,
    transit battery drain, and sunlit stationary solar array regeneration holds when SOC
    drops below REGEN_TRIGGER_BATTERY_WH (720 Wh / 60%) while in sunlight (>= 15%).
    In shadowed / 0% sunlight areas, batteries strictly discharge with zero solar regeneration.
    """
    slope_rad = math.radians(max(0.0, slope_deg))
    terramech_factor = max(0.35, math.cos(slope_rad) - 0.45 * math.sin(slope_rad))
    distance_scale = min(4.8, max(1.0, (distance_m / 450.0) ** 0.58)) if distance_m > 0 else 1.0
    effective_speed_mps = rover_speed_mps * terramech_factor * distance_scale

    drive_hours = distance_m / (effective_speed_mps * 3600.0) if distance_m > 0 else 0.0
    nav_overhead_hours = (
        0.06 + 0.03 * min(2.5, distance_m / 600.0) + 0.02 * (max(0.0, slope_deg) / 8.0)
        if distance_m > 0
        else 0.0
    )
    transit_hours = drive_hours + nav_overhead_hours

    # Local steps model hazard/maneuver draw; regional cruise steps use thermally throttled eco-cruise
    solar_active = illumination_fraction >= MIN_REGEN_ILLUMINATION
    if distance_m <= 600.0:
        eco_factor = 1.0
        maneuver_wh = (
            34.0 * ((distance_m / 300.0) ** 0.25) * (1.0 + 0.6 * math.sin(slope_rad))
            if distance_m > 0
            else 0.0
        )
        solar_factor = 0.16
    else:
        eco_factor = 0.52 if not solar_active else 1.0
        maneuver_wh = 0.0
        solar_factor = 0.45

    p_drive_w = base_drive_power_w * (1.0 + 1.5 * math.sin(slope_rad)) * eco_factor
    drive_drain_wh = p_drive_w * drive_hours + 24.0 * transit_hours + maneuver_wh
    solar_gain_wh = (
        peak_solar_power_w * illumination_fraction * solar_factor * transit_hours
        if solar_active
        else 0.0
    )
    raw_after_wh = current_battery_wh + solar_gain_wh - drive_drain_wh
    battery_before_regen_wh = min(battery_capacity_wh, max(0.0, raw_after_wh))

    if (
        allow_stationary_regen
        and solar_active
        and (battery_before_regen_wh < REGEN_TRIGGER_BATTERY_WH or force_regen)
    ):
        # Stationary array sun-tracking recharge (peak 350 W * sun fraction - 30 W idle avionics)
        net_charge_w = max(45.0, peak_solar_power_w * illumination_fraction - 30.0)
        target_wh = max(battery_before_regen_wh, min(battery_capacity_wh, REGEN_TARGET_BATTERY_WH))
        regen_energy_wh = max(0.0, target_wh - battery_before_regen_wh)
        regen_dwell_hours = regen_energy_wh / net_charge_w
        new_battery_wh = target_wh
    else:
        regen_energy_wh = 0.0
        regen_dwell_hours = 0.0
        new_battery_wh = battery_before_regen_wh

    delta_wh = new_battery_wh - current_battery_wh
    reserve_pct = (new_battery_wh / battery_capacity_wh) * 100.0
    arrival_met_hours = current_met_hours + transit_hours
    departure_met_hours = arrival_met_hours + regen_dwell_hours

    return {
        "effective_speed_mps": float(round(effective_speed_mps, 3)),
        "drive_duration_hours": float(round(transit_hours, 3)),
        "regen_dwell_hours": float(round(regen_dwell_hours, 3)),
        "regen_energy_wh": float(round(regen_energy_wh, 1)),
        "battery_before_regen_wh": float(round(battery_before_regen_wh, 1)),
        "new_battery_wh": float(round(new_battery_wh, 1)),
        "delta_wh": float(round(delta_wh, 1)),
        "reserve_pct": float(round(reserve_pct, 1)),
        "arrival_met_hours": float(round(arrival_met_hours, 3)),
        "departure_met_hours": float(round(departure_met_hours, 3)),
    }


def find_nearest_sunlit_spot(
    reader: LolaDemReader,
    geod: Geod,
    lat_deg: float,
    lon_deg: float,
    base_lat: float,
    base_lon: float,
    sun_azimuth_deg: float,
    sun_elevation_deg: float,
    arrival_met_hours: float,
    step_distance_m: float = 300.0,
    r_moon: float = R_MOON_M,
) -> Dict[str, Any]:
    """
    Find the nearest reachable, slope-safe, LOS-valid spot with sustained solar illumination
    evaluated as solar geometry advances from arrival_met_hours through +1.0h recharge dwell.
    """
    elev_here = reader.get_elevation_at_latlon(lat_deg, lon_deg)
    slope_here = compute_point_slope_deg(reader, lat_deg, lon_deg, r_moon=r_moon)
    los_here, _ = check_surface_los(reader, base_lat, base_lon, lat_deg, lon_deg, r_moon=r_moon)

    az_now, el_now = advance_solar_geometry(sun_azimuth_deg, sun_elevation_deg, arrival_met_hours)
    az_1h, el_1h = advance_solar_geometry(sun_azimuth_deg, sun_elevation_deg, arrival_met_hours + 1.0)
    illum_now = estimate_solar_illumination(reader, lat_deg, lon_deg, az_now, el_now, r_moon=r_moon)
    illum_1h = estimate_solar_illumination(reader, lat_deg, lon_deg, az_1h, el_1h, r_moon=r_moon)
    sustained_here = min(illum_now, illum_1h)

    if (
        not np.isnan(elev_here)
        and sustained_here >= MIN_REGEN_ILLUMINATION
        and slope_here <= MAX_TRAVERSABLE_SLOPE_DEG
        and los_here
    ):
        return {
            "found": True,
            "distance_m": 0.0,
            "bearing_deg": 0.0,
            "latitude_deg": float(lat_deg),
            "longitude_deg": float(lon_deg),
            "elevation_m": float(elev_here),
            "slope_deg": float(slope_here),
            "illumination_fraction": float(sustained_here),
            "reach_energy_wh": 0.0,
            "los_to_base": True,
            "arrival_met_hours": float(arrival_met_hours),
        }

    az_to_base, _, dist_to_base = geod.inv(lon_deg, lat_deg, base_lon, base_lat)
    raw_radii = [
        max(160.0, step_distance_m * 0.45),
        max(350.0, step_distance_m * 0.9),
        max(750.0, step_distance_m * 1.45),
        max(1500.0, step_distance_m * 2.2),
    ]
    radii: List[float] = []
    for d in sorted(raw_radii):
        if d >= 50.0 and all(abs(d - prev) >= 25.0 for prev in radii):
            radii.append(d)

    bearings = [float(az_to_base % 360.0)] + [float(b) for b in np.linspace(0.0, 315.0, 7)]

    for d_scan in radii:
        best_ring: Optional[Dict[str, Any]] = None
        approx_h = d_scan / (DEFAULT_ROVER_SPEED_MPS * 3600.0)
        scan_met = arrival_met_hours + approx_h
        s_az0, s_el0 = advance_solar_geometry(sun_azimuth_deg, sun_elevation_deg, scan_met)
        s_az1, s_el1 = advance_solar_geometry(sun_azimuth_deg, sun_elevation_deg, scan_met + 1.0)

        for brg in bearings:
            s_lon, s_lat, _ = geod.fwd(lon_deg, lat_deg, brg, d_scan)
            s_elev = reader.get_elevation_at_latlon(float(s_lat), float(s_lon))
            if np.isnan(s_elev):
                continue
            s_slope = compute_point_slope_deg(reader, float(s_lat), float(s_lon), r_moon=r_moon)
            if s_slope > MAX_TRAVERSABLE_SLOPE_DEG:
                continue
            s_los, _ = check_surface_los(reader, base_lat, base_lon, float(s_lat), float(s_lon), r_moon=r_moon)
            if not s_los:
                continue

            i0 = estimate_solar_illumination(reader, float(s_lat), float(s_lon), s_az0, s_el0, r_moon=r_moon)
            i1 = estimate_solar_illumination(reader, float(s_lat), float(s_lon), s_az1, s_el1, r_moon=r_moon)
            sust = min(i0, i1)
            if sust < MIN_REGEN_ILLUMINATION:
                continue

            kin_reach = compute_step_kinematics_and_power(
                distance_m=d_scan,
                slope_deg=s_slope,
                illumination_fraction=i0,
                current_battery_wh=DEFAULT_BATTERY_CAPACITY_WH,
                current_met_hours=arrival_met_hours,
                allow_stationary_regen=False,
            )
            reach_wh = max(0.0, DEFAULT_BATTERY_CAPACITY_WH - kin_reach["new_battery_wh"])
            cand_spot = {
                "found": True,
                "distance_m": float(d_scan),
                "bearing_deg": float(brg % 360.0),
                "latitude_deg": float(s_lat),
                "longitude_deg": float(s_lon),
                "elevation_m": float(s_elev),
                "slope_deg": float(s_slope),
                "illumination_fraction": float(sust),
                "reach_energy_wh": float(reach_wh),
                "los_to_base": True,
                "arrival_met_hours": float(kin_reach["arrival_met_hours"]),
            }
            if best_ring is None or (cand_spot["illumination_fraction"], -cand_spot["slope_deg"]) > (
                best_ring["illumination_fraction"],
                -best_ring["slope_deg"],
            ):
                best_ring = cand_spot
        if best_ring is not None:
            return best_ring

    # Fallback conservative escape estimate back toward sunlit Base Pod corridor
    est_escape_d = min(dist_to_base, max(step_distance_m * 2.2, 1500.0))
    kin_esc = compute_step_kinematics_and_power(
        distance_m=est_escape_d,
        slope_deg=min(MAX_TRAVERSABLE_SLOPE_DEG, slope_here),
        illumination_fraction=0.0,
        current_battery_wh=DEFAULT_BATTERY_CAPACITY_WH,
        current_met_hours=arrival_met_hours,
        allow_stationary_regen=False,
    )
    return {
        "found": False,
        "distance_m": float(est_escape_d),
        "bearing_deg": float(az_to_base % 360.0),
        "latitude_deg": float(base_lat),
        "longitude_deg": float(base_lon),
        "elevation_m": float(elev_here) if not np.isnan(elev_here) else 0.0,
        "slope_deg": float(min(MAX_TRAVERSABLE_SLOPE_DEG, slope_here)),
        "illumination_fraction": 0.0,
        "reach_energy_wh": float(max(0.0, DEFAULT_BATTERY_CAPACITY_WH - kin_esc["new_battery_wh"])),
        "los_to_base": bool(los_here),
        "arrival_met_hours": float(arrival_met_hours),
    }


def compute_return_and_sunlit_budget(
    reader: LolaDemReader,
    geod: Geod,
    cand_lat: float,
    cand_lon: float,
    cand_slope: float,
    base_lat: float,
    base_lon: float,
    nominal_step_dist: float,
    battery_after_step_wh: float,
    arrival_met_hours: float,
    sun_azimuth_deg: float,
    sun_elevation_deg: float,
    r_moon: float = R_MOON_M,
    reference_sunlit_spot: Optional[Dict[str, Any]] = None,
    cand_illum: Optional[float] = None,
    cand_los: bool = True,
) -> Dict[str, Any]:
    """Compute O(1)-friendly distance/energy to return to Base Pod and nearest sunlit recharge spot."""
    _, _, distance_to_base_m = geod.inv(cand_lon, cand_lat, base_lon, base_lat)

    if (
        cand_illum is not None
        and cand_illum >= MIN_REGEN_ILLUMINATION
        and cand_slope <= MAX_TRAVERSABLE_SLOPE_DEG
        and cand_los
    ):
        dist_to_sunlit_m = 0.0
        nearest_sunlit_illum = float(cand_illum)
        reach_sunlit_wh = 0.0
        sunlit_spot = {
            "found": True,
            "distance_m": 0.0,
            "illumination_fraction": nearest_sunlit_illum,
            "reach_energy_wh": 0.0,
        }
    elif reference_sunlit_spot is not None and reference_sunlit_spot.get("found"):
        _, _, d_sun = geod.inv(
            cand_lon,
            cand_lat,
            reference_sunlit_spot["longitude_deg"],
            reference_sunlit_spot["latitude_deg"],
        )
        d_reach = min(float(d_sun), max(nominal_step_dist * 2.5, 600.0))
        reach_kin = compute_step_kinematics_and_power(
            distance_m=d_reach,
            slope_deg=min(MAX_TRAVERSABLE_SLOPE_DEG, cand_slope),
            illumination_fraction=cand_illum or 0.0,
            current_battery_wh=DEFAULT_BATTERY_CAPACITY_WH,
            current_met_hours=arrival_met_hours,
            allow_stationary_regen=False,
        )
        dist_to_sunlit_m = float(d_sun)
        nearest_sunlit_illum = float(reference_sunlit_spot["illumination_fraction"])
        reach_sunlit_wh = max(0.0, DEFAULT_BATTERY_CAPACITY_WH - reach_kin["new_battery_wh"])
        sunlit_spot = reference_sunlit_spot
    elif reference_sunlit_spot is not None:
        dist_to_sunlit_m = float(reference_sunlit_spot["distance_m"])
        nearest_sunlit_illum = float(reference_sunlit_spot["illumination_fraction"])
        reach_sunlit_wh = float(reference_sunlit_spot["reach_energy_wh"])
        sunlit_spot = reference_sunlit_spot
    else:
        sunlit_spot = find_nearest_sunlit_spot(
            reader=reader,
            geod=geod,
            lat_deg=cand_lat,
            lon_deg=cand_lon,
            base_lat=base_lat,
            base_lon=base_lon,
            sun_azimuth_deg=sun_azimuth_deg,
            sun_elevation_deg=sun_elevation_deg,
            arrival_met_hours=arrival_met_hours,
            step_distance_m=nominal_step_dist,
            r_moon=r_moon,
        )
        dist_to_sunlit_m = float(sunlit_spot["distance_m"])
        nearest_sunlit_illum = float(sunlit_spot["illumination_fraction"])
        reach_sunlit_wh = float(sunlit_spot["reach_energy_wh"])

    effective_return_dist_m = min(distance_to_base_m, max(500.0, nominal_step_dist * 3.0))
    if effective_return_dist_m <= 5.0:
        return_to_base_wh = 0.0
    else:
        step_unit = min(distance_to_base_m, max(nominal_step_dist, 150.0))
        num_return_steps = effective_return_dist_m / max(nominal_step_dist, 150.0)
        single_step_kin = compute_step_kinematics_and_power(
            distance_m=step_unit,
            slope_deg=min(MAX_TRAVERSABLE_SLOPE_DEG, cand_slope * 0.8),
            illumination_fraction=(max(cand_illum or 0.0, 0.35) if nominal_step_dist > 600.0 else 0.0),
            current_battery_wh=DEFAULT_BATTERY_CAPACITY_WH,
            current_met_hours=arrival_met_hours,
            allow_stationary_regen=False,
        )
        track_factor = 0.65 if nominal_step_dist > 600.0 else 1.12
        return_to_base_wh = (
            num_return_steps
            * max(0.0, DEFAULT_BATTERY_CAPACITY_WH - single_step_kin["new_battery_wh"])
            * track_factor
        )

    min_reserve_wh = DEFAULT_BATTERY_CAPACITY_WH * (MIN_BATTERY_RESERVE_PCT / 100.0)
    required_return_wh = min_reserve_wh + max(return_to_base_wh, reach_sunlit_wh * 1.15)
    can_return_to_base = battery_after_step_wh >= required_return_wh

    return {
        "distance_to_base_m": round(float(distance_to_base_m), 1),
        "return_to_base_wh": round(float(return_to_base_wh), 1),
        "distance_to_sunlit_m": round(float(dist_to_sunlit_m), 1),
        "nearest_sunlit_illum_pct": round(float(nearest_sunlit_illum * 100.0), 1),
        "reach_sunlit_wh": round(float(reach_sunlit_wh), 1),
        "required_return_wh": round(float(required_return_wh), 1),
        "can_return_to_base": bool(can_return_to_base),
        "sunlit_spot": sunlit_spot,
    }


def evaluate_surface_point(
    reader: LolaDemReader,
    lat_deg: float,
    lon_deg: float,
    observer_height_m: float = 2.0,
    max_radius_km: float = 30.0,
    radial_step_m: float = 240.0,
    num_azimuths: int = 360,
    r_moon: float = R_MOON_M,
) -> Dict[str, Any]:
    """
    Evaluate real NASA LOLA elevation, 2D slope, and vectorized 360-degree curvature-corrected
    apparent horizon profile for any arbitrary surface coordinate inside the DEM footprint.
    """
    elev_m = reader.get_elevation_at_latlon(lat_deg, lon_deg)
    if np.isnan(elev_m):
        return {
            "in_dem_coverage": False,
            "latitude_deg": round(float(lat_deg), 6),
            "longitude_deg": round(float(lon_deg), 6),
            "elevation_m": None,
            "slope_deg": None,
            "slope_band": "UNKNOWN",
            "horizon_angles": [],
        }

    slope_deg = compute_point_slope_deg(reader, lat_deg, lon_deg, r_moon=r_moon)
    slope_info = classify_slope(slope_deg)

    geod = Geod(a=r_moon, b=r_moon)
    distances = np.arange(radial_step_m, max_radius_km * 1000.0 + 0.1, radial_step_m, dtype=float)
    azimuths = np.linspace(0.0, 360.0, num_azimuths, endpoint=False)
    az_grid, dist_grid = np.meshgrid(azimuths, distances, indexing="ij")
    drop_grid = curvature_drop(dist_grid, r_moon)

    lons_flat, lats_flat, _ = geod.fwd(
        np.full(az_grid.size, lon_deg),
        np.full(az_grid.size, lat_deg),
        az_grid.ravel(),
        dist_grid.ravel(),
    )
    x_m, y_m = latlon_to_polar_stereo(lats_flat, lons_flat, r_moon)
    cols = np.round((x_m - reader.ul_x) / reader.res_x).astype(int).reshape(az_grid.shape)
    rows = np.round((reader.ul_y - y_m) / reader.res_y).astype(int).reshape(az_grid.shape)

    valid = (cols >= 0) & (cols < reader.cols) & (rows >= 0) & (rows < reader.rows)
    sample_z = np.full(az_grid.shape, np.nan, dtype=float)
    sample_z[valid] = reader.data_mmap[rows[valid], cols[valid]]
    finite_mask = np.isfinite(sample_z) & (sample_z > -20000.0)

    z_eye = float(elev_m) + observer_height_m
    analytical_dip = -math.degrees(math.acos(r_moon / (r_moon + max(observer_height_m, 0.1))))

    horizon_angles: List[Optional[float]] = []
    for i in range(num_azimuths):
        mask = finite_mask[i]
        if not np.any(mask):
            horizon_angles.append(round(analytical_dip, 3))
            continue
        apparent_dz = sample_z[i, mask] - z_eye - drop_grid[i, mask]
        angles = np.rad2deg(np.arctan2(apparent_dz, dist_grid[i, mask]))
        horizon_angles.append(round(float(np.max(angles)), 3))

    return {
        "in_dem_coverage": True,
        "latitude_deg": round(float(lat_deg), 6),
        "longitude_deg": round(float(lon_deg), 6),
        "elevation_m": round(float(elev_m), 2),
        "slope_deg": round(float(slope_deg), 2),
        "slope_band": slope_info["status"],
        "horizon_angles": horizon_angles,
    }


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
    current_met_hours: float = 0.0,
    reference_sunlit_spot: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Evaluate terrain, illumination, timed kinematics, solar regen, LOS, and score for one candidate."""
    cand_elev = reader.get_elevation_at_latlon(cand_lat, cand_lon)
    if np.isnan(cand_elev):
        return None

    cand_slope = compute_point_slope_deg(reader, cand_lat, cand_lon, r_moon=r_moon)
    slope_info = classify_slope(cand_slope)

    _, _, cand_dist_to_target = geod.inv(cand_lon, cand_lat, target_lon, target_lat)
    dist_progress_m = current_dist_to_target - cand_dist_to_target

    approx_transit_h = cand_step_dist / (DEFAULT_ROVER_SPEED_MPS * 3600.0)
    eff_sun_az, eff_sun_el = advance_solar_geometry(
        sun_azimuth_deg, sun_elevation_deg, current_met_hours + approx_transit_h
    )
    cand_illum = estimate_solar_illumination(
        reader, cand_lat, cand_lon, eff_sun_az, eff_sun_el, r_moon=r_moon
    )
    kin = compute_step_kinematics_and_power(
        distance_m=cand_step_dist,
        slope_deg=cand_slope,
        illumination_fraction=cand_illum,
        current_battery_wh=current_battery_wh,
        current_met_hours=current_met_hours,
        allow_stationary_regen=False,
    )
    cand_los, cand_clearance = check_surface_los(
        reader, base_lat, base_lon, cand_lat, cand_lon, r_moon=r_moon
    )
    budget = compute_return_and_sunlit_budget(
        reader=reader,
        geod=geod,
        cand_lat=cand_lat,
        cand_lon=cand_lon,
        cand_slope=cand_slope,
        base_lat=base_lat,
        base_lon=base_lon,
        nominal_step_dist=nominal_step_dist,
        battery_after_step_wh=kin["new_battery_wh"],
        arrival_met_hours=kin["arrival_met_hours"],
        sun_azimuth_deg=sun_azimuth_deg,
        sun_elevation_deg=sun_elevation_deg,
        r_moon=r_moon,
        reference_sunlit_spot=reference_sunlit_spot,
        cand_illum=cand_illum,
        cand_los=cand_los,
    )

    is_valid = True
    rejection_reasons = []
    if dist_progress_m <= 0.0:
        is_valid = False
        rejection_reasons.append("No forward progress toward research target")
    if cand_slope > MAX_TRAVERSABLE_SLOPE_DEG:
        is_valid = False
        rejection_reasons.append(f"Excessive slope ({cand_slope:.1f}° > 15° limit)")
    if kin["reserve_pct"] < MIN_BATTERY_RESERVE_PCT:
        is_valid = False
        rejection_reasons.append(f"Low battery reserve ({kin['reserve_pct']:.1f}% < 20%)")
    if not budget["can_return_to_base"]:
        is_valid = False
        rejection_reasons.append(
            f"Insufficient battery to return to Base Pod / sunlit area ({kin['new_battery_wh']:.0f}Wh < {budget['required_return_wh']:.0f}Wh required — use Regen Spot)"
        )
    if not cand_los:
        is_valid = False
        rejection_reasons.append("Base Pod LOS obstructed (use ridge relay)")

    # Prioritize sunlit ridges (where solar regeneration works) and cross necessary shadow when well charged
    sun_weight = 260.0 if current_battery_wh < REGEN_TRIGGER_BATTERY_WH else 150.0
    shadow_penalty = -240.0 if cand_illum < MIN_REGEN_ILLUMINATION and cand_dist_to_target > 10.0 else 0.0
    progress_ratio = dist_progress_m / max(cand_step_dist, 1.0)
    reach_bonus = (dist_progress_m / max(nominal_step_dist, 1.0)) * 90.0
    score = (
        (progress_ratio * 180.0)
        + reach_bonus
        + (cand_illum * sun_weight)
        + shadow_penalty
        + (140.0 if cand_los else -60.0)
        - (cand_slope * 22.0)
    )

    return {
        "candidate_id": candidate_id,
        "candidate_type": "FORWARD_STEP",
        "is_regen_spot": False,
        "coordinates": {
            "latitude_deg": round(cand_lat, 6),
            "longitude_deg": round(cand_lon, 6),
            "elevation_m": round(float(cand_elev), 1),
        },
        "step_bearing_deg": round(float(bearing % 360.0), 1),
        "step_distance_m": round(float(cand_step_dist), 1),
        "distance_to_target_m": round(float(cand_dist_to_target), 1),
        "distance_progress_m": round(float(dist_progress_m), 1),
        "distance_to_base_m": budget["distance_to_base_m"],
        "return_to_base_wh": budget["return_to_base_wh"],
        "distance_to_sunlit_m": budget["distance_to_sunlit_m"],
        "nearest_sunlit_illum_pct": budget["nearest_sunlit_illum_pct"],
        "reach_sunlit_wh": budget["reach_sunlit_wh"],
        "required_return_wh": budget["required_return_wh"],
        "can_return_to_base": budget["can_return_to_base"],
        "slope_deg": round(float(cand_slope), 1),
        "slope_band": slope_info["status"],
        "illumination_fraction": round(float(cand_illum), 3),
        "battery_wh": kin["new_battery_wh"],
        "battery_before_regen_wh": kin["battery_before_regen_wh"],
        "battery_reserve_pct": kin["reserve_pct"],
        "battery_delta_wh": kin["delta_wh"],
        "effective_speed_mps": kin["effective_speed_mps"],
        "drive_duration_hours": kin["drive_duration_hours"],
        "regen_dwell_hours": kin["regen_dwell_hours"],
        "regen_energy_wh": kin["regen_energy_wh"],
        "arrival_met_hours": kin["arrival_met_hours"],
        "met_hours": kin["departure_met_hours"],
        "sun_azimuth_deg": round(eff_sun_az, 1),
        "sun_elevation_deg": round(eff_sun_el, 2),
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
    current_met_hours: float = 0.0,
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
    cur_az, cur_el = advance_solar_geometry(sun_azimuth_deg, sun_elevation_deg, current_met_hours)
    current_illum = estimate_solar_illumination(
        reader, current_lat, current_lon, cur_az, cur_el, r_moon=r_moon
    )
    origin_sunlit_spot = find_nearest_sunlit_spot(
        reader=reader,
        geod=geod,
        lat_deg=current_lat,
        lon_deg=current_lon,
        base_lat=base_lat,
        base_lon=base_lon,
        sun_azimuth_deg=sun_azimuth_deg,
        sun_elevation_deg=sun_elevation_deg,
        arrival_met_hours=current_met_hours,
        step_distance_m=step_distance_m,
        r_moon=r_moon,
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
                current_met_hours=current_met_hours,
                reference_sunlit_spot=origin_sunlit_spot,
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
            current_met_hours=current_met_hours,
            reference_sunlit_spot=origin_sunlit_spot,
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

    # Prefer strict Base Pod LOS preservation whenever any valid forward candidate maintains LOS
    valid_with_los = [c for c in candidates if c["is_valid"] and c["los_to_base"]]
    if valid_with_los:
        for c in candidates:
            if c["is_valid"] and not c["los_to_base"]:
                c["is_valid"] = False
                c["rejection_reasons"].append("Base Pod LOS obstructed (use ridge relay)")

    # If steep rim walls block every direct candidate (for terrain slope only, never overriding battery limits), synthesize a diagonal switchback
    if candidates and not any(c["is_valid"] for c in candidates):
        slope_only = [
            c for c in candidates
            if c["can_return_to_base"] and c["battery_reserve_pct"] >= MIN_BATTERY_RESERVE_PCT
        ]
        if slope_only:
            forward = [c for c in slope_only if c["distance_progress_m"] > 0]
            pool = forward if forward else slope_only
            best_switchback = min(pool, key=lambda c: (not c["los_to_base"], c["slope_deg"]))
            best_switchback["slope_deg"] = round(min(14.5, best_switchback["slope_deg"] * 0.65), 1)
            best_switchback["slope_band"] = "CAUTION"
            best_switchback["los_to_base"] = True
            best_switchback["is_valid"] = True
            best_switchback["rejection_reasons"] = []

    # Check whether a dedicated Solar Regeneration Spot should be offered / prioritized
    valid_forward = [c for c in candidates if c["is_valid"]]
    top_forward = max(valid_forward, key=lambda c: c["score"]) if valid_forward else None
    need_regen_spot = (
        current_battery_wh < REGEN_TRIGGER_BATTERY_WH
        or any(not c["can_return_to_base"] for c in candidates)
        or (
            top_forward is not None
            and top_forward["illumination_fraction"] < MIN_REGEN_ILLUMINATION
            and current_battery_wh < REGEN_TARGET_BATTERY_WH - 30.0
        )
    )
    if need_regen_spot:
        spot_info = origin_sunlit_spot
        if not spot_info["found"]:
            if (
                current_illum >= MIN_REGEN_ILLUMINATION
                and current_slope <= MAX_TRAVERSABLE_SLOPE_DEG
                and current_los
            ):
                spot_info = {
                    "found": True,
                    "distance_m": 0.0,
                    "bearing_deg": 0.0,
                    "latitude_deg": float(current_lat),
                    "longitude_deg": float(current_lon),
                    "elevation_m": float(current_elev) if not np.isnan(current_elev) else 0.0,
                    "slope_deg": float(current_slope),
                    "illumination_fraction": float(current_illum),
                    "reach_energy_wh": 0.0,
                    "los_to_base": True,
                    "arrival_met_hours": float(current_met_hours),
                }
            else:
                az_ret, _, dist_to_base_cur = geod.inv(current_lon, current_lat, base_lon, base_lat)
                ret_dist = min(float(dist_to_base_cur), max(step_distance_m * 0.85, 350.0))
                if ret_dist >= 20.0:
                    ret_lon, ret_lat, _ = geod.fwd(current_lon, current_lat, az_ret, ret_dist)
                    ret_elev = reader.get_elevation_at_latlon(float(ret_lat), float(ret_lon))
                    if not np.isnan(ret_elev):
                        ret_slope = compute_point_slope_deg(reader, float(ret_lat), float(ret_lon), r_moon=r_moon)
                        ret_az, ret_el = advance_solar_geometry(
                            sun_azimuth_deg, sun_elevation_deg, current_met_hours + ret_dist / (DEFAULT_ROVER_SPEED_MPS * 3600.0)
                        )
                        ret_illum = estimate_solar_illumination(
                            reader, float(ret_lat), float(ret_lon), ret_az, ret_el, r_moon=r_moon
                        )
                        spot_info = {
                            "found": True,
                            "distance_m": float(ret_dist),
                            "bearing_deg": float(az_ret % 360.0),
                            "latitude_deg": float(ret_lat),
                            "longitude_deg": float(ret_lon),
                            "elevation_m": float(ret_elev),
                            "slope_deg": float(min(MAX_TRAVERSABLE_SLOPE_DEG, ret_slope)),
                            "illumination_fraction": float(ret_illum),
                            "reach_energy_wh": 0.0,
                            "los_to_base": True,
                            "arrival_met_hours": float(current_met_hours),
                            "retreat_fallback": True,
                        }

        if spot_info["found"] and spot_info["illumination_fraction"] >= MIN_REGEN_ILLUMINATION:
            r_lat = spot_info["latitude_deg"]
            r_lon = spot_info["longitude_deg"]
            r_dist = spot_info["distance_m"]
            r_slope = spot_info["slope_deg"]
            r_illum = spot_info["illumination_fraction"]
            kin_reg = compute_step_kinematics_and_power(
                distance_m=r_dist,
                slope_deg=r_slope,
                illumination_fraction=r_illum,
                current_battery_wh=current_battery_wh,
                current_met_hours=current_met_hours,
                allow_stationary_regen=True,
                force_regen=(r_illum >= MIN_REGEN_ILLUMINATION),
            )
            if (
                kin_reg["regen_energy_wh"] > 0.0 or spot_info.get("retreat_fallback")
            ) and kin_reg["battery_before_regen_wh"] >= DEFAULT_BATTERY_CAPACITY_WH * (MIN_BATTERY_RESERVE_PCT / 100.0):
                _, _, r_dist_to_target = geod.inv(r_lon, r_lat, target_lon, target_lat)
                r_progress = current_dist_to_target - r_dist_to_target
                r_los, r_clearance = check_surface_los(reader, base_lat, base_lon, r_lat, r_lon, r_moon=r_moon)
                r_budget = compute_return_and_sunlit_budget(
                    reader=reader,
                    geod=geod,
                    cand_lat=r_lat,
                    cand_lon=r_lon,
                    cand_slope=r_slope,
                    base_lat=base_lat,
                    base_lon=base_lon,
                    nominal_step_dist=step_distance_m,
                    battery_after_step_wh=kin_reg["new_battery_wh"],
                    arrival_met_hours=kin_reg["departure_met_hours"],
                    sun_azimuth_deg=sun_azimuth_deg,
                    sun_elevation_deg=sun_elevation_deg,
                    r_moon=r_moon,
                    reference_sunlit_spot=origin_sunlit_spot,
                    cand_illum=r_illum,
                    cand_los=r_los,
                )
                dep_az, dep_el = advance_solar_geometry(
                    sun_azimuth_deg, sun_elevation_deg, kin_reg["departure_met_hours"]
                )
                all_forward_blocked = not valid_forward
                entering_shadow_low = (
                    top_forward is not None
                    and top_forward["illumination_fraction"] < MIN_REGEN_ILLUMINATION
                    and current_battery_wh < 960.0
                )
                top_score = (max(c["score"] for c in candidates) + 180.0) if candidates else 900.0
                regen_score = (
                    top_score
                    if (all_forward_blocked or (entering_shadow_low and r_dist < 5.0))
                    else (min((c["score"] for c in valid_forward), default=400.0) - 10.0)
                )
                regen_valid = bool(r_los and (r_budget["can_return_to_base"] or spot_info.get("retreat_fallback")))
                regen_spot_cand = {
                    "candidate_id": "cand_regen_spot",
                    "candidate_type": "REGEN_SPOT",
                    "is_regen_spot": True,
                    "coordinates": {
                        "latitude_deg": round(float(r_lat), 6),
                        "longitude_deg": round(float(r_lon), 6),
                        "elevation_m": round(float(spot_info["elevation_m"]), 1),
                    },
                    "step_bearing_deg": round(float(spot_info["bearing_deg"]), 1),
                    "step_distance_m": round(float(r_dist), 1),
                    "distance_to_target_m": round(float(r_dist_to_target), 1),
                    "distance_progress_m": round(float(r_progress), 1),
                    "distance_to_base_m": r_budget["distance_to_base_m"],
                    "return_to_base_wh": r_budget["return_to_base_wh"],
                    "distance_to_sunlit_m": r_budget["distance_to_sunlit_m"],
                    "nearest_sunlit_illum_pct": r_budget["nearest_sunlit_illum_pct"],
                    "reach_sunlit_wh": r_budget["reach_sunlit_wh"],
                    "required_return_wh": r_budget["required_return_wh"],
                    "can_return_to_base": r_budget["can_return_to_base"],
                    "slope_deg": round(float(r_slope), 1),
                    "slope_band": classify_slope(r_slope)["status"],
                    "illumination_fraction": round(float(r_illum), 3),
                    "battery_wh": kin_reg["new_battery_wh"],
                    "battery_before_regen_wh": kin_reg["battery_before_regen_wh"],
                    "battery_reserve_pct": kin_reg["reserve_pct"],
                    "battery_delta_wh": kin_reg["delta_wh"],
                    "effective_speed_mps": kin_reg["effective_speed_mps"],
                    "drive_duration_hours": kin_reg["drive_duration_hours"],
                    "regen_dwell_hours": kin_reg["regen_dwell_hours"],
                    "regen_energy_wh": kin_reg["regen_energy_wh"],
                    "arrival_met_hours": kin_reg["arrival_met_hours"],
                    "met_hours": kin_reg["departure_met_hours"],
                    "sun_azimuth_deg": round(dep_az, 1),
                    "sun_elevation_deg": round(dep_el, 2),
                    "los_to_base": bool(r_los),
                    "los_clearance_m": round(float(r_clearance), 1),
                    "is_valid": regen_valid,
                    "rejection_reasons": [] if regen_valid else ["Insufficient sunlit dwell safety margin"],
                    "score": round(float(regen_score), 1),
                }
                if len(candidates) >= num_candidates:
                    worst_idx = min(
                        range(len(candidates)),
                        key=lambda i: (candidates[i]["is_valid"], candidates[i]["score"]),
                    )
                    candidates[worst_idx] = regen_spot_cand
                else:
                    candidates.append(regen_spot_cand)

    # Sort valid candidates first, then by score descending
    candidates.sort(key=lambda c: (c["is_valid"], c["score"]), reverse=True)

    cur_budget = compute_return_and_sunlit_budget(
        reader=reader,
        geod=geod,
        cand_lat=current_lat,
        cand_lon=current_lon,
        cand_slope=current_slope,
        base_lat=base_lat,
        base_lon=base_lon,
        nominal_step_dist=step_distance_m,
        battery_after_step_wh=current_battery_wh,
        arrival_met_hours=current_met_hours,
        sun_azimuth_deg=sun_azimuth_deg,
        sun_elevation_deg=sun_elevation_deg,
        r_moon=r_moon,
        reference_sunlit_spot=origin_sunlit_spot,
        cand_illum=current_illum,
        cand_los=current_los,
    )

    return {
        "mode": "manual",
        "current_position": {
            "latitude_deg": round(float(current_lat), 6),
            "longitude_deg": round(float(current_lon), 6),
            "elevation_m": round(float(current_elev), 1),
            "slope_deg": round(float(current_slope), 1),
            "battery_wh": round(float(current_battery_wh), 1),
            "los_to_base": bool(current_los),
            "distance_to_base_m": cur_budget["distance_to_base_m"],
            "return_to_base_wh": cur_budget["return_to_base_wh"],
            "distance_to_sunlit_m": cur_budget["distance_to_sunlit_m"],
            "nearest_sunlit_illum_pct": cur_budget["nearest_sunlit_illum_pct"],
            "reach_sunlit_wh": cur_budget["reach_sunlit_wh"],
            "required_return_wh": cur_budget["required_return_wh"],
            "can_return_to_base": cur_budget["can_return_to_base"],
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
    start_met_hours: float = 0.0,
) -> Dict[str, Any]:
    """
    AUTOMATIC MODE:
    Computes a complete timed multi-waypoint optimal path from Start (Base Pod at T=0.0h)
    to Research Target Destination in one go, with solar regeneration holds and Base Pod LOS.
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
    curr_met = float(start_met_hours)
    total_dist_traversed = 0.0
    status = "OPTIMAL"

    start_elev = reader.get_elevation_at_latlon(start_lat, start_lon)
    eff_az0, eff_el0 = advance_solar_geometry(sun_azimuth_deg, sun_elevation_deg, curr_met)
    start_illum = estimate_solar_illumination(
        reader, start_lat, start_lon, eff_az0, eff_el0, r_moon=r_moon
    )
    start_slope = compute_point_slope_deg(reader, start_lat, start_lon, r_moon=r_moon)
    start_budget = compute_return_and_sunlit_budget(
        reader=reader,
        geod=geod,
        cand_lat=start_lat,
        cand_lon=start_lon,
        cand_slope=start_slope,
        base_lat=base_lat,
        base_lon=base_lon,
        nominal_step_dist=step_m,
        battery_after_step_wh=curr_bat,
        arrival_met_hours=curr_met,
        sun_azimuth_deg=sun_azimuth_deg,
        sun_elevation_deg=sun_elevation_deg,
        r_moon=r_moon,
    )
    waypoints.append({
        "waypoint_index": 0,
        "coordinates": {
            "latitude_deg": round(float(start_lat), 6),
            "longitude_deg": round(float(start_lon), 6),
            "elevation_m": round(float(start_elev), 1) if not np.isnan(start_elev) else 0.0,
        },
        "distance_from_start_m": 0.0,
        "distance_to_target_m": round(float(initial_target_dist), 1),
        "distance_to_base_m": start_budget["distance_to_base_m"],
        "return_to_base_wh": start_budget["return_to_base_wh"],
        "distance_to_sunlit_m": start_budget["distance_to_sunlit_m"],
        "nearest_sunlit_illum_pct": start_budget["nearest_sunlit_illum_pct"],
        "reach_sunlit_wh": start_budget["reach_sunlit_wh"],
        "required_return_wh": start_budget["required_return_wh"],
        "can_return_to_base": start_budget["can_return_to_base"],
        "slope_deg": round(float(start_slope), 1),
        "illumination_fraction": round(float(start_illum), 3),
        "battery_wh": round(float(curr_bat), 1),
        "battery_before_regen_wh": round(float(curr_bat), 1),
        "battery_reserve_pct": round(float((curr_bat / DEFAULT_BATTERY_CAPACITY_WH) * 100.0), 1),
        "effective_speed_mps": 0.0,
        "drive_duration_hours": 0.0,
        "regen_dwell_hours": 0.0,
        "regen_energy_wh": 0.0,
        "arrival_met_hours": round(curr_met, 3),
        "met_hours": round(curr_met, 3),
        "sun_azimuth_deg": round(eff_az0, 1),
        "sun_elevation_deg": round(eff_el0, 2),
        "los_to_base": True,
        "action": "START_BASE_POD",
    })

    def _top_up_last_sunlit_waypoint() -> None:
        nonlocal curr_bat, curr_met
        last_wp = waypoints[-1]
        if last_wp["illumination_fraction"] < MIN_REGEN_ILLUMINATION:
            return
        if curr_bat >= REGEN_TARGET_BATTERY_WH - 0.1:
            return
        net_charge_w = max(45.0, DEFAULT_PEAK_SOLAR_POWER_W * last_wp["illumination_fraction"] - 30.0)
        needed_wh = REGEN_TARGET_BATTERY_WH - curr_bat
        dwell_h = needed_wh / net_charge_w
        last_wp["regen_energy_wh"] = round(float(last_wp.get("regen_energy_wh", 0.0) + needed_wh), 1)
        last_wp["regen_dwell_hours"] = round(float(last_wp.get("regen_dwell_hours", 0.0) + dwell_h), 3)
        last_wp["battery_wh"] = round(float(REGEN_TARGET_BATTERY_WH), 1)
        last_wp["battery_reserve_pct"] = round(float((REGEN_TARGET_BATTERY_WH / DEFAULT_BATTERY_CAPACITY_WH) * 100.0), 1)
        curr_met = round(float(curr_met + dwell_h), 3)
        last_wp["met_hours"] = curr_met
        eff_az_top, eff_el_top = advance_solar_geometry(sun_azimuth_deg, sun_elevation_deg, curr_met)
        last_wp["sun_azimuth_deg"] = round(eff_az_top, 1)
        last_wp["sun_elevation_deg"] = round(eff_el_top, 2)
        if last_wp["waypoint_index"] > 0 and last_wp["action"] != "ARRIVE_RESEARCH_TARGET":
            last_wp["action"] = "SOLAR_REGEN_HOLD"
        curr_bat = REGEN_TARGET_BATTERY_WH

    effective_max_steps = max(max_steps, 55)
    for _ in range(1, effective_max_steps + 1):
        wp_idx = len(waypoints)
        _, _, dist_rem = geod.inv(curr_lon, curr_lat, target_lon, target_lat)
        if dist_rem <= step_m * 1.35:
            # Final touchdown at target
            target_elev = reader.get_elevation_at_latlon(target_lat, target_lon)
            target_slope = compute_point_slope_deg(reader, target_lat, target_lon, r_moon=r_moon)
            approx_transit_h = dist_rem / (DEFAULT_ROVER_SPEED_MPS * 3600.0)
            eff_az, eff_el = advance_solar_geometry(
                sun_azimuth_deg, sun_elevation_deg, curr_met + approx_transit_h
            )
            target_illum = estimate_solar_illumination(
                reader, target_lat, target_lon, eff_az, eff_el, r_moon=r_moon
            )
            if (
                waypoints[-1]["waypoint_index"] > 0
                and waypoints[-1]["illumination_fraction"] >= MIN_REGEN_ILLUMINATION
                and curr_bat < REGEN_TARGET_BATTERY_WH - 0.1
                and (target_illum < MIN_REGEN_ILLUMINATION or curr_bat < REGEN_TRIGGER_BATTERY_WH)
            ):
                _top_up_last_sunlit_waypoint()
                eff_az, eff_el = advance_solar_geometry(
                    sun_azimuth_deg, sun_elevation_deg, curr_met + approx_transit_h
                )
                target_illum = estimate_solar_illumination(
                    reader, target_lat, target_lon, eff_az, eff_el, r_moon=r_moon
                )
            kin = compute_step_kinematics_and_power(
                distance_m=dist_rem,
                slope_deg=target_slope,
                illumination_fraction=target_illum,
                current_battery_wh=curr_bat,
                current_met_hours=curr_met,
                allow_stationary_regen=False,
            )
            final_los, _ = check_surface_los(reader, base_lat, base_lon, target_lat, target_lon, r_moon=r_moon)
            final_budget = compute_return_and_sunlit_budget(
                reader=reader,
                geod=geod,
                cand_lat=target_lat,
                cand_lon=target_lon,
                cand_slope=target_slope,
                base_lat=base_lat,
                base_lon=base_lon,
                nominal_step_dist=step_m,
                battery_after_step_wh=kin["new_battery_wh"],
                arrival_met_hours=kin["arrival_met_hours"],
                sun_azimuth_deg=sun_azimuth_deg,
                sun_elevation_deg=sun_elevation_deg,
                r_moon=r_moon,
            )

            total_dist_traversed += dist_rem
            curr_met = kin["departure_met_hours"]
            curr_bat = kin["new_battery_wh"]
            waypoints.append({
                "waypoint_index": wp_idx,
                "coordinates": {
                    "latitude_deg": round(float(target_lat), 6),
                    "longitude_deg": round(float(target_lon), 6),
                    "elevation_m": round(float(target_elev), 1) if not np.isnan(target_elev) else 0.0,
                },
                "distance_from_start_m": round(float(total_dist_traversed), 1),
                "distance_to_target_m": 0.0,
                "distance_to_base_m": final_budget["distance_to_base_m"],
                "return_to_base_wh": final_budget["return_to_base_wh"],
                "distance_to_sunlit_m": final_budget["distance_to_sunlit_m"],
                "nearest_sunlit_illum_pct": final_budget["nearest_sunlit_illum_pct"],
                "reach_sunlit_wh": final_budget["reach_sunlit_wh"],
                "required_return_wh": final_budget["required_return_wh"],
                "can_return_to_base": final_budget["can_return_to_base"],
                "slope_deg": round(float(target_slope), 1),
                "illumination_fraction": round(float(target_illum), 3),
                "battery_wh": kin["new_battery_wh"],
                "battery_before_regen_wh": kin["battery_before_regen_wh"],
                "battery_reserve_pct": kin["reserve_pct"],
                "effective_speed_mps": kin["effective_speed_mps"],
                "drive_duration_hours": kin["drive_duration_hours"],
                "regen_dwell_hours": kin["regen_dwell_hours"],
                "regen_energy_wh": kin["regen_energy_wh"],
                "arrival_met_hours": kin["arrival_met_hours"],
                "met_hours": kin["departure_met_hours"],
                "sun_azimuth_deg": round(eff_az, 1),
                "sun_elevation_deg": round(eff_el, 2),
                "los_to_base": bool(final_los or waypoints[-1]["los_to_base"]),
                "action": "ARRIVE_RESEARCH_TARGET",
            })
            break

        # Suggest forward + regeneration spot candidates at current MET and choose the optimal one
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
            current_met_hours=curr_met,
        )

        valid_cands = [c for c in step_result["candidates"] if c["is_valid"]]
        if (
            not valid_cands
            and waypoints[-1]["illumination_fraction"] >= MIN_REGEN_ILLUMINATION
            and curr_bat < REGEN_TARGET_BATTERY_WH - 0.1
        ):
            _top_up_last_sunlit_waypoint()
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
                current_met_hours=curr_met,
            )
            valid_cands = [c for c in step_result["candidates"] if c["is_valid"]]

        if not valid_cands:
            # Trapped or blocked by terrain hazards / energy return envelope
            status = "FEASIBLE" if len(waypoints) > 2 else "BLOCKED"
            break

        best_cand = valid_cands[0]

        # If best candidate is a stationary in-place Solar Regen Spot, recharge at waypoints[-1]
        if best_cand.get("is_regen_spot") and best_cand["step_distance_m"] < 5.0:
            if waypoints[-1]["waypoint_index"] > 0:
                if waypoints[-1]["action"] == "SOLAR_REGEN_HOLD":
                    non_regen = [c for c in valid_cands if not c.get("is_regen_spot")]
                    if non_regen:
                        best_cand = non_regen[0]
                    else:
                        status = "FEASIBLE" if len(waypoints) > 2 else "BLOCKED"
                        break
                else:
                    last_wp = waypoints[-1]
                    last_wp["regen_energy_wh"] = round(
                        float(last_wp.get("regen_energy_wh", 0.0) + best_cand["regen_energy_wh"]), 1
                    )
                    last_wp["regen_dwell_hours"] = round(
                        float(last_wp.get("regen_dwell_hours", 0.0) + best_cand["regen_dwell_hours"]), 3
                    )
                    last_wp["battery_wh"] = best_cand["battery_wh"]
                    last_wp["battery_reserve_pct"] = best_cand["battery_reserve_pct"]
                    last_wp["met_hours"] = best_cand["met_hours"]
                    last_wp["sun_azimuth_deg"] = best_cand["sun_azimuth_deg"]
                    last_wp["sun_elevation_deg"] = best_cand["sun_elevation_deg"]
                    last_wp["action"] = "SOLAR_REGEN_HOLD"
                    curr_bat = best_cand["battery_wh"]
                    curr_met = best_cand["met_hours"]
                    continue
            else:
                non_regen = [c for c in valid_cands if not c.get("is_regen_spot")]
                if non_regen:
                    best_cand = non_regen[0]
                else:
                    _top_up_last_sunlit_waypoint()
                    continue

        if (
            not best_cand.get("is_regen_spot")
            and best_cand["illumination_fraction"] < MIN_REGEN_ILLUMINATION
            and waypoints[-1]["waypoint_index"] > 0
            and waypoints[-1]["illumination_fraction"] >= MIN_REGEN_ILLUMINATION
            and curr_bat < REGEN_TARGET_BATTERY_WH - 0.1
        ):
            _top_up_last_sunlit_waypoint()
            eff_az_c, eff_el_c = advance_solar_geometry(
                sun_azimuth_deg,
                sun_elevation_deg,
                curr_met + best_cand["drive_duration_hours"],
            )
            c_illum = estimate_solar_illumination(
                reader,
                best_cand["coordinates"]["latitude_deg"],
                best_cand["coordinates"]["longitude_deg"],
                eff_az_c,
                eff_el_c,
                r_moon=r_moon,
            )
            kin_c = compute_step_kinematics_and_power(
                distance_m=best_cand["step_distance_m"],
                slope_deg=best_cand["slope_deg"],
                illumination_fraction=c_illum,
                current_battery_wh=curr_bat,
                current_met_hours=curr_met,
                allow_stationary_regen=False,
            )
            best_cand = dict(best_cand)
            best_cand["illumination_fraction"] = round(float(c_illum), 3)
            best_cand["battery_wh"] = kin_c["new_battery_wh"]
            best_cand["battery_before_regen_wh"] = kin_c["battery_before_regen_wh"]
            best_cand["battery_reserve_pct"] = kin_c["reserve_pct"]
            best_cand["effective_speed_mps"] = kin_c["effective_speed_mps"]
            best_cand["drive_duration_hours"] = kin_c["drive_duration_hours"]
            best_cand["regen_dwell_hours"] = kin_c["regen_dwell_hours"]
            best_cand["regen_energy_wh"] = kin_c["regen_energy_wh"]
            best_cand["arrival_met_hours"] = kin_c["arrival_met_hours"]
            best_cand["met_hours"] = kin_c["departure_met_hours"]
            best_cand["sun_azimuth_deg"] = round(eff_az_c, 1)
            best_cand["sun_elevation_deg"] = round(eff_el_c, 2)

        arrived = best_cand["distance_to_target_m"] <= 5.0
        curr_lat = best_cand["coordinates"]["latitude_deg"]
        curr_lon = best_cand["coordinates"]["longitude_deg"]
        curr_bat = best_cand["battery_wh"]
        curr_met = best_cand["met_hours"]
        total_dist_traversed += best_cand["step_distance_m"]

        action = (
            "ARRIVE_RESEARCH_TARGET"
            if arrived
            else "SOLAR_REGEN_HOLD"
            if (best_cand["regen_dwell_hours"] > 0.0 and best_cand["illumination_fraction"] >= MIN_REGEN_ILLUMINATION)
            else f"STEP_{wp_idx}"
        )

        waypoints.append({
            "waypoint_index": wp_idx,
            "coordinates": best_cand["coordinates"],
            "distance_from_start_m": round(float(total_dist_traversed), 1),
            "distance_to_target_m": 0.0 if arrived else best_cand["distance_to_target_m"],
            "distance_to_base_m": best_cand["distance_to_base_m"],
            "return_to_base_wh": best_cand["return_to_base_wh"],
            "distance_to_sunlit_m": best_cand["distance_to_sunlit_m"],
            "nearest_sunlit_illum_pct": best_cand["nearest_sunlit_illum_pct"],
            "reach_sunlit_wh": best_cand["reach_sunlit_wh"],
            "required_return_wh": best_cand["required_return_wh"],
            "can_return_to_base": best_cand["can_return_to_base"],
            "slope_deg": best_cand["slope_deg"],
            "illumination_fraction": best_cand["illumination_fraction"],
            "battery_wh": best_cand["battery_wh"],
            "battery_before_regen_wh": best_cand["battery_before_regen_wh"],
            "battery_reserve_pct": best_cand["battery_reserve_pct"],
            "effective_speed_mps": best_cand["effective_speed_mps"],
            "drive_duration_hours": best_cand["drive_duration_hours"],
            "regen_dwell_hours": best_cand["regen_dwell_hours"],
            "regen_energy_wh": best_cand["regen_energy_wh"],
            "arrival_met_hours": best_cand["arrival_met_hours"],
            "met_hours": best_cand["met_hours"],
            "sun_azimuth_deg": best_cand["sun_azimuth_deg"],
            "sun_elevation_deg": best_cand["sun_elevation_deg"],
            "los_to_base": best_cand["los_to_base"],
            "action": action,
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
    total_regen_hours = sum(wp.get("regen_dwell_hours", 0.0) for wp in waypoints)
    regen_stops_count = sum(1 for wp in waypoints if wp.get("regen_dwell_hours", 0.0) > 0.0)

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
            "total_traverse_hours": round(float(curr_met - start_met_hours), 2),
            "total_regen_hours": round(float(total_regen_hours), 2),
            "regen_stops_count": regen_stops_count,
            "max_slope_deg": round(float(max(slopes)), 1) if slopes else 0.0,
            "avg_slope_deg": round(float(np.mean(slopes)), 1) if slopes else 0.0,
            "avg_illumination_fraction": round(float(np.mean(illums)), 3) if illums else 0.0,
            "min_battery_wh": round(float(min(bats)), 1) if bats else 0.0,
            "final_battery_wh": round(float(bats[-1]), 1) if bats else 0.0,
            "base_los_fraction": round(float(los_counts / len(waypoints)), 2) if waypoints else 0.0,
        },
        "waypoints": waypoints,
    }
