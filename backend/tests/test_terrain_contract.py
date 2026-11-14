"""
Unit Tests for Binary Terrain Contract Export (Person B & Person D Interface).
Verifies Float32 Little-Endian encoding, byte size, SHA256 checksums,
and JSON schema validation against contracts/terrain.schema.json.
"""

import hashlib
import json
import numpy as np
import pytest
from pathlib import Path

from backend.terrain.exporter import export_terrain_binary_contract
from scripts.validate_fixtures import validate_document, ROOT


def test_export_terrain_binary_contract():
    """Verify binary float32 mesh file and JSON contract metadata."""
    cols, rows = 64, 64
    grid = np.random.uniform(1000.0, 2000.0, (rows, cols)).astype(np.float32)

    site_meta = {
        "site_id": "test_site_contract",
        "latitude_deg": -89.44,
        "longitude_deg": 222.0,
        "elevation_m": 1850.0
    }

    test_dir = ROOT / "data" / "processed" / "test_tmp"
    test_dir.mkdir(parents=True, exist_ok=True)
    bin_path = test_dir / "test_mesh.bin"
    json_path = test_dir / "test_terrain.json"

    try:
        # Export using paths inside repo root context
        doc = export_terrain_binary_contract(
            site_meta=site_meta,
            heights_2d=grid,
            step_m=20.0,
            bin_output_path=bin_path,
            json_output_path=json_path,
            repo_root=ROOT,
            data_kind="cached_real"
        )

        # 1. Verify binary file on disk
        assert bin_path.exists()
        raw_bytes = bin_path.read_bytes()
        expected_bytes = cols * rows * 4
        assert len(raw_bytes) == expected_bytes

        # 2. Verify SHA256 hash
        actual_hash = hashlib.sha256(raw_bytes).hexdigest()
        assert doc["sha256"] == actual_hash

        # 3. Verify Float32 values decode back accurately
        recovered = np.frombuffer(raw_bytes, dtype="<f4").reshape((rows, cols))
        np.testing.assert_allclose(recovered, grid, rtol=1e-6)

        # 4. Verify coordinate conventions
        assert doc["schema_version"] == "0.1.0"
        assert doc["encoding"] == "float32_le"
        assert doc["layout"] == "row_major_north_to_south_west_to_east"
        assert doc["height_reference"] == "metres_above_reference_sphere"
        assert doc["scene_axes"] == "+X east, +Y up, -Z north"
        assert doc["coordinates"]["longitude_deg"] == -138.0  # normalized

        # 5. Validate against contracts/terrain.schema.json
        validate_document("terrain", doc, root=ROOT)
    finally:
        # Cleanup temporary test files
        if bin_path.exists():
            bin_path.unlink()
        if json_path.exists():
            json_path.unlink()
        if test_dir.exists():
            test_dir.rmdir()
