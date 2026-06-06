import { useEffect, useRef, useState } from "react";

export interface LogLine {
  kind: "ok" | "info" | "warn" | "error";
  text: string;
}

interface Props {
  lines: LogLine[];
  active: boolean;
}

function TypewriterLine({ text, instant }: { text: string; instant: boolean }) {
  const [shown, setShown] = useState(instant ? text.length : 0);

  useEffect(() => {
    if (instant) { setShown(text.length); return; }
    setShown(0);
  }, [text, instant]);

  useEffect(() => {
    if (shown >= text.length) return;
    // Speed: shorter = slower (more dramatic), longer = faster (don't drag)
    const speed = Math.max(8, 28 - Math.floor(text.length / 3));
    const t = setTimeout(() => setShown((n) => n + 1), speed);
    return () => clearTimeout(t);
  }, [shown, text]);

  const done = shown >= text.length;
  return (
    <>
      {text.slice(0, shown)}
      {!done && (
        <span
          style={{
            display: "inline-block",
            width: 5,
            height: "0.85em",
            background: "var(--green)",
            marginLeft: 1,
            verticalAlign: "text-bottom",
            animation: "blink 0.7s step-end infinite",
          }}
        />
      )}
    </>
  );
}

export function TerminalLog({ lines, active }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div
      style={{
        background: "var(--terminal-bg)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Terminal chrome */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 9, background: "var(--crimson-dim)", display: "inline-block" }} />
          <span style={{ width: 10, height: 10, borderRadius: 9, background: "var(--amber)", display: "inline-block" }} />
          <span style={{ width: 10, height: 10, borderRadius: 9, background: "var(--green)", display: "inline-block" }} />
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)", marginLeft: 4 }}>
          bestfly — finding loopholes
        </span>
      </div>

      {/* Log body */}
      <div
        style={{
          padding: "14px 16px",
          fontFamily: "var(--mono)",
          fontSize: 12,
          lineHeight: 1.85,
          minHeight: 80,
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        <div style={{ color: "var(--muted)", marginBottom: 6, fontSize: 11 }}>
          <span style={{ color: "var(--green)" }}>~/bestfly</span> $ run matrix search
        </div>

        {lines.map((l, i) => {
          const isLast = i === lines.length - 1;
          return (
            <div key={i} style={{ animation: "fade-in-up 0.2s ease both" }}>
              <span
                style={{
                  color:
                    l.kind === "ok"
                      ? "var(--green)"
                      : l.kind === "error"
                      ? "var(--red)"
                      : "var(--muted)",
                }}
              >
                {l.kind === "ok" ? "✓ " : l.kind === "error" ? "✗ " : "› "}
              </span>
              <span
                style={{
                  color:
                    l.kind === "ok"
                      ? "var(--text)"
                      : l.kind === "error"
                      ? "var(--red)"
                      : "var(--muted2)",
                }}
              >
                {/* Only typewrite the last line; rest show instantly */}
                <TypewriterLine text={l.text} instant={!isLast} />
              </span>
            </div>
          );
        })}

        {active && lines.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>$ </span>
            <span className="cursor-blink" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
