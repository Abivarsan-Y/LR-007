"""
HORIZON OPS — Terrain, Geodesy & Safety Engine (Person B)
"""

from .geometry import (
    R_MOON_M,
    latlon_to_polar_stereo,
    polar_stereo_to_latlon,
    curvature_drop,
    apparent_elevation_angle,
)
from .slope import compute_slope_grid, classify_slope
from .generator import generate_terrain_grid, TerrainConfig
from .ingest import LolaDemReader
from .exporter import export_terrain_to_json, export_terrain_binary_contract
from .horizon import (
    compute_azimuth_horizon,
    compute_dem_horizon,
    build_contract_horizon_profile,
)
from .recommender import (
    find_safe_havens_from_grid,
    recommend_safe_havens_from_dem,
    normalize_longitude,
)
from .traverse import (
    suggest_next_waypoints,
    plan_automatic_traverse,
    check_surface_los,
    compute_point_slope_deg,
    compute_leg_power,
    estimate_solar_illumination,
)

__all__ = [
    "R_MOON_M",
    "latlon_to_polar_stereo",
    "polar_stereo_to_latlon",
    "curvature_drop",
    "apparent_elevation_angle",
    "compute_slope_grid",
    "classify_slope",
    "generate_terrain_grid",
    "TerrainConfig",
    "LolaDemReader",
    "export_terrain_to_json",
    "export_terrain_binary_contract",
    "compute_azimuth_horizon",
    "compute_dem_horizon",
    "build_contract_horizon_profile",
    "find_safe_havens_from_grid",
    "recommend_safe_havens_from_dem",
    "normalize_longitude",
    "suggest_next_waypoints",
    "plan_automatic_traverse",
    "check_surface_los",
    "compute_point_slope_deg",
    "compute_leg_power",
    "estimate_solar_illumination",
]
