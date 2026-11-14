export const RADIUS = 1737400;
export const WMS_URL = 'https://wms.im-ldi.com/';
export function normalizeLongitude(lon) { return ((lon + 180) % 360 + 360) % 360 - 180; }
export function validateCoordinate(lat, lon) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 360) throw new Error('Enter latitude −90…90 and longitude −180…360.');
  return { lat, lon: normalizeLongitude(lon) };
}
// Spherical geodesic forward solution; east/north are true local bearings.
export function offsetCoordinate(lat, lon, east, north) {
  const d = Math.hypot(east, north) / RADIUS;
  if (d === 0) return { lat, lon: normalizeLongitude(lon) };
  const bearing = Math.atan2(east, north), phi = lat * Math.PI / 180, lambda = lon * Math.PI / 180;
  const p = Math.asin(Math.sin(phi) * Math.cos(d) + Math.cos(phi) * Math.sin(d) * Math.cos(bearing));
  const l = lambda + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(phi), Math.cos(d) - Math.sin(phi) * Math.sin(p));
  return { lat: p * 180 / Math.PI, lon: normalizeLongitude(l * 180 / Math.PI) };
}
export function directionEnu(azimuth, elevation) {
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  return [Math.cos(e) * Math.sin(a), Math.cos(e) * Math.cos(a), Math.sin(e)];
}
export function mapImageUrl(bounds, width = 1024, height = 1024) {
  const url = new URL(WMS_URL);
  url.search = new URLSearchParams({ service:'WMS', version:'1.1.1', request:'GetMap', layers:'luna_wac_global', styles:'', srs:'IAU2000:30100', bbox:bounds.join(','), width:String(width), height:String(height), format:'image/jpeg' });
  return url.href;
}
