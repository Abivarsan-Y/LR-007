"""
Lunar Coordinate Transformations, Projections, and Curvature Geometry.
Conforms to NASA LOLA polar stereographic definitions and MOON_ME frame.
"""

import math
import numpy as np

# NASA LOLA mean lunar reference radius in meters
R_MOON_M = 1737400.0


def latlon_to_polar_stereo(lat_deg: float, lon_deg: float, r_moon: float = R_MOON_M) -> tuple[float, float]:
    """
    Convert Planetocentric Latitude and East Longitude to South Polar Stereographic (x, y) in meters.
    Standard parallel: -90.0° (tangent at South Pole), central meridian: 0.0° E.
    Latitude must be in [-90.0, 0.0].
    """
    if lat_deg > 0.0:
        raise ValueError(f"Latitude must be south polar (<= 0.0°), got {lat_deg}°")

    lat_rad = math.radians(lat_deg)
    lon_rad = math.radians(lon_deg)

    # Colatitude from South Pole: 0 at -90°, pi/2 at equator
    colat = math.radians(90.0 + lat_deg)

    # Polar stereographic radial distance from south pole
    # Tangent plane at South Pole: r = 2 * R * tan(colat / 2)
    r = 2.0 * r_moon * math.tan(colat / 2.0)

    # Standard orientation: +X towards 90°E, +Y towards 0°E (or standard cartesian)
    x = r * math.sin(lon_rad)
    y = -r * math.cos(lon_rad)

    return x, y


def polar_stereo_to_latlon(x_m: float, y_m: float, r_moon: float = R_MOON_M) -> tuple[float, float]:
    """
    Convert South Polar Stereographic (x, y) in meters back to Planetocentric (lat, lon) in degrees.
    """
    r = math.hypot(x_m, y_m)

    if r == 0.0:
        return -90.0, 0.0

    # Invert r = 2 * R * tan(colat / 2)
    colat = 2.0 * math.atan(r / (2.0 * r_moon))
    lat_deg = math.degrees(colat) - 90.0

    # Invert x = r * sin(lon), y = -r * cos(lon) -> tan(lon) = x / (-y)
    lon_rad = math.atan2(x_m, -y_m)
    lon_deg = math.degrees(lon_rad) % 360.0

    return lat_deg, lon_deg


def curvature_drop(distance_m: float | np.ndarray, r_moon: float = R_MOON_M) -> float | np.ndarray:
    """
    Calculate lunar spherical curvature drop in meters at a given ground distance d.
    Drop = sqrt(R^2 + d^2) - R ≈ d^2 / (2 * R).
    """
    # Second-order accurate formula
    return (distance_m ** 2) / (2.0 * r_moon)


def apparent_elevation_angle(
    dx_m: float | np.ndarray,
    dy_m: float | np.ndarray,
    dz_m: float | np.ndarray,
    r_moon: float = R_MOON_M
) -> float | np.ndarray:
    """
    Calculate topocentric apparent elevation angle in degrees from observer to terrain target,
    taking lunar spherical curvature drop into account.
    """
    horiz_dist = np.hypot(dx_m, dy_m)
    drop = curvature_drop(horiz_dist, r_moon)
    apparent_dz = dz_m - drop
    angle_rad = np.arctan2(apparent_dz, horiz_dist)
    return np.degrees(angle_rad)
