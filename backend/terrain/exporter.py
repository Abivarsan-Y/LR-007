"""
Terrain Exporter Module.
Converts generated terrain grids into contract-compliant JSON format for Member D's Three.js viewer.
"""

import json
from pathlib import Path
from typing import Dict, Any
import numpy as np


def export_terrain_to_json(
    site_meta: Dict[str, Any],
    grid_meta: Dict[str, Any],
    heights_2d: np.ndarray,
    output_path: str | Path,
    deck_height_m: float = 2.0,
    mast_height_m: float = 5.0
) -> Dict[str, Any]:
    """
    Format terrain data to conform strictly to contracts/terrain.schema.json and save to disk.
    """
    rows, cols = heights_2d.shape
    center_y = rows // 2
    center_x = cols // 2

    # Flatten into 1D row-major list rounded to 2 decimal places for compact JSON payload
    heights_flat = [round(float(h), 2) for h in heights_2d.flatten()]

    contract_data = {
        "schema_version": "1.0",
        "site_id": site_meta["site_id"],
        "name": site_meta["name"],
        "coordinates": {
          "lat_deg": float(site_meta["latitude_deg"]),
          "lon_deg": float(site_meta["longitude_deg"]),
          "elevation_m": float(site_meta["elevation_m"])
        },
        "grid": {
          "cols": int(grid_meta["cols"]),
          "rows": int(grid_meta["rows"]),
          "physical_width_m": float(grid_meta["physical_width_m"]),
          "physical_height_m": float(grid_meta["physical_height_m"]),
          "step_m": float(grid_meta["step_m"]),
          "min_elevation_m": float(grid_meta["min_elevation_m"]),
          "max_elevation_m": float(grid_meta["max_elevation_m"])
        },
        "observer": {
          "grid_x": int(center_x),
          "grid_y": int(center_y),
          "deck_height_m": float(deck_height_m),
          "mast_height_m": float(mast_height_m)
        },
        "heights": heights_flat
    }

    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(contract_data, f, indent=2)

    return contract_data
