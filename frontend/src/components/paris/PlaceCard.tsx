import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const CAT_COLOR: Record<string, string> = {
  monumento:   "var(--green)",
  museu:       "#7ab8ff",
  bairro:      "var(--amber)",
  parque:      "#90ee90",
  gastronomia: "#ff9a5c",
};

interface Place {
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}

interface Props {
  place: Place;
  minutes: number;
  dayColor?: string;
  isDragging?: boolean;
  highlighted?: boolean;
  onMinutesChange: (m: number) => void;
  onRemove: (() => void) | undefined;
  onHover: (id: string | null) => void;
}

export function PlaceCard({ place, minutes, dayColor, highlighted, onMinutesChange, onRemove, onHover }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: place.id });

  const catColor = CAT_COLOR[place.category] ?? "var(--ink-3)";
  const accentColor = dayColor ?? catColor;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const durLabel = hrs > 0 ? (mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`) : `${mins}m`;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
        background: highlighted ? "var(--green-bg)" : "var(--surface-2)",
        border: `1px solid ${highlighted ? "var(--green)" : "var(--line)"}`,
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: "var(--r-sm)",
        padding: "7px 10px",
        cursor: "grab",
        display: "flex",
        alignItems: "center",
        gap: 8,
        userSelect: "none",
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.5)" : undefined,
      }}
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
      {...attributes}
      {...listeners}
    >
      <span style={{ color: "var(--line-2)", fontSize: 14, flexShrink: 0, pointerEvents: "none" }}>⠿</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {place.name}
        </div>
        <div style={{ fontSize: 9, color: catColor, fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 }}>
          {place.category}
        </div>
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button onClick={() => onMinutesChange(Math.max(15, minutes - 15))} style={btnStyle} title="−15min">−</button>
        <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--ink-2)", minWidth: 32, textAlign: "center" }}>
          {durLabel}
        </span>
        <button onClick={() => onMinutesChange(minutes + 15)} style={btnStyle} title="+15min">+</button>
      </div>

      {onRemove ? (
        <button
          onClick={onRemove}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ ...btnStyle, color: "var(--ink-3)", fontSize: 14, padding: "0 4px", width: "auto" }}
          title="Mover para sem data"
        >×</button>
      ) : (
        <div style={{ width: 20 }} />
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--line-2)",
  color: "var(--ink-3)",
  borderRadius: 4,
  width: 20,
  height: 20,
  fontSize: 12,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  flexShrink: 0,
};
