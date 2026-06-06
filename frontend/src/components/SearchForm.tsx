import { useState } from "react";
import type { SearchPayload } from "../api/search";
import { AirportTagInput } from "./AirportTagInput";

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

const MAX_COMBOS = 50;

export function SearchForm({ onSubmit, loading }: Props) {
  const [originCodes, setOriginCodes] = useState<string[]>(["GRU", "BSB"]);
  const [destCodes, setDestCodes] = useState<string[]>(["BCN", "PRG", "VIE"]);
  const [hubs, setHubs] = useState<string[]>(["MAD", "LIS"]);
  const [dateFrom, setDateFrom] = useState(todayPlus(30));
  const [dateTo, setDateTo] = useState(todayPlus(33));
  const [maxConn, setMaxConn] = useState(1);
  const [maxDur, setMaxDur] = useState(20);
  const [markup, setMarkup] = useState(0);

  const days = dateFrom && dateTo ? Math.max(1, Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1) : 1;
  const longhaulSearches = originCodes.length * hubs.length * days;
  const intraeUSearches = hubs.length * destCodes.length * days;
  const totalSearches = longhaulSearches + intraeUSearches;
  const overLimit = totalSearches > MAX_COMBOS || destCodes.length > 5;

  function toggleHub(hub: string) {
    setHubs((prev) =>
      prev.includes(hub) ? prev.filter((h) => h !== hub) : [...prev, hub]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (overLimit || originCodes.length === 0 || destCodes.length === 0) return;
    onSubmit({
      origins: originCodes,
      destinations: destCodes,
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
      <div className="bf-form-2col">
        <AirportTagInput
          label="Origens"
          hint="máx 2 aeroportos"
          value={originCodes}
          onChange={setOriginCodes}
          max={2}
          placeholder="São Paulo, Brasília…"
        />
        <AirportTagInput
          label="Destinos"
          hint="máx 5 aeroportos"
          value={destCodes}
          onChange={setDestCodes}
          max={5}
          placeholder="Barcelona, Praga…"
        />
      </div>

      {/* Hubs */}
      <div>
        <label style={labelStyle}>Hubs Transatlânticos</label>
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
        <span style={hintStyle}>escalas de conexão transatlântica</span>
      </div>

      {/* Date range */}
      <div>
        <label style={labelStyle}>Janela de Datas</label>
        <DateStrip
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
        />
      </div>

      {/* Advanced row */}
      <div className="bf-form-3col">
        <div>
          <label style={labelStyle}>Máx. escalas</label>
          <select className="bf-input" value={maxConn} onChange={(e) => setMaxConn(+e.target.value)} style={{ cursor: "pointer" }}>
            <option value={0}>Direto</option>
            <option value={1}>1 escala</option>
            <option value={2}>2 escalas</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Duração máx (h)</label>
          <input className="bf-input" type="number" min={5} max={36} value={maxDur} onChange={(e) => setMaxDur(+e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Markup %</label>
          <input className="bf-input" type="number" min={0} max={50} step={0.5} value={markup} onChange={(e) => setMarkup(+e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)", color: overLimit ? "var(--crimson)" : "var(--ink-3)", marginTop: 4, gap: 8 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {originCodes.length} ori · {hubs.length} hub · {destCodes.length} dest · {days} dias
        </span>
        <span style={{ flexShrink: 0 }}>
          <strong style={{ color: overLimit ? "var(--crimson)" : "var(--green)" }}>{totalSearches}</strong>/{MAX_COMBOS} buscas
        </span>
      </div>

      <button
        className="btn-primary"
        type="submit"
        disabled={loading || overLimit || originCodes.length === 0 || destCodes.length === 0}
        style={{ width: "100%", fontSize: 15, opacity: (overLimit || originCodes.length === 0 || destCodes.length === 0) ? 0.5 : 1 }}
      >
        {loading ? "Scanning routes…" : overLimit ? "Reduza destinos ou datas →" : "Find loopholes →"}
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
      <div className="bf-date-strip" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
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
