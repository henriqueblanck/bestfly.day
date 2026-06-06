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
  const [returnMatrix, setReturnMatrix] = useState<Matrix | null>(null);
  const [tripType, setTripType] = useState<"oneway" | "roundtrip">("oneway");
  const [origins, setOrigins] = useState<string[]>([]);
  const [destinations, setDestinations] = useState<string[]>([]);
  const [activeOrigin, setActiveOrigin] = useState<string | null>(null);
  const [activeRetOrigin, setActiveRetOrigin] = useState<string | null>(null);
  const [leg, setLeg] = useState<"ida" | "volta">("ida");
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
    if (raw.startsWith("[direto]")) return { kind: "info", text: raw };
    if (raw.startsWith("[volta]")) return { kind: "info", text: raw };
    if (raw.startsWith("[start]")) return { kind: "info", text: raw };
    if (raw.startsWith("→")) return { kind: "info", text: raw };
    return { kind: "info", text: raw };
  }

  async function handleSearch(payload: SearchPayload) {
    setLoading(true);
    setError(null);
    setMatrix(null);
    setReturnMatrix(null);
    setLeg("ida");
    seenStatuses.current.clear();
    setTripType(payload.trip_type);
    setLogs([
      { kind: "info", text: `${payload.origins.join(", ")} → ${payload.destinations.join(", ")}` },
      { kind: "info", text: `${payload.date_from} → ${payload.date_to}${payload.trip_type === "roundtrip" ? ` | volta: ${payload.return_date_from} → ${payload.return_date_to}` : ""}` },
    ]);
    setOrigins(payload.origins);
    setDestinations(payload.destinations);
    setActiveOrigin(payload.origins[0]);
    setActiveRetOrigin(payload.destinations[0]);

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

      const totalRoutes = Object.values(result.matrix!).flatMap((d) =>
        Object.values(d).flatMap((dt) => Object.keys(dt))
      ).length;

      addLog({ kind: "ok", text: `✦ Matrix completa — ${totalRoutes} rotas com preço` });
      setMatrix(result.matrix);
      setReturnMatrix(result.return_matrix);
    } catch (e: unknown) {
      if (e instanceof TimeoutWithPartialResult) {
        const entries = Object.values(e.matrix).flatMap((d) =>
          Object.values(d).flatMap((dt) => Object.keys(dt))
        ).length;
        if (entries > 0) {
          addLog({ kind: "info", text: `Tempo esgotado — exibindo ${entries} resultados parciais` });
          setMatrix(e.matrix);
          setReturnMatrix(e.return_matrix);
        } else {
          addLog({ kind: "error", text: "Tempo esgotado sem resultados. Tente reduzir datas." });
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

  const hasMatrix = matrix || returnMatrix;

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
          {hasMatrix && (
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

      <div className={hasMatrix ? "bf-app-panels" : ""} style={{ flex: 1, display: hasMatrix ? undefined : "block", maxWidth: hasMatrix ? "none" : 560, margin: hasMatrix ? 0 : "40px auto", padding: hasMatrix ? 0 : "0 24px", width: "100%" }}>

        {/* Left panel: form + terminal */}
        <div className="bf-left-panel" style={{
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          background: hasMatrix ? "var(--bg-card)" : "transparent",
          overflowY: hasMatrix ? "auto" : "visible",
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
        {hasMatrix && (
          <div className="bf-right-panel" style={{ padding: 28, overflowX: "auto" }}>

            {/* Leg tabs (roundtrip) */}
            {tripType === "roundtrip" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                <button
                  className={`chip ${leg === "ida" ? "active" : ""}`}
                  onClick={() => setLeg("ida")}
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  ✈ Ida
                </button>
                <button
                  className={`chip ${leg === "volta" ? "active" : ""}`}
                  onClick={() => setLeg("volta")}
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  ✈ Volta
                </button>
              </div>
            )}

            {/* Origin tabs */}
            {leg === "ida" && matrix && (
              <>
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
              </>
            )}

            {/* Return matrix */}
            {leg === "volta" && returnMatrix && (
              <>
                {destinations.length > 1 && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
                    {destinations.map((o) => (
                      <button
                        key={o}
                        className={`chip ${activeRetOrigin === o ? "active" : ""}`}
                        onClick={() => setActiveRetOrigin(o)}
                        style={{ fontSize: 13, padding: "6px 16px" }}
                      >
                        from {o}
                      </button>
                    ))}
                  </div>
                )}
                <PriceMatrix matrix={returnMatrix} origin={activeRetOrigin ?? destinations[0]} />
              </>
            )}

            {leg === "volta" && !returnMatrix && (
              <p style={{ color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 13 }}>
                Aguardando resultados de retorno…
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
