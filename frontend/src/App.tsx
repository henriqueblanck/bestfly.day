import { useState, useCallback, useEffect, useRef } from "react";
import "./styles.css";
import { Landing } from "./components/Landing";
import { SearchForm } from "./components/SearchForm";
import { PriceMatrix } from "./components/PriceMatrix";
import type { PinnedLeg } from "./components/PriceMatrix";
import { TerminalLog } from "./components/TerminalLog";
import { startSearch, waitForMatrix, TimeoutWithPartialResult } from "./api/search";
import type { Matrix, SearchPayload } from "./api/search";
import type { LogLine } from "./components/TerminalLog";

function fmtPrice(v: number): string {
  return "R$" + Math.round(v).toLocaleString("pt-BR");
}

function TotalBar({ ida, volta }: { ida: PinnedLeg | null; volta: PinnedLeg | null }) {
  const total = (ida?.price ?? 0) + (volta?.price ?? 0);
  const bothSelected = ida && volta;
  return (
    <div style={{
      background: bothSelected ? "var(--green-bg)" : "var(--surface)",
      border: `1px solid ${bothSelected ? "var(--green)" : "var(--line-2)"}`,
      borderRadius: "var(--r-md)",
      padding: "14px 18px",
      marginBottom: 20,
      fontFamily: "var(--mono)",
      display: "flex",
      alignItems: "center",
      gap: 16,
      flexWrap: "wrap",
      animation: "fade-in 0.2s ease",
    }}>
      <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>IDA</span>
        {ida ? (
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {ida.origin}→{ida.dest} · {new Date(ida.date + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
            <span style={{ color: "var(--green)", fontWeight: 700, marginLeft: 6 }}>{fmtPrice(ida.price)}</span>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>selecione uma célula →</span>
        )}
        <span style={{ color: "var(--line-2)", fontSize: 14 }}>+</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>VOLTA</span>
        {volta ? (
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {volta.origin}→{volta.dest} · {new Date(volta.date + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
            <span style={{ color: "var(--green)", fontWeight: 700, marginLeft: 6 }}>{fmtPrice(volta.price)}</span>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>selecione uma célula →</span>
        )}
      </div>
      {bothSelected && (
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: "var(--ink-3)", marginBottom: 2 }}>TOTAL IDA + VOLTA</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--green)", letterSpacing: "-0.03em" }}>
            {fmtPrice(total)}
          </div>
        </div>
      )}
    </div>
  );
}

type View = "landing" | "search";
type Theme = "terminal" | "mint" | "lime" | "cyan" | "cream";
const THEME_CYCLE: Theme[] = ["terminal", "mint", "lime", "cyan", "cream"];
const THEME_LABEL: Record<Theme, string> = {
  terminal: "◑", mint: "mint", lime: "lime", cyan: "cyan", cream: "cream",
};

const STATUS_ONCE: Record<string, LogLine> = {
  queued:   { kind: "info", text: "Job na fila…" },
  complete: { kind: "ok",   text: "Todos os resultados coletados. Montando matrix…" },
  failed:   { kind: "error", text: "Search failed." },
};

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("bf-theme") as Theme) || "terminal"; } catch { return "terminal"; }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, []);

  function applyTheme(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t === "cream" ? "light" : "dark";
    try { localStorage.setItem("bf-theme", t); } catch {}
  }

  function toggleTheme() {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    applyTheme(next);
    setTheme(next);
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
  const [pinnedIda, setPinnedIda] = useState<PinnedLeg | null>(null);
  const [pinnedVolta, setPinnedVolta] = useState<PinnedLeg | null>(null);

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
    setPinnedIda(null);
    setPinnedVolta(null);
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
            title="Next theme"
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              color: "var(--muted2)",
              fontSize: 12,
              padding: "4px 10px",
              cursor: "pointer",
              fontFamily: "var(--mono)",
              letterSpacing: 0.3,
            }}
          >
            {THEME_LABEL[theme]} →
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
          <div className="bf-right-panel bg-grid" style={{ padding: 28, overflowX: "auto" }}>

            {/* Leg tabs (roundtrip) */}
            {tripType === "roundtrip" && (
              <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  className={`chip ${leg === "ida" ? "active" : ""}`}
                  onClick={() => setLeg("ida")}
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  ✈ Ida {pinnedIda ? `· ${fmtPrice(pinnedIda.price)}` : ""}
                </button>
                <button
                  className={`chip ${leg === "volta" ? "active" : ""}`}
                  onClick={() => setLeg("volta")}
                  style={{ fontSize: 13, padding: "6px 16px" }}
                >
                  ✈ Volta {pinnedVolta ? `· ${fmtPrice(pinnedVolta.price)}` : ""}
                </button>
                {(pinnedIda || pinnedVolta) && (
                  <button
                    onClick={() => { setPinnedIda(null); setPinnedVolta(null); }}
                    style={{ fontSize: 11, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--mono)", padding: "4px 8px" }}
                  >
                    limpar
                  </button>
                )}
              </div>
            )}

            {/* Total bar (roundtrip) */}
            {tripType === "roundtrip" && (pinnedIda || pinnedVolta) && (
              <TotalBar ida={pinnedIda} volta={pinnedVolta} />
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
                <PriceMatrix
                  matrix={matrix}
                  origin={activeOrigin ?? origins[0]}
                  onPin={(leg) => setPinnedIda(leg)}
                  pinnedDate={pinnedIda?.date}
                />
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
                <PriceMatrix
                  matrix={returnMatrix}
                  origin={activeRetOrigin ?? destinations[0]}
                  onPin={(leg) => setPinnedVolta(leg)}
                  pinnedDate={pinnedVolta?.date}
                />
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
