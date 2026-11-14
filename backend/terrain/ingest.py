"""
NASA LOLA GeoTIFF Ingestion and Cropping Module.
Reads NASA LOLA polar stereographic DEM rasters (e.g. LDEM_80S_80MPP_ADJ.TIF)
and extracts real calibrated lunar elevation sub-grids preserving true nodata (NaN).
"""

from pathlib import Path
from typing import Tuple, Dict, Any, Optional
import numpy as np
import tifffile

from .geometry import latlon_to_polar_stereo, R_MOON_M


class LolaDemReader:
    """
    Reader for NASA LOLA Polar Stereographic GeoTIFFs (e.g. 80S products).
    Uses memory mapping (memmap) for sub-millisecond localized crops.
    Preserves missing data (NaN) without silent median-filling.
    """

    def __init__(self, tif_path: str | Path):
        self.tif_path = Path(tif_path)
        if not self.tif_path.exists():
            raise FileNotFoundError(f"LOLA DEM not found at: {self.tif_path}")

        self.tif = tifffile.TiffFile(str(self.tif_path))
        self.series = self.tif.series[0]
        self.shape = self.series.shape  # (rows, cols)
        self.rows, self.cols = self.shape

        # Read GeoTIFF ModelPixelScaleTag (33550) and ModelTiepointTag (33922) if present
        tags = {tag.code: tag.value for tag in self.tif.pages[0].tags}

        # ModelPixelScale: (scale_x, scale_y, scale_z)
        if 33550 in tags:
            scales = tags[33550]
            self.res_x = float(scales[0])
            self.res_y = float(scales[1])
        else:
            self.res_x = 80.0
            self.res_y = 80.0

        # ModelTiepoint: (i, j, k, x, y, z)
        if 33922 in tags:
            tiepoints = tags[33922]
            i0, j0 = tiepoints[0], tiepoints[1]
            x0, y0 = tiepoints[3], tiepoints[4]
            self.ul_x = x0 - (i0 * self.res_x)
            self.ul_y = y0 + (j0 * self.res_y)
        else:
            half_w = (self.cols * self.res_x) / 2.0
            half_h = (self.rows * self.res_y) / 2.0
            self.ul_x = -half_w
            self.ul_y = half_h

        # Access memory-mapped array for zero-RAM overhead cropping
        self.data_mmap = self.series.asarray(out="memmap")

    def world_to_pixel(self, x_m: float, y_m: float) -> Tuple[int, int]:
        """Convert Polar Stereographic metric coordinates (X, Y) to raster pixel (col, row)."""
        col = int(round((x_m - self.ul_x) / self.res_x))
        row = int(round((self.ul_y - y_m) / self.res_y))
        return col, row

    def pixel_to_world(self, col: int, row: int) -> Tuple[float, float]:
        """Convert raster pixel (col, row) to Polar Stereographic metric coordinates (X, Y)."""
        x_m = self.ul_x + (col * self.res_x)
        y_m = self.ul_y - (row * self.res_y)
        return x_m, y_m

    def get_elevation_at_latlon(self, lat_deg: float, lon_deg: float) -> float:
        """Sample elevation in meters at a given lunar south-pole coordinate. Returns NaN if out of bounds."""
        x_m, y_m = latlon_to_polar_stereo(lat_deg, lon_deg)
        col, row = self.world_to_pixel(x_m, y_m)
        if not (0 <= col < self.cols and 0 <= row < self.rows):
            return float(np.nan)
        val = float(self.data_mmap[row, col])
        if val < -10000.0:
            return float(np.nan)
        return val

    def crop_region(
        self,
        center_lat: float,
        center_lon: float,
        width_m: float = 5000.0,
        height_m: float = 5000.0,
        target_resolution: int = 64
    ) -> Tuple[np.ndarray, Dict[str, Any]]:
        """
        Extract an exact physical box (width_m x height_m) centered at (center_lat, center_lon)
        and resample to (target_resolution x target_resolution). Preserves NaNs for nodata.
        """
        center_x, center_y = latlon_to_polar_stereo(center_lat, center_lon)
        center_col, center_row = self.world_to_pixel(center_x, center_y)

        half_cols = int(round((width_m / 2.0) / self.res_x))
        half_rows = int(round((height_m / 2.0) / self.res_y))

        c_min = max(0, center_col - half_cols)
        c_max = min(self.cols, center_col + half_cols)
        r_min = max(0, center_row - half_rows)
        r_max = min(self.rows, center_row + half_rows)

        # Slice real NASA elevation data
        cropped_raw = self.data_mmap[r_min:r_max, c_min:c_max].astype(np.float32)

        # In NASA LOLA products, nodata is typically -32768 or <= -10000
        cropped_raw[cropped_raw < -10000.0] = np.nan

        # Resample to target_resolution x target_resolution
        from scipy.ndimage import zoom
        zoom_r = target_resolution / cropped_raw.shape[0]
        zoom_c = target_resolution / cropped_raw.shape[1]
        resampled = zoom(cropped_raw, (zoom_r, zoom_c), order=1)

        finite_vals = resampled[np.isfinite(resampled)]
        min_elev = round(float(np.min(finite_vals)), 2) if len(finite_vals) > 0 else None
        max_elev = round(float(np.max(finite_vals)), 2) if len(finite_vals) > 0 else None

        metadata = {
            "cols": target_resolution,
            "rows": target_resolution,
            "physical_width_m": width_m,
            "physical_height_m": height_m,
            "step_m": (width_m / (target_resolution - 1)),
            "min_elevation_m": min_elev,
            "max_elevation_m": max_elev,
            "source": "NASA_LOLA_PGDA_REAL",
            "source_file": self.tif_path.name
        }

        return resampled, metadata

    def close(self):
        self.tif.close()
