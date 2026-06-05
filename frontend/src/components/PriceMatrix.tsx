import { useState, useMemo, useCallback, useRef } from "react";
import type { Matrix, MatrixEntry } from "../api/search";

// ── City name lookup ──────────────────────────────────────────────────────────
const CITY_NAMES: Record<string, string> = {
  GRU: "São Paulo", GIG: "Rio de Janeiro", BSB: "Brasília", SSA: "Salvador",
  FOR: "Fortaleza", REC: "Recife", POA: "Porto Alegre", CWB: "Curitiba",
  MAD: "Madrid", LIS: "Lisbon", LHR: "London", CDG: "Paris",
  AMS: "Amsterdam", FCO: "Rome", BCN: "Barcelona", FRA: "Frankfurt",
  MXP: "Milan", ZRH: "Zurich", VIE: "Vienna", CPH: "Copenhagen",
  ARN: "Stockholm", HEL: "Helsinki", OSL: "Oslo", BRU: "Brussels",
  DUB: "Dublin", ATH: "Athens", WAW: "Warsaw", PRG: "Prague",
  BUD: "Budapest", OPO: "Porto", SVQ: "Seville", MRS: "Marseille",
  NCE: "Nice", LYS: "Lyon", DUS: "Düsseldorf", HAM: "Hamburg",
  MUC: "Munich", ORY: "Paris Orly", LGW: "London Gatwick",
};

function cityName(iata: string): string {
  return CITY_NAMES[iata] ?? iata;
}

// ── Duration formatter ────────────────────────────────────────────────────────
function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// ── Price formatter ───────────────────────────────────────────────────────────
function fmtPrice(value: number): string {
  return "R$" + Math.round(value).toLocaleString("pt-BR");
}

// ── Heat color (6-stop ramp) ──────────────────────────────────────────────────
const HEAT_STOPS = [
  [0x00, 0xFF, 0x88], // #00FF88
  [0x7C, 0xF0, 0x6B], // #7CF06B
  [0xD6, 0xE8, 0x4F], // #D6E84F
  [0xFF, 0xC8, 0x3D], // #FFC83D
  [0xFF, 0x8A, 0x4D], // #FF8A4D
  [0xFF, 0x4D, 0x63], // #FF4D63
];

function heatRgb(ratio: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, ratio));
  const scaled = clamped * (HEAT_STOPS.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(lo + 1, HEAT_STOPS.length - 1);
  const t = scaled - lo;
  const a = HEAT_STOPS[lo];
  const b = HEAT_STOPS[hi];
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function heatColor(ratio: number, alpha = 1): string {
  const [r, g, b] = heatRgb(ratio);
  return `rgba(${r},${g},${b},${alpha})`;
}

function heatHex(ratio: number): string {
  const [r, g, b] = heatRgb(ratio);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Shared data types ─────────────────────────────────────────────────────────
export interface ShareData {
  origin: string;
  dest: string;
  date: string;
  total: number;
  hub: string;
  lhAirline: string;
  euAirline: string;
  lhPrice: number;
  euPrice: number;
  currency: string;
}

interface CellInfo {
  entry: MatrixEntry;
  dest: string;
  date: string;
  origin: string;
  ratio: number;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  matrix: Matrix;
  origin: string;
  onShare?: (cell: ShareData) => void;
}

// ── Book helper ───────────────────────────────────────────────────────────────
function bookCombo(origin: string, hub: string, dest: string) {
  window.open(`https://www.google.com/travel/flights?q=${origin}+to+${hub}`, "_blank");
  window.open(`https://www.google.com/travel/flights?q=${hub}+to+${dest}`, "_blank");
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
interface TooltipState {
  cell: CellInfo;
  x: number;
  y: number;
}

function HoverTooltip({ state, origin }: { state: TooltipState; origin: string }) {
  const { cell, x, y } = state;
  const { entry, dest, date } = cell;
  const hub = entry.hub;
  const hubCity = cityName(hub);
  const destCity = cityName(dest);

  return (
    <div
      style={{
        position: "fixed",
        left: x + 16,
        top: y + 16,
        width: 260,
        zIndex: 2000,
        background: "var(--surface-2)",
        border: "1px solid var(--green)",
        borderRadius: "var(--r-md)",
        padding: "14px 16px",
        fontFamily: "var(--mono)",
        fontSize: 12,
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
        pointerEvents: "none",
        animation: "fade-in 0.12s ease",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, alignItems: "flex-start" }}>
        <span style={{ color: "var(--ink)", fontWeight: 600, fontSize: 13 }}>
          {origin} → {dest}
        </span>
        <span style={{ color: "var(--ink-3)", fontSize: 11 }}>via {hubCity}</span>
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--line)", marginBottom: 10 }} />

      {/* Leg 1 */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: "var(--ink-2)" }}>
          <span style={{ color: "var(--ink-3)" }}>① </span>
          {origin}→{hub} · {entry.longhaul_airline || "—"} · {fmtDuration(entry.longhaul_duration_minutes)}
        </span>
        <span style={{ color: "var(--ink)" }}>{fmtPrice(entry.longhaul_price)}</span>
      </div>

      {/* Leg 2 */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ color: "var(--ink-2)" }}>
          <span style={{ color: "var(--ink-3)" }}>② </span>
          {hub}→{dest} · {entry.intraeu_airline || "—"} · {fmtDuration(entry.intraeu_duration_minutes)}
        </span>
        <span style={{ color: "var(--ink)" }}>{fmtPrice(entry.intraeu_price)}</span>
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--line)", marginBottom: 10 }} />

      {/* Total */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ color: "var(--ink-3)" }}>total</span>
        <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 14 }}>{fmtPrice(entry.total_price)}</span>
      </div>

      {/* CTA hint */}
      <div style={{ color: "var(--ink-3)", fontSize: 10, textAlign: "center" }}>
        click → opens both legs in 2 tabs ↗
      </div>
    </div>
  );
}

