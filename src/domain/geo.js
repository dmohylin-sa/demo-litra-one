// Mocked routing service: great-circle distance x road factor, average laden tanker speed.
// In the real platform this is a truck routing API with ADR tunnel restrictions.

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export const ROAD_FACTOR = 1.27;
export const AVG_KMH = 64;

export const roadKm = (a, b) => Math.max(1, Math.round(haversineKm(a, b) * ROAD_FACTOR));
export const driveMinutes = (km) => Math.round((km / AVG_KMH) * 60);
export const lerp = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
