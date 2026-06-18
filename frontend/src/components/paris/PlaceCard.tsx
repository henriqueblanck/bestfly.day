import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const CAT_COLOR: Record<string, string> = {
  monumento: "#00ff88",
  museu:     "#7ab8ff",
  bairro:    "#ffd700",
  parque:    "#90ee90",
  gastronomia: "#ff9a5c",
};

interface Place {
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}

interface Props {
  place: Place;
  minutes: number;
  dayLabel?: string;
  highlighted?: boolean;
  onMinutesChange: (m: number) => void;
  onRemove: () => void;
  onHover: (id: string | null) => void;
}

export function PlaceCard({ place, minutes, dayLabel, highlighted, onMinutesChange, onRemove, onHover }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: place.id });

  const color = CAT_COLOR[place.category] ?? "#888";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const durLabel = hrs > 0 ? (mins > 0 ? `${hrs}h${mins}m` : `${hrs}h`) : `${mins}m`;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        background: highlighted ? "rgba(0,255,136,0.07)" : "var(--surface-2, #1a1a1a)",
        border: `1px solid ${highlighted ? "#00ff88" : "var(--line, #2a2a2a)"}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        padding: "8px 10px",
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
      {/* Drag handle visual cue */}
      <span style={{ color: "#444", fontSize: 14, flexShrink: 0, pointerEvents: "none" }}>⠿</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink, #eee)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {place.name}
        </div>
        <div style={{ fontSize: 10, color: "var(--ink-3, #666)", marginTop: 1 }}>
          <span style={{ color, fontSize: 9, fontFamily: "var(--mono, monospace)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            {place.category}
          </span>
          {dayLabel && (
            <span style={{ marginLeft: 6, color: "#555" }}>{dayLabel}</span>
          )}
        </div>
      </div>

      {/* Duration editor */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => onMinutesChange(Math.max(15, minutes - 15))}
          style={btnStyle}
          title="−15min"
        >−</button>
        <span style={{ fontSize: 11, fontFamily: "var(--mono, monospace)", color: "#aaa", minWidth: 34, textAlign: "center" }}>
          {durLabel}
        </span>
        <button
          onClick={() => onMinutesChange(minutes + 15)}
          style={btnStyle}
          title="+15min"
        >+</button>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ ...btnStyle, color: "#555", fontSize: 14, padding: "0 4px" }}
        title="Remover do roteiro"
      >×</button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid #333",
  color: "#888",
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
