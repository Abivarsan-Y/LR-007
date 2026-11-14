#!/usr/bin/env python3
"""
HORIZON OPS — Terrain Preparation, LOLA Ingestion & Horizon Profiler CLI Tool (Person B)
Ingests real NASA LOLA DEM GeoTIFFs (when present in data/raw/):
1. Resamples local East/North (ENU) grids (129x129, exact center at (64, 64)) aligned to:
   +X East, +Y Up, -Z North (row-major north-to-south, west-to-east).
2. Preserves missing data (NaN) without median filling.
3. Exports binary Float32 Little-Endian meshes (.bin) and metadata matching contracts/terrain.schema.json.
4. Exports v1.0 JSON format for Member C/D's dashboard inspection.
5. Pre-computes 360-degree curvature-aware horizon profiles.
6. Pre-computes Nearby Safe Haven recommendations (< 8° slope, ranked by prominence).
7. NEVER overwrites Member D's synthetic fixture data/fixtures/mock_terrain.json.

Usage:
    python3 scripts/prepare_dem.py --all
    python3 scripts/prepare_dem.py --site site01_connecting_ridge
"""

import argparse
import json
import sys
from pathlib import Path
import numpy as np

# Add project root to sys.path
root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))

from backend.terrain.generator import TerrainConfig, generate_terrain_grid
from backend.terrain.exporter import export_terrain_to_json, export_terrain_binary_contract
from backend.terrain.slope import compute_slope_grid, classify_slope
from backend.terrain.horizon import compute_azimuth_horizon, compute_dem_horizon
from backend.terrain.recommender import find_safe_havens_from_grid, normalize_longitude
from backend.terrain.resample import resample_local_enu_grid


def load_sites(sites_path: Path):
    with open(sites_path, "r", encoding="utf-8") as f:
        return json.load(f)


