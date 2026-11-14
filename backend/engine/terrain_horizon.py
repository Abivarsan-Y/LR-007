"""Windowed native-raster sampling and spherical, true-azimuth terrain horizons.

This optional preparation adapter stays separate from B's public terrain modules.
It never decompresses a whole polar DEM to a temporary memory-mapped file.
"""

from contextlib import ExitStack
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Geod, Transformer
from rasterio.windows import Window

from backend.engine.ephemeris import Observer
from backend.engine.visibility import HorizonPoint, HorizonProfile


class RasterTerrain:
    """Sample preferred-to-fallback GeoTIFFs using their own affine/CRS metadata."""

    def __init__(self, paths: list[Path | str]):
        if not paths:
            raise ValueError("At least one DEM is required")
        self.stack = ExitStack()
        self.layers = []
        try:
            for path in paths:
                dataset = self.stack.enter_context(rasterio.open(path))
                if dataset.count != 1 or dataset.crs is None:
                    raise ValueError("DEM must be a single georeferenced band")
                crs = CRS.from_wkt(dataset.crs.to_wkt())
                if (
                    abs(crs.ellipsoid.semi_major_metre - 1737400) > 1e-6
                    or abs(crs.ellipsoid.semi_minor_metre - 1737400) > 1e-6
                ):
                    raise ValueError("Expected the documented 1737400 m lunar sphere")
                if dataset.scales != (1.0,) or dataset.offsets != (0.0,):
                    raise ValueError(
                        "Scaled rasters need an explicit height conversion"
                    )
                transform = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
                self.layers.append((dataset, transform))
        except Exception:
            self.stack.close()
            raise

    def close(self):
        self.stack.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def sample(self, longitude: np.ndarray, latitude: np.ndarray) -> np.ndarray:
        longitude, latitude = np.broadcast_arrays(longitude, latitude)
        if not np.all(np.isfinite(longitude)) or not np.all(np.isfinite(latitude)):
            raise ValueError("Sample coordinates must be finite")
        shape = longitude.shape
        lon, lat = longitude.ravel(), latitude.ravel()
        result = np.full(lon.shape, np.nan)
        for dataset, transform in self.layers:
            missing = np.flatnonzero(~np.isfinite(result))
            if not len(missing):
                break
            x, y = transform.transform(lon[missing], lat[missing])
            # Affines address corners; scientific grid samples are pixel centres.
            inverse = ~dataset.transform
            x, y = np.asarray(x), np.asarray(y)
            column = inverse.a * x + inverse.b * y + inverse.c
            row = inverse.d * x + inverse.e * y + inverse.f
            column, row = column - 0.5, row - 0.5
            # Near-pole round trips can perturb exact pixel centres by nanometres.
            column = np.where(
                np.abs(column - np.rint(column)) < 1e-6, np.rint(column), column
            )
            row = np.where(np.abs(row - np.rint(row)) < 1e-6, np.rint(row), row)
            inside = (
                np.isfinite(column)
                & np.isfinite(row)
                & (column >= 0)
                & (row >= 0)
                & (column <= dataset.width - 1)
                & (row <= dataset.height - 1)
            )
            if not np.any(inside):
                continue
            indices = missing[inside]
            column, row = column[inside], row[inside]
            c0, r0 = np.floor(column).astype(int), np.floor(row).astype(int)
            c1, r1 = (
                np.minimum(c0 + 1, dataset.width - 1),
                np.minimum(r0 + 1, dataset.height - 1),
            )
            left, top = int(c0.min()), int(r0.min())
            right, bottom = int(c1.max()) + 1, int(r1.max()) + 1
            if (right - left) * (bottom - top) > 25000000:
                # A long diagonal ray has a huge bounding box but few samples.
                # Split its point sequence instead of allocating the whole box.
                midpoint = len(lon) // 2
                if not midpoint:
                    raise ValueError("Cannot bound terrain sampling window")
                return np.concatenate(
                    (
                        self.sample(lon[:midpoint], lat[:midpoint]),
                        self.sample(lon[midpoint:], lat[midpoint:]),
                    )
                ).reshape(shape)
            heights = (
                dataset.read(
                    1, window=Window(left, top, right - left, bottom - top), masked=True
                )
                .astype("float64")
                .filled(np.nan)
            )
            dx, dy = column - c0, row - r0
            values = np.zeros(len(indices))
            valid = np.ones(len(indices), dtype=bool)
            for rr, cc, weight in (
                (r0, c0, (1 - dx) * (1 - dy)),
                (r0, c1, dx * (1 - dy)),
                (r1, c0, (1 - dx) * dy),
                (r1, c1, dx * dy),
            ):
                height = heights[rr - top, cc - left]
                used = weight > 1e-12
                valid &= ~used | np.isfinite(height)
                values += np.where(used & np.isfinite(height), height, 0) * weight
            result[indices[valid]] = values[valid]
        return result.reshape(shape)


