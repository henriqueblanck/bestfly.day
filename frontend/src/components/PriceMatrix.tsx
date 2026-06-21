import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Matrix, MatrixEntry } from "../api/search";
import { makeGoogleFlightsUrl } from "../utils/googleFlights";

// ── Pexels image cache ────────────────────────────────────────────────────────
const PEXELS_KEY = "Wt96SoNgVA9bTKDX78tq10oQcOKmTKjNSMcJweThmD0YPMji68xDmiGi";
const imageCache = new Map<string, string[]>();

async function fetchCityImages(city: string): Promise<string[]> {
  if (imageCache.has(city)) return imageCache.get(city)!;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(city + " city travel")}&per_page=3&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    const data = await res.json();
    const urls: string[] = (data.photos ?? []).map((p: { src: { medium: string } }) => p.src.medium);
    imageCache.set(city, urls);
    return urls;
  } catch {
    imageCache.set(city, []);
    return [];
  }
}

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
  IST: "Istanbul", DOH: "Doha", DXB: "Dubai", AUH: "Abu Dhabi",
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

// ── Heat color (6-stop ramp, theme-aware) ────────────────────────────────────
const HEAT_STOPS_BY_THEME: Record<string, number[][]> = {
  terminal: [[0,255,136],[124,240,107],[214,232,79],[255,200,61],[255,138,77],[255,77,99]],
  dark:     [[0,255,136],[124,240,107],[214,232,79],[255,200,61],[255,138,77],[255,77,99]],
  mint:     [[47,227,163],[120,224,150],[214,224,100],[255,203,87],[255,140,90],[255,101,133]],
  lime:     [[205,255,74],[214,232,79],[255,210,61],[255,170,60],[255,120,70],[255,107,90]],
  cyan:     [[56,225,255],[80,220,200],[170,220,110],[255,200,77],[255,140,90],[255,92,138]],
  cream:    [[31,168,100],[120,180,70],[224,169,46],[226,140,50],[214,90,70],[208,52,75]],
};

function getHeatStops(): number[][] {
  const t = document.documentElement.getAttribute("data-theme") || "terminal";
  return HEAT_STOPS_BY_THEME[t] ?? HEAT_STOPS_BY_THEME.terminal;
}