def prepare_site(
    site_info: dict,
    output_dir: Path,
    dem_paths: list[Path] = None,
    dem_reader = None
):
    site_id = site_info["site_id"]
    lat = float(site_info["latitude_deg"])
    lon = float(site_info["longitude_deg"])
    nominal_elev = float(site_info["elevation_m"])
    mast_m = site_info.get("recommended_mast_m", 2.0)

    # 1. Generate 129x129 Local East/North (ENU) Grid for Three.js Celestial Rendering
    grid_size_129 = 129
    spacing_m_129 = 20.0
    physical_size_129 = (grid_size_129 - 1) * spacing_m_129  # 2560m

    active_dems = [p for p in (dem_paths or []) if p.exists()]
    heights_129 = None
    data_source = "PROCEDURAL"
    source_uri = "https://pgda.gsfc.nasa.gov/products/90"
    source_sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

    if active_dems:
        print(f"--> [REAL NASA LOLA] Resampling 129x129 local ENU grid for [{site_info['name']}] (spacing {spacing_m_129}m, {physical_size_129/1000:.2f}km box)...")
        try:
            heights_129 = resample_local_enu_grid(
                dem_paths=active_dems,
                lat_0=lat,
                lon_0=lon,
                grid_size=grid_size_129,
                spacing_m=spacing_m_129
            )
            data_source = "NASA_LOLA_PGDA_REAL"
            if "Site01" in str(active_dems[0]):
                source_uri = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif"
                source_sha256 = "3ba7b97cb00a2bcf21189c3aeb535f65afc21207154ab9f0d43c5bdc1f7e747e"
        except Exception as e:
            print(f"    ⚠️ Failed to resample local ENU grid ({e}). Falling back to procedural.")
            heights_129 = None

    if heights_129 is None:
        print(f"--> [PROCEDURAL FALLBACK] Generating 129x129 terrain for [{site_info['name']}]...")
        config_129 = TerrainConfig(
            cols=grid_size_129,
            rows=grid_size_129,
            physical_width_m=physical_size_129,
            physical_height_m=physical_size_129,
            base_elevation_m=nominal_elev,
            crater_depth_m=350.0,
            rim_height_m=220.0,
            roughness_m=16.0,
            seed=abs(hash(site_id)) % 100000
        )
        heights_129, _ = generate_terrain_grid(config_129)
        data_source = "SYNTHETIC_LUNAR_PROCEDURAL"

    center_129 = grid_size_129 // 2
    sampled_ground_elev = float(heights_129[center_129, center_129])
    if not np.isfinite(sampled_ground_elev):
        sampled_ground_elev = nominal_elev

    # Export 129x129 binary contract mesh (.bin + .json)
    bin_mesh_path = output_dir / f"{site_id}_terrain.bin"
    contract_json_path = output_dir / f"{site_id}_terrain.json"
    data_kind = "cached_real" if data_source == "NASA_LOLA_PGDA_REAL" else "synthetic"

    site_meta_129 = dict(site_info)
    site_meta_129["elevation_m"] = sampled_ground_elev

    export_terrain_binary_contract(
        site_meta=site_meta_129,
        heights_2d=heights_129,
        step_m=spacing_m_129,
        bin_output_path=bin_mesh_path,
        json_output_path=contract_json_path,
        repo_root=root_dir,
        data_kind=data_kind,
        source_uri=source_uri,
        source_sha256=source_sha256
    )

    # Export 129x129 ENU JSON format for Member D
    v1_129_path = output_dir / f"{site_id}_129_enu.json"
    finite_129 = heights_129[np.isfinite(heights_129)]
    grid_meta_129 = {
        "cols": grid_size_129,
        "rows": grid_size_129,
        "physical_width_m": physical_size_129,
        "physical_height_m": physical_size_129,
        "step_m": spacing_m_129,
        "min_elevation_m": round(float(np.min(finite_129)), 2),
        "max_elevation_m": round(float(np.max(finite_129)), 2)
    }
    v1_129_data = export_terrain_to_json(
        site_meta=site_meta_129,
        grid_meta=grid_meta_129,
        heights_2d=heights_129,
        output_path=v1_129_path,
        deck_height_m=mast_m,
        mast_height_m=5.0
    )
    v1_129_data["data_source"] = data_source
    with open(v1_129_path, "w", encoding="utf-8") as f:
        json.dump(v1_129_data, f, indent=2)

    # 2. Compute 360° curvature-aware horizon profile
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
            dem_grid=heights_129,
            x0_idx=center_129,
            y0_idx=center_129,
            pixel_res_m=spacing_m_129,
            h_obs=mast_m,
            max_radius_km=physical_size_129 / 2000.0,
            num_azimuths=360
        )
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
            "elevation_m": float(sampled_ground_elev),
            "frame": "MOON_ME_DE421",
            "reference_radius_m": 1737400
        },
        "observer_height_m": float(mast_m),
        "horizon_angles": [round(float(a), 4) for a in horizon_angles],
        "diagnostics": horizon_meta
    }
    with open(horizon_cache_path, "w", encoding="utf-8") as f:
        json.dump(horizon_export, f, indent=2)

    # 3. Compute Nearby Safe Haven recommendations
    print(f"    --> Computing Nearby Safe Haven recommendations...")
    safe_havens = find_safe_havens_from_grid(
        heights_2d=heights_129,
        step_m=spacing_m_129,
        origin_x_idx=center_129,
        origin_y_idx=center_129,
        origin_lat_deg=lat,
        origin_lon_deg=lon,
        origin_site_id=site_id,
        search_radius_m=physical_size_129 * 0.45,
        max_slope_deg=8.0,
        data_kind=data_kind,
        source_uri=source_uri,
        source_sha256=source_sha256
    )
    recommend_cache_path = output_dir / f"{site_id}_recommend.json"
    with open(recommend_cache_path, "w", encoding="utf-8") as f:
        json.dump(safe_havens, f, indent=2)

    slope_grid_129 = compute_slope_grid(heights_129, spacing_m_129)
    center_slope = float(slope_grid_129[center_129, center_129])
    safety = classify_slope(center_slope)

    print(f"    ✓ Data Source: {data_source}")
    print(f"    ✓ Grid Orientation: Local East/North (ENU), +X East, +Y Up, -Z North")
    print(f"    ✓ Observer Ground Sample (row=64, col=64): {sampled_ground_elev:.4f}m")
    print(f"    ✓ Touchdown Slope: {safety['slope_deg']}° [{safety['status']}]")
    print(f"    ✓ Horizon Range: {horizon_meta['min_horizon_deg']:.2f}° to {horizon_meta['max_horizon_deg']:.2f}°")
    print(f"    ✓ Safe Haven Candidates Found: {len(safe_havens['candidates'])}")
    print(f"    ✓ Saved artifacts -> {bin_mesh_path.name}, {contract_json_path.name}, {v1_129_path.name}, {horizon_cache_path.name}, {recommend_cache_path.name}")


