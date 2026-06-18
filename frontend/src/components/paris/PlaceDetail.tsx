import type { PlaceData, ParisItinerary, ParisEntry, TicketStatus } from "../../api/paris";

const DAY_COLORS = ["#0E7A4B", "#3B82F6", "#C2851A", "#E05A1A", "#7C3AED", "#DB2777", "#059669"];

const CAT_COLOR: Record<string, string> = {
  monumento: "#0E7A4B", museu: "#3B82F6", bairro: "#C2851A",
  parque: "#22A04B", gastronomia: "#E05A1A",
};

const TICKET: Record<TicketStatus, { label: string; color: string; textColor: string }> = {
  free:    { label: "gratuito",  color: "var(--green)",  textColor: "var(--on-accent)" },
  pending: { label: "pendente",  color: "var(--amber)",  textColor: "#1A1712" },
  bought:  { label: "comprado",  color: "#3B82F6",       textColor: "#fff" },
};

interface Props {
  place: PlaceData;
  entry: ParisEntry;
  itinerary: ParisItinerary;
  onClose: () => void;
  onMoveTo: (containerId: string) => void;
  onEntryChange: (fields: Partial<ParisEntry>) => void;
}

export function PlaceDetail({ place, entry, itinerary, onClose, onMoveTo, onEntryChange }: Props) {
  const catColor = CAT_COLOR[place.category] ?? "var(--ink-3)";
  const inDay = itinerary.days.find(d => d.entries.some(e => e.placeId === place.id));
  const inPool = !inDay;

  const hrs = Math.floor(entry.minutes / 60);
  const mins = entry.minutes % 60;
  const durLabel = hrs > 0 ? (mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`) : `${mins}m`;

  const gmapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(`${place.name} ${place.address}`)}`;

  const toggleTicket = (status: TicketStatus) => {
    onEntryChange({ ticketStatus: entry.ticketStatus === status ? undefined : status });
  };

  return (
    <div style={{
      borderBottom: "1px solid var(--line)",
      borderLeft: `3px solid ${catColor}`,
      background: "var(--surface)",
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      maxHeight: "60vh",
    }}>
      {/* Sticky header */}
      <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: 0.8, color: catColor, fontWeight: 600, marginBottom: 3 }}>
              {place.category}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", lineHeight: 1.2 }}>
              {place.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)", marginTop: 3 }}>
              {place.address}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: 18, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}>×</button>
        </div>

        {/* Description */}
        {place.description && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.55, fontStyle: "italic" }}>
            {place.description}
          </div>
        )}
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Duration */}
        <div>
          <Label>duração</Label>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Btn onClick={() => onEntryChange({ minutes: Math.max(15, entry.minutes - 15) })}>−</Btn>
            <span style={{ fontSize: 13, fontFamily: "var(--mono)", color: "var(--ink)", minWidth: 42, textAlign: "center", fontWeight: 600 }}>{durLabel}</span>
            <Btn onClick={() => onEntryChange({ minutes: entry.minutes + 15 })}>+</Btn>
          </div>
        </div>

        {/* Ticket */}
        <div>
          <Label>ingresso</Label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {(Object.keys(TICKET) as TicketStatus[]).map(s => {
              const t = TICKET[s];
              const active = entry.ticketStatus === s;
              return (
                <button
                  key={s}
                  onClick={() => toggleTicket(s)}
                  style={{
                    border: `1px solid ${active ? t.color : "var(--line-2)"}`,
                    background: active ? t.color : "transparent",
                    color: active ? t.textColor : "var(--ink-2)",
                    borderRadius: 999,
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    padding: "3px 12px",
                    cursor: "pointer",
                    fontWeight: active ? 600 : 400,
                  }}
                >{t.label}</button>
              );
            })}
          </div>

          {/* Price — only when pending or bought */}
          {entry.ticketStatus && entry.ticketStatus !== "free" && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>R$</span>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="valor"
                value={entry.ticketPrice ?? ""}
                onChange={e => onEntryChange({ ticketPrice: e.target.value ? parseFloat(e.target.value) : undefined })}
                style={{ ...inputStyle, width: 100 }}
              />
              <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>por pessoa</span>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <Label>anotações</Label>
          <textarea
            placeholder="dicas, horários, endereço de encontro…"
            value={entry.notes ?? ""}
            onChange={e => onEntryChange({ notes: e.target.value || undefined })}
            rows={3}
            style={{
              ...inputStyle,
              width: "100%",
              resize: "vertical",
              lineHeight: 1.5,
              minHeight: 68,
              maxHeight: 180,
            }}
          />
        </div>

        {/* Move-to pills */}
        <div>
          <Label>{inDay ? `em: ${inDay.label}` : "em: sem data"}</Label>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {!inPool && (
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
        </div>

        {/* Google Maps */}
        <a
          href={gmapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
          onMouseOver={e => (e.currentTarget.style.color = "var(--green)")}
          onMouseOut={e => (e.currentTarget.style.color = "var(--ink-3)")}
        >
          ↗ Google Maps
        </a>
      </div>
    </div>
  );
}

/* ── Small helpers ── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-3)", fontWeight: 600, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ background: "transparent", border: "1px solid var(--line-2)", color: "var(--ink-3)", borderRadius: 4, width: 24, height: 24, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}>
      {children}
    </button>
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
        padding: "2px 10px",
        cursor: active ? "default" : "pointer",
      }}
    >{label}</button>
  );
}

const inputStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--line-2)",
  borderRadius: "var(--r-sm)",
  color: "var(--ink)",
  fontSize: 12,
  fontFamily: "var(--mono)",
  padding: "7px 10px",
  outline: "none",
};
