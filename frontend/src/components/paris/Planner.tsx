import { useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCenter, useDroppable, type Active, type Over,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { PlaceCard } from "./PlaceCard";
import type { ParisItinerary, ParisEntry } from "../../api/paris";

const DAY_COLORS = [
  "var(--green)", "#7ab8ff", "var(--amber)", "#ff9a5c", "#c084fc", "#f472b6", "#34d399",
];

interface Place {
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}

interface Props {
  places: Place[];
  itinerary: ParisItinerary;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onMarkerFocus: (id: string) => void;
  onChange: (next: ParisItinerary) => void;
  onSelect?: (id: string) => void;
}

function fmtTotal(entries: ParisEntry[]): string {
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  if (!total) return "";
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? (m ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

function findContainer(itin: ParisItinerary, placeId: string): string | null {
  if (itin.pool.some(e => e.placeId === placeId)) return "pool";
  for (const day of itin.days) {
    if (day.entries.some(e => e.placeId === placeId)) return day.id;
  }
  return null;
}

function getEntries(itin: ParisItinerary, cid: string): ParisEntry[] {
  if (cid === "pool") return itin.pool;
  return itin.days.find(d => d.id === cid)?.entries ?? [];
}

function setEntries(itin: ParisItinerary, cid: string, entries: ParisEntry[]): ParisItinerary {
  if (cid === "pool") return { ...itin, pool: entries };
  return { ...itin, days: itin.days.map(d => d.id === cid ? { ...d, entries } : d) };
}

export function Planner({ places, itinerary, hoveredId, onHover, onChange, onSelect }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const placeMap = Object.fromEntries(places.map(p => [p.id, p]));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function onDragStart({ active }: { active: Active }) {
    const id = active.id as string;
    setDragId(id);
    setDragFrom(findContainer(itinerary, id));
  }

  function onDragEnd({ active, over }: { active: Active; over: Over | null }) {
    setDragId(null);
    setDragFrom(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const srcId = findContainer(itinerary, activeId);
    if (!srcId) return;

    // overId is either a container id or a place id
    const isContainerId = overId === "pool" || itinerary.days.some(d => d.id === overId);
    const dstId = isContainerId ? overId : (findContainer(itinerary, overId) ?? srcId);

    let next = itinerary;

    if (srcId === dstId) {
      if (!isContainerId) {
        const items = getEntries(next, srcId);
        const from = items.findIndex(e => e.placeId === activeId);
        const to = items.findIndex(e => e.placeId === overId);
        if (from !== -1 && to !== -1 && from !== to) {
          next = setEntries(next, srcId, arrayMove(items, from, to));
        }
      }
    } else {
      const srcItems = getEntries(next, srcId);
      const entry = srcItems.find(e => e.placeId === activeId)!;

      const dstItems = getEntries(next, dstId);
      const overIdx = isContainerId ? dstItems.length : dstItems.findIndex(e => e.placeId === overId);
      const insertAt = overIdx >= 0 ? overIdx : dstItems.length;

      next = setEntries(next, srcId, srcItems.filter(e => e.placeId !== activeId));
      next = setEntries(next, dstId, [
        ...getEntries(next, dstId).slice(0, insertAt),
        entry,
        ...getEntries(next, dstId).slice(insertAt),
      ]);
    }

    onChange(next);
  }

  function updateMinutes(cid: string, placeId: string, minutes: number) {
    onChange(setEntries(itinerary, cid, getEntries(itinerary, cid).map(e =>
      e.placeId === placeId ? { ...e, minutes } : e
    )));
  }

  function moveToPool(cid: string, placeId: string) {
    const items = getEntries(itinerary, cid);
    const entry = items.find(e => e.placeId === placeId)!;
    let next = setEntries(itinerary, cid, items.filter(e => e.placeId !== placeId));
    next = setEntries(next, "pool", [...next.pool, entry]);
    onChange(next);
  }

  function addDay() {
    onChange({
      ...itinerary,
      days: [...itinerary.days, {
        id: `day-${Date.now()}`,
        label: `Dia ${itinerary.days.length + 1}`,
        date: "",
        entries: [],
      }],
    });
  }

  function removeDay(dayId: string) {
    const day = itinerary.days.find(d => d.id === dayId)!;
    onChange({
      pool: [...itinerary.pool, ...day.entries],
      days: itinerary.days.filter(d => d.id !== dayId),
    });
  }

  function updateDate(dayId: string, date: string) {
    onChange({ ...itinerary, days: itinerary.days.map(d => d.id === dayId ? { ...d, date } : d) });
  }

  const dragEntry = dragId && dragFrom ? getEntries(itinerary, dragFrom).find(e => e.placeId === dragId) : null;
  const dragPlace = dragId ? placeMap[dragId] : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

        {/* Pool */}
        <Section label="Sem data" count={itinerary.pool.length}>
          <SortableContext id="pool" items={itinerary.pool.map(e => e.placeId)} strategy={verticalListSortingStrategy}>
            <DroppableZone id="pool" isEmpty={itinerary.pool.length === 0} accentColor="var(--line-2)">
              {itinerary.pool.map(entry => {
                const p = placeMap[entry.placeId];
                return p ? (
                  <PlaceCard
                    key={entry.placeId}
                    place={p}
                    minutes={entry.minutes}
                    isDragging={dragId === p.id}
                    highlighted={hoveredId === p.id}
                    onMinutesChange={m => updateMinutes("pool", p.id, m)}
                    onRemove={undefined}
                    onHover={onHover}
                    onSelect={() => onSelect?.(p.id)}
                  />
                ) : null;
              })}
            </DroppableZone>
          </SortableContext>
        </Section>

        {/* Days */}
        {itinerary.days.map((day, i) => {
          const color = DAY_COLORS[i % DAY_COLORS.length];
          const total = fmtTotal(day.entries);
          return (
            <Section
              key={day.id}
              label={day.label}
              count={day.entries.length}
              color={color}
              right={
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                  {total && <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>{total}</span>}
                  <input
                    type="date"
                    value={day.date}
                    onChange={e => updateDate(day.id, e.target.value)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      color: "var(--ink-2)",
                      fontSize: 11,
                      fontFamily: "var(--mono)",
                      padding: "2px 6px",
                      colorScheme: "dark",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => removeDay(day.id)}
                    style={{ background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
                    title="Remover dia"
                  >×</button>
                </div>
              }
            >
              <SortableContext id={day.id} items={day.entries.map(e => e.placeId)} strategy={verticalListSortingStrategy}>
                <DroppableZone id={day.id} isEmpty={day.entries.length === 0} accentColor={color}>
                  {day.entries.map(entry => {
                    const p = placeMap[entry.placeId];
                    return p ? (
                      <PlaceCard
                        key={entry.placeId}
                        place={p}
                        minutes={entry.minutes}
                        dayColor={color}
                        isDragging={dragId === p.id}
                        highlighted={hoveredId === p.id}
                        onMinutesChange={m => updateMinutes(day.id, p.id, m)}
                        onRemove={() => moveToPool(day.id, p.id)}
                        onHover={onHover}
                        onSelect={() => onSelect?.(p.id)}
                      />
                    ) : null;
                  })}
                </DroppableZone>
              </SortableContext>
            </Section>
          );
        })}

        {/* Add day */}
        <div style={{ padding: "12px 16px" }}>
          <button
            onClick={addDay}
            style={{
              width: "100%",
              background: "transparent",
              border: "1px dashed var(--line-2)",
              borderRadius: "var(--r-sm)",
              color: "var(--ink-3)",
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: "10px",
              cursor: "pointer",
              transition: "border-color 0.15s, color 0.15s",
            }}
            onMouseOver={e => { (e.currentTarget as HTMLElement).style.color = "var(--green)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--green)"; }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.color = "var(--ink-3)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--line-2)"; }}
          >
            + adicionar dia
          </button>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragPlace && dragEntry ? (
          <div style={{ transform: "rotate(2deg)", opacity: 0.95, width: "100%" }}>
            <PlaceCard
              place={dragPlace}
              minutes={dragEntry.minutes}
              highlighted={false}
              isDragging={false}
              onMinutesChange={() => {}}
              onRemove={undefined}
              onHover={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Droppable zone — registers as a drop target even when empty ──
function DroppableZone({ id, isEmpty, accentColor, children }: {
  id: string; isEmpty: boolean; accentColor: string; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 52,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "4px 0",
        borderRadius: "var(--r-sm)",
        background: isOver ? "var(--green-bg)" : "transparent",
        border: isOver ? `1px solid var(--green)` : isEmpty ? `1px dashed var(--line)` : "1px solid transparent",
        transition: "background 0.12s, border-color 0.12s",
      }}
    >
      {isEmpty ? (
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "12px",
        }}>
          <span style={{
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: isOver ? "var(--green)" : "var(--ink-3)",
            transition: "color 0.12s",
          }}>
            {isOver ? "soltar aqui →" : "arraste locais aqui"}
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Section wrapper ──
function Section({ label, count, color, right, children }: {
  label: string; count: number; color?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px 6px",
      }}>
        <span style={{
          fontSize: 10,
          fontFamily: "var(--mono)",
          fontWeight: 600,
          color: color ?? "var(--ink-3)",
          letterSpacing: 0.8,
          textTransform: "uppercase",
        }}>
          {label}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: "var(--mono)",
          color: "var(--ink-3)",
          background: "var(--surface-2)",
          border: "1px solid var(--line)",
          borderRadius: 4,
          padding: "0 5px",
        }}>
          {count}
        </span>
        {right}
      </div>
      <div style={{ padding: "2px 12px 12px" }}>
        {children}
      </div>
    </div>
  );
}
