import { useEffect, useState } from "react";

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

interface Props {
  onStart: () => void;
}

export function Landing({ onStart }: Props) {
  const [strikeVisible, setStrikeVisible] = useState(false);
  const [bestflyVisible, setBestflyVisible] = useState(false);
  const [savingsInput, setSavingsInput] = useState("");
  const [overpaid, setOverpaid] = useState<number | null>(null);

  useEffect(() => {
    const t1 = setTimeout(() => setStrikeVisible(true), 800);
    const t2 = setTimeout(() => setBestflyVisible(true), 1400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  function calcOverpaid() {
    const val = parseFloat(savingsInput.replace(/\D/g, ""));
    if (val > 0) setOverpaid(Math.max(0, val - BESTFLY_PRICE));
  }

  const tickerContent = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>

      {/* Nav */}
      <nav style={{ padding: "20px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontFamily: "var(--mono)", color: "var(--green)", fontSize: 16, fontWeight: 700, letterSpacing: -0.5 }}>
          bestfly<span style={{ color: "var(--muted)" }}>.day</span>
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)" }}>
            <span style={{ color: "var(--green)" }}>●</span> 847 deals found today
          </span>
        </div>
      </nav>

      {/* Live ticker */}
      <div style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border)", padding: "8px 0", overflow: "hidden" }}>
        <div className="ticker-wrap">
          <div className="ticker-track">
            {tickerContent.map((item, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0 32px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--muted2)" }}>
                <span style={{ color: "var(--green)", fontSize: 10 }}>↑</span>
                <span style={{ color: "var(--text)" }}>{item.route}</span>
                <span>·</span>
                <span style={{ color: "var(--green)", fontWeight: 700 }}>saved {item.saved}</span>
                <span>·</span>
                <span style={{ color: "var(--muted)", fontSize: 11 }}>{item.ago} ago</span>
                <span style={{ color: "var(--border-bright)", marginLeft: 16 }}>·</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Hero */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 24px", textAlign: "center" }}>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--green-bg)", border: "1px solid rgba(0,255,136,0.2)", borderRadius: 20, padding: "6px 14px", marginBottom: 32, fontSize: 12, color: "var(--green)", fontFamily: "var(--mono)" }}>
          <span style={{ animation: "pulse-green 2s infinite", display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }} />
          Split-ticket intelligence engine
        </div>

        <h1 style={{ fontSize: "clamp(40px, 7vw, 80px)", fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 800, marginBottom: 20 }}>
          Stop overpaying<br />
          <span style={{ color: "var(--green)" }}>for flights.</span>
        </h1>

        <p style={{ fontSize: 18, color: "var(--muted2)", maxWidth: 520, lineHeight: 1.6, marginBottom: 56 }}>
          We combine cheap transatlantic legs with European low-cost carriers to find prices airlines don't want you to see.
        </p>

        {/* Price comparison card */}
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "28px 40px", marginBottom: 48, display: "inline-flex", flexDirection: "column", gap: 16, minWidth: 320 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)", letterSpacing: 1, textAlign: "left" }}>GRU → BCN · 2 passengers · Jul 15</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32 }}>
              <span style={{ fontSize: 13, color: "var(--muted2)" }}>Airline direct</span>
              <span style={{ position: "relative", display: "inline-block" }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: "var(--muted)", fontFamily: "var(--mono)" }}>
                  R$4.200
                </span>
                {strikeVisible && (
                  <span style={{
                    position: "absolute", left: 0, top: "50%",
                    height: 2, background: "var(--red)",
                    animation: "strike-through 0.4s ease forwards",
                    width: "100%",
                  }} />
                )}
              </span>
            </div>
            {bestflyVisible && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 32, animation: "fade-in-up 0.4s ease forwards" }}>
                <span style={{ fontSize: 13, color: "var(--green)", fontFamily: "var(--mono)" }}>bestfly ✦</span>
                <span style={{ fontSize: 28, fontWeight: 700, color: "var(--green)", fontFamily: "var(--mono)" }}>R$1.890</span>
              </div>
            )}
          </div>
          {bestflyVisible && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", justifyContent: "space-between", animation: "fade-in 0.5s 0.3s ease both" }}>
              <span style={{ fontSize: 12, color: "var(--muted2)" }}>you save</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--green)", fontFamily: "var(--mono)" }}>R$2.310 (55%)</span>
            </div>
          )}
        </div>

        <button className="btn-primary" onClick={onStart} style={{ fontSize: 16, padding: "16px 40px", marginBottom: 20 }}>
          Find loopholes →
        </button>
        <p style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--mono)" }}>no signup · no bullshit · just prices</p>
      </div>

      {/* Savings calculator */}
      <div style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border)", padding: "48px 24px" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>How much did you overpay?</h2>
          <p style={{ color: "var(--muted2)", fontSize: 14, marginBottom: 24 }}>Enter the price of your last Brazil → Europe flight</p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="bf-input"
              placeholder="R$ 0.000"
              value={savingsInput}
              onChange={(e) => setSavingsInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && calcOverpaid()}
              style={{ textAlign: "center", fontSize: 18, fontFamily: "var(--mono)" }}
            />
            <button className="btn-primary" onClick={calcOverpaid} style={{ padding: "10px 20px", whiteSpace: "nowrap" }}>
              Check
            </button>
          </div>
          {overpaid !== null && (
            <div style={{ marginTop: 20, animation: "fade-in-up 0.4s ease", padding: "20px", background: overpaid > 0 ? "var(--red-bg)" : "var(--green-bg)", border: `1px solid ${overpaid > 0 ? "var(--red)" : "var(--green)"}`, borderRadius: 10 }}>
              {overpaid > 0 ? (
                <>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--red)", fontFamily: "var(--mono)" }}>R${overpaid.toLocaleString("pt-BR")}</div>
                  <div style={{ color: "var(--muted2)", fontSize: 14, marginTop: 4 }}>overpaid. That's a whole extra trip.</div>
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
