import type { PlaceData, ParisItinerary } from "../../api/paris";

const DAY_COLORS = ["#0E7A4B", "#3B82F6", "#C2851A", "#E05A1A", "#7C3AED", "#DB2777", "#059669"];

const CAT_COLOR: Record<string, string> = {
  monumento:   "#0E7A4B",
  museu:       "#3B82F6",
  bairro:      "#C2851A",
  parque:      "#22A04B",
  gastronomia: "#E05A1A",
};

interface Props {
  place: PlaceData;
  itinerary: ParisItinerary;
  onClose: () => void;
  onMoveTo: (containerId: string) => void;
  onMinutesChange: (m: number) => void;
}

export function PlaceDetail({ place, itinerary, onClose, onMoveTo, onMinutesChange }: Props) {
  const catColor = CAT_COLOR[place.category] ?? "var(--ink-3)";

  const poolEntry = itinerary.pool.find(e => e.placeId === place.id);
  const inDay = itinerary.days.find(d => d.entries.some(e => e.placeId === place.id));
  const dayEntry = inDay?.entries.find(e => e.placeId === place.id);
  const minutes = (poolEntry ?? dayEntry)?.minutes ?? place.minutes;

  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const durLabel = hrs > 0 ? (mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`) : `${mins}m`;

  const gmapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(`${place.name} ${place.address}`)}`;

  return (
    <div style={{
      borderBottom: "1px solid var(--line)",
      background: "var(--surface)",
      padding: "14px 16px",
      flexShrink: 0,
      borderLeft: `3px solid ${catColor}`,
    }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: 0.8, color: catColor, fontWeight: 600, marginBottom: 3 }}>
            {place.category}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", lineHeight: 1.2 }}>
            {place.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)", marginTop: 4 }}>
            {place.address}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: 18, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
        >×</button>
      </div>

      {/* Duration */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>duração</span>
        <button onClick={() => onMinutesChange(Math.max(15, minutes - 15))} style={btnStyle}>−</button>
        <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink)", minWidth: 40, textAlign: "center", fontWeight: 600 }}>
          {durLabel}
        </span>
        <button onClick={() => onMinutesChange(minutes + 15)} style={btnStyle}>+</button>
      </div>

      {/* Location + move */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>
          {inDay ? `${inDay.label}` : "sem data"}
        </span>
        <span style={{ color: "var(--line-2)" }}>→</span>

        {inDay && (
          <Pill label="sem data" active={false} color="var(--ink-2)" onClick={() => onMoveTo("pool")} />
        )}
        {itinerary.days.map((day, idx) => (
          <Pill
            key={day.id}
            label={day.label}
            active={inDay?.id === day.id}
            color={DAY_COLORS[idx % DAY_COLORS.length]}
            onClick={() => { if (inDay?.id !== day.id) onMoveTo(day.id); }}
          />
        ))}
      </div>

      {/* Google Maps */}
      <a
        href={gmapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 10, fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)", textDecoration: "none" }}
        onMouseOver={e => (e.currentTarget.style.color = "var(--green)")}
        onMouseOut={e => (e.currentTarget.style.color = "var(--ink-3)")}
      >
        ↗ Google Maps
      </a>
    </div>
  );
}

function Pill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? color : "transparent",
        border: `1px solid ${active ? color : "var(--line-2)"}`,
        borderRadius: 999,
        color: active ? "#fff" : "var(--ink-2)",
        fontSize: 10,
        fontFamily: "var(--mono)",
        padding: "2px 9px",
        cursor: active ? "default" : "pointer",
      }}
    >{label}</button>
  );
}

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line-2)",
  color: "var(--ink-3)",
  borderRadius: 4,
  width: 22, height: 22, fontSize: 13,
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 0, flexShrink: 0,
};
