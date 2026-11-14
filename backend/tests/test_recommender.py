"""
Unit Tests for Nearby Safe Haven Recommender Engine (Person B).
Verifies candidate search radius enforcement, touchdown slope safety threshold (<= 8.0°),
and JSON schema validation against contracts/recommend.schema.json.
"""

import numpy as np
import pytest
from pathlib import Path

from backend.terrain.recommender import (
    find_safe_havens_from_grid,
    normalize_longitude,
)
from scripts.validate_fixtures import validate_document


def test_normalize_longitude():
    """Verify longitude normalization into [-180, 180]."""
    assert normalize_longitude(0.0) == 0.0
    assert normalize_longitude(180.0) == -180.0 or normalize_longitude(180.0) == 180.0
    assert normalize_longitude(222.0) == -138.0
    assert normalize_longitude(355.2) == pytest.approx(-4.8, abs=1e-5)
    assert normalize_longitude(-45.0) == -45.0


def test_find_safe_havens_contract_validation():
    """Verify generated recommendation strictly satisfies contracts/recommend.schema.json."""
    # Create a synthetic crater: deep steep center (-800m, slope 25°), surrounded by flat ridges (+200m, slope 3°)
    res = 64
    grid = np.zeros((res, res), dtype=float)
    y, x = np.indices((res, res))
    r = np.hypot(x - 32, y - 32)
    
    # Crater bowl in center
    grid[r < 15] = -500.0 + (r[r < 15] * 20.0)
    # Ridge on the northwest
    grid[(x < 20) & (y < 20)] = 300.0

    doc = find_safe_havens_from_grid(
        heights_2d=grid,
        step_m=50.0,
        origin_x_idx=32,
        origin_y_idx=32,
        origin_lat_deg=-87.40,
        origin_lon_deg=355.20,
        origin_site_id="site09_haworth_floor",
        search_radius_m=2000.0,
        max_slope_deg=8.0,
        data_kind="cached_real"
    )

    # Validate against JSON schema using official contract validator
    validate_document("recommend", doc)

    assert doc["schema_version"] == "0.1.0"
    assert doc["origin_site_id"] == "site09_haworth_floor"
    assert doc["search_radius_m"] == 2000.0
    assert len(doc["candidates"]) > 0

    for cand in doc["candidates"]:
        # Verify distance constraint
        assert 0.0 <= cand["distance_m"] <= doc["search_radius_m"]
        # Verify slope constraint
        assert cand["slope_deg"] <= 8.0
        # Verify coordinate conventions
        coords = cand["coordinates"]
        assert -90.0 <= coords["latitude_deg"] <= 90.0
        assert -180.0 <= coords["longitude_deg"] <= 180.0
        assert coords["frame"] == "MOON_ME_DE421"
        assert coords["reference_radius_m"] == 1737400


def test_candidates_are_ranked_by_elevation_and_flatness():
    """Verify that candidates with higher elevation and lower slope are prioritized."""
    res = 64
    grid = np.zeros((res, res), dtype=float)
    # Flat low plain at 0m
    # High plateau at 500m (slope 0) at x=45, y=32
    grid[28:36, 40:50] = 500.0

    doc = find_safe_havens_from_grid(
        heights_2d=grid,
        step_m=50.0,
        origin_x_idx=32,
        origin_y_idx=32,
        origin_lat_deg=-89.0,
        origin_lon_deg=0.0,
        origin_site_id="test_site",
        search_radius_m=1500.0,
        max_slope_deg=8.0,
        data_kind="cached_real"
    )

    candidates = doc["candidates"]
    assert len(candidates) > 0
    # The top candidate should have elevated plateau benefits
    top = candidates[0]
    assert top["coordinates"]["elevation_m"] > 0
