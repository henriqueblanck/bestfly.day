import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import { PlaceMap } from "../components/paris/PlaceMap";
import { Planner } from "../components/paris/Planner";
import { PlaceDetail } from "../components/paris/PlaceDetail";
import baseData from "../data/paris-places.json";
import { loadItinerary, saveItinerary, geocodeAddress } from "../api/paris";
import type { ParisItinerary, PlaceData, ParisEntry } from "../api/paris";

const BASE_PLACES = baseData as PlaceData[];
const DAY_COLORS = ["#0E7A4B", "#3B82F6", "#C2851A", "#E05A1A", "#7C3AED", "#DB2777", "#059669"];
const CATEGORIES = ["monumento", "museu", "bairro", "parque", "gastronomia", "outro"];

const JSON_MODEL = JSON.stringify([
  { id: "unico-id", name: "Nome do Local", address: "Rua, Paris, França", lat: 48.8584, lng: 2.2945, category: "monumento", minutes: 90, description: "Descrição opcional do local" }
], null, 2);

function makeDefault(): ParisItinerary {
  return {
    pool: BASE_PLACES.map(p => ({ placeId: p.id, minutes: p.minutes })),
    days: [
      { id: "day-1", label: "Dia 1", date: "", entries: [] },
      { id: "day-2", label: "Dia 2", date: "", entries: [] },
      { id: "day-3", label: "Dia 3", date: "", entries: [] },
    ],
    customPlaces: [],
  };
}

// Shared itinerary helpers
function getEntries(itin: ParisItinerary, cid: string): ParisEntry[] {
  return cid === "pool" ? itin.pool : (itin.days.find(d => d.id === cid)?.entries ?? []);
}
function setEntries(itin: ParisItinerary, cid: string, entries: ParisEntry[]): ParisItinerary {
  return cid === "pool"
    ? { ...itin, pool: entries }
    : { ...itin, days: itin.days.map(d => d.id === cid ? { ...d, entries } : d) };
}
function findContainer(itin: ParisItinerary, placeId: string): string | undefined {
  if (itin.pool.some(e => e.placeId === placeId)) return "pool";
  return itin.days.find(d => d.entries.some(e => e.placeId === placeId))?.id;
}

