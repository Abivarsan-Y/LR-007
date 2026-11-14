#!/usr/bin/env python3
"""
HORIZON OPS — Terrain Preparation & Real LOLA Ingestion CLI Tool (Person B)
Ingests real NASA LOLA DEM GeoTIFFs (when present in data/raw/) or generates realistic baselines,
exporting contract-compliant 3D terrain height grids for Member D's Three.js viewer.

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
from backend.terrain.exporter import export_terrain_to_json
from backend.terrain.slope import compute_slope_grid, classify_slope


def load_sites(sites_path: Path):
    with open(sites_path, "r", encoding="utf-8") as f:
        return json.load(f)


def prepare_site(site_info: dict, resolution: int, physical_size_m: float, output_dir: Path, dem_reader=None):
    site_id = site_info["site_id"]
    lat = site_info["latitude_deg"]
    lon = site_info["longitude_deg"]

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

    if dem_reader is None:
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

    # Evaluate slope at center observer position
    slope_grid = compute_slope_grid(heights_2d, grid_meta["step_m"])
    center_y, center_x = resolution // 2, resolution // 2
    center_slope = float(slope_grid[center_y, center_x])
    safety_assessment = classify_slope(center_slope)

    out_path = output_dir / f"{site_id}.json"
    contract_data = export_terrain_to_json(
        site_meta=site_info,
        grid_meta=grid_meta,
        heights_2d=heights_2d,
        output_path=out_path,
        deck_height_m=site_info.get("recommended_mast_m", 2.0),
        mast_height_m=5.0
    )

    # Attach data source tag to metadata
    contract_data["data_source"] = data_source

    print(f"    ✓ Data Source: {data_source}")
    print(f"    ✓ Real Elevation Range: {grid_meta['min_elevation_m']}m to {grid_meta['max_elevation_m']}m")
    print(f"    ✓ Center Landing Slope: {safety_assessment['slope_deg']}° [{safety_assessment['status']}]")
    print(f"    ✓ Saved dataset -> {out_path} ({len(contract_data['heights'])} vertices)")

    return contract_data


def main():
    parser = argparse.ArgumentParser(description="HORIZON OPS DEM Ingestion & Preparation Tool")
    parser.add_argument("--site", type=str, help="Specific site_id to generate (e.g. site01_connecting_ridge)")
    parser.add_argument("--resolution", type=int, default=64, help="Grid resolution per side (default: 64)")
    parser.add_argument("--size", type=float, default=5000.0, help="Physical box width/height in meters (default: 5000)")
    parser.add_argument("--all", action="store_true", help="Generate all curated sites")

    args = parser.parse_args()

    sites_file = root_dir / "data" / "sites.json"
    output_dir = root_dir / "data" / "processed"
    fixtures_dir = root_dir / "data" / "fixtures"
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
        first_data = None
        for s in sites:
            data = prepare_site(s, args.resolution, args.size, output_dir, dem_reader)
            if first_data is None:
                first_data = data

        if first_data:
            mock_fixture_path = fixtures_dir / "mock_terrain.json"
            fixtures_dir.mkdir(parents=True, exist_ok=True)
            with open(mock_fixture_path, "w", encoding="utf-8") as f:
                json.dump(first_data, f, indent=2)
            print(f"\n✓ Updated Member D's primary fixture: {mock_fixture_path}")

    else:
        matched = [s for s in sites if s["site_id"] == args.site]
        if not matched:
            print(f"Error: Site '{args.site}' not found in data/sites.json. Available: {[s['site_id'] for s in sites]}")
            sys.exit(1)
        prepare_site(matched[0], args.resolution, args.size, output_dir, dem_reader)

    if dem_reader:
        dem_reader.close()

    print("\n[SUCCESS] Terrain preparation complete. Ready for Member D Three.js integration.")


if __name__ == "__main__":
    main()
