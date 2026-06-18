export type TicketLabel = "gratuito" | "pendente" | "comprado";

export interface PPlace {
  id: string;
  name: string;
  cat: string;
  lat: number;
  lng: number;
  address: string;
  desc?: string;
  duration: number;
  ticket?: TicketLabel;
  price?: number | null;
  notes?: string;
}

export interface PColumn {
  id: string;
  label: string;
  isPool: boolean;
  items: string[];
  date?: string;
  color?: string;
}

export interface ParisPlan {
  places: Record<string, PPlace>;
  columns: PColumn[];
}

// Keep old types for migration
export interface _OldEntry { placeId: string; minutes: number; notes?: string; ticketStatus?: string; ticketPrice?: number }
export interface _OldDay   { id: string; label: string; date: string; entries: _OldEntry[] }
export interface _OldPlan  { pool: _OldEntry[]; days: _OldDay[]; customPlaces?: any[] }

const BASE = "/api/paris";
const DAY_COLORS_MIG = ["#C0492F", "#3B6FB5", "#2F6B4F", "#C2851A", "#7A4E8C", "#2F7E7A", "#B5536B", "#4D6A2E"];

export function migratePlan(raw: any, seedPlaces: Record<string, PPlace>): ParisPlan {
  if (!raw) return { places: { ...seedPlaces }, columns: [{ id: "pool", label: "Sem data", isPool: true, items: Object.keys(seedPlaces) }] };
  if (raw.columns) return raw as ParisPlan;

  // Old format: { pool, days, customPlaces }
  const places: Record<string, PPlace> = { ...seedPlaces };

  for (const cp of (raw.customPlaces ?? [])) {
    places[cp.id] = {
      id: cp.id, name: cp.name, cat: cp.category ?? "outro",
      lat: cp.lat, lng: cp.lng, address: cp.address ?? "",
      desc: cp.description, duration: cp.minutes ?? 60,
    };
  }

  const applyEntry = (e: _OldEntry) => {
    if (!places[e.placeId]) return;
    places[e.placeId] = {
      ...places[e.placeId],
      duration: e.minutes ?? places[e.placeId].duration,
      ticket: (e.ticketStatus as TicketLabel | undefined) ?? places[e.placeId].ticket,
      price: e.ticketPrice ?? places[e.placeId].price,
      notes: e.notes ?? places[e.placeId].notes,
    };
  };

  const poolItems: string[] = [];
  for (const e of (raw.pool ?? [])) {
    applyEntry(e);
    if (places[e.placeId]) poolItems.push(e.placeId);
  }

  const columns: PColumn[] = [{ id: "pool", label: "Sem data", isPool: true, items: poolItems }];
  for (const [idx, day] of ((raw.days ?? []) as _OldDay[]).entries()) {
    const items: string[] = [];
    for (const e of day.entries) {
      applyEntry(e);
      if (places[e.placeId]) items.push(e.placeId);
    }
    columns.push({ id: day.id, label: day.label, isPool: false, items, date: day.date, color: DAY_COLORS_MIG[idx % DAY_COLORS_MIG.length] });
  }

  return { places, columns };
}

export async function loadPlan(): Promise<any | null> {
  try {
    const r = await fetch(`${BASE}/itinerary`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function savePlan(data: ParisPlan): Promise<void> {
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