export function ParisPage() {
  const [itinerary, setItinerary] = useState<ParisItinerary | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputId = useId();

  // Add-place form
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCat, setNewCat] = useState("monumento");
  const [newMin, setNewMin] = useState(60);
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState("");

  // JSON model toggle
  const [showModel, setShowModel] = useState(false);

  useEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "cream";
    return () => { document.documentElement.dataset.theme = prev ?? "dark"; };
  }, []);

  useEffect(() => {
    loadItinerary().then(setItinerary).catch(() => setItinerary(makeDefault()));
  }, []);

  const handleChange = useCallback((next: ParisItinerary) => {
    setItinerary(next);
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveItinerary(next).then(() => setSaveStatus("saved")).catch(() => setSaveStatus("idle"));
    }, 800);
  }, []);

  const allPlaces = useMemo(() => [...BASE_PLACES, ...(itinerary?.customPlaces ?? [])], [itinerary?.customPlaces]);
  const placeMap = useMemo(() => Object.fromEntries(allPlaces.map(p => [p.id, p])), [allPlaces]);

  const dayAssignment = useMemo(() => {
    const m: Record<string, number | undefined> = {};
    itinerary?.days.forEach((day, idx) => { day.entries.forEach(e => { m[e.placeId] = idx; }); });
    return m;
  }, [itinerary?.days]);

  const dayPolygons = useMemo(() =>
    (itinerary?.days ?? []).map((day, idx) => ({
      dayIdx: idx,
      color: DAY_COLORS[idx % DAY_COLORS.length],
      points: day.entries.map(e => placeMap[e.placeId]).filter((p): p is PlaceData => Boolean(p)).map(p => [p.lat, p.lng] as [number, number]),
    })).filter(dp => dp.points.length >= 2),
    [itinerary?.days, placeMap]
  );

  function movePlaceTo(placeId: string, targetId: string) {
    if (!itinerary) return;
    const srcId = findContainer(itinerary, placeId);
    if (!srcId) return;
    const entry = getEntries(itinerary, srcId).find(e => e.placeId === placeId)!;
    let next = setEntries(itinerary, srcId, getEntries(itinerary, srcId).filter(e => e.placeId !== placeId));
    next = setEntries(next, targetId, [...getEntries(next, targetId), entry]);
    handleChange(next);
  }

  function updateEntryField(placeId: string, fields: Partial<ParisEntry>) {
    if (!itinerary) return;
    const cid = findContainer(itinerary, placeId);
    if (!cid) return;
    handleChange(setEntries(itinerary, cid, getEntries(itinerary, cid).map(e =>
      e.placeId === placeId ? { ...e, ...fields } : e
    )));
  }

  function addDay() {
    if (!itinerary) return;
    handleChange({
      ...itinerary,
      days: [...itinerary.days, { id: `day-${Date.now()}`, label: `Dia ${itinerary.days.length + 1}`, date: "", entries: [] }],
    });
  }

  async function addPlace() {
    if (!itinerary || !newName.trim() || !newAddress.trim()) return;
    setGeocoding(true); setGeoError("");
    try {
      const coords = await geocodeAddress(newAddress);
      if (!coords) { setGeoError("Endereço não encontrado"); return; }
      const place: PlaceData = { id: `custom-${Date.now()}`, name: newName.trim(), address: newAddress.trim(), lat: coords.lat, lng: coords.lng, category: newCat, minutes: newMin };
      handleChange({ ...itinerary, customPlaces: [...(itinerary.customPlaces ?? []), place], pool: [...itinerary.pool, { placeId: place.id, minutes: place.minutes }] });
      setNewName(""); setNewAddress(""); setNewMin(60); setShowAdd(false);
    } finally { setGeocoding(false); }
  }

  function loadJson(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target!.result as string);
        const incoming: PlaceData[] = Array.isArray(raw) ? raw : (raw.places ?? []);
        const existingIds = new Set([...BASE_PLACES.map(p => p.id), ...(itinerary!.customPlaces ?? []).map(p => p.id)]);
        const toAdd = incoming.filter(p => p.id && p.name && p.lat && p.lng && !existingIds.has(p.id));
        if (!toAdd.length) return;
        handleChange({ ...itinerary!, customPlaces: [...(itinerary!.customPlaces ?? []), ...toAdd], pool: [...itinerary!.pool, ...toAdd.map(p => ({ placeId: p.id, minutes: p.minutes ?? 60 }))] });
      } catch { alert("JSON inválido"); }
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const blob = new Blob([JSON_MODEL], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "modelo-paris.json"; a.click();
    URL.revokeObjectURL(url);
  }

  if (!itinerary) {
    return <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", color: "var(--ink-3)", fontFamily: "var(--mono)" }}>carregando…</div>;
  }

  const scheduled = itinerary.days.reduce((s, d) => s + d.entries.length, 0);
  const selectedPlace = selectedId ? placeMap[selectedId] : null;
  const selectedEntry = selectedId
    ? (itinerary.pool.find(e => e.placeId === selectedId) ?? itinerary.days.flatMap(d => d.entries).find(e => e.placeId === selectedId) ?? null)
    : null;
  const newMinLabel = newMin >= 60 ? `${Math.floor(newMin / 60)}h${newMin % 60 ? `${newMin % 60}m` : ""}` : `${newMin}m`;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--ink)", fontFamily: "var(--font)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0, background: "var(--surface-2)" }}>
        <a href="/" style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--ink-3)", textDecoration: "none" }}>✈ fly</a>
        <span style={{ color: "var(--line-2)" }}>/</span>
        <span style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--green)" }}>paris</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
            {allPlaces.length} locais · {itinerary.days.length} dias · <span style={{ color: "var(--green)" }}>{scheduled} agendados</span>
          </span>
          <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: saveStatus === "saving" ? "var(--ink-3)" : saveStatus === "saved" ? "var(--green)" : "transparent" }}>
            {saveStatus === "saving" ? "salvando…" : "✓ salvo"}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Map */}
        <div style={{ flex: "0 0 55%", position: "relative" }}>
          <PlaceMap places={allPlaces} dayAssignment={dayAssignment} hoveredId={hoveredId} onMarkerClick={(id) => { setHoveredId(id); setSelectedId(id); }} dayPolygons={dayPolygons} />
          {/* Legend */}
          <div style={{ position: "absolute", bottom: 12, left: 12, zIndex: 1000, background: "rgba(251,248,242,0.92)", borderRadius: "var(--r-sm)", padding: "8px 12px", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 5 }}>
            {[
              { color: "var(--green)",  label: "Monumentos" },
              { color: "#3B82F6",       label: "Museus" },
              { color: "var(--amber)",  label: "Bairros" },
              { color: "#22A04B",       label: "Parques" },
              { color: "#E05A1A",       label: "Gastronomia" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Planner column */}
        <div style={{ flex: 1, borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", minHeight: 0 }}>

          {/* Place detail panel — appears when a place is selected */}
          {selectedPlace && selectedEntry && (
            <PlaceDetail
              place={selectedPlace}
              entry={selectedEntry}
              itinerary={itinerary}
              onClose={() => setSelectedId(null)}
              onMoveTo={(cid) => movePlaceTo(selectedPlace.id, cid)}
              onEntryChange={(fields) => updateEntryField(selectedPlace.id, fields)}
            />
          )}

          {/* Scrollable planner */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <Planner
              places={allPlaces}
              itinerary={itinerary}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onMarkerFocus={setHoveredId}
              onChange={handleChange}
              onSelect={(id) => setSelectedId(prev => prev === id ? null : id)}
            />
          </div>

          {/* ── Tools footer ── */}
          <div style={{ borderTop: "1px solid var(--line)", flexShrink: 0 }}>

            {/* Add day button */}
            <button
              onClick={addDay}
              style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid var(--line)", padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "var(--green)", fontSize: 12, fontFamily: "var(--mono)", fontWeight: 600, textAlign: "left" }}
            >
              + dia
            </button>

            {/* Add place form */}
            <div style={{ borderBottom: "1px solid var(--line)" }}>
              <button onClick={() => setShowAdd(v => !v)} style={{ width: "100%", background: "none", border: "none", padding: "10px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "var(--ink-2)", fontSize: 12, fontFamily: "var(--mono)", textAlign: "left" }}>
                <span style={{ color: "var(--ink-3)", fontSize: 14, lineHeight: 1 }}>{showAdd ? "−" : "+"}</span>
                adicionar local
              </button>
              {showAdd && (
                <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <input placeholder="Nome do local" value={newName} onChange={e => setNewName(e.target.value)} style={inputStyle} />
                    <select value={newCat} onChange={e => setNewCat(e.target.value)} style={{ ...inputStyle, width: "auto", paddingRight: 6 }}>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <input placeholder="Endereço (geocodificado automaticamente)" value={newAddress} onChange={e => { setNewAddress(e.target.value); setGeoError(""); }} style={inputStyle} onKeyDown={e => e.key === "Enter" && addPlace()} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1 }}>
                      <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>duração</span>
                      <button onClick={() => setNewMin(m => Math.max(15, m - 15))} style={miniBtnStyle}>−</button>
                      <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-2)", minWidth: 36, textAlign: "center" }}>{newMinLabel}</span>
                      <button onClick={() => setNewMin(m => m + 15)} style={miniBtnStyle}>+</button>
                    </div>
                    <button onClick={addPlace} disabled={geocoding || !newName.trim() || !newAddress.trim()} style={{ background: "var(--green)", border: "none", borderRadius: "var(--r-sm)", color: "var(--on-accent)", fontSize: 12, fontFamily: "var(--mono)", padding: "7px 14px", cursor: "pointer", fontWeight: 600, opacity: (geocoding || !newName.trim() || !newAddress.trim()) ? 0.4 : 1 }}>
                      {geocoding ? "buscando…" : "adicionar"}
                    </button>
                  </div>
                  {geoError && <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--crimson)" }}>{geoError}</span>}
                </div>
              )}
            </div>

            {/* JSON import + model */}
            <div>
              <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 12 }}>
                <label htmlFor={fileInputId} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: "var(--ink-3)", fontSize: 12, fontFamily: "var(--mono)" }}>
                  <span style={{ fontSize: 13 }}>↑</span> importar JSON
                  <input id={fileInputId} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) loadJson(f); e.target.value = ""; }} />
                </label>
                <button onClick={() => setShowModel(v => !v)} style={{ background: "none", border: "none", color: "var(--ink-3)", fontSize: 11, fontFamily: "var(--mono)", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                  {showModel ? "fechar modelo" : "ver modelo"}
                </button>
                <button onClick={downloadTemplate} style={{ background: "none", border: "none", color: "var(--ink-3)", fontSize: 11, fontFamily: "var(--mono)", cursor: "pointer", padding: 0, marginLeft: "auto" }}>
                  ↓ baixar modelo
                </button>
              </div>

              {showModel && (
                <div style={{ margin: "0 16px 12px", padding: 12, background: "var(--surface-2)", borderRadius: "var(--r-sm)", border: "1px solid var(--line)" }}>
                  <pre style={{ margin: 0, fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-2)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{JSON_MODEL}</pre>
                  <div style={{ marginTop: 8, fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
                    categorias válidas: {CATEGORIES.join(" · ")}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-sm)",
  color: "var(--ink)",
  fontSize: 12,
  fontFamily: "var(--mono)",
  padding: "7px 10px",
  outline: "none",
  width: "100%",
};

const miniBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line-2)",
  color: "var(--ink-3)",
  borderRadius: 4,
  width: 22, height: 22, fontSize: 13,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 0, flexShrink: 0,
};