def compute_horizon(
    observer: Observer,
    sample_heights,
    *,
    provenance: dict,
    max_radius_m: float = 100000,
    radial_step_m: float = 20,
    near_step_m: float = 5,
    near_radius_m: float = 2000,
    azimuth_step_deg: float = 1,
    batch_size: int = 16,
) -> HorizonProfile:
    """Sample true-bearing geodesics and calculate exact spherical ray elevations.

    A finite complete ray means all configured samples are known. It does not
    establish completeness between bearings or beyond the finite search radius.
    """
    parameters = (
        max_radius_m,
        radial_step_m,
        near_step_m,
        near_radius_m,
        azimuth_step_deg,
    )
    if not all(np.isfinite(value) and value > 0 for value in parameters):
        raise ValueError("Horizon sampling parameters must be positive and finite")
    count = round(360 / azimuth_step_deg)
    if not 2 <= count <= 36000 or not np.isclose(
        count * azimuth_step_deg, 360, rtol=0, atol=1e-9
    ):
        raise ValueError("Azimuth step must evenly divide 360 degrees")
    if not 1 <= batch_size <= 64 or max_radius_m > 300000:
        raise ValueError("Unsupported horizon batch size or radius")
    near_end = min(near_radius_m, max_radius_m)
    if near_end / near_step_m + (max_radius_m - near_end) / radial_step_m + 3 > 100000:
        raise ValueError("Too many radial samples")
    distances = np.unique(
        np.concatenate(
            (
                np.arange(near_step_m, near_end, near_step_m),
                np.array([near_end]),
                np.arange(near_end + radial_step_m, max_radius_m, radial_step_m),
                np.array([max_radius_m]),
            )
        )
    )
    if len(distances) > 100000:
        raise ValueError("Too many radial samples")
    radius = observer.reference_radius_m
    geod = Geod(a=radius, b=radius)
    angle = distances / radius
    points = []
    for start in range(0, count, batch_size):
        azimuths = np.arange(start, min(start + batch_size, count)) * azimuth_step_deg
        bearings = np.repeat(azimuths, len(distances))
        ranges = np.tile(distances, len(azimuths))
        longitude, latitude, _ = geod.fwd(
            np.full(len(bearings), observer.longitude_deg),
            np.full(len(bearings), observer.latitude_deg),
            bearings,
            ranges,
        )
        heights = np.asarray(sample_heights(longitude, latitude), dtype=float).reshape(
            len(azimuths), len(distances)
        )
        if np.any(np.isinf(heights)) or np.any(
            heights[np.isfinite(heights)] <= -radius
        ):
            raise ValueError("Invalid radial terrain heights")
        radial = radius + heights
        # Observer's local up is the radial direction at its exact lat/lon.
        vertical = radial * np.cos(angle) - (
            radius + observer.elevation_m + observer.observer_height_m
        )
        horizontal = radial * np.sin(angle)
        elevations = np.degrees(np.arctan2(vertical, horizontal))
        for azimuth, ray in zip(azimuths, elevations, strict=True):
            complete = bool(np.all(np.isfinite(ray)))
            points.append(
                HorizonPoint(
                    azimuth_deg=float(azimuth),
                    elevation_deg=float(np.max(ray)) if complete else None,
                    coverage="complete" if complete else "unknown",
                )
            )
    return HorizonProfile(
        observer=observer,
        points=tuple(points),
        provenance=provenance,
        method="true-bearing-spherical-raster-horizon-v1",
        parameters={
            "max_radius_m": max_radius_m,
            "radial_step_m": radial_step_m,
            "near_step_m": near_step_m,
            "near_radius_m": near_radius_m,
            "azimuth_step_deg": azimuth_step_deg,
            "radial_samples": len(distances),
            "interpolation": "bilinear terrain, circular-linear skyline",
            "coverage_definition": "All sampled points known within the finite search radius; angular/radial resolution limits remain.",
        },
    )
