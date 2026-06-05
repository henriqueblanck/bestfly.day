import { useState } from "react";
import type { SearchPayload } from "../api/search";

interface Props {
  onSubmit: (p: SearchPayload) => void;
  loading: boolean;
}

const HUB_OPTIONS = ["MAD", "LIS", "CDG", "AMS", "FCO", "MXP"];
const DATE_RANGE_DAYS = 10;

function todayPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function SearchForm({ onSubmit, loading }: Props) {
  const [origins, setOrigins] = useState("GRU,BSB");
  const [destinations, setDestinations] = useState("BCN,PRG,VIE,ATH,DUB,LHR");
  const [hubs, setHubs] = useState<string[]>(["MAD", "LIS"]);
  const [dateFrom, setDateFrom] = useState(todayPlus(30));
  const [dateTo, setDateTo] = useState(todayPlus(39));
  const [maxConn, setMaxConn] = useState(1);
  const [maxDur, setMaxDur] = useState(20);
  const [markup, setMarkup] = useState(0);

  function toggleHub(hub: string) {
    setHubs((prev) =>
      prev.includes(hub) ? prev.filter((h) => h !== hub) : [...prev, hub]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      origins: origins.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      destinations: destinations.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      hubs,
      date_from: dateFrom,
      date_to: dateTo,
      max_connections: maxConn,
      max_duration_hours: maxDur,
      markup_percent: markup,
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Origins + Destinations */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={labelStyle}>Origins</label>
          <input
            className="bf-input"
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder="GRU, BSB"
          />
          <span style={hintStyle}>IATA codes, comma-separated · max 2</span>
        </div>
        <div>
          <label style={labelStyle}>Destinations</label>
          <input
            className="bf-input"
            value={destinations}
            onChange={(e) => setDestinations(e.target.value)}
            placeholder="BCN, PRG, VIE..."
          />
          <span style={hintStyle}>up to 10 cities</span>
        </div>
      </div>

      {/* Hubs */}
      <div>
        <label style={labelStyle}>Transatlantic Hubs</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {HUB_OPTIONS.map((hub) => (
            <button
              key={hub}
              type="button"
              className={`chip ${hubs.includes(hub) ? "active" : ""}`}
              onClick={() => toggleHub(hub)}
            >
              {hub}
            </button>
          ))}
        </div>
        <span style={hintStyle}>long-haul anchor points</span>
      </div>

      {/* Date range — 10-day strip */}
      <div>
        <label style={labelStyle}>Date Window</label>
        <DateStrip
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
        />
      </div>

      {/* Advanced row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>Max stops</label>
          <select className="bf-input" value={maxConn} onChange={(e) => setMaxConn(+e.target.value)} style={{ cursor: "pointer" }}>
            <option value={0}>Direct only</option>
            <option value={1}>1 stop</option>
            <option value={2}>2 stops</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Max duration (h)</label>
          <input className="bf-input" type="number" min={5} max={36} value={maxDur} onChange={(e) => setMaxDur(+e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Markup %</label>
          <input className="bf-input" type="number" min={0} max={50} step={0.5} value={markup} onChange={(e) => setMarkup(+e.target.value)} />
        </div>
      </div>

      <button className="btn-primary" type="submit" disabled={loading} style={{ width: "100%", fontSize: 15, marginTop: 4 }}>
        {loading ? "Scanning routes…" : "Find loopholes →"}
      </button>
    </form>
  );
}

/* 10-day date strip */
function DateStrip({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const days: string[] = [];
  const base = new Date(from || new Date());
  for (let i = 0; i < DATE_RANGE_DAYS; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {days.map((d) => {
          const isFrom = d === from;
          const isTo = d === to;
          const inRange = d >= from && d <= to;
          const label = new Date(d + "T12:00:00").toLocaleDateString("en", { month: "short", day: "numeric" });
          return (
            <button
              key={d}
              type="button"
              onClick={() => {
                if (!from || (from && to)) {
                  onChange(d, "");
                } else if (d < from) {
                  onChange(d, from);
                } else {
                  onChange(from, d);
                }
              }}
              style={{
                minWidth: 54,
                padding: "8px 4px",
                borderRadius: 8,
                border: `1px solid ${isFrom || isTo ? "var(--green)" : inRange ? "var(--border-bright)" : "var(--border)"}`,
                background: isFrom || isTo ? "var(--green-bg)" : inRange ? "rgba(255,255,255,0.02)" : "var(--bg-elevated)",
                color: isFrom || isTo ? "var(--green)" : inRange ? "var(--text)" : "var(--muted2)",
                fontSize: 11,
                fontFamily: "var(--mono)",
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="bf-input"
          type="date"
          value={from}
          onChange={(e) => onChange(e.target.value, to)}
          style={{ fontSize: 12 }}
        />
        <span style={{ color: "var(--muted)", alignSelf: "center", fontSize: 12 }}>→</span>
        <input
          className="bf-input"
          type="date"
          value={to}
          onChange={(e) => onChange(from, e.target.value)}
          style={{ fontSize: 12 }}
        />
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--muted2)",
  letterSpacing: 0.8,
  textTransform: "uppercase",
  marginBottom: 8,
  fontFamily: "var(--mono)",
};

const hintStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--muted)",
  marginTop: 5,
};
