export interface ParisEntry { placeId: string; minutes: number }
export interface ParisDay { id: string; label: string; date: string; entries: ParisEntry[] }
export interface ParisItinerary { pool: ParisEntry[]; days: ParisDay[] }

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
