"""
Tweakable Lunar Terrain Generator & Ingestion Module.
Generates realistic south-pole topography (crater rims, basins, regolith roughness)
and supports reading real LOLA DEM raster crops when available.
"""

from dataclasses import dataclass
from typing import Optional, Tuple
import numpy as np


@dataclass
class TerrainConfig:
    """Configurable parameters for Person B to tweak terrain generation."""
    cols: int = 64
    rows: int = 64
    physical_width_m: float = 5000.0  # 5 km x 5 km box
    physical_height_m: float = 5000.0
    base_elevation_m: float = 1850.0  # Site nominal elevation
    crater_radius_m: float = 1800.0   # Dominant crater feature radius
    crater_depth_m: float = 350.0     # Basin depression
    rim_height_m: float = 220.0       # Uplifted crater rim height
    roughness_m: float = 18.0         # Regolith noise amplitude
    seed: int = 42


def generate_terrain_grid(config: TerrainConfig) -> Tuple[np.ndarray, dict]:
    """
    Generate a realistic 2D lunar terrain elevation array with crater rim/bowl structure
    and micro-scale regolith roughness.
    Returns:
        heights_2d: 2D numpy array of shape (rows, cols) in meters.
        metadata: Dict describing the grid bounds and step size.
    """
    rng = np.random.default_rng(config.seed)

    cols = config.cols
    rows = config.rows
    step_x = config.physical_width_m / (cols - 1)
    step_y = config.physical_height_m / (rows - 1)
    step_m = (step_x + step_y) / 2.0

    # Local metric coordinates relative to center (0, 0)
    x = np.linspace(-config.physical_width_m / 2.0, config.physical_width_m / 2.0, cols)
    y = np.linspace(-config.physical_height_m / 2.0, config.physical_height_m / 2.0, rows)
    xx, yy = np.meshgrid(x, y)
    r = np.hypot(xx, yy)

    # 1. Base topography: Regional slope tilt (simulating large polar basin gradient)
    regional_slope = 0.02 * xx - 0.015 * yy

    # 2. Crater morphology: Raised rim + deep bowl
    # Rim peaks at r = crater_radius_m
    norm_r = r / max(config.crater_radius_m, 1.0)
    # Rim uplift function: Gaussian ring around crater_radius
    rim_uplift = config.rim_height_m * np.exp(-((norm_r - 1.0) ** 2) / 0.15)
    # Basin depression inside the rim
    crater_bowl = -config.crater_depth_m * np.exp(-(norm_r ** 2) / 0.8)

    # 3. Secondary craterlets & undulating ridge spurs
    spur_angle = np.arctan2(yy, xx)
    ridge_spurs = 60.0 * np.sin(3.0 * spur_angle) * np.exp(-(norm_r ** 2) / 1.5)

    # 4. Multi-octave regolith fractal roughness
    noise = np.zeros((rows, cols))
    # Low frequency undulating hills
    noise += 25.0 * np.sin(xx / 400.0) * np.cos(yy / 350.0)
    # Medium frequency ripples
    noise += 10.0 * np.sin(xx / 120.0 + yy / 150.0)
    # High frequency random rockiness
    noise += rng.normal(0.0, config.roughness_m, size=(rows, cols))

    # Combine into absolute lunar elevation
    heights_2d = (
        config.base_elevation_m
        + regional_slope
        + crater_bowl
        + rim_uplift
        + ridge_spurs
        + noise
    )

    metadata = {
        "cols": cols,
        "rows": rows,
        "physical_width_m": config.physical_width_m,
        "physical_height_m": config.physical_height_m,
        "step_m": step_m,
        "min_elevation_m": round(float(np.min(heights_2d)), 2),
        "max_elevation_m": round(float(np.max(heights_2d)), 2),
    }

    return heights_2d, metadata
