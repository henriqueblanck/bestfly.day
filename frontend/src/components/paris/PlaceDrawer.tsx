import type { ParisPlan, PPlace, TicketLabel } from "../../api/paris";

const CAT_COLORS: Record<string, string> = {
  monument: "#1F8A52",
  museum:   "#3B6FB5",
  hood:     "#E0A03C",
  park:     "#2F6B4F",
  food:     "#E8743B",
};

const DAY_COLORS = ["#C0492F", "#3B6FB5", "#2F6B4F", "#C2851A", "#7A4E8C", "#2F7E7A", "#B5536B", "#4D6A2E"];

function fmtDur(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h${m}m` : `${h}h`) : `${m}m`;
}

interface Props {
  plan: ParisPlan;
  selectedId: string | null;
  onClose: () => void;
  onChange: (plan: ParisPlan) => void;
}

export function PlaceDrawer({ plan, selectedId, onClose, onChange }: Props) {
  const place = selectedId ? plan.places[selectedId] : null;
  const open = Boolean(place);

  const currentCol = selectedId
    ? plan.columns.find(c => c.items.includes(selectedId))
    : null;

  const catColor = place ? (CAT_COLORS[place.cat] ?? "#888") : "#888";

  function updatePlace(fields: Partial<PPlace>) {
    if (!selectedId || !place) return;
    onChange({ ...plan, places: { ...plan.places, [selectedId]: { ...place, ...fields } } });
  }

  function moveTo(colId: string) {
    if (!selectedId) return;
    onChange({
      ...plan,
      columns: plan.columns.map(c => {
        if (c.items.includes(selectedId)) return { ...c, items: c.items.filter(i => i !== selectedId) };
        if (c.id === colId) return { ...c, items: [...c.items, selectedId] };
        return c;
      }),
    });
  }

  function toggleTicket(label: TicketLabel) {
    updatePlace({ ticket: place?.ticket === label ? undefined : label });
  }

  const gmapsUrl = place
    ? `https://www.google.com/maps/search/${encodeURIComponent(`${place.name} ${place.address}`)}`
    : "#";

  return (
    <>
      <div className={`pp-drawer-scrim${open ? " open" : ""}`} onClick={onClose} />
      <div
        className={`pp-drawer${open ? " open" : ""}`}
        style={{ "--c": catColor } as React.CSSProperties}
      >
        {place && (
          <>
            <div className="pp-drawer-grip" />
            <div className="pp-drawer-scroll">
              {/* Head */}
              <div className="pp-dw-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="pp-dw-title">{place.name}</div>
                  <span className="pp-dw-badge">
                    <span className="d" />
                    {place.cat}
                  </span>
                  <div className="pp-dw-addr">
                    <span>📍</span>
                    <span>{place.address}</span>
                  </div>
                </div>
                <button className="pp-dw-close" onClick={onClose}>×</button>
              </div>

              {/* Two-column grid */}
              <div className="pp-dw-grid">
                {/* Left: description + notes */}
                <div>
                  {place.desc && (
                    <div className="pp-dw-sect">
                      <div className="pp-dw-lbl">descrição</div>
                      <div className="pp-dw-desc">{place.desc}</div>
                    </div>
                  )}
                  <div className="pp-dw-sect">
                    <div className="pp-dw-lbl">anotações</div>
                    <textarea
                      className="pp-dw-notes"
                      placeholder="dicas, horários, ponto de encontro…"
                      value={place.notes ?? ""}
                      onChange={e => updatePlace({ notes: e.target.value })}
                    />
                  </div>
                </div>

                {/* Right: duration + ticket + move-to + maps */}
                <div>
                  <div className="pp-dw-sect">
                    <div className="pp-dw-lbl">duração</div>
                    <div className="pp-dw-dur">
                      <button onClick={() => updatePlace({ duration: Math.max(15, place.duration - 15) })}>−</button>
                      <span className="val">{fmtDur(place.duration)}</span>
                      <button onClick={() => updatePlace({ duration: place.duration + 15 })}>+</button>
                    </div>
                  </div>

                  <div className="pp-dw-sect">
                    <div className="pp-dw-lbl">ingresso</div>
                    <div className="pp-seg">
                      {(["gratuito", "pendente", "comprado"] as TicketLabel[]).map(t => (
                        <button
                          key={t}
                          className={place.ticket === t ? `on ${t}` : ""}
                          onClick={() => toggleTicket(t)}
                        >
                          <span className="d" />
                          {t}
                        </button>
                      ))}
                    </div>
                    {place.ticket && place.ticket !== "gratuito" && (
                      <div className="pp-price-field">
                        <div className="pp-field">
                          <span>R$</span>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            placeholder="valor"
                            value={place.price ?? ""}
                            onChange={e => updatePlace({ price: e.target.value ? parseFloat(e.target.value) : null })}
                          />
                        </div>
                        <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-3)" }}>p/ pessoa</span>
                      </div>
                    )}
                  </div>

                  <div className="pp-dw-sect">
                    <div className="pp-dw-lbl">mover para</div>
                    <div className="pp-pills">
                      {plan.columns.map((col, idx) => {
                        const active = currentCol?.id === col.id;
                        const pillColor = col.isPool
                          ? "var(--ink-2)"
                          : (col.color ?? DAY_COLORS[(plan.columns.filter(c => !c.isPool).indexOf(col)) % DAY_COLORS.length]);
                        return (
                          <button
                            key={col.id}
                            className={`pp-pill${active ? " on" : ""}`}
                            onClick={() => { if (!active) moveTo(col.id); }}
                          >
                            {!col.isPool && <span className="d" style={{ background: active ? "#fff" : pillColor }} />}
                            {col.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <a href={gmapsUrl} target="_blank" rel="noopener noreferrer" className="pp-dw-maps">
                    ↗ Google Maps
                  </a>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
