export interface PlaceData {
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}
export interface ParisEntry { placeId: string; minutes: number }
export interface ParisDay { id: string; label: string; date: string; entries: ParisEntry[] }
export interface ParisItinerary {
  pool: ParisEntry[];
  days: ParisDay[];
  customPlaces?: PlaceData[];
}

const BASE = "/api/paris";

export async function loadItinerary(): Promise<ParisItinerary> {
  const r = await fetch(`${BASE}/itinerary`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function saveItinerary(data: ParisItinerary): Promise<void> {
  await fetch(`${BASE}/itinerary`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const res = await fetch(url, { headers: { "User-Agent": "BestFly/paris-planner" } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}
