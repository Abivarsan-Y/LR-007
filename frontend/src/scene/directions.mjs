/** North-clockwise azimuth to local scene axes: +X east, +Y up, -Z north. */
export function azElToSceneDirection(azimuthDeg, elevationDeg) {
  if (!Number.isFinite(azimuthDeg) || azimuthDeg < 0 || azimuthDeg >= 360 ||
      !Number.isFinite(elevationDeg) || Math.abs(elevationDeg) > 90) {
    throw new RangeError('Expected azimuth [0,360) and elevation [-90,90] degrees');
  }
  const az = azimuthDeg * Math.PI / 180;
  const el = elevationDeg * Math.PI / 180;
  return {
    x: Math.cos(el) * Math.sin(az),
    y: Math.sin(el),
    z: -Math.cos(el) * Math.cos(az),
  };
}