// ── Matrix cell ───────────────────────────────────────────────────────────────
function MatrixCell({
  entry,
  dest,
  date,
  origin,
  ratio,
  isMin,
  onHover,
  onClick,
}: {
  entry: MatrixEntry | undefined;
  dest: string;
  date: string;
  origin: string;
  ratio: number;
  isMin: boolean;
  onHover: (cell: CellInfo | null, x: number, y: number) => void;
  onClick: (cell: CellInfo) => void;
}) {
  const hub = entry?.hub ?? "";

  if (!entry) {
    return (
      <td
        style={{
          height: 68,
          minWidth: 96,
          border: "1px solid var(--line)",
          borderRadius: 9,
          textAlign: "center",
          verticalAlign: "middle",
          color: "var(--ink-3)",
          fontSize: 16,
          cursor: "default",
        }}
      >
        ·
      </td>
    );
  }

  const bgColor = heatColor(ratio, 0.16);
  const fgColor = heatHex(ratio);
  const minStyle = isMin
    ? {
        border: `1.5px solid var(--green)`,
        boxShadow: "0 0 0 1px var(--green), 0 0 24px -4px var(--green-glow)",
      }
    : { border: "1px solid var(--line)" };

  return (
    <td
      style={{
        height: 68,
        minWidth: 96,
        background: bgColor,
        borderRadius: 9,
        textAlign: "center",
        verticalAlign: "middle",
        position: "relative",
        cursor: "pointer",
        transition: "filter 0.15s ease",
        padding: "6px 8px",
        ...minStyle,
      }}
      onMouseEnter={(e) => {
        onHover({ entry, dest, date, origin, ratio }, e.clientX, e.clientY);
      }}
      onMouseMove={(e) => {
        onHover({ entry, dest, date, origin, ratio }, e.clientX, e.clientY);
      }}
      onMouseLeave={() => onHover(null, 0, 0)}
      onClick={() => onClick({ entry, dest, date, origin, ratio })}
    >
      {/* Crown above best cell */}
      {isMin && (
        <div style={{
          position: "absolute",
          top: -18,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 14,
          lineHeight: 1,
        }}>
          👑
        </div>
      )}

      {/* SPLIT badge */}
      <div style={{
        position: "absolute",
        top: 4,
        right: 5,
        fontSize: 8,
        fontFamily: "var(--mono)",
        color: fgColor,
        opacity: 0.7,
        letterSpacing: 0.3,
        lineHeight: 1,
      }}>
        SPLIT
      </div>

      {/* Price */}
      <div style={{
        fontFamily: "var(--mono)",
        fontSize: 13,
        fontWeight: 700,
        color: fgColor,
        lineHeight: 1.2,
      }}>
        {fmtPrice(entry.total_price)}
      </div>

      {/* Via hub */}
      <div style={{
        fontFamily: "var(--mono)",
        fontSize: 9,
        color: fgColor,
        opacity: 0.65,
        marginTop: 3,
        lineHeight: 1,
      }}>
        via {hub}
      </div>
    </td>
  );
}

