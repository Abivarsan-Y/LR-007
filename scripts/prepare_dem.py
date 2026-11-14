#!/usr/bin/env python3
"""
HORIZON OPS — Terrain Preparation, LOLA Ingestion & Horizon Profiler CLI Tool (Person B)
Ingests real NASA LOLA DEM GeoTIFFs (when present in data/raw/) or generates realistic baselines:
1. Exports v1.0 JSON grids for frontend visual inspection.
2. Exports binary Float32 meshes (.bin) and metadata matching contracts/terrain.schema.json.
3. Pre-computes 360-degree curvature-aware horizon profiles matching contracts.
4. Pre-computes Nearby Safe Haven recommendations matching contracts/recommend.schema.json.

Usage:
    python3 scripts/prepare_dem.py --all
    python3 scripts/prepare_dem.py --site site01_connecting_ridge --resolution 64 --size 5000
    python3 scripts/prepare_dem.py --site site04_shackleton_rim --resolution 128
"""

import argparse
import json
import sys
from pathlib import Path

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from backend.terrain.generator import TerrainConfig, generate_terrain_grid
from backend.terrain.exporter import export_terrain_to_json, export_terrain_binary_contract
from backend.terrain.slope import compute_slope_grid, classify_slope
from backend.terrain.horizon import compute_azimuth_horizon, compute_dem_horizon
from backend.terrain.recommender import find_safe_havens_from_grid, recommend_safe_havens_from_dem, normalize_longitude


def load_sites(sites_path: Path):
    with open(sites_path, "r", encoding="utf-8") as f:
        return json.load(f)


def prepare_site(site_info: dict, resolution: int, physical_size_m: float, output_dir: Path, dem_reader=None):
    site_id = site_info["site_id"]
    lat = site_info["latitude_deg"]
    lon = site_info["longitude_deg"]
    mast_m = site_info.get("recommended_mast_m", 2.0)

    heights_2d = None
    data_source = "PROCEDURAL"

    if dem_reader is not None:
        print(f"--> [REAL NASA LOLA] Ingesting terrain for [{site_info['name']}] ({resolution}x{resolution}, {physical_size_m/1000:.1f}km box)...")
        try:
            heights_2d, grid_meta = dem_reader.crop_region(
                center_lat=lat,
                center_lon=lon,
                width_m=physical_size_m,
                height_m=physical_size_m,
                target_resolution=resolution
            )
            data_source = "NASA_LOLA_PGDA_REAL"
        except Exception as e:
            print(f"    ⚠️ Failed to crop real LOLA DEM ({e}). Falling back to procedural.")
            dem_reader = None

    if dem_reader is None or heights_2d is None:
        print(f"--> [PROCEDURAL FALLBACK] Generating terrain for [{site_info['name']}] ({resolution}x{resolution}, {physical_size_m/1000:.1f}km box)...")
        crater_depth = 350.0
        rim_height = 220.0
        roughness = 16.0

        if "shackleton" in site_id:
            crater_depth = 600.0
            rim_height = 350.0
            roughness = 22.0
        elif "malapert" in site_id:
            crater_depth = 150.0
            rim_height = 550.0
            roughness = 25.0
        elif "haworth" in site_id:
            crater_depth = 800.0
            rim_height = 180.0
            roughness = 18.0

        config = TerrainConfig(
            cols=resolution,
            rows=resolution,
            physical_width_m=physical_size_m,
            physical_height_m=physical_size_m,
            base_elevation_m=site_info["elevation_m"],
            crater_depth_m=crater_depth,
            rim_height_m=rim_height,
            roughness_m=roughness,
            seed=abs(hash(site_id)) % 100000
        )
        heights_2d, grid_meta = generate_terrain_grid(config)
        data_source = "SYNTHETIC_LUNAR_PROCEDURAL"

    # 1. Evaluate touchdown slope at center observer position
    step_m = grid_meta["step_m"]
    slope_grid = compute_slope_grid(heights_2d, step_m)
    center_y, center_x = resolution // 2, resolution // 2
    center_slope = float(slope_grid[center_y, center_x])
    safety_assessment = classify_slope(center_slope)

    # 2. Export v1.0 JSON format for dashboard inspection
    v1_json_path = output_dir / f"{site_id}.json"
    v1_data = export_terrain_to_json(
        site_meta=site_info,
        grid_meta=grid_meta,
        heights_2d=heights_2d,
        output_path=v1_json_path,
        deck_height_m=mast_m,
        mast_height_m=5.0
    )
    v1_data["data_source"] = data_source

    with open(v1_json_path, "w", encoding="utf-8") as f:
        json.dump(v1_data, f, indent=2)

    # 3. Export binary Float32 Little-Endian mesh and contract metadata
    bin_mesh_path = output_dir / f"{site_id}_terrain.bin"
    contract_json_path = output_dir / f"{site_id}_terrain.json"
    data_kind = "cached_real" if data_source == "NASA_LOLA_PGDA_REAL" else "synthetic"

    export_terrain_binary_contract(
        site_meta=site_info,
        heights_2d=heights_2d,
        step_m=step_m,
        bin_output_path=bin_mesh_path,
        json_output_path=contract_json_path,
        repo_root=root_dir,
        data_kind=data_kind
    )

    # 4. Compute 360° curvature-aware horizon profile
    print(f"    --> Computing 360° curvature horizon profile...")
    if dem_reader is not None:
        azimuths, horizon_angles, horizon_meta = compute_dem_horizon(
            reader=dem_reader,
            lat_deg=lat,
            lon_deg=lon,
            h_obs=mast_m,
            max_radius_km=50.0,
            radial_step_m=160.0,
            num_azimuths=360
        )
    else:
        horizon_angles = compute_azimuth_horizon(
            dem_grid=heights_2d,
            x0_idx=center_x,
            y0_idx=center_y,
            pixel_res_m=step_m,
            h_obs=mast_m,
            max_radius_km=physical_size_m / 2000.0,
            num_azimuths=360
        )
        azimuths = [float(i) for i in range(360)]
        horizon_meta = {
            "min_horizon_deg": float(np.min(horizon_angles)),
            "max_horizon_deg": float(np.max(horizon_angles)),
            "complete_coverage": True
        }

    horizon_cache_path = output_dir / f"{site_id}_horizon.json"
    horizon_export = {
        "schema_version": "0.1.0",
        "site_id": site_id,
        "site_name": site_info["name"],
        "coordinates": {
            "latitude_deg": float(lat),
            "longitude_deg": float(normalize_longitude(lon)),
            "elevation_m": float(site_info["elevation_m"]),
            "frame": "MOON_ME_DE421",
            "reference_radius_m": 1737400
        },
        "observer_height_m": float(mast_m),
        "horizon_angles": [round(float(a), 4) for a in horizon_angles],
        "diagnostics": horizon_meta
    }
    with open(horizon_cache_path, "w", encoding="utf-8") as f:
        json.dump(horizon_export, f, indent=2)

    # 5. Compute Safe Haven recommendations
    print(f"    --> Computing Nearby Safe Haven recommendations...")
    safe_havens = find_safe_havens_from_grid(
        heights_2d=heights_2d,
        step_m=step_m,
        origin_x_idx=center_x,
        origin_y_idx=center_y,
        origin_lat_deg=lat,
        origin_lon_deg=lon,
        origin_site_id=site_id,
        search_radius_m=physical_size_m * 0.45,
        max_slope_deg=8.0,
        data_kind=data_kind
    )
    recommend_cache_path = output_dir / f"{site_id}_recommend.json"
    with open(recommend_cache_path, "w", encoding="utf-8") as f:
        json.dump(safe_havens, f, indent=2)

    print(f"    ✓ Data Source: {data_source}")
    print(f"    ✓ Elevation Range: {grid_meta['min_elevation_m']:.1f}m to {grid_meta['max_elevation_m']:.1f}m")
    print(f"    ✓ Touchdown Slope: {safety_assessment['slope_deg']}° [{safety_assessment['status']}]")
    print(f"    ✓ Horizon Range: {horizon_meta['min_horizon_deg']:.2f}° to {horizon_meta['max_horizon_deg']:.2f}°")
    print(f"    ✓ Safe Haven Candidates Found: {len(safe_havens['candidates'])}")
    print(f"    ✓ Saved artifacts -> {v1_json_path.name}, {bin_mesh_path.name}, {horizon_cache_path.name}, {recommend_cache_path.name}")

    return v1_data


