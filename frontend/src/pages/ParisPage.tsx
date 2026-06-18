import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import { PlaceMap } from "../components/paris/PlaceMap";
import { KanbanBoard } from "../components/paris/KanbanBoard";
import { PlaceDrawer } from "../components/paris/PlaceDrawer";
import seedData from "../data/paris-plan-seed.json";
import { loadPlan, savePlan, migratePlan, geocodeAddress } from "../api/paris";
import type { ParisPlan, PPlace } from "../api/paris";
import "../styles/paris.css";

const SEED_PLACES = (seedData as ParisPlan).places;
const CATEGORIES = ["monument", "museum", "hood", "park", "food"];

const JSON_MODEL = JSON.stringify({
  places: {
    "unico-id": { id: "unico-id", name: "Nome do Local", cat: "monument", lat: 48.8584, lng: 2.2945, address: "Endereço, Paris", desc: "Descrição opcional", duration: 90 }
  },
  columns: [{ id: "pool", label: "Sem data", isPool: true, items: ["unico-id"] }]
}, null, 2);

export function ParisPage() {
  const [plan, setPlan] = useState<ParisPlan | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputId = useId();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newCat, setNewCat] = useState("monument");
  const [newMin, setNewMin] = useState(60);
  const [geocoding, setGeocoding] = useState(false);
  const [geoError, setGeoError] = useState("");

  const [showJsonModal, setShowJsonModal] = useState(false);

  // Load on mount
  useEffect(() => {
    loadPlan().then(raw => {
      setPlan(migratePlan(raw, SEED_PLACES));
    });
  }, []);

  const handleChange = useCallback((next: ParisPlan) => {
    setPlan(next);
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePlan(next)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("idle"));
    }, 800);
  }, []);

  const totalPlaces = plan ? Object.keys(plan.places).length : 0;
  const totalDays = plan ? plan.columns.filter(c => !c.isPool).length : 0;
  const scheduled = plan ? plan.columns.filter(c => !c.isPool).reduce((s, c) => s + c.items.length, 0) : 0;

  async function addPlace() {
    if (!plan || !newName.trim() || !newAddress.trim()) return;
    setGeocoding(true); setGeoError("");
    try {
      const coords = await geocodeAddress(newAddress);
      if (!coords) { setGeoError("Endereço não encontrado"); return; }
      const id = `custom-${Date.now()}`;
      const place: PPlace = { id, name: newName.trim(), cat: newCat, lat: coords.lat, lng: coords.lng, address: newAddress.trim(), duration: newMin };
      const poolCol = plan.columns.find(c => c.isPool);
      handleChange({
        places: { ...plan.places, [id]: place },
        columns: plan.columns.map(c => c.isPool ? { ...c, items: [...c.items, id] } : c),
      });
      setNewName(""); setNewAddress(""); setNewMin(60); setShowAdd(false);
    } catch { setGeoError("Erro ao geocodificar"); }
    finally { setGeocoding(false); }
  }

  function loadJson(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target!.result as string);
        // Accept new format or array of old PlaceData
        if (raw.places && raw.columns) {
          // Full plan import — merge places, keep our columns
          const merged: ParisPlan = {
            places: { ...plan!.places, ...raw.places },
            columns: plan!.columns,
          };
          handleChange(merged);
        } else if (Array.isArray(raw)) {
          // Array of old-format places
          const existingIds = new Set(Object.keys(plan!.places));
          const toAdd = raw.filter((p: any) => p.id && p.name && p.lat && p.lng && !existingIds.has(p.id));
          if (!toAdd.length) return;
          const newPlaces: Record<string, PPlace> = {};
          for (const p of toAdd) {
            newPlaces[p.id] = { id: p.id, name: p.name, cat: p.category ?? p.cat ?? "outro", lat: p.lat, lng: p.lng, address: p.address ?? "", desc: p.description ?? p.desc, duration: p.minutes ?? p.duration ?? 60 };
          }
          handleChange({
            places: { ...plan!.places, ...newPlaces },
            columns: plan!.columns.map(c => c.isPool ? { ...c, items: [...c.items, ...Object.keys(newPlaces)] } : c),
          });
        }
      } catch { alert("JSON inválido"); }
    };
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const blob = new Blob([JSON_MODEL], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "modelo-paris.json"; a.click();
    URL.revokeObjectURL(url);
  }

  const newMinLabel = newMin >= 60 ? `${Math.floor(newMin / 60)}h${newMin % 60 ? `${newMin % 60}m` : ""}` : `${newMin}m`;

  if (!plan) {
    return (
      <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F0E7", color: "#9A9384", fontFamily: "'IBM Plex Mono', monospace" }}>
        carregando…
      </div>
    );
  }

  return (
    <div className="pp-root">
      {/* Top bar */}
      <header className="pp-topbar">
        <div className="pp-crumb">
          <a href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="plane">✈</span> fly
          </a>
          <span className="slash">/</span>
          <b>paris</b>
        </div>
        <div className="pp-hstats">
          <div className="pp-hstat"><span className="v">{totalPlaces}</span><span className="k">locais</span></div>
          <div className="pp-hstat"><span className="v">{totalDays}</span><span className="k">dias</span></div>
          <div className="pp-hstat"><span className="v" style={{ color: "var(--green)" }}>{scheduled}</span><span className="k">agendados</span></div>
        </div>
        <div className={`pp-save${saveStatus === "saving" ? " saving" : ""}`}>
          <div className="dot" />
          {saveStatus === "saving" ? "salvando…" : saveStatus === "saved" ? "salvo" : ""}
        </div>
      </header>

      {/* Map zone */}
      <div className="pp-map-zone">
        <div className="pp-map">
          <PlaceMap
            plan={plan}
            hoveredId={hoveredId}
            focusId={selectedId}
            onMarkerClick={(id) => { setHoveredId(id); setSelectedId(id); }}
          />
        </div>
      </div>

      {/* Board zone */}
      <div className="pp-board-zone">
        <KanbanBoard
          plan={plan}
          onChange={handleChange}
          selectedId={selectedId}
          onSelect={setSelectedId}
          hoveredId={hoveredId}
          onHover={setHoveredId}
        />

        <PlaceDrawer
          plan={plan}
          selectedId={selectedId}
          onClose={() => setSelectedId(null)}
          onChange={handleChange}
        />

        {/* Toolbar */}
        <div className="pp-toolbar">
          {!showAdd ? (
            <>
              <button className="pp-tbtn" onClick={() => setShowAdd(true)}>+ local</button>
              <label className="pp-tbtn" style={{ cursor: "pointer" }}>
                ↑ importar JSON
                <input id={fileInputId} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f && plan) loadJson(f); e.target.value = ""; }} />
              </label>
              <button className="pp-tbtn" onClick={() => setShowJsonModal(v => !v)}>ver modelo</button>
              <div className="pp-toolbar-spacer" />
              <span className="pp-toolbar-hint">clique num local para detalhes</span>
            </>
          ) : (
            <div className="pp-add-form">
              <input className="grow" placeholder="Nome do local" value={newName} onChange={e => setNewName(e.target.value)} />
              <select value={newCat} onChange={e => setNewCat(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input className="grow" placeholder="Endereço (geocodificado)" value={newAddress} onChange={e => { setNewAddress(e.target.value); setGeoError(""); }} onKeyDown={e => e.key === "Enter" && addPlace()} />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button style={miniBtn} onClick={() => setNewMin(m => Math.max(15, m - 15))}>−</button>
                <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--ink-2)", minWidth: 36, textAlign: "center" }}>{newMinLabel}</span>
                <button style={miniBtn} onClick={() => setNewMin(m => m + 15)}>+</button>
              </div>
              <button className="pp-tbtn primary" onClick={addPlace} disabled={geocoding || !newName.trim() || !newAddress.trim()}>
                {geocoding ? "buscando…" : "adicionar"}
              </button>
              <button className="pp-tbtn" onClick={() => { setShowAdd(false); setGeoError(""); }}>cancelar</button>
              {geoError && <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--crimson)" }}>{geoError}</span>}
            </div>
          )}
        </div>
      </div>

      {/* JSON model modal */}
      {showJsonModal && (
        <div className="pp-modal-scrim" onClick={() => setShowJsonModal(false)}>
          <div className="pp-modal" onClick={e => e.stopPropagation()}>
            <h3>Modelo JSON</h3>
            <p>Importe um arquivo neste formato para adicionar locais em batch.</p>
            <textarea readOnly value={JSON_MODEL} />
            <div className="pp-modal-acts">
              <button className="pp-tbtn" onClick={downloadTemplate}>↓ baixar modelo</button>
              <button className="pp-tbtn primary" onClick={() => setShowJsonModal(false)}>fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  background: "transparent", border: "1px solid var(--line-2)", color: "var(--ink-3)",
  borderRadius: 4, width: 22, height: 22, fontSize: 13, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0,
};
