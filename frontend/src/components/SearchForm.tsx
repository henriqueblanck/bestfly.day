import { useState } from "react";
import type { SearchPayload } from "../api/search";

interface Props {
  onSubmit: (p: SearchPayload) => void;
  loading: boolean;
}

const HUBS = ["MAD", "LIS", "CDG", "AMS", "FCO"];
const EU_CITIES = ["BCN", "PRG", "VIE", "ATH", "DUB", "ROM", "MXP", "BRU", "ZRH", "LHR"];

export function SearchForm({ onSubmit, loading }: Props) {
  const [origins, setOrigins] = useState("GRU,BSB");
  const [destinations, setDestinations] = useState("BCN,PRG,VIE,ATH,DUB");
  const [hubs, setHubs] = useState("MAD,LIS");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [maxConn, setMaxConn] = useState(1);
  const [maxDur, setMaxDur] = useState(20);
  const [markup, setMarkup] = useState(0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      origins: origins.split(",").map((s) => s.trim().toUpperCase()),
      destinations: destinations.split(",").map((s) => s.trim().toUpperCase()),
      hubs: hubs.split(",").map((s) => s.trim().toUpperCase()),
      date_from: dateFrom,
      date_to: dateTo,
      max_connections: maxConn,
      max_duration_hours: maxDur,
      markup_percent: markup,
    });
  }

  return (
    <form onSubmit={handleSubmit} style={formStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 20, color: "#fff" }}>
        ✈ BestFly <span style={{ color: "#6c6", fontSize: 13, fontWeight: 400 }}>split-ticket matrix</span>
      </h1>

      <Row label="Origins (comma-sep)">
        <input style={inp} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="GRU,BSB" />
      </Row>

      <Row label="Destinations">
        <input style={inp} value={destinations} onChange={(e) => setDestinations(e.target.value)} placeholder="BCN,PRG,VIE..." />
      </Row>

      <Row label="Hubs">
        <input style={inp} value={hubs} onChange={(e) => setHubs(e.target.value)} placeholder="MAD,LIS" />
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          {HUBS.map((h) => (
            <Chip key={h} label={h} active={hubs.includes(h)}
              onClick={() => setHubs((prev) =>
                prev.includes(h) ? prev.split(",").filter((x) => x.trim() !== h).join(",") : [...prev.split(","), h].join(",")
              )}
            />
          ))}
        </div>
      </Row>

      <div style={{ display: "flex", gap: 12 }}>
        <Row label="From">
          <input style={inp} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} required />
        </Row>
        <Row label="To">
          <input style={inp} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} required />
        </Row>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <Row label="Max connections">
          <input style={{ ...inp, width: 60 }} type="number" min={0} max={2} value={maxConn} onChange={(e) => setMaxConn(+e.target.value)} />
        </Row>
        <Row label="Max duration (h)">
          <input style={{ ...inp, width: 70 }} type="number" min={5} max={36} value={maxDur} onChange={(e) => setMaxDur(+e.target.value)} />
        </Row>
        <Row label="Markup %">
          <input style={{ ...inp, width: 60 }} type="number" min={0} max={50} step={0.5} value={markup} onChange={(e) => setMarkup(+e.target.value)} />
        </Row>
      </div>

      <button type="submit" disabled={loading} style={btnStyle}>
        {loading ? "Searching…" : "Find cheapest routes →"}
      </button>
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>{label.toUpperCase()}</label>
      {children}
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      background: active ? "#1a3a1a" : "#1a1a2e", border: `1px solid ${active ? "#4c4" : "#333"}`,
      color: active ? "#6f6" : "#666", borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer",
    }}>
      {label}
    </button>
  );
}

const formStyle: React.CSSProperties = {
  background: "#111122", border: "1px solid #1e1e3a", borderRadius: 12,
  padding: 24, maxWidth: 640, width: "100%",
};

const inp: React.CSSProperties = {
  background: "#0d0d1a", border: "1px solid #2a2a4a", borderRadius: 6,
  color: "#e0e0e0", padding: "8px 12px", fontSize: 13, width: "100%", outline: "none",
};

const btnStyle: React.CSSProperties = {
  marginTop: 8, width: "100%", padding: "12px 0", background: "#1a3a1a",
  border: "1px solid #4c4", color: "#6f6", borderRadius: 8, fontSize: 14,
  cursor: "pointer", letterSpacing: 0.3,
};
