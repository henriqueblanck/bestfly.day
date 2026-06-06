import { useState } from "react";
import type { SearchPayload } from "../api/search";
import { AirportTagInput } from "./AirportTagInput";

interface Props {
  onSubmit: (p: SearchPayload) => void;
  loading: boolean;
}

const DATE_RANGE_DAYS = 10;
const INTERNAL_HUBS = 8; // MAD, LIS, CDG, FRA, LHR, AMS, MUC, IST
const MAX_COMBOS = 200;

function todayPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function SearchForm({ onSubmit, loading }: Props) {
  const [originCodes, setOriginCodes] = useState<string[]>(["GRU", "BSB"]);
  const [destCodes, setDestCodes] = useState<string[]>(["BCN", "PRG", "VIE"]);
  const [tripType, setTripType] = useState<"oneway" | "roundtrip">("oneway");
  const [dateFrom, setDateFrom] = useState(todayPlus(30));
  const [dateTo, setDateTo] = useState(todayPlus(33));
  const [retDateFrom, setRetDateFrom] = useState(todayPlus(44));
  const [retDateTo, setRetDateTo] = useState(todayPlus(45));
  const [maxConn, setMaxConn] = useState(1);
  const [maxDur, setMaxDur] = useState(36);
  const [markup, setMarkup] = useState(0);

  const outDays = dateFrom && dateTo
    ? Math.max(1, Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1)
    : 1;
  const retDays = tripType === "roundtrip" && retDateFrom && retDateTo
    ? Math.max(1, Math.round((new Date(retDateTo).getTime() - new Date(retDateFrom).getTime()) / 86400000) + 1)
    : 0;
  const totalDays = outDays + retDays;

  // (H*(origins+dests) + origins*dests) * total_days
  const searchesPerDay = INTERNAL_HUBS * (originCodes.length + destCodes.length) + originCodes.length * destCodes.length;
  const totalSearches = searchesPerDay * totalDays;
  const overLimit = totalSearches > MAX_COMBOS || destCodes.length > 5;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (overLimit || originCodes.length === 0 || destCodes.length === 0) return;
    const payload: SearchPayload = {
      origins: originCodes,
      destinations: destCodes,
      date_from: dateFrom,
      date_to: dateTo,
      trip_type: tripType,
      max_connections: maxConn,
      max_duration_hours: maxDur,
      markup_percent: markup,
    };
    if (tripType === "roundtrip") {
      payload.return_date_from = retDateFrom;
      payload.return_date_to = retDateTo;
    }
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Trip type toggle */}
      <div style={{ display: "flex", gap: 6 }}>
        {(["oneway", "roundtrip"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`chip ${tripType === t ? "active" : ""}`}
            onClick={() => setTripType(t)}
          >
            {t === "oneway" ? "Só ida" : "Ida e volta"}
          </button>
        ))}
      </div>

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

      {/* Outbound dates */}
      <div>
        <label style={labelStyle}>{tripType === "roundtrip" ? "Ida — " : ""}Janela de Datas</label>
        <DateStrip
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => { setDateFrom(f); setDateTo(t); }}
        />
      </div>

      {/* Return dates (roundtrip only) */}
      {tripType === "roundtrip" && (
        <div>
          <label style={labelStyle}>Volta — Janela de Datas</label>
          <DateStrip
            from={retDateFrom}
            to={retDateTo}
            onChange={(f, t) => { setRetDateFrom(f); setRetDateTo(t); }}
          />
        </div>
      )}

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
          <input className="bf-input" type="number" min={10} max={48} value={maxDur} onChange={(e) => setMaxDur(+e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Markup %</label>
          <input className="bf-input" type="number" min={0} max={50} step={0.5} value={markup} onChange={(e) => setMarkup(+e.target.value)} />
        </div>
      </div>

      {/* Hubs info (read-only) */}
      <div style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--muted)", background: "var(--bg-elevated)", borderRadius: 6, padding: "6px 10px" }}>
        hubs automáticos: MAD · LIS · CDG · FRA · LHR · AMS · MUC · IST + voo direto
      </div>

      {/* Counter */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, fontFamily: "var(--mono)", color: overLimit ? "var(--crimson)" : "var(--ink-3)", marginTop: 4, gap: 8 }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {originCodes.length} ori · {destCodes.length} dest · {totalDays} dias{tripType === "roundtrip" ? " (ida+volta)" : ""}
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
