import { useState, useMemo } from "react";
import type { Matrix, MatrixEntry } from "../api/search";

interface Props {
  matrix: Matrix;
  origin: string;
}

export function PriceMatrix({ matrix, origin }: Props) {
  const [tooltip, setTooltip] = useState<{ entry: MatrixEntry; dest: string; date: string } | null>(null);
  const destData = matrix[origin];
  if (!destData) return <p style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>No data for {origin}</p>;

  const destinations = Object.keys(destData);
  const dates = useMemo(() => {
    const all = new Set<string>();
    destinations.forEach((d) => Object.keys(destData[d]).forEach((dt) => all.add(dt)));
    return [...all].sort();
  }, [destData, destinations]);

  const allPrices = useMemo(
    () => destinations.flatMap((d) => dates.map((dt) => destData[d][dt]?.total_price).filter((p): p is number => p !== undefined)),
    [destData, destinations, dates]
  );
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);

  function heatColor(price: number | undefined): string {
    if (price === undefined) return "transparent";
    const ratio = (price - minP) / (maxP - minP + 0.01);
    if (ratio < 0.33) {
      const t = ratio / 0.33;
      return `rgba(${Math.round(t * 255)}, 255, ${Math.round((1 - t) * 136)}, 0.85)`;
    } else if (ratio < 0.66) {
      const t = (ratio - 0.33) / 0.33;
      return `rgba(255, ${Math.round((1 - t) * 210 + 45)}, ${Math.round(t * 20)}, 0.85)`;
    } else {
      return `rgba(255, ${Math.round((1 - (ratio - 0.66) / 0.34) * 70)}, 60, 0.85)`;
    }
  }

  function textColor(price: number | undefined): string {
    if (price === undefined) return "var(--muted)";
    const ratio = (price - minP) / (maxP - minP + 0.01);
    return ratio < 0.5 ? "#001a0e" : "#fff";
  }

  return (
    <div>
      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--muted2)", fontFamily: "var(--mono)" }}>
          {allPrices.length} routes found · {origin} as origin
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: "rgba(0,255,136,0.85)" }} />
          cheap
          <div style={{ width: 60, height: 6, borderRadius: 3, background: "linear-gradient(to right, rgba(0,255,136,0.85), rgba(255,204,0,0.85), rgba(255,68,60,0.85))" }} />
          expensive
          <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 2, background: "rgba(255,68,60,0.85)" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--green)", fontFamily: "var(--mono)" }}>
          <span>👑</span> global min: R${minP.toFixed(0)}
        </div>
      </div>

      {/* Table */}
      <div className="matrix-scroll" style={{ position: "relative" }}>
        <table className="matrix-table">
          <thead>
            <tr>
              <th style={{ textAlign: "left", minWidth: 80, position: "sticky", left: 0, background: "var(--bg)", zIndex: 3 }}>
                DEST
              </th>
              {dates.map((d) => (
                <th key={d}>
                  {new Date(d + "T12:00").toLocaleDateString("en", { month: "short", day: "numeric" })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {destinations.map((dest) => (
              <tr key={dest}>
                <td style={{
                  fontFamily: "var(--mono)", fontWeight: 700, color: "var(--text)",
                  background: "var(--bg)", position: "sticky", left: 0, zIndex: 2,
                  borderRight: "2px solid var(--border-bright)",
                }}>
                  {dest}
                </td>
                {dates.map((d) => {
                  const entry = destData[dest]?.[d];
                  const isMin = entry?.total_price === minP;
                  return (
                    <MatrixCell
                      key={d}
                      entry={entry}
                      isMin={isMin}
                      bg={heatColor(entry?.total_price)}
                      textCol={textColor(entry?.total_price)}
                      onHover={(e) => setTooltip(e ? { entry: e, dest, date: d } : null)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--bg-elevated)", border: "1px solid var(--border-bright)",
          borderRadius: 12, padding: "14px 20px", zIndex: 1000,
          animation: "fade-in-up 0.2s ease",
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          display: "flex", gap: 24, alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)", marginBottom: 4 }}>
              {origin} → {tooltip.dest} · {tooltip.date}
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "var(--green)", fontFamily: "var(--mono)" }}>
              R${tooltip.entry.total_price.toFixed(0)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted2)", lineHeight: 2 }}>
            <div>✈ Long-haul <span style={{ color: "var(--text)", fontFamily: "var(--mono)" }}>R${tooltip.entry.longhaul_price.toFixed(0)}</span></div>
            <div>🇪🇺 Intra-EU <span style={{ color: "var(--text)", fontFamily: "var(--mono)" }}>R${tooltip.entry.intraeu_price.toFixed(0)}</span></div>
            <div>🔗 Hub <span style={{ color: "var(--text)", fontFamily: "var(--mono)" }}>{tooltip.entry.hub}</span></div>
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            SPLIT TICKET
          </div>
        </div>
      )}
    </div>
  );
}

function MatrixCell({
  entry, isMin, bg, textCol, onHover,
}: {
  entry: MatrixEntry | undefined;
  isMin: boolean;
  bg: string;
  textCol: string;
  onHover: (e: MatrixEntry | null) => void;
}) {
  return (
    <td
      className={isMin ? "matrix-cell-min" : ""}
      style={{ background: bg, color: textCol, fontWeight: isMin ? 700 : 400, position: "relative" }}
      onMouseEnter={() => entry && onHover(entry)}
      onMouseLeave={() => onHover(null)}
    >
      {entry ? (
        <>
          {isMin && <span style={{ position: "absolute", top: 2, right: 4, fontSize: 10 }}>👑</span>}
          R${entry.total_price.toFixed(0)}
        </>
      ) : (
        <span style={{ color: "var(--muted)", fontSize: 16 }}>·</span>
      )}
    </td>
  );
}
