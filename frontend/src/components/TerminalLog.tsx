import { useEffect, useRef } from "react";

export interface LogLine {
  kind: "ok" | "info" | "warn" | "error";
  text: string;
}

interface Props {
  lines: LogLine[];
  active: boolean;
}

export function TerminalLog({ lines, active }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="terminal">
      <div style={{ color: "var(--muted)", marginBottom: 8, fontSize: 11 }}>
        <span style={{ color: "var(--green)" }}>~/bestfly</span> $ run matrix search
      </div>
      {lines.map((l, i) => (
        <div key={i} className={`terminal-line ${l.kind}`}>
          {l.kind === "ok" && "✓ "}
          {l.kind === "info" && "→ "}
          {l.kind === "warn" && "⚠ "}
          {l.kind === "error" && "✗ "}
          {l.text}
        </div>
      ))}
      {active && (
        <div style={{ color: "var(--muted2)" }}>
          <span className="cursor-blink" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
