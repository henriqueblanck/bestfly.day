import { useState, useRef, useEffect, useId } from "react";
import { searchAirports } from "../data/airports";
import type { Airport } from "../data/airports";

interface Props {
  label: string;
  hint?: string;
  value: string[];          // list of IATA codes
  onChange: (codes: string[]) => void;
  max?: number;
  placeholder?: string;
}

export function AirportTagInput({ label, hint, value, onChange, max = 10, placeholder = "cidade ou código..." }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const suggestions = searchAirports(query);

  useEffect(() => { setCursor(0); }, [query]);

  function addCode(iata: string) {
    if (!value.includes(iata) && value.length < max) {
      onChange([...value, iata]);
    }
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeCode(iata: string) {
    onChange(value.filter((c) => c !== iata));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && suggestions[cursor]) {
      e.preventDefault();
      addCode(suggestions[cursor].iata);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && value.length > 0) {
      removeCode(value[value.length - 1]);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    color: "var(--muted2)",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
    fontFamily: "var(--mono)",
  };

  return (
    <div style={{ position: "relative" }}>
      <label htmlFor={id} style={labelStyle}>{label}</label>

      {/* Tag + input box */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "7px 10px",
          background: "var(--bg-elevated)",
          border: `1px solid ${open ? "var(--green)" : "var(--border)"}`,
          borderRadius: 8,
          cursor: "text",
          minHeight: 42,
          alignItems: "center",
          transition: "border-color 0.2s",
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((iata) => (
          <span
            key={iata}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "var(--green-bg)",
              border: "1px solid var(--green)",
              borderRadius: 6,
              padding: "2px 8px",
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--green)",
              lineHeight: 1.6,
            }}
          >
            {iata}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeCode(iata); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--green)",
                cursor: "pointer",
                fontSize: 13,
                lineHeight: 1,
                padding: 0,
                opacity: 0.7,
              }}
              aria-label={`Remove ${iata}`}
            >
              ×
            </button>
          </span>
        ))}

        <input
          id={id}
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={handleKey}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={value.length >= max}
          style={{
            flex: "1 1 120px",
            minWidth: 80,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--text)",
            fontFamily: "var(--font)",
            fontSize: 14,
            padding: "2px 4px",
          }}
          autoComplete="off"
        />
      </div>

      {hint && (
        <span style={{ display: "block", fontSize: 11, color: "var(--muted)", marginTop: 5 }}>
          {hint}
        </span>
      )}

      {/* Dropdown */}
      {open && suggestions.length > 0 && (
        <ul
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface-2)",
            border: "1px solid var(--border-bright)",
            borderRadius: 10,
            zIndex: 500,
            listStyle: "none",
            margin: 0,
            padding: "4px 0",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {suggestions.map((apt, i) => (
            <SuggestionRow
              key={apt.iata}
              airport={apt}
              selected={value.includes(apt.iata)}
              active={i === cursor}
              onMouseEnter={() => setCursor(i)}
              onClick={() => addCode(apt.iata)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionRow({
  airport,
  selected,
  active,
  onMouseEnter,
  onClick,
}: {
  airport: Airport;
  selected: boolean;
  active: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const flagMap: Record<string, string> = {
    BR: "🇧🇷", ES: "🇪🇸", PT: "🇵🇹", FR: "🇫🇷", NL: "🇳🇱",
    IT: "🇮🇹", GB: "🇬🇧", DE: "🇩🇪", AT: "🇦🇹", CZ: "🇨🇿",
    HU: "🇭🇺", PL: "🇵🇱", GR: "🇬🇷", DK: "🇩🇰", SE: "🇸🇪",
    NO: "🇳🇴", FI: "🇫🇮", IE: "🇮🇪", BE: "🇧🇪", CH: "🇨🇭",
    HR: "🇭🇷", SI: "🇸🇮", BG: "🇧🇬", RO: "🇷🇴", RS: "🇷🇸",
    MK: "🇲🇰", AL: "🇦🇱", CY: "🇨🇾", IL: "🇮🇱", TR: "🇹🇷",
  };
  const flag = flagMap[airport.country] ?? "✈";

  return (
    <li
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 14px",
        cursor: selected ? "default" : "pointer",
        background: active ? "rgba(255,255,255,0.05)" : "transparent",
        opacity: selected ? 0.45 : 1,
        transition: "background 0.1s",
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{flag}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13 }}>
          {airport.city}
        </span>
        <span style={{ color: "var(--ink-3)", fontSize: 11, marginLeft: 6 }}>
          {airport.name}
        </span>
      </span>
      <span style={{
        fontFamily: "var(--mono)",
        fontSize: 12,
        fontWeight: 700,
        color: selected ? "var(--green)" : "var(--ink-2)",
        flexShrink: 0,
      }}>
        {selected ? "✓ " : ""}{airport.iata}
      </span>
    </li>
  );
}
