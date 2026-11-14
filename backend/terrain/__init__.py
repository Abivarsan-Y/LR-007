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
from .exporter import export_terrain_to_json

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
    "export_terrain_to_json",
]
