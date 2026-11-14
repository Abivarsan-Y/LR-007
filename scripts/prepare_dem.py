#!/usr/bin/env python3
"""
HORIZON OPS — Terrain Preparation & Exporter CLI Tool (Person B)
Generates contract-compliant 3D terrain height grids for Member D's Three.js viewer.

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


def prepare_site(site_info: dict, resolution: int, physical_size_m: float, output_dir: Path):
    site_id = site_info["site_id"]
    print(f"--> Generating terrain for [{site_info['name']}] ({resolution}x{resolution}, {physical_size_m/1000:.1f}km box)...")

    # Tailor morphological features by site characteristics
    crater_depth = 350.0
    rim_height = 220.0
    roughness = 16.0

    if "shackleton" in site_id:
        crater_depth = 600.0
        rim_height = 350.0
        roughness = 22.0
    elif "malapert" in site_id:
        crater_depth = 150.0
        rim_height = 550.0  # High massif
        roughness = 25.0
    elif "haworth" in site_id:
        crater_depth = 800.0  # Deep shadow basin
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

    print(f"    ✓ Elevation range: {grid_meta['min_elevation_m']}m to {grid_meta['max_elevation_m']}m")
    print(f"    ✓ Center landing slope: {safety_assessment['slope_deg']}° [{safety_assessment['status']}]")
    print(f"    ✓ Saved contract dataset -> {out_path} ({len(contract_data['heights'])} vertices)")

    return contract_data


def main():
    parser = argparse.ArgumentParser(description="HORIZON OPS DEM Preparation Tool")
    parser.add_argument("--site", type=str, help="Specific site_id to generate (e.g. site01_connecting_ridge)")
    parser.add_argument("--resolution", type=int, default=64, help="Grid resolution per side (default: 64)")
    parser.add_argument("--size", type=float, default=5000.0, help="Physical box width/height in meters (default: 5000)")
    parser.add_argument("--all", action="store_true", help="Generate all curated sites")

    args = parser.parse_args()

    sites_file = root_dir / "data" / "sites.json"
    output_dir = root_dir / "data" / "processed"
    fixtures_dir = root_dir / "data" / "fixtures"

    if not sites_file.exists():
        print(f"Error: {sites_file} not found.")
        sys.exit(1)

    sites = load_sites(sites_file)

    if args.all or not args.site:
        print(f"=== Preparing All {len(sites)} Curated Lunar South-Pole Sites ===")
        first_data = None
        for s in sites:
            data = prepare_site(s, args.resolution, args.size, output_dir)
            if first_data is None:
                first_data = data

        # Also write the primary fallback fixture for Member D
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
        prepare_site(matched[0], args.resolution, args.size, output_dir)

    print("\n[SUCCESS] Terrain preparation complete. Ready for Member D Three.js integration.")


if __name__ == "__main__":
    main()
