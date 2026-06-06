import { useEffect, useRef, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";

const TICKER_ITEMS = [
  { route: "GRU → BCN", saved: "R$2.340", ago: "3min" },
  { route: "BSB → LIS", saved: "R$1.890", ago: "7min" },
  { route: "GRU → PRG", saved: "R$3.100", ago: "12min" },
  { route: "CGH → MAD", saved: "R$2.650", ago: "18min" },
  { route: "GRU → VIE", saved: "R$1.750", ago: "24min" },
  { route: "BSB → ATH", saved: "R$2.980", ago: "31min" },
  { route: "GRU → CDG", saved: "R$2.200", ago: "44min" },
  { route: "GIG → LHR", saved: "R$1.420", ago: "52min" },
];

const AIRLINE_PRICE = 4200;
const BESTFLY_PRICE = 1890;
const DEALS_TODAY = 847;

interface Props {
  onStart: () => void;
  theme?: string;
  onToggleTheme?: () => void;
}

// Smooth animated price countdown: airline → bestfly
function PriceCountdown() {
  const [disp, setDisp] = useState(AIRLINE_PRICE);
  const [strikeVisible, setStrikeVisible] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    // 450ms hold on airline price, then count down over 1200ms
    let startAt = 0;
    const dur = 1200;
    const strikeTimer = setTimeout(() => setStrikeVisible(true), 600);

    const tick = (now: number) => {
      if (!startAt) startAt = now + 450;
      const p = now < startAt ? 0 : Math.min(1, (now - startAt) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisp(Math.round(AIRLINE_PRICE + (BESTFLY_PRICE - AIRLINE_PRICE) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      clearTimeout(strikeTimer);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const atBestfly = disp <= BESTFLY_PRICE;
  const savings = AIRLINE_PRICE - BESTFLY_PRICE;
  const pct = Math.round((savings / AIRLINE_PRICE) * 100);

  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "28px 40px",
      marginBottom: 48,
      display: "inline-flex",
      flexDirection: "column",
      gap: 16,
      minWidth: 320,
      position: "relative",
    }}>
      {/* Live badge */}
      <div style={{
        position: "absolute",
        top: 14,
        right: 16,
        display: "flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10,
        fontFamily: "var(--mono)",
        color: "var(--muted)",
        letterSpacing: 0.8,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", animation: "pulse-green 2s infinite", display: "inline-block" }} />
        GRU → BCN · LIVE
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)", letterSpacing: 1 }}>
        What the airline charges
      </div>

      {/* Airline price with strikethrough */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ position: "relative", display: "inline-block" }}>
          <span style={{
            fontSize: 32,
            fontWeight: 700,
            color: atBestfly ? "var(--muted)" : "var(--text)",
            fontFamily: "var(--mono)",
            transition: "color 0.4s",
          }}>
            R$4.200
          </span>
          {strikeVisible && (
            <span style={{
              position: "absolute",
              left: 0,
              top: "50%",
              height: 2,
              background: "var(--red)",
              animation: "strike-through 0.4s ease forwards",
              width: "100%",
              opacity: atBestfly ? 1 : 0.5,
            }} />
          )}
        </span>
        <span style={{ fontSize: 12, color: "var(--red)", fontWeight: 600, fontFamily: "var(--mono)", opacity: atBestfly ? 1 : 0 }}>
          direct ticket
        </span>
      </div>

      {/* BestFly price — counts down live */}
      <div>
        <div style={{ fontSize: 11, color: "var(--green)", fontFamily: "var(--mono)", letterSpacing: 0.8, marginBottom: 4 }}>
          BestFly split-ticket
        </div>
        <span style={{
          fontSize: 52,
          fontWeight: 700,
          color: "var(--green)",
          fontFamily: "var(--mono)",
          letterSpacing: "-0.03em",
          textShadow: atBestfly ? "0 0 30px var(--green-glow)" : "none",
          transition: "text-shadow 0.4s",
        }}>
          R${disp.toLocaleString("pt-BR")}
        </span>
      </div>

      {/* Savings row */}
      {atBestfly && (
        <div style={{
          borderTop: "1px dashed var(--border)",
          paddingTop: 12,
          display: "flex",
          justifyContent: "space-between",
          animation: "fade-in-up 0.4s ease both",
        }}>
          <span style={{ fontSize: 12, color: "var(--muted2)" }}>you'd overpay by</span>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--red)", fontFamily: "var(--mono)" }}>
              R${savings.toLocaleString("pt-BR")}
            </span>
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--on-accent)",
              background: "var(--red)",
              padding: "2px 7px",
              borderRadius: 5,
              fontFamily: "var(--mono)",
            }}>
              -{pct}%
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export function Landing({ onStart, theme, onToggleTheme }: Props) {
  const [dealsCount] = useState(DEALS_TODAY);
  const [savingsInput, setSavingsInput] = useState("");
  const [overpaid, setOverpaid] = useState<number | null>(null);

  function calcOverpaid() {
    const val = parseFloat(savingsInput.replace(/[^\d]/g, ""));
    if (val > 100) {
      const fair = Math.round(val * (0.42 + Math.random() * 0.12));
      setOverpaid(Math.max(0, val - fair));
    }
  }

  const tickerContent = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Nav */}
      <nav style={{ padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--mono)", color: "var(--green)", fontSize: 16, fontWeight: 700, letterSpacing: -0.5 }}>
          bestfly<span style={{ color: "var(--muted)" }}>.day</span>
        </span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {/* StatTicker — animated count */}
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            <span style={{ color: "var(--green)" }}>●</span>{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              <AnimatedNumber value={dealsCount} duration={1400} from={0} />
            </span>
            {" "}deals found today
          </span>
          {onToggleTheme && (
            <button
              onClick={onToggleTheme}
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
              {theme ?? "◑"} →
            </button>
          )}
        </div>
      </nav>

      {/* Live ticker */}
      <div style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", padding: "8px 0", overflow: "hidden" }}>
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)",
          }}
        >
          <div className="ticker-track" style={{ display: "inline-flex", gap: 0, animation: "ticker-scroll 32s linear infinite" }}>
            {tickerContent.map((item, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 14px",
                  margin: "0 6px",
                  background: "var(--bg-elevated)",
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  fontSize: 12,
                  fontFamily: "var(--mono)",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
                <span style={{ color: "var(--muted2)" }}>Saved</span>
                <span style={{ color: "var(--green)", fontWeight: 700 }}>{item.saved}</span>
                <span style={{ color: "var(--text)" }}>{item.route}</span>
                <span style={{ color: "var(--muted)", fontSize: 11 }}>· {item.ago} ago</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="bf-hero" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "72px 48px", gap: 64 }}>

        {/* Left: copy */}
        <div style={{ flex: "1 1 0", minWidth: 0, maxWidth: 560 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--green-bg)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 20, padding: "6px 14px", marginBottom: 32, fontSize: 12, color: "var(--green)", fontFamily: "var(--mono)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", animation: "pulse-green 2s infinite", display: "inline-block" }} />
            Split-ticket intelligence engine
          </div>

          <h1 style={{ fontSize: "clamp(40px, 5.5vw, 76px)", fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, marginBottom: 20 }}>
            Stop overpaying<br />
            <span style={{ color: "var(--green)" }}>for flights.</span>
          </h1>

          <p style={{ fontSize: 17, color: "var(--muted2)", lineHeight: 1.65, marginBottom: 40, maxWidth: 460 }}>
            We split your trip into a cheap long-haul + a low-cost European hop — two tickets that beat one overpriced fare.{" "}
            <span style={{ color: "var(--ink-2)" }}>Same destination, half the price.</span>
          </p>

          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={onStart} style={{ fontSize: 16, padding: "16px 36px" }}>
              Find loopholes →
            </button>
            <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>no signup · no bullshit · just prices</span>
          </div>
        </div>

        {/* Right: animated price card */}
        <div style={{ flexShrink: 0 }}>
          <PriceCountdown />
        </div>
      </div>

      {/* Overpay calculator */}
      <div style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border)", padding: "48px 24px" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>How much did you overpay?</h2>
          <p style={{ color: "var(--muted2)", fontSize: 14, marginBottom: 24 }}>Enter the price of your last Brazil → Europe flight</p>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", fontFamily: "var(--mono)", fontSize: 15 }}>R$</span>
              <input
                className="bf-input"
                placeholder="4.200"
                value={savingsInput}
                onChange={(e) => setSavingsInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && calcOverpaid()}
                style={{ textAlign: "right", fontSize: 18, fontFamily: "var(--mono)", paddingLeft: 36 }}
              />
            </div>
            <button className="btn-primary" onClick={calcOverpaid} style={{ padding: "10px 20px", whiteSpace: "nowrap" }}>
              Expose it
            </button>
          </div>

          {overpaid !== null && (
            <div style={{
              marginTop: 20,
              animation: "fade-in-up 0.4s ease",
              padding: "20px",
              background: overpaid > 0 ? "var(--red-bg)" : "var(--green-bg)",
              border: `1px solid ${overpaid > 0 ? "var(--red)" : "var(--green)"}`,
              borderRadius: 10,
            }}>
              {overpaid > 0 ? (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: "var(--muted2)" }}>you overpaid</span>
                    <span style={{ fontSize: 36, fontWeight: 700, color: "var(--red)", fontFamily: "var(--mono)", letterSpacing: "-0.03em" }}>
                      R$<AnimatedNumber value={overpaid} duration={900} from={0} />
                    </span>
                    <span style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: "var(--on-accent)",
                      background: "var(--red)",
                      padding: "3px 8px",
                      borderRadius: 5,
                      fontFamily: "var(--mono)",
                    }}>
                      ouch
                    </span>
                  </div>
                  <div style={{ color: "var(--muted2)", fontSize: 14, marginTop: 8 }}>That's a whole extra trip. Ouch.</div>
                </>
              ) : (
                <div style={{ color: "var(--green)", fontSize: 16 }}>You already got a great deal ✓</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--mono)", color: "var(--muted)", fontSize: 12 }}>bestfly.day</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>powered by split-ticketing · not affiliated with any airline</span>
      </div>
    </div>
  );
}
