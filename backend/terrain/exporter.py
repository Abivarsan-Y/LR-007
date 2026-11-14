"""
Terrain Exporter Module.
Converts generated and cropped terrain grids into:
1. v1.0 JSON format for Member C/D's dashboard inspection.
2. Standard binary Float32 Little-Endian (.bin) and contract-compliant JSON
   conforming strictly to contracts/terrain.schema.json.
"""

import hashlib
import json
from pathlib import Path
from typing import Dict, Any, Optional
import numpy as np

from backend.terrain.recommender import normalize_longitude


def export_terrain_to_json(
    site_meta: Dict[str, Any],
    grid_meta: Dict[str, Any],
    heights_2d: np.ndarray,
    output_path: str | Path,
    deck_height_m: float = 2.0,
    mast_height_m: float = 5.0
) -> Dict[str, Any]:
    """
    Format terrain data to v1.0 JSON format for inspection and save to disk.
    """
    rows, cols = heights_2d.shape
    center_y = rows // 2
    center_x = cols // 2

    # Flatten into 1D row-major list rounded to 2 decimal places for compact JSON payload
    heights_flat = [round(float(h), 2) if np.isfinite(h) else None for h in heights_2d.flatten()]

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


def export_terrain_binary_contract(
    site_meta: Dict[str, Any],
    heights_2d: np.ndarray,
    step_m: float,
    bin_output_path: str | Path,
    json_output_path: str | Path,
    repo_root: Optional[Path] = None,
    data_kind: str = "cached_real",
    source_uri: str = "https://pgda.gsfc.nasa.gov/products/90",
    source_sha256: str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
) -> Dict[str, Any]:
    """
    Export binary Float32 array (.bin) and matching metadata JSON
    conforming strictly to contracts/terrain.schema.json.
    
    Args:
        site_meta: Dictionary with site_id, latitude_deg, longitude_deg, elevation_m
        heights_2d: 2D numpy array of elevations in meters (rows, cols)
        step_m: Grid cell resolution in meters
        bin_output_path: Path to write the .bin binary float32 file
        json_output_path: Path to write the .json metadata contract file
        repo_root: Repository root path for relative asset_path calculation
        data_kind: "cached_real" or "synthetic"
        source_uri: Source URI for provenance
        source_sha256: Source SHA256 checksum for provenance
        
    Returns:
        JSON contract dictionary validating against contracts/terrain.schema.json
    """
    rows, cols = heights_2d.shape
    bin_file = Path(bin_output_path)
    json_file = Path(json_output_path)
    
    bin_file.parent.mkdir(parents=True, exist_ok=True)
    json_file.parent.mkdir(parents=True, exist_ok=True)
    
    # Convert heights to float32 little endian array (row major)
    # NaNs are encoded as standard IEEE 754 float32 NaN
    arr_f32 = heights_2d.astype("<f4")
    bin_bytes = arr_f32.tobytes()
    
    with open(bin_file, "wb") as f:
        f.write(bin_bytes)
        
    file_sha256 = hashlib.sha256(bin_bytes).hexdigest()
    
    if repo_root is None:
        repo_root = Path(__file__).resolve().parents[2]
        
    # Relative path from repository root
    try:
        rel_asset_path = str(bin_file.resolve().relative_to(repo_root.resolve()))
    except ValueError:
        rel_asset_path = str(bin_file)
        
    sources = []
    if data_kind != "synthetic":
        sources.append({
            "id": "NASA_LOLA_80MPP",
            "uri": source_uri,
            "sha256": source_sha256
        })

    lon_deg = float(site_meta["longitude_deg"])
    norm_lon = normalize_longitude(lon_deg)
    
    contract_data = {
        "schema_version": "0.1.0",
        "provenance": {
            "data_kind": data_kind,
            "model_version": "0.1.0",
            "sources": sources,
            "assumptions": [
                "Elevation values are in metres above 1,737,400 m lunar reference sphere.",
                "Grid is aligned to local ENU tangent plane: +X east, +Y up, -Z north."
            ]
        },
        "site_id": str(site_meta["site_id"]),
        "asset_path": rel_asset_path,
        "sha256": file_sha256,
        "encoding": "float32_le",
        "width": int(cols),
        "height": int(rows),
        "spacing_m": float(step_m),
        "coordinates": {
            "latitude_deg": float(site_meta["latitude_deg"]),
            "longitude_deg": float(norm_lon),
            "elevation_m": float(site_meta["elevation_m"]),
            "frame": "MOON_ME_DE421",
            "reference_radius_m": 1737400
        },
        "layout": "row_major_north_to_south_west_to_east",
        "height_reference": "metres_above_reference_sphere",
        "nodata_encoding": "nan",
        "scene_axes": "+X east, +Y up, -Z north"
    }

    with open(json_file, "w", encoding="utf-8") as f:
        json.dump(contract_data, f, indent=2)

    return contract_data
