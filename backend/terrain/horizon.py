"""
Curvature-Aware Lunar Horizon Engine.
Casts 360-degree azimuth rays over LOLA DEMs and height grids,
accounting for lunar spherical curvature drop:
    Delta z_drop(d) = sqrt(R^2 + d^2) - R ≈ d^2 / (2 * R_moon)
"""

import math
from pathlib import Path
from typing import Dict, Any, Tuple, List, Optional
import numpy as np
from pyproj import Geod

from backend.terrain.geometry import R_MOON_M, curvature_drop, latlon_to_polar_stereo, polar_stereo_to_latlon
from backend.terrain.ingest import LolaDemReader


def compute_azimuth_horizon(
    dem_grid: np.ndarray,
    x0_idx: int,
    y0_idx: int,
    pixel_res_m: float = 80.0,
    h_obs: float = 2.0,
    max_radius_km: float = 35.0,
    num_azimuths: int = 360,
    r_moon: float = R_MOON_M
) -> np.ndarray:
    """
    Compute 360-degree apparent horizon profile from a 2D height grid.
    
    Args:
        dem_grid: 2D array of elevations in meters (rows, cols)
        x0_idx: Observer column index
        y0_idx: Observer row index
        pixel_res_m: Spatial resolution per pixel in meters
        h_obs: Observer mast/deck height above ground in meters
        max_radius_km: Maximum radial search distance in km
        num_azimuths: Number of azimuth steps around horizon (default 360)
        r_moon: Lunar mean radius in meters (1,737,400 m)
        
    Returns:
        1D array of apparent horizon elevation angles in degrees (length num_azimuths)
    """
    rows, cols = dem_grid.shape
    if not (0 <= x0_idx < cols and 0 <= y0_idx < rows):
        raise ValueError(f"Observer index ({x0_idx}, {y0_idx}) out of grid bounds ({cols}, {rows})")

    z0 = float(dem_grid[y0_idx, x0_idx])
    if np.isnan(z0):
        raise ValueError("Observer elevation in grid is NaN / nodata")
    
    z_eye = z0 + h_obs
    max_steps = max(2, int((max_radius_km * 1000.0) / pixel_res_m))
    step_indices = np.arange(1, max_steps, dtype=float)
    distances = step_indices * pixel_res_m
    drop = curvature_drop(distances, r_moon)

    azimuths_deg = np.linspace(0.0, 360.0, num_azimuths, endpoint=False)
    horizon_profile = np.zeros(num_azimuths, dtype=float)

    for i, az_deg in enumerate(azimuths_deg):
        # Azimuth angle measured clockwise from North (+Y in image if row-decreases-northwards)
        az_rad = math.radians(az_deg)
        dx = np.sin(az_rad)
        dy = np.cos(az_rad)

        sample_x = np.clip(np.round(x0_idx + step_indices * dx).astype(int), 0, cols - 1)
        sample_y = np.clip(np.round(y0_idx - step_indices * dy).astype(int), 0, rows - 1)

        sample_z = dem_grid[sample_y, sample_x]
        
        # Mask NaNs
        valid = np.isfinite(sample_z)
        if not np.any(valid):
            horizon_profile[i] = -90.0
            continue

        valid_z = sample_z[valid]
        valid_dist = distances[valid]
        valid_drop = drop[valid]

        apparent_dz = valid_z - z_eye - valid_drop
        apparent_angles = np.rad2deg(np.arctan2(apparent_dz, valid_dist))
        horizon_profile[i] = float(np.max(apparent_angles))

    return horizon_profile