// ── Best Deal Callout ─────────────────────────────────────────────────────────
function BestDealCallout({
  cell,
  onShare,
}: {
  cell: CellInfo;
  onShare?: (data: ShareData) => void;
}) {
  const { entry, dest, date, origin } = cell;
  const hub = entry.hub;
  const destCity = cityName(dest);
  const hubCity = cityName(hub);

  const shareData: ShareData = {
    origin,
    dest,
    date,
    total: entry.total_price,
    hub,
    lhAirline: entry.longhaul_airline,
    euAirline: entry.intraeu_airline,
    lhPrice: entry.longhaul_price,
    euPrice: entry.intraeu_price,
    currency: entry.currency,
  };

  return (
    <div style={{
      marginTop: 32,
      border: "1px solid var(--green)",
      borderRadius: "var(--r-lg)",
      background: "linear-gradient(135deg, rgba(0,255,136,0.06) 0%, rgba(0,255,136,0.02) 100%)",
      padding: "20px 24px",
      display: "flex",
      alignItems: "center",
      gap: 20,
      flexWrap: "wrap",
    }}>
      {/* Crown + label */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--green)", fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
          👑 CHEAPEST TRIP FOUND
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
          {origin} → {destCity} · {date}
        </div>
        <div style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--ink-2)" }}>
          via {hubCity} · {entry.longhaul_airline || "—"} + {entry.intraeu_airline || "—"}
        </div>
      </div>

      {/* Price */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 28, fontFamily: "var(--mono)", fontWeight: 700, color: "var(--green)" }}>
          {fmtPrice(entry.total_price)}
        </div>

        {onShare && (
          <button
            onClick={() => onShare(shareData)}
            style={{
              background: "transparent",
              border: "1px solid var(--line-2)",
              borderRadius: "var(--r-sm)",
              color: "var(--ink-2)",
              fontFamily: "var(--font)",
              fontSize: 13,
              padding: "8px 14px",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--green)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--green)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--line-2)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--ink-2)";
            }}
          >
            Share deal ↗
          </button>
        )}

        <button
          onClick={() => bookCombo(origin, hub, dest)}
          style={{
            background: "var(--green)",
            border: "none",
            borderRadius: "var(--r-sm)",
            color: "var(--on-accent)",
            fontFamily: "var(--font)",
            fontSize: 13,
            fontWeight: 700,
            padding: "8px 16px",
            cursor: "pointer",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.85"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
        >
          Book this combo
        </button>
      </div>
    </div>
  );
}

// ── Heat bar (14 segments) ────────────────────────────────────────────────────
function HeatBar({ filledRatio }: { filledRatio: number }) {
  const segments = 14;
  const filled = Math.round(filledRatio * segments);
  return (
    <div style={{ display: "flex", gap: 3, margin: "12px 0" }}>
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            background: i < filled ? heatHex(i / (segments - 1)) : "rgba(255,255,255,0.08)",
          }}
        />
      ))}
    </div>
  );
}