function heatRgb(ratio: number): [number, number, number] {
  const stops = getHeatStops();
  const clamped = Math.max(0, Math.min(1, ratio));
  const scaled = clamped * (stops.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(lo + 1, stops.length - 1);
  const t = scaled - lo;
  const a = stops[lo];
  const b = stops[hi];
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

// ── Pin selection type ────────────────────────────────────────────────────────
export interface PinnedLeg {
  price: number;
  dest: string;
  date: string;
  hub: string;
  airline: string;
  origin: string;
  direct_price: number | null;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  matrix: Matrix;
  origin: string;
  onShare?: (cell: ShareData) => void;
  onPin?: (leg: PinnedLeg) => void;
  pinnedDate?: string; // highlight pinned date
}

// ── Book helper ───────────────────────────────────────────────────────────────
function openBothLegs(origin: string, hub: string, dest: string, date: string) {
  window.open(makeGoogleFlightsUrl(origin, hub, date), "_blank");
  window.open(makeGoogleFlightsUrl(hub, dest, date), "_blank");
}

// ── Self-transfer warning ─────────────────────────────────────────────────────
function BookOverlay({
  origin, hub, dest,
  onConfirm, onCancel,
}: {
  origin: string; hub: string; dest: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  const hubCity = cityName(hub);
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 4000,
        background: "rgba(0,0,0,0.78)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fade-in 0.15s ease",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: "100%", maxWidth: 400,
        background: "var(--surface)",
        border: "1px solid var(--amber)",
        borderRadius: "var(--r-lg)",
        padding: "24px 24px 20px",
        fontFamily: "var(--font)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              Você vai comprar 2 bilhetes separados
            </div>
            <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)", marginTop: 2 }}>
              {origin} → {hub} + {hub} → {dest}
            </div>
          </div>
        </div>

        {/* Warnings */}
        <div style={{
          background: "rgba(255,200,61,0.08)",
          border: "1px solid rgba(255,200,61,0.25)",
          borderRadius: "var(--r-md)",
          padding: "12px 14px",
          marginBottom: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: 13,
          color: "var(--ink-2)",
          lineHeight: 1.5,
        }}>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ flexShrink: 0 }}>✈</span>
            <span>Se o primeiro voo atrasar, a <strong style={{ color: "var(--ink)" }}>segunda cia não vai esperar</strong> — você perderá esse bilhete.</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ flexShrink: 0 }}>⏱</span>
            <span>Escolha uma janela de <strong style={{ color: "var(--ink)" }}>mínimo 3h de layover</strong> em {hubCity}.</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ flexShrink: 0 }}>🛡</span>
            <span>Considere seguro viagem com <strong style={{ color: "var(--ink)" }}>cobertura de voo perdido</strong>.</span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid var(--line-2)",
              borderRadius: "var(--r-sm)",
              color: "var(--ink-3)",
              fontFamily: "var(--font)",
              fontSize: 13,
              padding: "10px 0",
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 2,
              background: "var(--green)",
              border: "none",
              borderRadius: "var(--r-sm)",
              color: "var(--on-accent)",
              fontFamily: "var(--font)",
              fontSize: 13,
              fontWeight: 700,
              padding: "10px 0",
              cursor: "pointer",
            }}
          >
            Entendi, abrir os dois voos →
          </button>
        </div>
      </div>
    </div>
  );
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

  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    setImages([]);
    fetchCityImages(destCity).then(setImages);
  }, [destCity]);

  return (
    <div
      style={{
        position: "fixed",
        left: x + 16,
        top: y + 16,
        width: 280,
        zIndex: 2000,
        background: "var(--surface-2)",
        border: "1px solid var(--green)",
        borderRadius: "var(--r-md)",
        overflow: "hidden",
        fontFamily: "var(--mono)",
        fontSize: 12,
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
        pointerEvents: "none",
        animation: "fade-in 0.12s ease",
      }}
    >
      {/* City images strip */}
      {images.length > 0 ? (
        <div style={{ display: "flex", height: 90, gap: 1 }}>
          {images.map((url, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                backgroundImage: `url(${url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          ))}
        </div>
      ) : (
        <div style={{
          height: 90,
          background: "linear-gradient(135deg, rgba(0,255,136,0.08) 0%, rgba(0,0,0,0) 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          opacity: 0.3,
        }}>
          ✈
        </div>
      )}

      {/* Content below images */}
      <div style={{ padding: "12px 14px" }}>

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

      {/* Historical context */}
      {entry.hist_avg != null && entry.hist_obs >= 1 && (
        <>
          <div style={{ borderTop: "1px solid var(--line)", marginBottom: 10, marginTop: 10 }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "var(--ink-3)", fontSize: 11 }}>
              média histórica ({entry.hist_obs}x)
              {entry.trend === "up" ? " ↑" : entry.trend === "down" ? " ↓" : ""}
            </span>
            <span style={{ color: "var(--ink-2)", fontSize: 11 }}>{fmtPrice(entry.hist_avg)}</span>
          </div>
          {entry.deal_pct != null && entry.deal_pct >= 5 && (
            <div style={{ textAlign: "right", fontSize: 10, color: "var(--green)" }}>
              {Math.round(entry.deal_pct)}% abaixo da média
            </div>
          )}
          {entry.deal_pct != null && entry.deal_pct <= -5 && (
            <div style={{ textAlign: "right", fontSize: 10, color: "var(--crimson)" }}>
              {Math.round(-entry.deal_pct)}% acima da média
            </div>
          )}
        </>
      )}

      {/* When split wins: show direct as strikethrough comparison */}
      {entry.direct_price != null && entry.hub !== "DIRECT" && (
        <>
          <div style={{ borderTop: "1px solid var(--line)", marginBottom: 10 }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "var(--ink-3)", fontSize: 11 }}>Passagem única ({entry.direct_airline || "—"})</span>
            <span style={{ color: "var(--ink-2)", fontSize: 11, textDecoration: "line-through" }}>{fmtPrice(entry.direct_price)}</span>
          </div>
          <div style={{ textAlign: "right", fontSize: 10, color: "var(--green)" }}>
            economia {fmtPrice(entry.direct_price - entry.total_price)} ({Math.round((entry.direct_price - entry.total_price) / entry.direct_price * 100)}%)
          </div>
        </>
      )}

      {/* When direct wins: show split as alternative */}
      {entry.hub === "DIRECT" && entry.split_price != null && entry.split_hub && (
        <>
          <div style={{ borderTop: "1px solid var(--line)", marginBottom: 10 }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ color: "var(--ink-3)", fontSize: 11 }}>Split via {entry.split_hub}</span>
            <span style={{ color: "var(--ink-2)", fontSize: 11 }}>{fmtPrice(entry.split_price)}</span>
          </div>
          <div style={{ textAlign: "right", fontSize: 10, color: "var(--ink-3)" }}>
            passagem única é {fmtPrice(entry.split_price - entry.total_price)} mais barata
          </div>
        </>
      )}

      {/* CTA hint */}
      <div style={{ color: "var(--ink-3)", fontSize: 10, textAlign: "center", marginTop: 8 }}>
        click → ver detalhes e reservar
      </div>

      </div>{/* end content */}
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
  onPin,
  isPinned,
}: {
  entry: MatrixEntry | undefined;
  dest: string;
  date: string;
  origin: string;
  ratio: number;
  isMin: boolean;
  onHover: (cell: CellInfo | null, x: number, y: number) => void;
  onClick: (cell: CellInfo) => void;
  onPin?: (leg: PinnedLeg) => void;
  isPinned?: boolean;
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

      {/* Trend indicator — top-left */}
      {entry.trend && entry.hist_obs >= 1 && (
        <div style={{
          position: "absolute",
          top: 4,
          left: 5,
          fontSize: 8,
          fontFamily: "var(--mono)",
          color: entry.trend === "up" ? "var(--crimson)" : entry.trend === "down" ? "var(--green)" : "var(--muted)",
          opacity: 0.85,
          lineHeight: 1,
        }}>
          {entry.trend === "up" ? "↑" : entry.trend === "down" ? "↓" : "→"}
        </div>
      )}

      {/* Badge: SPLIT or DIRETO */}
      <div style={{
        position: "absolute",
        top: 4,
        right: 5,
        fontSize: 8,
        fontFamily: "var(--mono)",
        color: hub === "DIRECT" ? "rgba(120,180,255,0.9)" : fgColor,
        opacity: 0.8,
        letterSpacing: 0.3,
        lineHeight: 1,
      }}>
        {hub === "DIRECT" ? "DIRETO" : "SPLIT"}
      </div>

      {/* Price */}
      <div style={{
        fontFamily: "var(--mono)",
        fontSize: 13,
        fontWeight: 700,
        color: hub === "DIRECT" ? "rgba(120,180,255,1)" : fgColor,
        lineHeight: 1.2,
      }}>
        {fmtPrice(entry.total_price)}
      </div>

      {/* Via hub or direct savings */}
      {hub !== "DIRECT" ? (
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
      ) : (
        <div style={{
          fontFamily: "var(--mono)",
          fontSize: 9,
          color: "rgba(120,180,255,0.6)",
          marginTop: 3,
          lineHeight: 1,
        }}>
          {entry.direct_airline || "—"}
        </div>
      )}

      {/* Savings badge vs direct */}
      {entry.direct_price != null && hub !== "DIRECT" && entry.direct_price > entry.total_price && (
        <div style={{
          fontFamily: "var(--mono)",
          fontSize: 8,
          color: "var(--green)",
          marginTop: 2,
          lineHeight: 1,
          opacity: 0.85,
        }}>
          -{Math.round((entry.direct_price - entry.total_price) / entry.direct_price * 100)}% vs direto
        </div>
      )}

      {/* Deal badge — historical */}
      {entry.deal_pct != null && entry.deal_pct >= 10 && (
        <div style={{
          fontFamily: "var(--mono)",
          fontSize: 8,
          color: "var(--green)",
          marginTop: 2,
          lineHeight: 1,
          opacity: 0.9,
        }}>
          -{Math.round(entry.deal_pct)}% hist
        </div>
      )}
      {entry.deal_pct != null && entry.deal_pct <= -10 && (
        <div style={{
          fontFamily: "var(--mono)",
          fontSize: 8,
          color: "var(--crimson)",
          marginTop: 2,
          lineHeight: 1,
          opacity: 0.7,
        }}>
          +{Math.round(-entry.deal_pct)}% acima
        </div>
      )}

      {/* Pin button */}
      {onPin && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin({
              price: entry.total_price,
              dest,
              date,
              hub: entry.hub,
              airline: entry.hub === "DIRECT" ? (entry.direct_airline || "—") : `${entry.longhaul_airline}+${entry.intraeu_airline}`,
              origin,
              direct_price: entry.direct_price ?? null,
            });
          }}
          title={isPinned ? "Selecionado" : "Selecionar para cálculo total"}
          style={{
            position: "absolute",
            bottom: 3,
            left: 4,
            background: isPinned ? "var(--green)" : "rgba(255,255,255,0.06)",
            border: `1px solid ${isPinned ? "var(--green)" : "var(--line-2)"}`,
            borderRadius: 4,
            color: isPinned ? "var(--on-accent)" : "var(--ink-3)",
            fontSize: 8,
            padding: "1px 4px",
            cursor: "pointer",
            fontFamily: "var(--mono)",
            lineHeight: 1.4,
            transition: "all 0.15s",
          }}
        >
          {isPinned ? "✓ sel" : "+ sel"}
        </button>
      )}
    </td>
  );
}

// ── Direct flight sub-row ────────────────────────────────────────────────────
function DirectSubRow({
  destData,
  dest,
  dates,
}: {
  destData: Record<string, Record<string, MatrixEntry>>;
  dest: string;
  dates: string[];
}) {
  const hasAny = dates.some((d) => destData[dest]?.[d]?.direct_price != null);
  if (!hasAny) return null;

  function connLabel(n: number): string {
    if (n === 0) return "direto";
    return `${n}x`;
  }

  return (
    <tr>
      {/* Sticky label */}
      <td style={{
        position: "sticky",
        left: 0,
        background: "var(--bg)",
        zIndex: 2,
        padding: "2px 12px 6px 12px",
        whiteSpace: "nowrap",
        borderRight: "1px solid var(--line)",
        verticalAlign: "middle",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--ink-3)", fontSize: 10, fontFamily: "var(--mono)" }}>
          <span style={{ fontSize: 8, opacity: 0.6 }}>▸</span>
          <span style={{ letterSpacing: 0.5 }}>voo direto</span>
        </div>
      </td>

      {dates.map((d) => {
        const entry = destData[dest]?.[d];
        const dp = entry?.direct_price;
        if (dp == null) {
          return (
            <td key={d} style={{
              minWidth: 96,
              padding: "4px 8px",
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 10,
              fontFamily: "var(--mono)",
            }}>
              —
            </td>
          );
        }
        const durMin = entry.direct_duration_minutes;
        const dur = durMin > 0 && durMin <= 2880 ? fmtDuration(durMin) : null;
        const conn = connLabel(entry.direct_connections);
        const airline = entry.direct_airline || "—";
        const savings = entry.total_price < dp
          ? Math.round((dp - entry.total_price) / dp * 100)
          : null;

        return (
          <td key={d} style={{
            minWidth: 96,
            padding: "4px 8px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--line)",
            textAlign: "center",
            fontFamily: "var(--mono)",
            verticalAlign: "middle",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
              {fmtPrice(dp)}
            </div>
            <div style={{ fontSize: 9, color: "var(--ink-3)", marginTop: 2, display: "flex", justifyContent: "center", gap: 5, flexWrap: "wrap" }}>
              <span>{dur ?? "—"}</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{conn}</span>
              <span style={{ opacity: 0.5 }}>·</span>
              <span>{airline}</span>
            </div>
            {savings != null && savings > 0 && (
              <div style={{ fontSize: 8, color: "var(--green)", marginTop: 2, opacity: 0.8 }}>
                -{savings}% c/ split
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}

// ── Best Deal Callout ─────────────────────────────────────────────────────────
function BestDealCallout({
  cell,
  onShare,
  onDetail,
}: {
  cell: CellInfo;
  onShare?: (data: ShareData) => void;
  onDetail?: (cell: CellInfo) => void;
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
          onClick={() => onDetail ? onDetail(cell) : openBothLegs(origin, hub, dest, date)}
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
          Ver detalhes →
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

// ── Flight Detail Modal ───────────────────────────────────────────────────────
function stops(n: number): string {
  if (n === 0) return "direto";
  return n === 1 ? "1 escala" : `${n} escalas`;
}

function FlightDetailModal({
  cell,
  origin,
  onClose,
  onShare,
  onBook,
}: {
  cell: CellInfo;
  origin: string;
  onClose: () => void;
  onShare?: (d: ShareData) => void;
  onBook?: (origin: string, hub: string, dest: string, date: string) => void;
}) {
  const { entry, dest, date } = cell;
  const hub = entry.hub;
  const hubCity = cityName(hub);
  const destCity = cityName(dest);
  const originCity = cityName(origin);

  const fmtDate = new Date(date + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "short", day: "numeric", month: "short",
  });

  const shareData: ShareData = {
    origin, dest, date,
    total: entry.total_price, hub,
    lhAirline: entry.longhaul_airline,
    euAirline: entry.intraeu_airline,
    lhPrice: entry.longhaul_price,
    euPrice: entry.intraeu_price,
    currency: entry.currency,
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 3000,
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "fade-in 0.15s ease",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: "100%", maxWidth: 420,
        background: "var(--surface)",
        border: "1px solid var(--line-2)",
        borderRadius: "var(--r-lg)",
        fontFamily: "var(--mono)",
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      }}>

        {/* Header */}
        <div style={{
          padding: "18px 20px 16px",
          borderBottom: "1px solid var(--line)",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 3 }}>
              {originCity} → {destCity}
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {fmtDate} · {entry.currency}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: 18, lineHeight: 1, padding: 4 }}
          >
            ×
          </button>
        </div>

        {/* Legs */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>

          {hub === "DIRECT" ? (
            /* Direct-only entry */
            <div style={{
              background: "var(--surface-2)",
              borderRadius: "var(--r-md)",
              padding: "14px 16px",
              border: "1px solid rgba(120,180,255,0.3)",
            }}>
              <div style={{ fontSize: 10, color: "rgba(120,180,255,0.7)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                Voo Direto
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                    {origin}
                    {entry.direct_departure_time ? (
                      <span style={{ color: "rgba(120,180,255,1)", marginLeft: 8 }}>{entry.direct_departure_time}</span>
                    ) : null}
                    {" → "}{dest}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 2 }}>
                    {entry.direct_airline || "—"} · {fmtDuration(entry.direct_duration_minutes)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--ink-3)" }}>{stops(entry.direct_connections)}</div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(120,180,255,1)", flexShrink: 0 }}>
                  {fmtPrice(entry.total_price)}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Leg 1 */}
              <div style={{
                background: "var(--surface-2)",
                borderRadius: "var(--r-md)",
                padding: "14px 16px",
                border: "1px solid var(--line)",
              }}>
                <div style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                  ① Transatlântico
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                      {origin}
                      {entry.longhaul_departure_time ? (
                        <span style={{ color: "var(--green)", marginLeft: 8 }}>{entry.longhaul_departure_time}</span>
                      ) : null}
                      {" → "}{hub}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 2 }}>
                      {entry.longhaul_airline || "—"} · {fmtDuration(entry.longhaul_duration_minutes)}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--ink-3)" }}>{stops(entry.longhaul_connections)}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", flexShrink: 0 }}>
                    {fmtPrice(entry.longhaul_price)}
                  </div>
                </div>
              </div>

              {/* Hub connector */}
              <div style={{ textAlign: "center", fontSize: 10, color: "var(--ink-3)", position: "relative" }}>
                <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", whiteSpace: "nowrap" }}>
                  via {hubCity}
                </div>
                <div style={{ borderTop: "1px dashed var(--line)", margin: "8px 0" }} />
              </div>

              {/* Leg 2 */}
              <div style={{
                background: "var(--surface-2)",
                borderRadius: "var(--r-md)",
                padding: "14px 16px",
                border: "1px solid var(--line)",
              }}>
                <div style={{ fontSize: 10, color: "var(--ink-3)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                  ② Intra-Europa
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                      {hub}
                      {entry.intraeu_departure_time ? (
                        <span style={{ color: "var(--green)", marginLeft: 8 }}>{entry.intraeu_departure_time}</span>
                      ) : null}
                      {" → "}{dest}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--ink-2)", marginBottom: 2 }}>
                      {entry.intraeu_airline || "—"} · {fmtDuration(entry.intraeu_duration_minutes)}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--ink-3)" }}>{stops(entry.intraeu_connections)}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", flexShrink: 0 }}>
                    {fmtPrice(entry.intraeu_price)}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Total */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "12px 16px",
            background: "rgba(0,255,136,0.06)",
            border: "1px solid var(--green)",
            borderRadius: "var(--r-md)",
          }}>
            <span style={{ fontSize: 12, color: "var(--ink-2)" }}>
              {entry.hub === "DIRECT" ? "Voo direto" : "Total split-ticket"}
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, color: "var(--green)" }}>
              {fmtPrice(entry.total_price)}
            </span>
          </div>

          {/* Direct comparison */}
          {entry.direct_price != null && entry.hub !== "DIRECT" && (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 16px",
              background: "var(--surface-2)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
            }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 2 }}>
                  vs. direto ({entry.direct_airline || "—"} · {fmtDuration(entry.direct_duration_minutes)})
                </div>
                <div style={{ fontSize: 10, color: "var(--green)", fontWeight: 600 }}>
                  você economiza {fmtPrice(entry.direct_price - entry.total_price)} ({Math.round((entry.direct_price - entry.total_price) / entry.direct_price * 100)}%)
                </div>
              </div>
              <span style={{ fontSize: 14, color: "var(--ink-3)", textDecoration: "line-through" }}>
                {fmtPrice(entry.direct_price)}
              </span>
            </div>
          )}

          {/* Historical price context */}
          {entry.hist_avg != null && entry.hist_obs >= 1 && (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 16px",
              background: entry.deal_pct != null && entry.deal_pct >= 10
                ? "rgba(0,255,136,0.05)"
                : entry.deal_pct != null && entry.deal_pct <= -10
                  ? "rgba(255,77,99,0.05)"
                  : "var(--surface-2)",
              border: `1px solid ${entry.deal_pct != null && entry.deal_pct >= 10 ? "rgba(0,255,136,0.3)" : entry.deal_pct != null && entry.deal_pct <= -10 ? "rgba(255,77,99,0.25)" : "var(--line)"}`,
              borderRadius: "var(--r-md)",
            }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 2 }}>
                  histórico ({entry.hist_obs} buscas){entry.trend === "up" ? " · preço subindo ↑" : entry.trend === "down" ? " · preço caindo ↓" : ""}
                </div>
                {entry.deal_pct != null && entry.deal_pct >= 5 && (
                  <div style={{ fontSize: 10, color: "var(--green)", fontWeight: 600 }}>
                    {Math.round(entry.deal_pct)}% abaixo da média histórica
                  </div>
                )}
                {entry.deal_pct != null && entry.deal_pct <= -5 && (
                  <div style={{ fontSize: 10, color: "var(--crimson)", fontWeight: 600 }}>
                    {Math.round(-entry.deal_pct)}% acima da média histórica
                  </div>
                )}
              </div>
              <span style={{ fontSize: 14, color: "var(--ink-3)" }}>
                avg {fmtPrice(entry.hist_avg)}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{
          padding: "0 20px 20px",
          display: "flex", gap: 10,
        }}>
          {onShare && (
            <button
              onClick={() => onShare(shareData)}
              style={{
                flex: 1,
                background: "transparent",
                border: "1px solid var(--line-2)",
                borderRadius: "var(--r-sm)",
                color: "var(--ink-2)",
                fontFamily: "var(--mono)",
                fontSize: 12,
                padding: "10px 0",
                cursor: "pointer",
              }}
            >
              Share deal ↗
            </button>
          )}
          <button
            onClick={() => {
              if (hub !== "DIRECT") {
                onBook ? onBook(origin, hub, dest, date) : openBothLegs(origin, hub, dest, date);
              } else {
                window.open(makeGoogleFlightsUrl(origin, dest, date), "_blank");
              }
              onClose();
            }}
            style={{
              flex: 2,
              background: "var(--green)",
              border: "none",
              borderRadius: "var(--r-sm)",
              color: "var(--on-accent)",
              fontFamily: "var(--mono)",
              fontSize: 13,
              fontWeight: 700,
              padding: "10px 0",
              cursor: "pointer",
            }}
          >
            Book this combo →
          </button>
        </div>
      </div>
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
export function PriceMatrix({ matrix, origin, onShare, onPin, pinnedDate }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [detailCell, setDetailCell] = useState<CellInfo | null>(null);
  const [bookTarget, setBookTarget] = useState<{ origin: string; hub: string; dest: string; date: string } | null>(null);

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
      setDetailCell(cell);
    },
    []
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
                <>
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
                          onPin={onPin ? (leg) => onPin(leg) : undefined}
                          isPinned={pinnedDate === d && !!entry}
                        />
                      );
                    })}
                  </tr>
                  <DirectSubRow key={`${dest}-direct`} destData={destData} dest={dest} dates={dates} />
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Best Deal Callout */}
      {bestCell && (
        <BestDealCallout cell={bestCell} onShare={handleShare} onDetail={setDetailCell} />
      )}

      {/* Hover tooltip */}
      {tooltip && <HoverTooltip state={tooltip} origin={origin} />}

      {/* Flight Detail Modal */}
      {detailCell && (
        <FlightDetailModal
          cell={detailCell}
          origin={origin}
          onClose={() => setDetailCell(null)}
          onShare={(d) => { setShareData(d); setDetailCell(null); }}
          onBook={(o, h, d, dt) => { setBookTarget({ origin: o, hub: h, dest: d, date: dt }); setDetailCell(null); }}
        />
      )}

      {/* Self-transfer warning overlay */}
      {bookTarget && (
        <BookOverlay
          origin={bookTarget.origin}
          hub={bookTarget.hub}
          dest={bookTarget.dest}
          onConfirm={() => { openBothLegs(bookTarget.origin, bookTarget.hub, bookTarget.dest, bookTarget.date); setBookTarget(null); }}
          onCancel={() => setBookTarget(null)}
        />
      )}

      {/* Share Card Modal */}
      {shareData && (
        <ShareCardModal data={shareData} onClose={() => setShareData(null)} />
      )}
    </div>
  );
}
