import { useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCenter, type Active, type Over,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { PlaceCard } from "./PlaceCard";
import type { ParisItinerary, ParisDay, ParisEntry } from "../../api/paris";

const DAY_COLORS = ["#00ff88","#7ab8ff","#ffd700","#ff9a5c","#c084fc","#f472b6","#34d399"];

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
}

function fmtTotal(entries: ParisEntry[]): string {
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  if (!total) return "—";
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? (m ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

function findContainer(itinerary: ParisItinerary, placeId: string): string | null {
  if (itinerary.pool.some(e => e.placeId === placeId)) return "pool";
  for (const day of itinerary.days) {
    if (day.entries.some(e => e.placeId === placeId)) return day.id;
  }
  return null;
}

function getEntries(itinerary: ParisItinerary, containerId: string): ParisEntry[] {
  if (containerId === "pool") return itinerary.pool;
  return itinerary.days.find(d => d.id === containerId)?.entries ?? [];
}

function setEntries(itinerary: ParisItinerary, containerId: string, entries: ParisEntry[]): ParisItinerary {
  if (containerId === "pool") return { ...itinerary, pool: entries };
  return {
    ...itinerary,
    days: itinerary.days.map(d => d.id === containerId ? { ...d, entries } : d),
  };
}

export function Planner({ places, itinerary, hoveredId, onHover, onMarkerFocus, onChange }: Props) {
  const [activeInfo, setActiveInfo] = useState<{ id: string; fromContainer: string } | null>(null);
  const placeMap = Object.fromEntries(places.map(p => [p.id, p]));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragStart({ active }: { active: Active }) {
    const from = findContainer(itinerary, active.id as string);
    if (from) setActiveInfo({ id: active.id as string, fromContainer: from });
  }

  function onDragEnd({ active, over }: { active: Active; over: Over | null }) {
    setActiveInfo(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const srcId = findContainer(itinerary, activeId);
    if (!srcId) return;

    // Determine destination container
    const isContainer = overId === "pool" || itinerary.days.some(d => d.id === overId);
    const dstId = isContainer ? overId : findContainer(itinerary, overId) ?? srcId;

    let next = itinerary;

    if (srcId === dstId) {
      // Reorder within same container
      const items = getEntries(next, srcId);
      const oldIdx = items.findIndex(e => e.placeId === activeId);
      const newIdx = items.findIndex(e => e.placeId === overId);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        next = setEntries(next, srcId, arrayMove(items, oldIdx, newIdx));
      }
    } else {
      // Move between containers
      const srcItems = getEntries(next, srcId);
      const entry = srcItems.find(e => e.placeId === activeId)!;
      const newSrcItems = srcItems.filter(e => e.placeId !== activeId);

      const dstItems = getEntries(next, dstId);
      const overIdx = dstItems.findIndex(e => e.placeId === overId);
      const insertAt = overIdx >= 0 ? overIdx : dstItems.length;
      const newDstItems = [...dstItems.slice(0, insertAt), entry, ...dstItems.slice(insertAt)];

      next = setEntries(next, srcId, newSrcItems);
      next = setEntries(next, dstId, newDstItems);
    }

    onChange(next);
  }

  function updateMinutes(containerId: string, placeId: string, minutes: number) {
    const items = getEntries(itinerary, containerId);
    const next = setEntries(itinerary, containerId, items.map(e => e.placeId === placeId ? { ...e, minutes } : e));
    onChange(next);
  }

  function removeFromSchedule(containerId: string, placeId: string) {
    // Move back to pool
    const items = getEntries(itinerary, containerId);
    const entry = items.find(e => e.placeId === placeId)!;
    const next = setEntries(
      setEntries(itinerary, containerId, items.filter(e => e.placeId !== placeId)),
      "pool",
      [...itinerary.pool, entry],
    );
    onChange(next);
  }

  function addDay() {
    const dayNum = itinerary.days.length + 1;
    const next: ParisItinerary = {
      ...itinerary,
      days: [...itinerary.days, { id: `day-${Date.now()}`, label: `Dia ${dayNum}`, date: "", entries: [] }],
    };
    onChange(next);
  }

  function removeDay(dayId: string) {
    const day = itinerary.days.find(d => d.id === dayId)!;
    const next: ParisItinerary = {
      pool: [...itinerary.pool, ...day.entries],
      days: itinerary.days.filter(d => d.id !== dayId),
    };
    onChange(next);
  }

  function updateDayDate(dayId: string, date: string) {
    onChange({ ...itinerary, days: itinerary.days.map(d => d.id === dayId ? { ...d, date } : d) });
  }

  const activePlace = activeInfo ? placeMap[activeInfo.id] : null;
  const activeEntry = activeInfo ? getEntries(itinerary, activeInfo.fromContainer).find(e => e.placeId === activeInfo.id) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", overflow: "auto", padding: "0 4px 80px" }}>

        {/* Pool */}
        <div>
          <div style={{ fontSize: 10, fontFamily: "var(--mono,monospace)", color: "#555", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
            Sem data — {itinerary.pool.length} locais
          </div>
          <SortableContext id="pool" items={itinerary.pool.map(e => e.placeId)} strategy={verticalListSortingStrategy}>
            <DropZone containerId="pool" empty={itinerary.pool.length === 0}>
              {itinerary.pool.map(entry => {
                const p = placeMap[entry.placeId];
                if (!p) return null;
                return (
                  <PlaceCard
                    key={entry.placeId}
                    place={p}
                    minutes={entry.minutes}
                    highlighted={hoveredId === p.id}
                    onMinutesChange={(m) => updateMinutes("pool", p.id, m)}
                    onRemove={() => {}}
                    onHover={onHover}
                  />
                );
              })}
            </DropZone>
          </SortableContext>
        </div>

        {/* Days */}
        {itinerary.days.map((day, dayIdx) => {
          const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
          return (
            <div key={day.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontFamily: "var(--mono,monospace)", color, fontWeight: 700 }}>
                  {day.label}
                </span>
                <input
                  type="date"
                  value={day.date}
                  onChange={e => updateDayDate(day.id, e.target.value)}
                  style={{
                    background: "transparent", border: "1px solid #2a2a2a", borderRadius: 4,
                    color: "#666", fontSize: 11, fontFamily: "var(--mono,monospace)", padding: "2px 6px",
                    colorScheme: "dark",
                  }}
                />
                <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "var(--mono,monospace)", color: "#444" }}>
                  {fmtTotal(day.entries)}
                </span>
                <button
                  onClick={() => removeDay(day.id)}
                  style={{ background: "transparent", border: "none", color: "#333", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
                  title="Remover dia"
                >×</button>
              </div>

              <SortableContext id={day.id} items={day.entries.map(e => e.placeId)} strategy={verticalListSortingStrategy}>
                <DropZone containerId={day.id} empty={day.entries.length === 0} color={color}>
                  {day.entries.map(entry => {
                    const p = placeMap[entry.placeId];
                    if (!p) return null;
                    return (
                      <PlaceCard
                        key={entry.placeId}
                        place={p}
                        minutes={entry.minutes}
                        dayLabel={day.label}
                        highlighted={hoveredId === p.id}
                        onMinutesChange={(m) => updateMinutes(day.id, p.id, m)}
                        onRemove={() => removeFromSchedule(day.id, p.id)}
                        onHover={onHover}
                      />
                    );
                  })}
                </DropZone>
              </SortableContext>
            </div>
          );
        })}

        <button
          onClick={addDay}
          style={{
            background: "transparent", border: "1px dashed #2a2a2a", borderRadius: 6,
            color: "#444", fontFamily: "var(--mono,monospace)", fontSize: 12,
            padding: "10px", cursor: "pointer", textAlign: "center",
          }}
        >
          + adicionar dia
        </button>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activePlace && activeEntry ? (
          <div style={{ opacity: 0.9, transform: "rotate(1.5deg)" }}>
            <PlaceCard
              place={activePlace}
              minutes={activeEntry.minutes}
              highlighted={false}
              onMinutesChange={() => {}}
              onRemove={() => {}}
              onHover={() => {}}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DropZone({ containerId, empty, color, children }: {
  containerId: string; empty: boolean; color?: string; children: React.ReactNode;
}) {
  return (
    <div
      id={containerId}
      style={{
        minHeight: 44,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        border: `1px dashed ${empty ? (color ?? "#2a2a2a") : "transparent"}`,
        borderRadius: 6,
        padding: 4,
        position: "relative",
      }}
    >
      {children}
      {empty && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: 11, color: "#333", fontFamily: "var(--mono,monospace)" }}>
            solte aqui
          </span>
        </div>
      )}
    </div>
  );
}
