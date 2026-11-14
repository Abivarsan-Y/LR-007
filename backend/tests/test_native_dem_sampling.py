"""Native affine/pixel-centre, nodata and lunar-CRS sampling checks."""

import hashlib

import numpy as np
import pytest
import rasterio
from pyproj import CRS, Transformer
from rasterio.transform import from_origin

from backend.engine.mission import prepare_raster_horizon
from backend.engine.terrain_horizon import RasterTerrain

MOON = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m +no_defs"


def write_grid(path, values, crs=MOON):
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        dtype="float32",
        crs=crs,
        transform=from_origin(-20, 20, 10, 10),
        nodata=np.nan,
    ) as output:
        output.write(values.astype("float32"), 1)


def coordinates(x, y):
    crs = CRS.from_user_input(MOON)
    transform = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
    return transform.transform(np.asarray(x), np.asarray(y))


def test_native_projection_pixel_centres_and_bilinear_values(tmp_path):
    path = tmp_path / "moon.tif"
    values = np.arange(16).reshape(4, 4)
    write_grid(path, values)
    lon, lat = coordinates([-15, -10], [15, 10])
    with RasterTerrain([path]) as source:
        result = source.sample(lon, lat)
    assert result == pytest.approx([0, 2.5], abs=1e-6)


def test_outside_and_nodata_are_not_clipped_or_median_filled(tmp_path):
    path = tmp_path / "moon.tif"
    values = np.zeros((4, 4))
    values[1, 1] = np.nan
    write_grid(path, values)
    lon, lat = coordinates([-5, 500], [5, 500])
    with RasterTerrain([path]) as source:
        result = source.sample(lon, lat)
    assert np.all(np.isnan(result))


def test_fallback_uses_real_secondary_grid_for_missing_primary(tmp_path):
    primary = tmp_path / "primary.tif"
    secondary = tmp_path / "secondary.tif"
    first = np.full((4, 4), 10.0)
    first[1, 1] = np.nan
    write_grid(primary, first)
    write_grid(secondary, np.full((4, 4), 20.0))
    lon, lat = coordinates([-5, 5], [5, -5])
    with RasterTerrain([primary, secondary]) as source:
        result = source.sample(lon, lat)
    assert result == pytest.approx([20, 10], abs=1e-7)


def test_earth_crs_is_rejected(tmp_path):
    path = tmp_path / "earth.tif"
    write_grid(path, np.zeros((4, 4)), crs="EPSG:3857")
    with pytest.raises(ValueError, match="lunar sphere"):
        RasterTerrain([path])


@pytest.mark.parametrize("failure", ["checksum", "elevation"])
def test_real_source_preparation_rejects_bad_manifest_or_observer(tmp_path, failure):
    path = tmp_path / "moon.tif"
    write_grid(path, np.full((4, 4), 10.0))
    lon, lat = coordinates([5], [5])
    site = {
        "site_id": "synthetic-observer",
        "coordinates": {
            "longitude_deg": float(lon[0]),
            "latitude_deg": float(lat[0]),
            "elevation_m": 20 if failure == "elevation" else 10,
        },
        "provenance": {
            "data_kind": "synthetic",
            "sources": [],
            "assumptions": ["Synthetic source for a preflight test."],
        },
    }
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = {
        path.name: {
            "path": path.name,
            "bytes": path.stat().st_size,
            "sha256": "0" * 64 if failure == "checksum" else digest,
            "url": "urn:test:synthetic-raster",
        }
    }
    with pytest.raises(ValueError, match="checksum|elevation"):
        prepare_raster_horizon(
            site,
            [path],
            manifest,
            source_root=tmp_path,
            max_radius_m=20,
            azimuth_step_deg=90,
        )