def main():
    parser = argparse.ArgumentParser(description="HORIZON OPS DEM Ingestion & Preparation Tool")
    parser.add_argument("--site", type=str, help="Specific site_id to generate (e.g. site01_connecting_ridge)")
    parser.add_argument("--resolution", type=int, default=64, help="Grid resolution per side (default: 64)")
    parser.add_argument("--size", type=float, default=5000.0, help="Physical box width/height in meters (default: 5000)")
    parser.add_argument("--all", action="store_true", help="Generate all curated sites")

    args = parser.parse_args()

    sites_file = root_dir / "data" / "sites.json"
    output_dir = root_dir / "data" / "processed"
    raw_lola_file = root_dir / "data" / "raw" / "LDEM_80S_80MPP_ADJ.TIF"

    if not sites_file.exists():
        print(f"Error: {sites_file} not found.")
        sys.exit(1)

    sites = load_sites(sites_file)

    dem_reader = None
    if raw_lola_file.exists():
        print(f"✓ Found Real NASA LOLA DEM: {raw_lola_file} ({raw_lola_file.stat().st_size / (1024*1024):.1f} MB)")
        try:
            from backend.terrain.ingest import LolaDemReader
            dem_reader = LolaDemReader(raw_lola_file)
            print(f"  Raster loaded: {dem_reader.cols}x{dem_reader.rows} pixels @ {dem_reader.res_x:.1f}m/px")
        except Exception as e:
            print(f"  Warning: Could not open {raw_lola_file} ({e}). Using procedural fallback.")

    if args.all or not args.site:
        print(f"\n=== Preparing All {len(sites)} Curated Lunar South-Pole Sites ===")
        for s in sites:
            prepare_site(s, args.resolution, args.size, output_dir, dem_reader)

    else:
        matched = [s for s in sites if s["site_id"] == args.site]
        if not matched:
            print(f"Error: Site '{args.site}' not found in data/sites.json. Available: {[s['site_id'] for s in sites]}")
            sys.exit(1)
        prepare_site(matched[0], args.resolution, args.size, output_dir, dem_reader)

    if dem_reader:
        dem_reader.close()

    print("\n[SUCCESS] Terrain, horizons and safe havens preparation complete.")


if __name__ == "__main__":
    main()
