"""
Lunar Coordinate Transformations, Projections, and Curvature Geometry.
Conforms strictly to NASA LOLA South Polar Stereographic definitions (+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400)
and the MOON_ME / DE421 reference frame.
"""

import math
from typing import Tuple, Union
import numpy as np

# NASA LOLA mean lunar reference radius in meters
R_MOON_M = 1737400.0


def latlon_to_polar_stereo(
    lat_deg: Union[float, np.ndarray],
    lon_deg: Union[float, np.ndarray],
    r_moon: float = R_MOON_M
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
    """
    Convert Planetocentric Latitude and East Longitude to South Polar Stereographic (x, y) in meters.
    Standard parallel: -90.0° (tangent at South Pole), central meridian: 0.0° E.
    NASA convention:
        colat = 90.0° + lat_deg
        r = 2 * R * tan(colat / 2)
        X = r * sin(lon)
        Y = +r * cos(lon)
    Supports both scalar floats and numpy arrays.
    """
    is_array = isinstance(lat_deg, np.ndarray) or isinstance(lon_deg, np.ndarray)
    
    if is_array:
        lats = np.asarray(lat_deg, dtype=float)
        lons = np.asarray(lon_deg, dtype=float)
        if np.any(lats > 0.0):
            raise ValueError("Latitude must be south polar (<= 0.0°)")
        
        colat = np.radians(90.0 + lats)
        r = 2.0 * r_moon * np.tan(colat / 2.0)
        lon_rad = np.radians(lons)
        x = r * np.sin(lon_rad)
        y = r * np.cos(lon_rad)
        return x, y
    else:
        if lat_deg > 0.0:
            raise ValueError(f"Latitude must be south polar (<= 0.0°), got {lat_deg}°")

        colat = math.radians(90.0 + lat_deg)
        r = 2.0 * r_moon * math.tan(colat / 2.0)
        lon_rad = math.radians(lon_deg)
        x = r * math.sin(lon_rad)
        y = r * math.cos(lon_rad)
        return float(x), float(y)


def polar_stereo_to_latlon(
    x_m: Union[float, np.ndarray],
    y_m: Union[float, np.ndarray],
    r_moon: float = R_MOON_M
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
    """
    Convert South Polar Stereographic (x, y) in meters back to Planetocentric (lat, lon) in degrees.
    NASA convention:
        r = sqrt(x^2 + y^2)
        colat = 2 * atan(r / (2 * R))
        lat = colat - 90.0°
        lon = atan2(x, y)
    Supports both scalar floats and numpy arrays.
    """
    is_array = isinstance(x_m, np.ndarray) or isinstance(y_m, np.ndarray)
    
    if is_array:
        xs = np.asarray(x_m, dtype=float)
        ys = np.asarray(y_m, dtype=float)
        r = np.hypot(xs, ys)
        
        colat = 2.0 * np.arctan(r / (2.0 * r_moon))
        lat_deg = np.degrees(colat) - 90.0
        
        lon_rad = np.arctan2(xs, ys)
        lon_deg = np.degrees(lon_rad) % 360.0
        return lat_deg, lon_deg
    else:
        r = math.hypot(x_m, y_m)
        if r == 0.0:
            return -90.0, 0.0

        colat = 2.0 * math.atan(r / (2.0 * r_moon))
        lat_deg = math.degrees(colat) - 90.0

        lon_rad = math.atan2(x_m, y_m)
        lon_deg = math.degrees(lon_rad) % 360.0
        return float(lat_deg), float(lon_deg)


def curvature_drop(distance_m: Union[float, np.ndarray], r_moon: float = R_MOON_M) -> Union[float, np.ndarray]:
    """
    Calculate lunar spherical curvature drop in meters at a given ground distance d.
    Drop = sqrt(R^2 + d^2) - R ≈ d^2 / (2 * R).
    """
    return (distance_m ** 2) / (2.0 * r_moon)


def apparent_elevation_angle(
    dx_m: Union[float, np.ndarray],
    dy_m: Union[float, np.ndarray],
    dz_m: Union[float, np.ndarray],
    r_moon: float = R_MOON_M
) -> Union[float, np.ndarray]:
    """
    Calculate topocentric apparent elevation angle in degrees from observer to terrain target,
    taking lunar spherical curvature drop into account.
    """
    horiz_dist = np.hypot(dx_m, dy_m)
    drop = curvature_drop(horiz_dist, r_moon)
    apparent_dz = dz_m - drop
    angle_rad = np.arctan2(apparent_dz, horiz_dist)
    return np.degrees(angle_rad)
