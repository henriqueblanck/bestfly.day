import { useState, useCallback, useEffect, useRef } from "react";
import "./styles.css";
import { makeGoogleFlightsUrl } from "./utils/googleFlights";
import { Landing } from "./components/Landing";
import { SearchForm } from "./components/SearchForm";
import { PriceMatrix } from "./components/PriceMatrix";
import type { PinnedLeg } from "./components/PriceMatrix";
import { TerminalLog } from "./components/TerminalLog";
import { startSearch, waitForMatrix, TimeoutWithPartialResult } from "./api/search";
import type { Matrix, SearchPayload, RoundTripDirectOffer, SplitRTOffer } from "./api/search";
import type { LogLine } from "./components/TerminalLog";

function fmtPrice(v: number): string {
  return "R$" + Math.round(v).toLocaleString("pt-BR");
}

function findBestCell(matrix: Matrix, origin: string): PinnedLeg | null {
  const destData = matrix[origin];
  if (!destData) return null;
  let best: PinnedLeg | null = null;
  for (const dest of Object.keys(destData)) {
    for (const [date, entry] of Object.entries(destData[dest])) {
      if (!best || entry.total_price < best.price) {
        best = {
          price: entry.total_price,
          dest,
          date,
          hub: entry.hub,
          airline: entry.hub === "DIRECT"
            ? (entry.direct_airline || "—")
            : `${entry.longhaul_airline}+${entry.intraeu_airline}`,
          origin,
          direct_price: entry.direct_price ?? null,
        };
      }
    }
  }
  return best;
}

