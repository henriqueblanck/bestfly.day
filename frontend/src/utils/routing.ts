export interface RouteLeg {
  distance: number; // meters
  duration: number; // seconds
}

export interface RouteResult {
  legs: RouteLeg[];
  geojson: { type: "LineString"; coordinates: [number, number][] };
}

const cache = new Map<string, RouteResult | null>();

function cacheKey(coords: [number, number][]): string {
  return coords.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join("|");
}

export async function fetchWalkRoute(coords: [number, number][]): Promise<RouteResult | null> {
  if (coords.length < 2) return null;
  const key = cacheKey(coords);
  if (cache.has(key)) return cache.get(key)!;

  const waypoints = coords.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${waypoints}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error("http error");
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.[0]) {
      cache.set(key, null);
      return null;
    }
    const route = data.routes[0];
    const result: RouteResult = {
      legs: route.legs.map((l: { distance: number; duration: number }) => ({
        distance: l.distance,
        duration: l.duration,
      })),
      geojson: route.geometry,
    };
    cache.set(key, result);
    return result;
  } catch {
    cache.set(key, null);
    return null;
  }
}

export function fmtWalk(meters: number, seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min === 0) return "< 1min";
  const km = (meters / 1000).toFixed(1);
  return `${min}min · ${km}km`;
}

// Haversine fallback (straight-line)
export function haversine(a: [number, number], b: [number, number]): RouteLeg {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  const distance = 2 * R * Math.asin(Math.sqrt(s));
  const duration = (distance / 1000 / 4.6) * 3600; // ~4.6 km/h walk
  return { distance, duration };
}