def main():
    parser = argparse.ArgumentParser(description="HORIZON OPS DEM Ingestion & Preparation Tool")
    parser.add_argument("--site", type=str, help="Specific site_id to generate (e.g. site01_connecting_ridge)")
    parser.add_argument("--all", action="store_true", help="Generate all curated sites")

    args = parser.parse_args()

    sites_file = root_dir / "data" / "sites.json"
    output_dir = root_dir / "data" / "processed"
    raw_lola_file = root_dir / "data" / "raw" / "LDEM_80S_80MPP_ADJ.TIF"
    site01_dem_file = root_dir / "data" / "raw" / "Site01_final_adj_5mpp_surf.tif"

    if not sites_file.exists():
        print(f"Error: {sites_file} not found.")
        sys.exit(1)

    sites = load_sites(sites_file)

    dem_reader = None
    if raw_lola_file.exists():
        print(f"✓ Found Regional NASA LOLA 80m DEM: {raw_lola_file.name} ({raw_lola_file.stat().st_size / (1024*1024):.1f} MB)")
        try:
            from backend.terrain.ingest import LolaDemReader
            dem_reader = LolaDemReader(raw_lola_file)
        except Exception as e:
            print(f"  Warning: Could not open {raw_lola_file} ({e}).")

    if site01_dem_file.exists():
        print(f"✓ Found NASA LOLA Site 01 5m High-Res DEM: {site01_dem_file.name} ({site01_dem_file.stat().st_size / (1024*1024):.1f} MB)")

    dem_paths_site01 = []
    if site01_dem_file.exists():
        dem_paths_site01.append(site01_dem_file)
    if raw_lola_file.exists():
        dem_paths_site01.append(raw_lola_file)

    dem_paths_general = [raw_lola_file] if raw_lola_file.exists() else []

    if args.all or not args.site:
        print(f"\n=== Preparing All {len(sites)} Curated Lunar South-Pole Sites (129x129 Local ENU Grids) ===")
        for s in sites:
            active_paths = dem_paths_site01 if s["site_id"] == "site01_connecting_ridge" else dem_paths_general
            prepare_site(
                site_info=s,
                output_dir=output_dir,
                dem_paths=active_paths,
                dem_reader=dem_reader
            )

    else:
        matched = [s for s in sites if s["site_id"] == args.site]
        if not matched:
            print(f"Error: Site '{args.site}' not found in data/sites.json. Available: {[s['site_id'] for s in sites]}")
            sys.exit(1)
        active_paths = dem_paths_site01 if matched[0]["site_id"] == "site01_connecting_ridge" else dem_paths_general
        prepare_site(
            site_info=matched[0],
            output_dir=output_dir,
            dem_paths=active_paths,
            dem_reader=dem_reader
        )

    if dem_reader:
        dem_reader.close()

    print("\n[SUCCESS] Local East/North (ENU) terrain meshes, horizons and safe havens generated.")
    print("✓ Note: data/fixtures/mock_terrain.json was preserved untouched.")


if __name__ == "__main__":
    main()
