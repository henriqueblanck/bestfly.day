import { useState, useEffect, useRef, useCallback } from "react";
import { PlaceMap } from "../components/paris/PlaceMap";
import { Planner } from "../components/paris/Planner";
import places from "../data/paris-places.json";
import { loadItinerary, saveItinerary } from "../api/paris";
import type { ParisItinerary } from "../api/paris";

const ALL_PLACES = places as Array<{
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}>;

function makeDefault(): ParisItinerary {
  return {
    pool: ALL_PLACES.map(p => ({ placeId: p.id, minutes: p.minutes })),
    days: [
      { id: "day-1", label: "Dia 1", date: "", entries: [] },
      { id: "day-2", label: "Dia 2", date: "", entries: [] },
      { id: "day-3", label: "Dia 3", date: "", entries: [] },
    ],
  };
}

export function ParisPage() {
  const [itinerary, setItinerary] = useState<ParisItinerary | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Build day assignment map: placeId → dayIndex
  const dayAssignment: Record<string, number | undefined> = {};
  if (itinerary) {
    itinerary.days.forEach((day, idx) => {
      day.entries.forEach(e => { dayAssignment[e.placeId] = idx; });
    });
  }

  if (!itinerary) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d0d", color: "#555", fontFamily: "monospace" }}>
        carregando…
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0d0d0d", color: "#eee", fontFamily: "sans-serif" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, padding: "10px 16px",
        borderBottom: "1px solid #1a1a1a", flexShrink: 0,
        background: "#0a0a0a",
      }}>
        <a href="/" style={{ fontSize: 13, fontFamily: "monospace", color: "#555", textDecoration: "none" }}>
          ✈ fly
        </a>
        <span style={{ color: "#2a2a2a" }}>/</span>
        <span style={{ fontSize: 13, fontFamily: "monospace", color: "#00ff88" }}>paris</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "monospace", color: saveStatus === "saving" ? "#666" : saveStatus === "saved" ? "#00ff88" : "#333" }}>
          {saveStatus === "saving" ? "salvando…" : saveStatus === "saved" ? "✓ salvo" : ""}
        </span>
      </div>

      {/* Body: map + planner */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Map */}
        <div style={{ flex: "0 0 55%", position: "relative" }}>
          <PlaceMap
            places={ALL_PLACES}
            dayAssignment={dayAssignment}
            hoveredId={hoveredId}
            onMarkerClick={(id) => setHoveredId(id)}
          />
          {/* Legend */}
          <div style={{
            position: "absolute", bottom: 12, left: 12, zIndex: 1000,
            background: "rgba(10,10,10,0.85)", borderRadius: 6, padding: "8px 12px",
            border: "1px solid #1e1e1e", display: "flex", flexDirection: "column", gap: 4,
          }}>
            {[
              { cat: "monumento",   color: "#00ff88", label: "Monumentos" },
              { cat: "museu",       color: "#7ab8ff", label: "Museus" },
              { cat: "bairro",      color: "#ffd700", label: "Bairros" },
              { cat: "parque",      color: "#90ee90", label: "Parques" },
              { cat: "gastronomia", color: "#ff9a5c", label: "Gastronomia" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                <span style={{ fontSize: 10, fontFamily: "monospace", color: "#888" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Planner */}
        <div style={{
          flex: 1,
          borderLeft: "1px solid #1a1a1a",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}>
          {/* Planner header */}
          <div style={{
            padding: "10px 16px",
            borderBottom: "1px solid #1a1a1a",
            fontSize: 11,
            fontFamily: "monospace",
            color: "#555",
            flexShrink: 0,
            display: "flex",
            gap: 12,
          }}>
            <span>{ALL_PLACES.length} locais</span>
            <span>·</span>
            <span>{itinerary.days.length} dias</span>
            <span>·</span>
            <span style={{ color: "#00ff88" }}>
              {itinerary.days.reduce((s, d) => s + d.entries.length, 0)} agendados
            </span>
          </div>

          {/* Scrollable planner content */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
            <Planner
              places={ALL_PLACES}
              itinerary={itinerary}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onMarkerFocus={setHoveredId}
              onChange={handleChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
