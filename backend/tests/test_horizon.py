"""
Unit Tests for Curvature-Aware Lunar Horizon Engine (Person B).
Verifies geodesic ray-casting, lunar curvature drop, analytical spherical horizon dip,
and integration with Pydantic HorizonProfile contracts.
"""

import math
import numpy as np
import pytest

from backend.terrain.geometry import R_MOON_M, curvature_drop
from backend.terrain.horizon import (
    compute_azimuth_horizon,
    build_contract_horizon_profile,
)


def test_curvature_drop_values():
    """Verify lunar spherical curvature drop: delta_z = d^2 / (2 * R_moon)."""
    # At d = 10 km: (10,000^2) / (2 * 1,737,400) ≈ 28.778 m
    drop_10km = curvature_drop(10000.0)
    assert abs(drop_10km - 28.7786) < 0.01

    # At d = 20 km: (20,000^2) / (2 * 1,737,400) ≈ 115.114 m
    drop_20km = curvature_drop(20000.0)
    assert abs(drop_20km - 115.1145) < 0.01

    # At d = 50 km: (50,000^2) / (2 * 1,737,400) ≈ 719.465 m
    drop_50km = curvature_drop(50000.0)
    assert abs(drop_50km - 719.4658) < 0.01


def test_spherical_flat_surface_matches_analytic_dip():
    """
    On a flat reference sphere with no topography (z=0), the apparent horizon dip
    for an observer at height h_obs must match the exact spherical formula:
    theta_dip = -arccos(R / (R + h_obs)).
    """
    grid = np.zeros((128, 128), dtype=float)
    x0, y0 = 64, 64
    pixel_res_m = 50.0
    h_obs = 2.0  # standard 2m lander deck

    expected_dip = -math.degrees(math.acos(R_MOON_M / (R_MOON_M + h_obs)))

    horizon = compute_azimuth_horizon(
        dem_grid=grid,
        x0_idx=x0,
        y0_idx=y0,
        pixel_res_m=pixel_res_m,
        h_obs=h_obs,
        max_radius_km=10.0,
        num_azimuths=16
    )

    # All azimuths should be identical on a flat sphere
    for angle in horizon:
        assert abs(angle - expected_dip) < 0.005, f"Expected {expected_dip:.4f}°, got {angle:.4f}°"


def test_synthetic_ridge_obstruction():
    """Verify that an elevated ridge in a specific azimuth direction raises the apparent skyline."""
    grid = np.zeros((128, 128), dtype=float)
    x0, y0 = 64, 64
    pixel_res_m = 50.0

    # Place a 500m tall ridge to the East (+X in grid, azimuth 90°) at distance 2 km (col 64 + 40 = 104)
    grid[:, 104] = 500.0

    horizon = compute_azimuth_horizon(
        dem_grid=grid,
        x0_idx=x0,
        y0_idx=y0,
        pixel_res_m=pixel_res_m,
        h_obs=2.0,
        max_radius_km=5.0,
        num_azimuths=360
    )

    # East is azimuth 90°
    east_angle = horizon[90]
    west_angle = horizon[270]

    # At d = 2000m, dz = 500 - 2 - drop(2000) = 498 - 1.15 = 496.85m -> arctan(496.85/2000) ≈ 13.95°
    assert east_angle > 10.0
    assert abs(east_angle - 13.95) < 0.5
    # West has no ridge, should be near flat dip (-0.087°)
    assert west_angle < 0.0


def test_build_contract_horizon_profile_and_query():
    """Verify conversion to HorizonProfile contract and piecewise linear query."""
    azimuths = np.linspace(0, 360, 360, endpoint=False)
    # Sine wave skyline between -0.08° and 4.0°
    elevations = 2.0 + 2.0 * np.sin(np.radians(azimuths))

    profile = build_contract_horizon_profile(
        azimuths_deg=azimuths,
        horizon_angles=elevations,
        site_id="site01_test",
        lat_deg=-89.44,
        lon_deg=222.0,
        elevation_m=1850.0,
        h_obs=2.0,
        data_kind="cached_real"
    )

    assert profile is not None
    assert len(profile.points) == 360
    assert profile.observer.site_id == "site01_test"
    # Longitude normalized to [-180, 180]
    assert profile.observer.longitude_deg == -138.0

    # Query interpolation at exact and intermediate angles
    at_0 = profile.at(0.0)
    assert abs(at_0 - 2.0) < 1e-4

    at_90 = profile.at(90.0)
    assert abs(at_90 - 4.0) < 1e-4

    at_45 = profile.at(45.0)
    assert 2.0 < at_45 < 4.0


def test_invalid_observer_or_bounds():
    """Verify bounds checking and error handling."""
    grid = np.zeros((32, 32))
    with pytest.raises(ValueError, match="out of grid bounds"):
        compute_azimuth_horizon(grid, -1, 10)

    with pytest.raises(ValueError, match="out of grid bounds"):
        compute_azimuth_horizon(grid, 10, 50)
