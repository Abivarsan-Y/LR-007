"""
Unit Tests for Person B: Lunar Geometry, Slope Engine & Terrain Exporter.
Built with standard library unittest for zero-dependency execution.
"""

import json
import math
import tempfile
import unittest
from pathlib import Path
import numpy as np

from backend.terrain.geometry import (
    R_MOON_M,
    latlon_to_polar_stereo,
    polar_stereo_to_latlon,
    curvature_drop,
    apparent_elevation_angle,
)
from backend.terrain.slope import compute_slope_grid, classify_slope
from backend.terrain.generator import TerrainConfig, generate_terrain_grid
from backend.terrain.exporter import export_terrain_to_json


class TestTerrainGeometry(unittest.TestCase):

    def test_south_pole_origin(self):
        """Verify that South Pole (-90°, 0°) maps to (0, 0) in polar stereographic."""
        x, y = latlon_to_polar_stereo(-90.0, 0.0)
        self.assertAlmostEqual(x, 0.0, places=3)
        self.assertAlmostEqual(y, 0.0, places=3)

        lat, lon = polar_stereo_to_latlon(0.0, 0.0)
        self.assertEqual(lat, -90.0)

    def test_latlon_roundtrip(self):
        """Verify roundtrip coordinate accuracy across lunar south pole latitudes."""
        test_coords = [
            (-89.9, 0.0),
            (-89.44, 222.0),
            (-86.04, 2.70),
            (-87.40, 355.20),
        ]

        for lat_in, lon_in in test_coords:
            x, y = latlon_to_polar_stereo(lat_in, lon_in)
            lat_out, lon_out = polar_stereo_to_latlon(x, y)

            self.assertAlmostEqual(lat_out, lat_in, places=4, msg=f"Latitude mismatch for ({lat_in}, {lon_in})")
            self.assertAlmostEqual(lon_out, lon_in, places=3, msg=f"Longitude mismatch for ({lat_in}, {lon_in})")

    def test_curvature_drop(self):
        """
        Verify lunar curvature drop matches d^2 / (2 * R_MOON).
        At 10 km: (10,000)^2 / (2 * 1,737,400) ≈ 28.778 m.
        At 20 km: (20,000)^2 / (2 * 1,737,400) ≈ 115.114 m.
        """
        drop_10km = curvature_drop(10000.0)
        self.assertAlmostEqual(drop_10km, 28.778, delta=0.05)

        drop_20km = curvature_drop(20000.0)
        self.assertAlmostEqual(drop_20km, 115.114, delta=0.05)

    def test_apparent_elevation_curvature_reduction(self):
        """Verify that distant targets appear at lower elevation angles due to lunar curvature."""
        elev_flat = np.degrees(np.arctan2(0.0, 20000.0))  # 0.0°
        elev_curved = apparent_elevation_angle(20000.0, 0.0, 0.0)

        self.assertEqual(elev_flat, 0.0)
        self.assertLess(elev_curved, 0.0)
        self.assertAlmostEqual(float(elev_curved), -0.3298, delta=0.02)


class TestSlopeSafety(unittest.TestCase):

    def test_flat_and_ramp_slope(self):
        """Verify slope gradient computation on a known synthetic slope."""
        flat = np.ones((64, 64)) * 1000.0
        slope_flat = compute_slope_grid(flat, step_m=20.0)
        self.assertTrue(np.allclose(slope_flat, 0.0))
        self.assertEqual(classify_slope(0.0)["status"], "SAFE")

        # Constant 10° slope ramp along X: dz/dx = tan(10°)
        step_m = 20.0
        dz_dx = math.tan(math.radians(10.0))
        x_indices = np.arange(64)
        ramp = np.tile(x_indices * step_m * dz_dx, (64, 1))
        slope_ramp = compute_slope_grid(ramp, step_m=step_m)

        interior = slope_ramp[2:-2, 2:-2]
        self.assertTrue(np.allclose(interior, 10.0, atol=0.2))
        self.assertEqual(classify_slope(10.0)["status"], "CAUTION")

        # Severe slope test
        hazard = classify_slope(18.5)
        self.assertEqual(hazard["status"], "HAZARD")
        self.assertEqual(hazard["tip_over_risk"], "HIGH")


class TestTerrainGeneratorAndExport(unittest.TestCase):

    def test_generator_and_export(self):
        """Verify that generated terrain meets contract schema properties."""
        config = TerrainConfig(
            cols=32,
            rows=32,
            physical_width_m=2000.0,
            physical_height_m=2000.0,
            base_elevation_m=1500.0
        )
        heights, meta = generate_terrain_grid(config)

        self.assertEqual(heights.shape, (32, 32))
        self.assertEqual(meta["cols"], 32)
        self.assertEqual(meta["rows"], 32)
        self.assertEqual(meta["physical_width_m"], 2000.0)

        site_meta = {
            "site_id": "test_site",
            "name": "Test Site",
            "latitude_deg": -89.5,
            "longitude_deg": 180.0,
            "elevation_m": 1500.0
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            out_file = Path(tmpdir) / "test_terrain.json"
            data = export_terrain_to_json(site_meta, meta, heights, out_file)

            self.assertTrue(out_file.exists())
            self.assertEqual(data["schema_version"], "1.0")
            self.assertEqual(len(data["heights"]), 32 * 32)
            self.assertEqual(data["observer"]["grid_x"], 16)
            self.assertEqual(data["observer"]["grid_y"], 16)
            self.assertEqual(data["observer"]["deck_height_m"], 2.0)
            self.assertLessEqual(data["grid"]["min_elevation_m"], data["grid"]["max_elevation_m"])

    def test_member_d_fixtures_exist(self):
        """Verify that Member D's required files and schemas exist and are valid JSON."""
        schema_path = Path("contracts/terrain.schema.json")
        fixture_path = Path("data/fixtures/mock_terrain.json")
        processed_site01 = Path("data/processed/site01_connecting_ridge.json")

        self.assertTrue(schema_path.exists(), "Missing contracts/terrain.schema.json")
        self.assertTrue(fixture_path.exists(), "Missing data/fixtures/mock_terrain.json")
        self.assertTrue(processed_site01.exists(), "Missing data/processed/site01_connecting_ridge.json")

        with open(fixture_path, "r", encoding="utf-8") as f:
            fixture_data = json.load(f)

        self.assertEqual(fixture_data["schema_version"], "1.0")
        self.assertIn("heights", fixture_data)
        self.assertEqual(len(fixture_data["heights"]), fixture_data["grid"]["cols"] * fixture_data["grid"]["rows"])


if __name__ == "__main__":
    unittest.main()
