import { useState, useCallback } from "react";
import "./styles.css";
import { Landing } from "./components/Landing";
import { SearchForm } from "./components/SearchForm";
import { PriceMatrix } from "./components/PriceMatrix";
import { TerminalLog } from "./components/TerminalLog";
import { startSearch, waitForMatrix } from "./api/search";
import type { Matrix, SearchPayload } from "./api/search";
import type { LogLine } from "./components/TerminalLog";

type View = "landing" | "search";

const STATUS_MESSAGES: Record<string, LogLine> = {
  queued:   { kind: "info", text: "Job queued. Firing concurrent batch requests…" },
  running:  { kind: "info", text: "Batches in flight. Waiting for Duffel responses…" },
  complete: { kind: "ok",   text: "All results collected. Building price matrix…" },
  failed:   { kind: "error", text: "Search failed." },
};

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [activeOrigin, setActiveOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addLog = useCallback((line: LogLine) => {
    setLogs((prev) => [...prev, line]);
  }, []);

  async function handleSearch(payload: SearchPayload) {
    setLoading(true);
    setError(null);
    setMatrix(null);
    setLogs([{ kind: "info", text: `Starting search: ${payload.origins.join(",")} → ${payload.destinations.join(",")}` }]);
    setOrigins(payload.origins);
    setActiveOrigin(payload.origins[0]);

    addLog({ kind: "info", text: `Hubs: ${payload.hubs.join(", ")} · Dates: ${payload.date_from} → ${payload.date_to}` });
    addLog({ kind: "info", text: `Firing Step A (long-haul) + Step B (intra-EU) concurrently…` });

    try {
      const jobId = await startSearch(payload);
      addLog({ kind: "ok", text: `Job created: ${jobId.slice(0, 8)}…` });

      const result = await waitForMatrix(jobId, (status) => {
        const msg = STATUS_MESSAGES[status];
        if (msg) addLog(msg);
      });

      const totalRoutes = Object.values(result).flatMap((d) =>
        Object.values(d).flatMap((dt) => Object.keys(dt))
      ).length;

      addLog({ kind: "ok", text: `Matrix complete. ${totalRoutes} routes priced. ✦` });
      setMatrix(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      addLog({ kind: "error", text: msg });
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  if (view === "landing") {
    return <Landing onStart={() => setView("search")} />;
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Top bar */}
      <nav style={{ padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg)", zIndex: 10 }}>
        <button
          onClick={() => setView("landing")}
          style={{ fontFamily: "var(--mono)", color: "var(--green)", fontSize: 15, fontWeight: 700, background: "none", border: "none", cursor: "pointer", letterSpacing: -0.5 }}
        >
          bestfly<span style={{ color: "var(--muted)" }}>.day</span>
        </button>
        {matrix && (
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            <span style={{ color: "var(--green)" }}>●</span> matrix ready
          </span>
        )}
      </nav>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: matrix ? "380px 1fr" : "1fr", gap: 0, maxWidth: matrix ? "none" : 560, margin: matrix ? 0 : "40px auto", padding: matrix ? 0 : "0 24px", width: "100%" }}>

        {/* Left panel: form + terminal */}
        <div style={{
          borderRight: matrix ? "1px solid var(--border)" : "none",
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          background: matrix ? "var(--bg-card)" : "transparent",
          overflowY: matrix ? "auto" : "visible",
        }}>
          <div style={{ fontSize: 11, color: "var(--muted2)", fontFamily: "var(--mono)", letterSpacing: 0.5, textTransform: "uppercase" }}>
            New search
          </div>
          <SearchForm onSubmit={handleSearch} loading={loading} />

          {logs.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: "var(--muted2)", fontFamily: "var(--mono)", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 }}>
                Engine log
              </div>
              <TerminalLog lines={logs} active={loading} />
            </div>
          )}

          {error && (
            <div style={{ background: "var(--red-bg)", border: "1px solid var(--red)", borderRadius: 8, padding: "12px 16px", fontSize: 13, color: "var(--red)" }}>
              {error}
            </div>
          )}
        </div>

        {/* Right panel: matrix */}
        {matrix && (
          <div style={{ padding: 28, overflowX: "auto" }}>
            {/* Origin tabs */}
            {origins.length > 1 && (
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                {origins.map((o) => (
                  <button
                    key={o}
                    className={`chip ${activeOrigin === o ? "active" : ""}`}
                    onClick={() => setActiveOrigin(o)}
                    style={{ fontSize: 13, padding: "6px 16px" }}
                  >
                    from {o}
                  </button>
                ))}
              </div>
            )}
            <PriceMatrix matrix={matrix} origin={activeOrigin ?? origins[0]} />
          </div>
        )}

        {/* Empty state */}
        {!matrix && !loading && logs.length === 0 && (
          <div />
        )}
      </div>
    </div>
  );
}
