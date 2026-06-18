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

  const dayAssignment: Record<string, number | undefined> = {};
  if (itinerary) {
    itinerary.days.forEach((day, idx) => {
      day.entries.forEach(e => { dayAssignment[e.placeId] = idx; });
    });
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
        borderBottom: "1px solid var(--line)", flexShrink: 0,
        background: "var(--surface-2)",
      }}>
        <a href="/" style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--ink-3)", textDecoration: "none" }}>
          ✈ fly
        </a>
        <span style={{ color: "var(--line-2)" }}>/</span>
        <span style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--green)" }}>paris</span>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
            {ALL_PLACES.length} locais · {itinerary.days.length} dias ·{" "}
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
            places={ALL_PLACES}
            dayAssignment={dayAssignment}
            hoveredId={hoveredId}
            onMarkerClick={(id) => setHoveredId(id)}
          />
          {/* Legend */}
          <div style={{
            position: "absolute", bottom: 12, left: 12, zIndex: 1000,
            background: "rgba(10,10,10,0.88)", borderRadius: "var(--r-sm)", padding: "8px 12px",
            border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 5,
          }}>
            {[
              { color: "var(--green)",  label: "Monumentos" },
              { color: "#7ab8ff",       label: "Museus" },
              { color: "var(--amber)",  label: "Bairros" },
              { color: "#90ee90",       label: "Parques" },
              { color: "#ff9a5c",       label: "Gastronomia" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Planner */}
        <div style={{
          flex: 1,
          borderLeft: "1px solid var(--line)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "auto",
        }}>
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
  );
}
