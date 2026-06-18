import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import { PlaceMap } from "../components/paris/PlaceMap";
import { Planner } from "../components/paris/Planner";
import baseData from "../data/paris-places.json";
import { loadItinerary, saveItinerary, geocodeAddress } from "../api/paris";
import type { ParisItinerary, PlaceData } from "../api/paris";

const BASE_PLACES = baseData as PlaceData[];

const DAY_COLORS = ["#0E7A4B", "#3B82F6", "#C2851A", "#E05A1A", "#7C3AED", "#DB2777", "#059669"];

const CATEGORIES = ["monumento", "museu", "bairro", "parque", "gastronomia", "outro"];

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

export function ParisPage() {
  const [itinerary, setItinerary] = useState<ParisItinerary | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputId = useId();

  // Add-place form state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCat, setNewCat] = useState("monumento");
  const [newMin, setNewMin] = useState(60);
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState("");

  useEffect(() => {
    const prev = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "cream";
    return () => { document.documentElement.dataset.theme = prev ?? "dark"; };
  }, []);

  useEffect(() => {
    loadItinerary()
      .then(setItinerary)
      .catch(() => setItinerary(makeDefault()));
  }, []);

  const handleChange = useCallback((next: ParisItinerary) => {
    setItinerary(next);
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveItinerary(next)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("idle"));
    }, 800);
  }, []);

  const allPlaces = useMemo(() => [
    ...BASE_PLACES,
    ...(itinerary?.customPlaces ?? []),
  ], [itinerary?.customPlaces]);

  const placeMap = useMemo(() =>
    Object.fromEntries(allPlaces.map(p => [p.id, p])),
    [allPlaces]
  );

  const dayAssignment = useMemo(() => {
    const m: Record<string, number | undefined> = {};
    itinerary?.days.forEach((day, idx) => {
      day.entries.forEach(e => { m[e.placeId] = idx; });
    });
    return m;
  }, [itinerary?.days]);

  const dayPolygons = useMemo(() =>
    (itinerary?.days ?? []).map((day, idx) => ({
      dayIdx: idx,
      color: DAY_COLORS[idx % DAY_COLORS.length],
      points: day.entries
        .map(e => placeMap[e.placeId])
        .filter((p): p is PlaceData => Boolean(p))
        .map(p => [p.lat, p.lng] as [number, number]),
    })).filter(dp => dp.points.length >= 2),
    [itinerary?.days, placeMap]
  );

  async function addPlace() {
    if (!newName.trim() || !newAddress.trim()) return;
    setGeocoding(true);
    setGeoError("");
    try {
      const coords = await geocodeAddress(newAddress);
      if (!coords) { setGeoError("Endereço não encontrado"); return; }
      const place: PlaceData = {
        id: `custom-${Date.now()}`,
        name: newName.trim(),
        address: newAddress.trim(),
        lat: coords.lat,
        lng: coords.lng,
        category: newCat,
        minutes: newMin,
      };
      handleChange({
        ...itinerary!,
        customPlaces: [...(itinerary!.customPlaces ?? []), place],
        pool: [...itinerary!.pool, { placeId: place.id, minutes: place.minutes }],
      });
      setNewName(""); setNewAddress(""); setNewMin(60); setShowAdd(false);
    } finally {
      setGeocoding(false);
    }
  }

  function loadJson(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target!.result as string);
        const incoming: PlaceData[] = Array.isArray(raw) ? raw : (raw.places ?? []);
        const existingIds = new Set([
          ...BASE_PLACES.map(p => p.id),
          ...(itinerary!.customPlaces ?? []).map(p => p.id),
        ]);
        const toAdd = incoming.filter(p => p.id && p.name && p.lat && p.lng && !existingIds.has(p.id));
        if (!toAdd.length) return;
        handleChange({
          ...itinerary!,
          customPlaces: [...(itinerary!.customPlaces ?? []), ...toAdd],
          pool: [...itinerary!.pool, ...toAdd.map(p => ({ placeId: p.id, minutes: p.minutes ?? 60 }))],
        });
      } catch { alert("JSON inválido"); }
    };
    reader.readAsText(file);
  }

  if (!itinerary) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
        carregando…
      </div>
    );
  }

  const scheduled = itinerary.days.reduce((s, d) => s + d.entries.length, 0);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--ink)", fontFamily: "var(--font, sans-serif)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
        borderBottom: "1px solid var(--line)", flexShrink: 0, background: "var(--surface-2)",
      }}>
        <a href="/" style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--ink-3)", textDecoration: "none" }}>✈ fly</a>
        <span style={{ color: "var(--line-2)" }}>/</span>
        <span style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--green)" }}>paris</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
            {allPlaces.length} locais · {itinerary.days.length} dias ·{" "}
            <span style={{ color: "var(--green)" }}>{scheduled} agendados</span>
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
          <PlaceMap
            places={allPlaces}
            dayAssignment={dayAssignment}
            hoveredId={hoveredId}
            onMarkerClick={(id) => setHoveredId(id)}
            dayPolygons={dayPolygons}
          />
          {/* Legend */}
          <div style={{
            position: "absolute", bottom: 12, left: 12, zIndex: 1000,
            background: "rgba(251,248,242,0.92)", borderRadius: "var(--r-sm)", padding: "8px 12px",
            border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 5,
          }}>
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
          {/* Scrollable planner */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <Planner
              places={allPlaces}
              itinerary={itinerary}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onMarkerFocus={setHoveredId}
              onChange={handleChange}
            />
          </div>

          {/* ── Tools footer ── */}
          <div style={{ borderTop: "1px solid var(--line)", flexShrink: 0 }}>

            {/* Add place form */}
            <div style={{ borderBottom: showAdd ? "1px solid var(--line)" : "none" }}>
              <button
                onClick={() => setShowAdd(v => !v)}
                style={{
                  width: "100%", background: "none", border: "none",
                  padding: "10px 16px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  color: "var(--ink-2)", fontSize: 12, fontFamily: "var(--mono)",
                  textAlign: "left",
                }}
              >
                <span style={{ color: "var(--green)", fontSize: 14, lineHeight: 1 }}>{showAdd ? "−" : "+"}</span>
                adicionar local
              </button>

              {showAdd && (
                <div style={{ padding: "0 16px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <input
                      placeholder="Nome do local"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      style={inputStyle}
                    />
                    <select
                      value={newCat}
                      onChange={e => setNewCat(e.target.value)}
                      style={{ ...inputStyle, width: "auto", paddingRight: 8 }}
                    >
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <input
                    placeholder="Endereço (geocodificado automaticamente)"
                    value={newAddress}
                    onChange={e => { setNewAddress(e.target.value); setGeoError(""); }}
                    style={inputStyle}
                    onKeyDown={e => e.key === "Enter" && addPlace()}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                      <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>duração</span>
                      <button onClick={() => setNewMin(m => Math.max(15, m - 15))} style={btnStyle}>−</button>
                      <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-2)", minWidth: 40, textAlign: "center" }}>
                        {newMin >= 60 ? `${Math.floor(newMin/60)}h${newMin%60 ? `${newMin%60}m` : ""}` : `${newMin}m`}
                      </span>
                      <button onClick={() => setNewMin(m => m + 15)} style={btnStyle}>+</button>
                    </div>
                    <button
                      onClick={addPlace}
                      disabled={geocoding || !newName.trim() || !newAddress.trim()}
                      style={{
                        background: "var(--green)", border: "none", borderRadius: "var(--r-sm)",
                        color: "var(--on-accent)", fontSize: 12, fontFamily: "var(--mono)",
                        padding: "7px 14px", cursor: "pointer", fontWeight: 600,
                        opacity: (geocoding || !newName.trim() || !newAddress.trim()) ? 0.4 : 1,
                      }}
                    >
                      {geocoding ? "buscando…" : "adicionar"}
                    </button>
                  </div>
                  {geoError && (
                    <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--crimson)" }}>{geoError}</span>
                  )}
                </div>
              )}
            </div>

            {/* JSON import */}
            <label
              htmlFor={fileInputId}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 16px", cursor: "pointer",
                color: "var(--ink-3)", fontSize: 12, fontFamily: "var(--mono)",
              }}
            >
              <span style={{ fontSize: 13 }}>↑</span>
              importar JSON
              <input
                id={fileInputId}
                type="file"
                accept=".json,application/json"
                style={{ display: "none" }}
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) loadJson(f);
                  e.target.value = "";
                }}
              />
            </label>
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

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line-2)",
  color: "var(--ink-3)",
  borderRadius: 4,
  width: 22,
  height: 22,
  fontSize: 13,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
};
