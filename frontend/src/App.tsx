import { useState, useCallback, useEffect, useRef } from "react";
import "./styles.css";
import { Landing } from "./components/Landing";
import { SearchForm } from "./components/SearchForm";
import { PriceMatrix } from "./components/PriceMatrix";
import { TerminalLog } from "./components/TerminalLog";
import { startSearch, waitForMatrix, TimeoutWithPartialResult } from "./api/search";
import type { Matrix, SearchPayload } from "./api/search";
import type { LogLine } from "./components/TerminalLog";

type View = "landing" | "search";
type Theme = "dark" | "cream";

const STATUS_ONCE: Record<string, LogLine> = {
  queued:   { kind: "info", text: "Job na fila…" },
  complete: { kind: "ok",   text: "Todos os resultados coletados. Montando matrix…" },
  failed:   { kind: "error", text: "Search failed." },
};

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [theme, setTheme] = useState<Theme>("dark");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "dark" ? "cream" : "dark"));
  }
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);
  const [activeOrigin, setActiveOrigin] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addLog = useCallback((line: LogLine) => {
    setLogs((prev) => [...prev, line]);
  }, []);

  const addLogs = useCallback((lines: LogLine[]) => {
    setLogs((prev) => [...prev, ...lines]);
  }, []);

  const seenStatuses = useRef(new Set<string>());

  function engineLogToLine(raw: string): LogLine {
    if (raw.startsWith("  ✓")) return { kind: "ok", text: raw.trim() };
    if (raw.startsWith("  –")) return { kind: "info", text: raw.trim() };
    if (raw.startsWith("[hub")) return { kind: "ok", text: raw };
    if (raw.startsWith("[start]")) return { kind: "info", text: raw };
    if (raw.startsWith("→")) return { kind: "info", text: raw };
    return { kind: "info", text: raw };
  }

  async function handleSearch(payload: SearchPayload) {
    setLoading(true);
    setError(null);
    setMatrix(null);
    seenStatuses.current.clear();
    setLogs([
      { kind: "info", text: `${payload.origins.join(", ")} → ${payload.destinations.join(", ")}` },
      { kind: "info", text: `Hubs: ${payload.hubs.join(", ")} · ${payload.date_from} → ${payload.date_to}` },
    ]);
    setOrigins(payload.origins);
    setActiveOrigin(payload.origins[0]);

    try {
      const jobId = await startSearch(payload);
      addLog({ kind: "ok", text: `Job ${jobId.slice(0, 8)}… iniciado` });

      const result = await waitForMatrix(jobId, (status, newLogs) => {
        if (!seenStatuses.current.has(status)) {
          seenStatuses.current.add(status);
          const msg = STATUS_ONCE[status];
          if (msg) addLog(msg);
        }
        if (newLogs.length > 0) {
          addLogs(newLogs.map(engineLogToLine));
        }
      });

      const totalRoutes = Object.values(result).flatMap((d) =>
        Object.values(d).flatMap((dt) => Object.keys(dt))
      ).length;

      addLog({ kind: "ok", text: `✦ Matrix completa — ${totalRoutes} rotas com preço` });
      setMatrix(result);
    } catch (e: unknown) {
      if (e instanceof TimeoutWithPartialResult) {
        const entries = Object.values(e.matrix).flatMap((d) =>
          Object.values(d).flatMap((dt) => Object.keys(dt))
        ).length;
        if (entries > 0) {
          addLog({ kind: "info", text: `Tempo esgotado — exibindo ${entries} resultados parciais` });
          setMatrix(e.matrix);
        } else {
          addLog({ kind: "error", text: "Tempo esgotado sem resultados. Tente reduzir hubs ou datas." });
          setError("Timeout sem resultados.");
        }
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        addLog({ kind: "error", text: msg });
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  if (view === "landing") {
    return <Landing onStart={() => setView("search")} theme={theme} onToggleTheme={toggleTheme} />;
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
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {matrix && (
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
              <span style={{ color: "var(--green)" }}>●</span> matrix ready
            </span>
          )}
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to cream" : "Switch to dark"}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              color: "var(--muted2)",
              fontSize: 13,
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: "var(--mono)",
            }}
          >
            {theme === "dark" ? "☀" : "◑"}
          </button>
        </div>
      </nav>

      <div className={matrix ? "bf-app-panels" : ""} style={{ flex: 1, display: matrix ? undefined : "block", maxWidth: matrix ? "none" : 560, margin: matrix ? 0 : "40px auto", padding: matrix ? 0 : "0 24px", width: "100%" }}>

        {/* Left panel: form + terminal */}
        <div className="bf-left-panel" style={{
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
          <div className="bf-right-panel" style={{ padding: 28, overflowX: "auto" }}>
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
