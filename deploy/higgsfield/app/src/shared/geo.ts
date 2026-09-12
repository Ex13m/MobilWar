/**
 * Geo math for MobilWar.
 * All distances in metres, angles in degrees unless stated otherwise.
 * Local coordinate system: ENU (East-North-Up) tangent plane anchored at a room origin.
 * Game uses x = east, y = up, z = -north (three.js right-handed, camera looks down -Z),
 * so "north" in the world is -Z. Helpers below produce {x, z} ground-plane coords.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Vec2 {
  x: number; // east, metres
  z: number; // -north, metres (three.js convention)
}

export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

export const deg2rad = (d: number): number => d * DEG;
export const rad2deg = (r: number): number => r / DEG;

/** Great-circle distance between two points (Haversine). */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = deg2rad(b.lat - a.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const la1 = deg2rad(a.lat);
  const la2 = deg2rad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from true north in [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const la1 = deg2rad(a.lat);
  const la2 = deg2rad(b.lat);
  const dLon = deg2rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return normalizeDeg(rad2deg(Math.atan2(y, x)));
}

/** Normalise angle to [0, 360). */
export function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Signed smallest difference a-b in (-180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = normalizeDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

/**
 * Equirectangular projection to a local tangent plane. Accurate to <0.1% within a few km.
 * Returns three.js ground coords: x = east, z = -north.
 */
export function toLocal(origin: LatLon, p: LatLon): Vec2 {
  const cosLat = Math.cos(deg2rad(origin.lat));
  const east = deg2rad(p.lon - origin.lon) * cosLat * EARTH_RADIUS_M;
  const north = deg2rad(p.lat - origin.lat) * EARTH_RADIUS_M;
  return { x: east, z: -north };
}

/** Inverse of toLocal. */
export function fromLocal(origin: LatLon, v: Vec2): LatLon {
  const cosLat = Math.cos(deg2rad(origin.lat));
  const north = -v.z;
  return {
    lat: origin.lat + rad2deg(north / EARTH_RADIUS_M),
    lon: origin.lon + rad2deg(v.x / (EARTH_RADIUS_M * cosLat)),
  };
}

/** Move a point by distance along a compass bearing. */
export function destination(p: LatLon, bearingDeg: number, distM: number): LatLon {
  const br = deg2rad(bearingDeg);
  const ad = distM / EARTH_RADIUS_M;
  const la1 = deg2rad(p.lat);
  const lo1 = deg2rad(p.lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(ad) + Math.cos(la1) * Math.sin(ad) * Math.cos(br));
  const lo2 =
    lo1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(la1), Math.cos(ad) - Math.sin(la1) * Math.sin(la2));
  return { lat: rad2deg(la2), lon: normalizeLon(rad2deg(lo2)) };
}

export function normalizeLon(lon: number): number {
  return ((lon + 540) % 360) - 180;
}

/** Bearing (compass degrees) of a local vector from origin to v. */
export function bearingLocal(from: Vec2, to: Vec2): number {
  const east = to.x - from.x;
  const north = -(to.z - from.z);
  return normalizeDeg(rad2deg(Math.atan2(east, north)));
}

export function distLocal(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Is point p inside a circular geofence? */
export function insideCircle(center: LatLon, radiusM: number, p: LatLon): boolean {
  return haversine(center, p) <= radiusM;
}

/** Point-in-polygon on lat/lon (ray casting). Polygon may be open or closed. */
export function insidePolygon(poly: LatLon[], p: LatLon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const intersect =
      a.lat > p.lat !== b.lat > p.lat &&
      p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (intersect) inside = !inside;
  }
  return inside;
}