// ── Share Card Modal ──────────────────────────────────────────────────────────
function ShareCardModal({
  data,
  onClose,
}: {
  data: ShareData;
  onClose: () => void;
}) {
  const destCity = cityName(data.dest);
  const hubCity = cityName(data.hub);

  // saving ratio: assume worst case is 1.5x total for heat bar
  const savingRatio = Math.min(1, (data.lhPrice + data.euPrice) / (data.total * 1.5));
  const filledRatio = 1 - savingRatio; // more filled = cheaper

  const waText = encodeURIComponent(
    `✈ Split-ticket deal via BestFly!\n${data.origin} → ${destCity} em ${data.date}\nvia ${hubCity} · ${data.lhAirline} + ${data.euAirline}\n${fmtPrice(data.total)}\nbestfly.day`
  );

  function copyLink() {
    navigator.clipboard.writeText(window.location.href).catch(() => {});
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 3000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "fade-in 0.2s ease",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        {/* 9:16 card */}
        <div style={{
          width: 320,
          height: 568,
          background: "var(--surface)",
          border: "1px solid var(--green)",
          borderRadius: "var(--r-lg)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Glow bg */}
          <div style={{
            position: "absolute",
            top: -60,
            right: -60,
            width: 200,
            height: 200,
            background: "radial-gradient(circle, rgba(0,255,136,0.12) 0%, transparent 70%)",
            pointerEvents: "none",
          }} />

          {/* Top row: logo + badge */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
            <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 15, color: "var(--green)" }}>
              bestfly<span style={{ color: "var(--ink-3)" }}>.day</span>
            </div>
            <div style={{
              fontFamily: "var(--mono)",
              fontSize: 9,
              fontWeight: 700,
              background: "rgba(0,255,136,0.15)",
              border: "1px solid var(--green)",
              borderRadius: 4,
              padding: "3px 7px",
              color: "var(--green)",
              letterSpacing: 0.8,
            }}>
              SPLIT-TICKET
            </div>
          </div>

          {/* Route */}
          <div style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-2)", marginBottom: 6 }}>
            {data.origin} → {data.dest} · {data.date}
          </div>

          {/* Destination city */}
          <div style={{ fontFamily: "var(--font)", fontSize: 36, fontWeight: 700, color: "var(--ink)", lineHeight: 1.1, marginBottom: 12 }}>
            {destCity}
          </div>

          {/* Price */}
          <div style={{ fontFamily: "var(--mono)", fontSize: 42, fontWeight: 700, color: "var(--green)", lineHeight: 1, marginBottom: 4 }}>
            {fmtPrice(data.total)}
          </div>

          {/* Heat bar */}
          <HeatBar filledRatio={filledRatio} />

          {/* Savings info */}
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-2)", marginBottom: 8 }}>
            via {hubCity}
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)" }}>
            {data.lhAirline} + {data.euAirline}
          </div>

          {/* Footer */}
          <div style={{ marginTop: "auto", fontFamily: "var(--mono)", fontSize: 12, color: "var(--ink-3)", textAlign: "center" }}>
            bestfly.day
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10 }}>
          <a
            href={`https://wa.me/?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              background: "#25D366",
              color: "#fff",
              fontFamily: "var(--font)",
              fontWeight: 700,
              fontSize: 13,
              padding: "10px 20px",
              borderRadius: "var(--r-sm)",
              textDecoration: "none",
            }}
          >
            WhatsApp
          </a>
          <button
            onClick={copyLink}
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--line-2)",
              color: "var(--ink-2)",
              fontFamily: "var(--font)",
              fontSize: 13,
              padding: "10px 20px",
              borderRadius: "var(--r-sm)",
              cursor: "pointer",
            }}
          >
            Copy link
          </button>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--line)",
              color: "var(--ink-3)",
              fontFamily: "var(--font)",
              fontSize: 13,
              padding: "10px 16px",
              borderRadius: "var(--r-sm)",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PriceMatrix (main export) ─────────────────────────────────────────────────
export function PriceMatrix({ matrix, origin, onShare }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);

  const destData = matrix[origin];
  if (!destData) {
    return (
      <p style={{ color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
        No data for {origin}
      </p>
    );
  }

  const destinations = Object.keys(destData);
  const dates = useMemo(() => {
    const all = new Set<string>();
    destinations.forEach((d) => Object.keys(destData[d]).forEach((dt) => all.add(dt)));
    return [...all].sort();
  }, [destData, destinations]);

  // Compute min/max for heat ratio
  const allPrices = useMemo(
    () =>
      destinations
        .flatMap((d) => dates.map((dt) => destData[d][dt]?.total_price))
        .filter((p): p is number => p !== undefined),
    [destData, destinations, dates]
  );
  const minP = allPrices.length ? Math.min(...allPrices) : 0;
  const maxP = allPrices.length ? Math.max(...allPrices) : 1;
  const priceRange = maxP - minP || 1;

  function ratio(price: number): number {
    return (price - minP) / priceRange;
  }

  // Find best cell (min price)
  const bestCell = useMemo<CellInfo | null>(() => {
    let best: CellInfo | null = null;
    for (const dest of destinations) {
      for (const date of dates) {
        const entry = destData[dest]?.[date];
        if (!entry) continue;
        if (!best || entry.total_price < best.entry.total_price) {
          best = { entry, dest, date, origin, ratio: ratio(entry.total_price) };
        }
      }
    }
    return best;
  }, [destData, destinations, dates, minP, priceRange]);

  const handleHover = useCallback(
    (cell: CellInfo | null, x: number, y: number) => {
      setTooltip(cell ? { cell, x, y } : null);
    },
    []
  );

  const handleCellClick = useCallback(
    (cell: CellInfo) => {
      bookCombo(origin, cell.entry.hub, cell.dest);
    },
    [origin]
  );

  const handleShare = useCallback(
    (data: ShareData) => {
      setShareData(data);
      onShare?.(data);
    },
    [onShare]
  );

  return (
    <div style={{ position: "relative" }}>
      {/* Legend row */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
          {allPrices.length} routes · {origin}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--mono)" }}>
          <div style={{ width: 56, height: 5, borderRadius: 3, background: `linear-gradient(to right, ${heatHex(0)}, ${heatHex(0.5)}, ${heatHex(1)})` }} />
          <span>cheap → expensive</span>
        </div>
        {bestCell && (
          <span style={{ fontSize: 11, color: "var(--green)", fontFamily: "var(--mono)" }}>
            👑 best: {fmtPrice(bestCell.entry.total_price)}
          </span>
        )}
      </div>

      {/* Matrix scroll wrapper */}
      <div className="matrix-scroll">
        <table style={{ borderCollapse: "separate", borderSpacing: "4px", fontFamily: "var(--mono)", fontSize: 12 }}>
          <thead>
            <tr>
              {/* Sticky destination header */}
              <th style={{
                position: "sticky",
                left: 0,
                background: "var(--bg)",
                zIndex: 4,
                textAlign: "left",
                padding: "6px 12px 6px 0",
                color: "var(--ink-3)",
                fontWeight: 400,
                fontSize: 11,
                letterSpacing: 0.5,
                whiteSpace: "nowrap",
                borderBottom: "1px solid var(--line)",
              }}>
                DESTINATION
              </th>

              {dates.map((d) => (
                <th key={d} style={{
                  padding: "6px 8px",
                  color: "var(--ink-2)",
                  fontWeight: 400,
                  fontSize: 11,
                  letterSpacing: 0.3,
                  whiteSpace: "nowrap",
                  textAlign: "center",
                  borderBottom: "1px solid var(--line)",
                  minWidth: 96,
                }}>
                  {new Date(d + "T12:00").toLocaleDateString("pt-BR", { month: "short", day: "numeric" })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {destinations.map((dest) => {
              const city = cityName(dest);
              return (
                <tr key={dest}>
                  {/* Sticky dest label */}
                  <td style={{
                    position: "sticky",
                    left: 0,
                    background: "var(--bg)",
                    zIndex: 2,
                    padding: "4px 12px 4px 0",
                    whiteSpace: "nowrap",
                    borderRight: "1px solid var(--line)",
                    verticalAlign: "middle",
                  }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13 }}>{city}</div>
                    <div style={{ color: "var(--ink-3)", fontSize: 10, marginTop: 2 }}>{dest}</div>
                  </td>

                  {dates.map((d) => {
                    const entry = destData[dest]?.[d];
                    const isMin = entry?.total_price === minP && allPrices.length > 0;
                    return (
                      <MatrixCell
                        key={d}
                        entry={entry}
                        dest={dest}
                        date={d}
                        origin={origin}
                        ratio={entry ? ratio(entry.total_price) : 0}
                        isMin={!!isMin}
                        onHover={handleHover}
                        onClick={handleCellClick}
                      />
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Best Deal Callout */}
      {bestCell && (
        <BestDealCallout cell={bestCell} onShare={handleShare} />
      )}

      {/* Hover tooltip */}
      {tooltip && <HoverTooltip state={tooltip} origin={origin} />}

      {/* Share Card Modal */}
      {shareData && (
        <ShareCardModal data={shareData} onClose={() => setShareData(null)} />
      )}
    </div>
  );
}
