"""
Local East-North-Up (ENU) Terrain Resampling Engine.
Resamples raw rotated polar stereographic DEM rasters into an observer-centered
Cartesian grid aligned strictly with scene axes:
    +X East, +Y Up, -Z North (row-major north-to-south, west-to-east)
Conforms to contracts/terrain.schema.json and Three.js requirements.
"""

from pathlib import Path
from typing import List, Union, Tuple, Dict, Any, Optional
import numpy as np
from pyproj import Geod

from backend.terrain.geometry import R_MOON_M
from backend.terrain.exporter import export_terrain_binary_contract, export_terrain_to_json
from backend.engine.terrain_horizon import RasterTerrain


def resample_local_enu_grid(
    dem_paths: List[Union[str, Path]],
    lat_0: float,
    lon_0: float,
    grid_size: int = 129,
    spacing_m: float = 20.0,
    r_moon: float = R_MOON_M
) -> np.ndarray:
    """
    Sample an exact (grid_size x grid_size) local East/North grid centered on (lat_0, lon_0).
    
    Layout: row-major north-to-south (row 0 is North, row N-1 is South),
            west-to-east (col 0 is West, col N-1 is East).
    Center: row = grid_size // 2, col = grid_size // 2 has east = 0, north = 0.
    Missing/nodata values are preserved as IEEE 754 float32 NaN (never median-filled).
    
    Args:
        dem_paths: List of GeoTIFF paths in priority order (e.g. [5mpp_surf.tif, 80mpp.tif])
        lat_0: Canonical observer latitude in degrees south
        lon_0: Canonical observer longitude in degrees east [-180, 180] or [0, 360]
        grid_size: Number of vertices per side (default 129 for exact center at 64)
        spacing_m: Distance between adjacent vertices in meters (default 20m)
        r_moon: Lunar mean radius (1,737,400 m)
        
    Returns:
        2D numpy array of shape (grid_size, grid_size) with dtype float32
    """
    if grid_size % 2 == 0:
        raise ValueError(f"grid_size must be odd to have an exact center sample, got {grid_size}")

    center = grid_size // 2
    r_indices, c_indices = np.indices((grid_size, grid_size))

    # Local metric coordinates:
    # Col increases eastwards (+X East)
    east_m = (c_indices - center) * spacing_m
    # Row increases southwards (-Z North -> Row 0 is +North, Row N-1 is -North)
    north_m = (center - r_indices) * spacing_m

    distances = np.hypot(east_m, north_m)
    # Azimuth clockwise from North in degrees [0, 360)
    bearings = (np.degrees(np.arctan2(east_m, north_m)) + 360.0) % 360.0

    geod = Geod(a=r_moon, b=r_moon)
    sample_lons, sample_lats, _ = geod.fwd(
        np.full_like(distances, lon_0),
        np.full_like(distances, lat_0),
        bearings,
        distances
    )

    # Exact centre has distance 0, preserve exact canonical coordinates
    sample_lons[center, center] = lon_0
    sample_lats[center, center] = lat_0

    with RasterTerrain(dem_paths) as terrain:
        flat_heights = terrain.sample(sample_lons.ravel(), sample_lats.ravel())

    grid = flat_heights.reshape((grid_size, grid_size)).astype(np.float32)
    return grid