function fmtDur(mins: number): string {
  if (!mins) return "—";
  return `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function TotalBar({
  ida, volta, roundtripDirect, splitRt,
}: {
  ida: PinnedLeg | null;
  volta: PinnedLeg | null;
  roundtripDirect: Record<string, Record<string, Record<string, RoundTripDirectOffer>>> | null;
  splitRt: Record<string, Record<string, SplitRTOffer>> | null;
}) {
  const [showRtDetails, setShowRtDetails] = useState(false);
  const [showSrtDetails, setShowSrtDetails] = useState(false);
  const bothSelected = !!(ida && volta);

  // ① Split-ticket total (two separate one-way bookings)
  const splitTotal = (ida?.price ?? 0) + (volta?.price ?? 0);

  // ② Single-ticket pair: cheapest one-way each leg (may include connections like Avianca via BOG)
  //    direct_price is already in each matrix cell from the one-way engine baseline search
  const pairTotal: number | null =
    ida?.direct_price != null && volta?.direct_price != null
      ? ida.direct_price + volta.direct_price
      : null;

  // ③ RT consolidado direto
  const rt = (() => {
    if (!ida || !volta) return null;
    const byDate = roundtripDirect?.[ida.origin]?.[ida.dest];
    if (!byDate) return null;
    if (byDate[ida.date]) return byDate[ida.date];
    return Object.values(byDate).reduce<RoundTripDirectOffer | null>(
      (best, o) => (!best || o.total < best.total ? o : best),
      null,
    );
  })();
  const rtTotal = rt?.total ?? null;

  // ④ Split RT: RT(origin↔hub) + RT(hub↔dest)
  const srt: SplitRTOffer | null = ida && volta
    ? (splitRt?.[ida.origin]?.[ida.dest] ?? null)
    : null;
  const srtTotal = srt?.total ?? null;
  const srtDone = splitRt !== null;

  // Best across all options
  const options = [splitTotal, pairTotal, rtTotal, srtTotal].filter((v): v is number => v != null);
  const best = options.length ? Math.min(...options) : null;

  function col(v: number | null) {
    return best != null && v != null && v === best ? "var(--green)" : "var(--ink-2)";
  }
  function winner(v: number | null) {
    return best != null && v != null && v === best;
  }

  return (
    <div style={{
      background: bothSelected ? "var(--green-bg)" : "var(--surface)",
      border: `1px solid ${bothSelected ? "var(--green)" : "var(--line-2)"}`,
      borderRadius: "var(--r-md)",
      padding: "14px 18px",
      marginBottom: 20,
      fontFamily: "var(--mono)",
      display: "flex",
      flexDirection: "column",
      gap: 10,
      animation: "fade-in 0.2s ease",
    }}>
      {/* Legs row */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>IDA</span>
        {ida ? (
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {ida.origin}→{ida.dest} · {new Date(ida.date + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
            <span style={{ color: "var(--green)", fontWeight: 700, marginLeft: 6 }}>{fmtPrice(ida.price)}</span>
          </span>
        ) : <span style={{ fontSize: 12, color: "var(--ink-3)" }}>selecione uma célula →</span>}
        <span style={{ color: "var(--line-2)" }}>+</span>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>VOLTA</span>
        {volta ? (
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {volta.origin}→{volta.dest} · {new Date(volta.date + "T12:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}
            <span style={{ color: "var(--green)", fontWeight: 700, marginLeft: 6 }}>{fmtPrice(volta.price)}</span>
          </span>
        ) : <span style={{ fontSize: 12, color: "var(--ink-3)" }}>selecione uma célula →</span>}
      </div>

      {/* 3-way comparison */}
      {bothSelected && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 10, alignItems: "flex-end" }}>

          {/* ① Split */}
          <div style={{ flex: 1, minWidth: 110 }}>
            <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>
              {winner(splitTotal) ? "✦ MELHOR · " : ""}SPLIT-TICKET
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col(splitTotal), letterSpacing: "-0.03em" }}>
              {fmtPrice(splitTotal)}
            </div>
            {winner(splitTotal) && (
              <div style={{ fontSize: 9, color: "var(--ink-3)", marginTop: 3 }}>
                reserve cada perna na matrix ↑
              </div>
            )}
          </div>

          <div style={{ color: "var(--line-2)", alignSelf: "center", fontSize: 11 }}>vs</div>

          {/* ② Single-ticket pair (one-way × 2) */}
          {pairTotal != null && (
            <>
              <div style={{ flex: 1, minWidth: 110 }}>
                <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>
                  {winner(pairTotal) ? "✦ MELHOR · " : ""}2× IDA SIMPLES
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: col(pairTotal), letterSpacing: "-0.03em" }}>
                  {fmtPrice(pairTotal)}
                </div>
                {winner(pairTotal) && (
                  <button
                    onClick={() => {
                      window.open(makeGoogleFlightsUrl(ida!.origin, ida!.dest, ida!.date), "_blank");
                      window.open(makeGoogleFlightsUrl(volta!.origin, volta!.dest, volta!.date), "_blank");
                    }}
                    style={{ marginTop: 5, fontSize: 9, background: "var(--green)", color: "var(--on-accent)", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 700 }}
                  >
                    reservar ida + volta →
                  </button>
                )}
              </div>
              <div style={{ color: "var(--line-2)", alignSelf: "center", fontSize: 11 }}>vs</div>
            </>
          )}

          {/* ③ Round-trip consolidated */}
          {rtTotal != null ? (
            <div style={{ flex: 1, minWidth: 130 }}>
              <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>
                {winner(rtTotal) ? "✦ MELHOR · " : ""}IDA+VOLTA ÚNICO{rt?.outbound_airline ? ` · ${rt.outbound_airline}` : ""}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: col(rtTotal), letterSpacing: "-0.03em" }}>
                {fmtPrice(rtTotal)}
              </div>
              {rt?.hist_obs != null && rt.hist_obs >= 1 && rt.hist_avg && (
                <div style={{ fontSize: 9, marginTop: 3, color: rt.deal_pct != null && rt.deal_pct >= 5 ? "var(--green)" : rt.deal_pct != null && rt.deal_pct <= -5 ? "var(--crimson)" : "var(--ink-3)" }}>
                  {rt.deal_pct != null && rt.deal_pct >= 5 ? `↓ ${Math.round(rt.deal_pct)}% abaixo da média` :
                   rt.deal_pct != null && rt.deal_pct <= -5 ? `↑ ${Math.round(-rt.deal_pct)}% acima da média` :
                   "na média histórica"}
                  {rt.trend === "down" ? " · tendência queda" : rt.trend === "up" ? " · tendência alta" : ""}
                  {" · "}avg {fmtPrice(rt.hist_avg)}
                </div>
              )}
              <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                <button
                  onClick={() => setShowRtDetails(v => !v)}
                  style={{ fontSize: 9, background: "transparent", color: "var(--ink-3)", border: "1px solid var(--line-2)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "var(--mono)" }}
                >
                  {showRtDetails ? "fechar ▲" : "ver detalhes ▾"}
                </button>
                <button
                  onClick={() => window.open(makeGoogleFlightsUrl(ida!.origin, ida!.dest, rt!.outbound_date, rt!.return_date), "_blank")}
                  style={{ fontSize: 9, background: "var(--green)", color: "var(--on-accent)", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 700 }}
                >
                  reservar →
                </button>
              </div>
              {showRtDetails && rt && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, fontFamily: "var(--mono)", fontSize: 10 }}>
                  {/* Leg ① */}
                  <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 8, color: "var(--ink-3)", letterSpacing: 1, marginBottom: 4 }}>① IDA</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{ida!.origin} → {ida!.dest}</span>
                      <span style={{ color: "var(--ink-2)" }}>{fmtDate(rt.outbound_date)}</span>
                    </div>
                    <div style={{ color: "var(--ink-3)", marginTop: 3 }}>
                      {rt.outbound_airline || "—"}
                      {rt.outbound_duration_minutes ? ` · ${fmtDur(rt.outbound_duration_minutes)}` : ""}
                      {" · "}{rt.outbound_connections === 0 ? "direto" : `${rt.outbound_connections} parada${rt.outbound_connections > 1 ? "s" : ""}`}
                    </div>
                  </div>
                  {/* Leg ② */}
                  <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 8, color: "var(--ink-3)", letterSpacing: 1, marginBottom: 4 }}>② VOLTA</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{ida!.dest} → {ida!.origin}</span>
                      <span style={{ color: "var(--ink-2)" }}>{fmtDate(rt.return_date)}</span>
                    </div>
                    <div style={{ color: "var(--ink-3)", marginTop: 3 }}>
                      {rt.return_airline || "—"}
                      {rt.return_duration_minutes ? ` · ${fmtDur(rt.return_duration_minutes)}` : ""}
                      {" · "}{rt.return_connections === 0 ? "direto" : `${rt.return_connections} parada${rt.return_connections > 1 ? "s" : ""}`}
                    </div>
                  </div>
                  {/* Total + vs split */}
                  <div style={{ background: "var(--green-bg)", border: "1px solid var(--green)", borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--ink-2)" }}>Total IDA+VOLTA</span>
                      <span style={{ color: "var(--green)", fontWeight: 700, fontSize: 13 }}>{fmtPrice(rtTotal!)}</span>
                    </div>
                    {srtTotal != null && (
                      <div style={{ marginTop: 4, color: "var(--ink-3)", fontSize: 9 }}>
                        vs. SPLIT RT{srt?.hub ? ` (via ${srt.hub})` : ""} <span style={{ textDecoration: "line-through" }}>{fmtPrice(srtTotal)}</span>
                        {srtTotal > rtTotal! && (
                          <span style={{ color: "var(--green)", marginLeft: 4 }}>
                            você economiza {fmtPrice(srtTotal - rtTotal!)} ({Math.round((srtTotal - rtTotal!) / srtTotal * 100)}%)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Historical */}
                  {rt.hist_obs >= 1 && rt.hist_avg && (
                    <div style={{ padding: "6px 10px", color: "var(--ink-3)", fontSize: 9, display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: rt.deal_pct != null && rt.deal_pct >= 5 ? "var(--green)" : rt.deal_pct != null && rt.deal_pct <= -5 ? "var(--crimson)" : "var(--ink-3)" }}>
                        {rt.deal_pct != null && rt.deal_pct >= 5
                          ? `↓ ${Math.round(rt.deal_pct)}% abaixo da média histórica`
                          : rt.deal_pct != null && rt.deal_pct <= -5
                          ? `↑ ${Math.round(-rt.deal_pct)}% acima da média histórica`
                          : "na média histórica"}
                      </span>
                      <span>histórico ({rt.hist_obs} busca{rt.hist_obs > 1 ? "s" : ""}) · avg {fmtPrice(rt.hist_avg)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : roundtripDirect === null ? (
            <div style={{ flex: 1, minWidth: 110 }}>
              <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>IDA+VOLTA ÚNICO</div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", fontStyle: "italic" }}>buscando…</div>
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 110 }}>
              <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>IDA+VOLTA ÚNICO</div>
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>—</div>
            </div>
          )}

          <div style={{ color: "var(--line-2)", alignSelf: "center", fontSize: 11 }}>vs</div>

          {/* ④ Split RT */}
          {srtTotal != null ? (
            <div style={{ flex: 1, minWidth: 130 }}>
              <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>
                {winner(srtTotal) ? "✦ MELHOR · " : ""}SPLIT RT{srt?.hub ? ` · via ${srt.hub}` : ""}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: col(srtTotal), letterSpacing: "-0.03em" }}>
                {fmtPrice(srtTotal)}
              </div>
              {srt?.hist_obs != null && srt.hist_obs >= 1 && srt.hist_avg && (
                <div style={{ fontSize: 9, marginTop: 2, color: srt.deal_pct != null && srt.deal_pct >= 5 ? "var(--green)" : srt.deal_pct != null && srt.deal_pct <= -5 ? "var(--crimson)" : "var(--ink-3)" }}>
                  {srt.deal_pct != null && srt.deal_pct >= 5 ? `↓ ${Math.round(srt.deal_pct)}% abaixo da média` :
                   srt.deal_pct != null && srt.deal_pct <= -5 ? `↑ ${Math.round(-srt.deal_pct)}% acima da média` :
                   "na média histórica"}
                  {" · "}avg {fmtPrice(srt.hist_avg)}
                </div>
              )}
              <div style={{ display: "flex", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                <button
                  onClick={() => setShowSrtDetails(v => !v)}
                  style={{ fontSize: 9, background: "transparent", color: "var(--ink-3)", border: "1px solid var(--line-2)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "var(--mono)" }}
                >
                  {showSrtDetails ? "fechar ▲" : "ver detalhes ▾"}
                </button>
                <button
                  onClick={() => {
                    window.open(makeGoogleFlightsUrl(ida!.origin, srt!.hub, srt!.outbound_date, srt!.return_date), "_blank");
                    window.open(makeGoogleFlightsUrl(srt!.hub, ida!.dest, srt!.outbound_date, srt!.return_date), "_blank");
                  }}
                  style={{ fontSize: 9, background: "var(--green)", color: "var(--on-accent)", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "var(--mono)", fontWeight: 700 }}
                >
                  reservar →
                </button>
              </div>
              {showSrtDetails && srt && (
                <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 10, color: "var(--ink-2)", display: "flex", flexDirection: "column", gap: 5 }}>
                  <div>
                    <span style={{ color: "var(--ink-3)", marginRight: 6, letterSpacing: 0.5 }}>LH</span>
                    {ida!.origin}↔{srt.hub}
                    {srt.lh_airline ? ` · ${srt.lh_airline}` : ""}
                    {" · "}{fmtDate(srt.outbound_date)} → {fmtDate(srt.return_date)}
                    <span style={{ color: "var(--green)", marginLeft: 6 }}>{fmtPrice(srt.lh_total)}</span>
                  </div>
                  <div>
                    <span style={{ color: "var(--ink-3)", marginRight: 6, letterSpacing: 0.5 }}>EU</span>
                    {srt.hub}↔{ida!.dest}
                    {srt.eu_airline ? ` · ${srt.eu_airline}` : ""}
                    {" · "}{fmtDate(srt.outbound_date)} → {fmtDate(srt.return_date)}
                    <span style={{ color: "var(--green)", marginLeft: 6 }}>{fmtPrice(srt.eu_total)}</span>
                  </div>
                </div>
              )}
            </div>
          ) : srtDone ? (
            <div style={{ flex: 1, minWidth: 130 }}>
              <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>SPLIT RT</div>
              <div style={{ fontSize: 11, color: "var(--ink-3)" }}>—</div>
            </div>
          ) : (
            <div style={{ flex: 1, minWidth: 130 }}>
              <div style={{ fontSize: 9, color: "var(--ink-3)", marginBottom: 2, letterSpacing: 0.8 }}>SPLIT RT</div>
              <div style={{ fontSize: 11, color: "var(--ink-3)", fontStyle: "italic" }}>buscando…</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type View = "landing" | "search";

const STATUS_ONCE: Record<string, LogLine> = {
  queued:   { kind: "info", text: "Job na fila…" },
  complete: { kind: "ok",   text: "Todos os resultados coletados. Montando matrix…" },
  failed:   { kind: "error", text: "Search failed." },
};

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "cream");
    document.documentElement.style.colorScheme = "light";
  }, []);

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
  const [roundtripDirect, setRoundtripDirect] = useState<Record<string, Record<string, Record<string, RoundTripDirectOffer>>> | null>(null);
  const [splitRt, setSplitRt] = useState<Record<string, Record<string, SplitRTOffer>> | null>(null);

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
    setRoundtripDirect(null);
    setSplitRt(null);
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
      if (result.roundtrip_direct) setRoundtripDirect(result.roundtrip_direct);
      if (result.split_rt !== undefined) setSplitRt(result.split_rt);

      // Auto-pin best cells for roundtrip total
      if (payload.trip_type === "roundtrip" && result.matrix && result.return_matrix) {
        const bestIda = findBestCell(result.matrix, payload.origins[0]);
        const bestVolta = findBestCell(result.return_matrix, payload.destinations[0]);
        if (bestIda) setPinnedIda(bestIda);
        if (bestVolta) setPinnedVolta(bestVolta);
      }
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
    return <Landing onStart={() => setView("search")} />;
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
        {hasMatrix && (
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            <span style={{ color: "var(--green)" }}>●</span> matrix ready
          </span>
        )}
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
            {tripType === "roundtrip" && hasMatrix && (
              <TotalBar ida={pinnedIda} volta={pinnedVolta} roundtripDirect={roundtripDirect} splitRt={splitRt} />
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
