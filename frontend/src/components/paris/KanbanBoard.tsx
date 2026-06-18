import { useState, useRef } from "react";
import type { ParisPlan, PColumn } from "../../api/paris";

const CAT_COLORS: Record<string, string> = {
  monument: "#1F8A52",
  museum:   "#3B6FB5",
  hood:     "#E0A03C",
  park:     "#2F6B4F",
  food:     "#E8743B",
};

const CAT_LABELS: Record<string, string> = {
  monument: "Monumentos",
  museum:   "Museus",
  hood:     "Bairros",
  park:     "Parques",
  food:     "Gastronomia",
};

const CAT_ORDER = ["monument", "museum", "hood", "park", "food"];

const DAY_COLORS = ["#C0492F", "#3B6FB5", "#2F6B4F", "#C2851A", "#7A4E8C", "#2F7E7A", "#B5536B", "#4D6A2E"];

function cardHeight(min: number) {
  return Math.max(58, Math.min(208, Math.round(46 + min * 0.66)));
}

function fmtDur(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

function colTotal(plan: ParisPlan, col: PColumn) {
  return fmtDur(col.items.reduce((s, id) => s + (plan.places[id]?.duration ?? 0), 0));
}

function dayColorOf(col: PColumn, allCols: PColumn[]) {
  if (col.color) return col.color;
  const dayIdx = allCols.filter(c => !c.isPool).indexOf(col);
  return DAY_COLORS[dayIdx % DAY_COLORS.length];
}

interface Props {
  plan: ParisPlan;
  onChange: (plan: ParisPlan) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

interface DragState { id: string; colId: string }
interface DropState { colId: string; idx: number }

export function KanbanBoard({ plan, onChange, selectedId, onSelect, hoveredId, onHover }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [openCats, setOpenCats] = useState<Set<string>>(
    () => new Set(CAT_ORDER)
  );
  const dragRef = useRef<DragState | null>(null);
  const colBodyRefs = useRef<Record<string, HTMLDivElement | null>>({});

  function toggleCat(cat: string) {
    setOpenCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function addDay() {
    const dayCount = plan.columns.filter(c => !c.isPool).length;
    onChange({
      ...plan,
      columns: [...plan.columns, {
        id: `d${Date.now()}`,
        label: `Dia ${dayCount + 1}`,
        isPool: false,
        items: [],
        date: "",
        color: DAY_COLORS[dayCount % DAY_COLORS.length],
      }],
    });
  }

  function removeDay(colId: string) {
    const col = plan.columns.find(c => c.id === colId)!;
    onChange({
      ...plan,
      columns: plan.columns
        .filter(c => c.id !== colId)
        .map(c => c.isPool ? { ...c, items: [...c.items, ...col.items] } : c),
    });
  }

  function updateDate(colId: string, date: string) {
    onChange({ ...plan, columns: plan.columns.map(c => c.id === colId ? { ...c, date } : c) });
  }

  function updateDuration(id: string, minutes: number) {
    onChange({ ...plan, places: { ...plan.places, [id]: { ...plan.places[id], duration: minutes } } });
  }

  function moveToPool(id: string) {
    onChange({
      ...plan,
      columns: plan.columns.map(c => {
        if (!c.isPool && c.items.includes(id)) return { ...c, items: c.items.filter(i => i !== id) };
        if (c.isPool) return { ...c, items: [...c.items, id] };
        return c;
      }),
    });
  }

  function computeDropIdx(colId: string, clientY: number): number {
    const body = colBodyRefs.current[colId];
    if (!body) return 0;
    const cards = Array.from(body.querySelectorAll<HTMLElement>(".pp-card"));
    const col = plan.columns.find(c => c.id === colId);
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return col?.items.length ?? 0;
  }

  function handleDragStart(e: React.DragEvent, id: string, colId: string) {
    const state = { id, colId };
    setDrag(state);
    dragRef.current = state;
    e.dataTransfer.effectAllowed = "move";
    setTimeout(() => (e.target as HTMLElement).classList.add("dragging"), 0);
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.target as HTMLElement).classList.remove("dragging");
    setDrag(null);
    setDrop(null);
    dragRef.current = null;
  }

  function handleDragOver(e: React.DragEvent, colId: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const col = plan.columns.find(c => c.id === colId);
    // Pool: always append — order doesn't matter, displayed by category
    const idx = col?.isPool ? (col.items.length) : computeDropIdx(colId, e.clientY);
    setDrop(prev => prev?.colId === colId && prev?.idx === idx ? prev : { colId, idx });
  }

  function handleDragLeave(e: React.DragEvent, colId: string) {
    const body = colBodyRefs.current[colId];
    if (!body || !body.contains(e.relatedTarget as Node)) {
      setDrop(prev => prev?.colId === colId ? null : prev);
    }
  }

  function handleDrop(e: React.DragEvent, colId: string) {
    e.preventDefault();
    const state = dragRef.current;
    if (!state) return;
    const col = plan.columns.find(c => c.id === colId);
    const idx = col?.isPool ? (col.items.length) : computeDropIdx(colId, e.clientY);
    applyMove(state.id, state.colId, colId, idx);
    setDrag(null);
    setDrop(null);
    dragRef.current = null;
  }

  function applyMove(id: string, srcId: string, dstId: string, dstIdx: number) {
    onChange({
      ...plan,
      columns: plan.columns.map(c => {
        if (c.id === srcId && c.id === dstId) {
          const items = c.items.filter(i => i !== id);
          const insertAt = Math.max(0, Math.min(
            dstIdx > c.items.indexOf(id) ? dstIdx - 1 : dstIdx,
            items.length,
          ));
          items.splice(insertAt, 0, id);
          return { ...c, items };
        }
        if (c.id === srcId) return { ...c, items: c.items.filter(i => i !== id) };
        if (c.id === dstId) {
          const items = [...c.items];
          items.splice(Math.max(0, Math.min(dstIdx, items.length)), 0, id);
          return { ...c, items };
        }
        return c;
      }),
    });
  }

  return (
    <div className="pp-board">
      {plan.columns.map((col) => {
        const isPool = col.isPool;
        const dayColor = isPool ? undefined : dayColorOf(col, plan.columns);
        const dropHere = drop?.colId === col.id;

        return (
          <div
            key={col.id}
            className={`pp-col${isPool ? " pool" : " day"}`}
            style={dayColor ? { "--cd": dayColor } as React.CSSProperties : undefined}
          >
            {/* Column header */}
            <div className="pp-col-head">
              <div className="pp-col-row1">
                {isPool
                  ? <span className="pp-pool-label">Sem data</span>
                  : (
                    <>
                      <div className="pp-col-swatch" />
                      <span className="pp-col-label">{col.label}</span>
                      <button className="pp-col-x" onClick={() => removeDay(col.id)}>×</button>
                    </>
                  )
                }
              </div>
              <div className="pp-col-row2">
                {!isPool && (
                  <input
                    type="date"
                    className="pp-date-input"
                    value={col.date ?? ""}
                    onChange={e => updateDate(col.id, e.target.value)}
                  />
                )}
                <div className="pp-col-meta" style={isPool ? { marginLeft: 0 } : undefined}>
                  <span>{col.items.length} <b>loc</b></span>
                  {!isPool && <span>{colTotal(plan, col)}</span>}
                </div>
              </div>
            </div>

            {/* Column body */}
            <div
              className={`pp-col-body${dropHere ? " dragover" : ""}`}
              ref={el => { colBodyRefs.current[col.id] = el; }}
              onDragOver={e => handleDragOver(e, col.id)}
              onDragLeave={e => handleDragLeave(e, col.id)}
              onDrop={e => handleDrop(e, col.id)}
            >
              {isPool
                ? <PoolGrouped
                    plan={plan}
                    col={col}
                    drag={drag}
                    dropHere={dropHere}
                    selectedId={selectedId}
                    hoveredId={hoveredId}
                    openCats={openCats}
                    onToggleCat={toggleCat}
                    onSelect={onSelect}
                    onHover={onHover}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDurationChange={updateDuration}
                  />
                : <DayItems
                    plan={plan}
                    col={col}
                    drag={drag}
                    drop={drop}
                    selectedId={selectedId}
                    hoveredId={hoveredId}
                    onSelect={onSelect}
                    onHover={onHover}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDurationChange={updateDuration}
                    onMoveToPool={moveToPool}
                  />
              }
            </div>
          </div>
        );
      })}

      <button className="pp-add-day" onClick={addDay}>
        <span className="plus">+</span>
        <span className="t">dia</span>
      </button>
    </div>
  );
}

/* ── Pool grouped by category ── */

interface PoolGroupedProps {
  plan: ParisPlan;
  col: PColumn;
  drag: DragState | null;
  dropHere: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  openCats: Set<string>;
  onToggleCat: (cat: string) => void;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onDragStart: (e: React.DragEvent, id: string, colId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDurationChange: (id: string, m: number) => void;
}

function PoolGrouped({ plan, col, drag, dropHere, selectedId, hoveredId, openCats, onToggleCat, onSelect, onHover, onDragStart, onDragEnd, onDurationChange }: PoolGroupedProps) {
  if (col.items.length === 0) {
    return <div className="pp-dropzone">{dropHere ? "soltar aqui →" : "arraste locais aqui"}</div>;
  }

  // Build groups in fixed order
  const grouped = new Map<string, string[]>();
  for (const id of col.items) {
    const cat = plan.places[id]?.cat ?? "outro";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(id);
  }

  const sortedGroups = [...grouped.entries()].sort(
    ([a], [b]) => (CAT_ORDER.indexOf(a) === -1 ? 99 : CAT_ORDER.indexOf(a)) -
                  (CAT_ORDER.indexOf(b) === -1 ? 99 : CAT_ORDER.indexOf(b))
  );

  return (
    <>
      {sortedGroups.map(([cat, ids]) => {
        const color = CAT_COLORS[cat] ?? "#888";
        const open = openCats.has(cat);
        return (
          <div key={cat} style={{ marginBottom: 4 }}>
            {/* Category header */}
            <button
              onClick={() => onToggleCat(cat)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "transparent",
                border: "none",
                borderRadius: "var(--r-sm)",
                padding: "5px 6px",
                cursor: "pointer",
                marginBottom: open ? 5 : 0,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--ink-2)", textAlign: "left" }}>
                {CAT_LABELS[cat] ?? cat}
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-3)" }}>{ids.length}</span>
              <span style={{ fontSize: 9, color: "var(--ink-3)", marginLeft: 2 }}>{open ? "▾" : "▸"}</span>
            </button>

            {open && ids.map(id => {
              const place = plan.places[id];
              if (!place) return null;
              return (
                <PlaceCard
                  key={id}
                  place={place}
                  catColor={color}
                  selected={selectedId === id}
                  hovered={hoveredId === id}
                  isDragging={drag?.id === id}
                  inDay={false}
                  onDragStart={e => onDragStart(e, id, col.id)}
                  onDragEnd={onDragEnd}
                  onClick={() => onSelect(selectedId === id ? null : id)}
                  onHover={onHover}
                  onDurationChange={m => onDurationChange(id, m)}
                />
              );
            })}
          </div>
        );
      })}
      {dropHere && <div className="pp-drop-line" />}
    </>
  );
}

/* ── Day column items (ordered, with drop lines) ── */

interface DayItemsProps {
  plan: ParisPlan;
  col: PColumn;
  drag: DragState | null;
  drop: DropState | null;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onDragStart: (e: React.DragEvent, id: string, colId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDurationChange: (id: string, m: number) => void;
  onMoveToPool: (id: string) => void;
}

function DayItems({ plan, col, drag, drop, selectedId, hoveredId, onSelect, onHover, onDragStart, onDragEnd, onDurationChange, onMoveToPool }: DayItemsProps) {
  const dropHere = drop?.colId === col.id;

  if (col.items.length === 0 && !dropHere) {
    return <div className="pp-dropzone">arraste locais aqui</div>;
  }

  return (
    <>
      {col.items.map((id, itemIdx) => {
        const place = plan.places[id];
        if (!place) return null;
        const catColor = CAT_COLORS[place.cat] ?? "#888";
        return (
          <div key={id}>
            {dropHere && drop!.idx === itemIdx && drag?.id !== id && (
              <div className="pp-drop-line" />
            )}
            <PlaceCard
              place={place}
              catColor={catColor}
              selected={selectedId === id}
              hovered={hoveredId === id}
              isDragging={drag?.id === id}
              inDay
              onDragStart={e => onDragStart(e, id, col.id)}
              onDragEnd={onDragEnd}
              onClick={() => onSelect(selectedId === id ? null : id)}
              onHover={onHover}
              onDurationChange={m => onDurationChange(id, m)}
              onRemove={() => onMoveToPool(id)}
            />
          </div>
        );
      })}
      {dropHere && drop!.idx >= col.items.length && (
        <div className="pp-drop-line" />
      )}
    </>
  );
}

/* ── Place card ── */

interface PlaceCardProps {
  place: { id: string; name: string; cat: string; duration: number; ticket?: string };
  catColor: string;
  selected: boolean;
  hovered: boolean;
  isDragging: boolean;
  inDay: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onClick: () => void;
  onHover: (id: string | null) => void;
  onDurationChange: (m: number) => void;
  onRemove?: () => void;
}

function PlaceCard({ place, catColor, selected, hovered, isDragging, inDay, onDragStart, onDragEnd, onClick, onHover, onDurationChange, onRemove }: PlaceCardProps) {
  return (
    <div
      className={`pp-card${selected ? " sel" : ""}${isDragging ? " dragging" : ""}${hovered ? " hover" : ""}`}
      style={{ "--c": catColor, height: inDay ? cardHeight(place.duration) + "px" : undefined } as React.CSSProperties}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onMouseEnter={() => onHover(place.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div>
        <div className="pp-card-name">{place.name}</div>
        <div className="pp-card-cat">
          {place.cat}
          {place.ticket && <span className={`pp-card-tk ${place.ticket}`}> · {place.ticket}</span>}
        </div>
      </div>
      <div className="pp-card-foot">
        <div
          className="pp-dur"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <button onClick={() => onDurationChange(Math.max(15, place.duration - 15))}>−</button>
          <span className="val">{fmtDur(place.duration)}</span>
          <button onClick={() => onDurationChange(place.duration + 15)}>+</button>
        </div>
        {onRemove && (
          <button
            className="pp-card-rm"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onRemove(); }}
            title="Mover para sem data"
          >×</button>
        )}
      </div>
    </div>
  );
}
