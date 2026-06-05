import { useMemo } from "react";

interface MatrixEntry {
  total_price: number;
  longhaul_price: number;
  intraeu_price: number;
  hub: string;
  currency: string;
}

type Matrix = Record<string, Record<string, Record<string, MatrixEntry>>>;

interface Props {
  matrix: Matrix;
  origin: string;
}

export function PriceMatrix({ matrix, origin }: Props) {
  const destData = matrix[origin];
  if (!destData) return <p>No data for {origin}</p>;

  const destinations = Object.keys(destData);
  const dates = useMemo(() => {
    const all = new Set<string>();
    destinations.forEach((dest) =>
      Object.keys(destData[dest]).forEach((d) => all.add(d))
    );
    return [...all].sort();
  }, [destData, destinations]);

  const allPrices = useMemo(
    () =>
      destinations.flatMap((dest) =>
        dates.map((d) => destData[dest][d]?.total_price).filter(Boolean)
      ),
    [destData, destinations, dates]
  );
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);

  function heatColor(price: number | undefined): string {
    if (price === undefined) return "#1a1a2e";
    const ratio = (price - minP) / (maxP - minP + 0.01);
    // green → yellow → red
    const r = Math.round(ratio * 220);
    const g = Math.round((1 - ratio) * 180 + 40);
    return `rgb(${r},${g},40)`;
  }

  return (
    <div style={{ overflowX: "auto", fontFamily: "monospace" }}>
      <table style={{ borderCollapse: "collapse", minWidth: 600 }}>
        <thead>
          <tr>
            <th style={th}>Destination</th>
            {dates.map((d) => (
              <th key={d} style={{ ...th, fontSize: 11 }}>
                {d.slice(5)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {destinations.map((dest) => (
            <tr key={dest}>
              <td style={{ ...td, fontWeight: "bold", background: "#111" }}>
                {dest}
              </td>
              {dates.map((d) => {
                const entry = destData[dest][d];
                return (
                  <td
                    key={d}
                    title={
                      entry
                        ? `${entry.currency} ${entry.total_price.toFixed(0)}\nHub: ${entry.hub}\nLH: ${entry.longhaul_price.toFixed(0)} + EU: ${entry.intraeu_price.toFixed(0)}`
                        : "No route"
                    }
                    style={{
                      ...td,
                      background: heatColor(entry?.total_price),
                      color: entry ? "#fff" : "#444",
                      fontWeight: entry?.total_price === minP ? "bold" : "normal",
                    }}
                  >
                    {entry ? entry.total_price.toFixed(0) : "–"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ color: "#888", marginTop: 8, fontSize: 12 }}>
        Hover cells for breakdown. Bold = global minimum. All prices in {allPrices.length ? "BRL" : "–"}.
      </p>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "6px 10px",
  background: "#0d0d1a",
  color: "#ccc",
  border: "1px solid #333",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "6px 10px",
  border: "1px solid #222",
  textAlign: "center",
  cursor: "default",
  minWidth: 60,
};