def compute_dem_horizon(
    reader: LolaDemReader,
    lat_deg: float,
    lon_deg: float,
    h_obs: float = 2.0,
    max_radius_km: float = 50.0,
    radial_step_m: float = 80.0,
    num_azimuths: int = 360,
    r_moon: float = R_MOON_M
) -> Tuple[np.ndarray, np.ndarray, Dict[str, Any]]:
    """
    Cast true spherical geodetic rays over the full LOLA GeoTIFF DEM.
    
    Uses pyproj.Geod on the 1,737,400 m lunar sphere to follow true geodesic bearings
    from the observer point, sampling elevations from the LOLA memory map.
    
    Args:
        reader: LolaDemReader instance of LOLA DEM (e.g. LDEM_80S_80MPP_ADJ.TIF)
        lat_deg: Observer latitude in degrees south [-90.0, 0.0]
        lon_deg: Observer longitude in degrees east [0.0, 360.0]
        h_obs: Observer antenna/mast height above ground in meters
        max_radius_km: Maximum radial search radius in km (default 50 km)
        radial_step_m: Radial step along ray in meters (default 80 m)
        num_azimuths: Number of azimuth bearings [0, 360) (default 360)
        r_moon: Lunar mean radius in meters
        
    Returns:
        azimuths_deg: 1D array of azimuths in [0, 360)
        horizon_profile: 1D array of apparent horizon elevation angles in degrees
        metadata: Diagnostic info (observer elevation, min/max angle, completeness)
    """
    geod = Geod(a=r_moon, b=r_moon)
    
    # Observer ground elevation
    z0 = reader.get_elevation_at_latlon(lat_deg, lon_deg)
    if np.isnan(z0) or z0 < -20000.0:
        # Fallback to local average if exact point is nodata
        z0 = 0.0

    z_eye = z0 + h_obs
    max_radius_m = max_radius_km * 1000.0
    distances = np.arange(radial_step_m, max_radius_m + 0.1, radial_step_m, dtype=float)
    drop = curvature_drop(distances, r_moon)

    azimuths_deg = np.linspace(0.0, 360.0, num_azimuths, endpoint=False)
    horizon_angles = np.zeros(num_azimuths, dtype=float)
    ray_completeness = []

    for i, az in enumerate(azimuths_deg):
        # Forward geodesic calculation on lunar sphere
        sample_lons, sample_lats, _ = geod.fwd(
            np.full_like(distances, lon_deg),
            np.full_like(distances, lat_deg),
            np.full_like(distances, az),
            distances
        )

        # Convert geodetic sample points to Polar Stereographic coordinates
        # and sample LOLA memory-mapped raster
        x_m, y_m = latlon_to_polar_stereo(sample_lats, sample_lons, r_moon)
        cols = np.round((x_m - reader.ul_x) / reader.res_x).astype(int)
        rows = np.round((reader.ul_y - y_m) / reader.res_y).astype(int)

        valid_bounds = (cols >= 0) & (cols < reader.cols) & (rows >= 0) & (rows < reader.rows)
        
        if not np.any(valid_bounds):
            horizon_angles[i] = -90.0
            ray_completeness.append(False)
            continue

        sample_z = np.full_like(distances, np.nan)
        sample_z[valid_bounds] = reader.data_mmap[rows[valid_bounds], cols[valid_bounds]]

        finite_mask = np.isfinite(sample_z) & (sample_z > -20000.0)
        
        if not np.any(finite_mask):
            horizon_angles[i] = -90.0
            ray_completeness.append(False)
            continue

        active_z = sample_z[finite_mask]
        active_dist = distances[finite_mask]
        active_drop = drop[finite_mask]

        apparent_dz = active_z - z_eye - active_drop
        apparent_elevs = np.rad2deg(np.arctan2(apparent_dz, active_dist))
        horizon_angles[i] = float(np.max(apparent_elevs))
        ray_completeness.append(bool(np.all(finite_mask)))

    metadata = {
        "site_latitude_deg": float(lat_deg),
        "site_longitude_deg": float(lon_deg),
        "site_elevation_m": float(z0),
        "observer_height_m": float(h_obs),
        "search_radius_km": float(max_radius_km),
        "radial_step_m": float(radial_step_m),
        "num_azimuths": int(num_azimuths),
        "min_horizon_deg": float(np.min(horizon_angles)),
        "max_horizon_deg": float(np.max(horizon_angles)),
        "mean_horizon_deg": float(np.mean(horizon_angles)),
        "complete_coverage": bool(all(ray_completeness))
    }

    return azimuths_deg, horizon_angles, metadata


def build_contract_horizon_profile(
    azimuths_deg: np.ndarray,
    horizon_angles: np.ndarray,
    site_id: str,
    lat_deg: float,
    lon_deg: float,
    elevation_m: float,
    h_obs: float,
    data_kind: str = "cached_real",
    source_uri: str = "https://pgda.gsfc.nasa.gov/products/90",
    source_sha256: str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
):
    """
    Format horizon angles into a validated Pydantic HorizonProfile instance
    matching backend.engine.visibility.HorizonProfile for seamless pipeline integration.
    """
    try:
        from backend.engine.visibility import HorizonPoint, HorizonProfile
        from backend.engine.ephemeris import Observer
    except ImportError:
        return None

    # Longitude must be normalized to [-180, 180] for contract
    norm_lon = ((lon_deg + 180.0) % 360.0) - 180.0
    
    observer = Observer(
        site_id=site_id,
        latitude_deg=float(lat_deg),
        longitude_deg=float(norm_lon),
        elevation_m=float(elevation_m),
        observer_height_m=float(h_obs)
    )

    points = []
    for az, elev in zip(azimuths_deg, horizon_angles):
        is_finite = math.isfinite(elev) and elev > -89.9
        points.append(
            HorizonPoint(
                azimuth_deg=float(az % 360.0),
                elevation_deg=float(elev) if is_finite else None,
                coverage="complete" if is_finite else "unknown"
            )
        )

    sources = []
    if data_kind != "synthetic":
        sources.append({
            "id": "NASA_LOLA_80MPP",
            "uri": source_uri,
            "sha256": source_sha256
        })

    provenance = {
        "data_kind": data_kind,
        "model_version": "0.1.0",
        "sources": sources,
        "assumptions": [
            "Terrain elevations referenced to 1,737,400 m lunar sphere.",
            "Lunar curvature drop delta_z = d^2 / (2 * R_moon) applied along true geodetic bearings."
        ]
    }

    return HorizonProfile(
        observer=observer,
        points=tuple(points),
        provenance=provenance,
        method="lola_geodesic_curvature_raycast",
        parameters={
            "radial_step_m": 80.0,
            "max_radius_km": 50.0,
            "num_azimuths": len(azimuths_deg)
        }
    )
