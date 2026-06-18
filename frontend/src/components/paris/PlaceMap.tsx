import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import "leaflet.markercluster";

const CAT_COLOR: Record<string, string> = {
  monumento:   "#00ff88",
  museu:       "#7ab8ff",
  bairro:      "#ffd700",
  parque:      "#90ee90",
  gastronomia: "#ff9a5c",
};

// Maps day index → color for scheduled markers
const DAY_COLORS = ["#00ff88","#7ab8ff","#ffd700","#ff9a5c","#c084fc","#f472b6","#34d399"];

interface Place {
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}

interface Props {
  places: Place[];
  // placeId → day index (0-based), undefined = pool
  dayAssignment: Record<string, number | undefined>;
  hoveredId: string | null;
  onMarkerClick: (id: string) => void;
}

function makeIcon(color: string, size = 10) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      border-radius:50%;
      background:${color};
      border:2px solid rgba(0,0,0,0.6);
      box-shadow:0 0 6px ${color}88;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeDayIcon(dayIdx: number, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:22px;height:22px;
      border-radius:50%;
      background:${color};
      border:2px solid #000;
      color:#000;
      font-size:11px;
      font-weight:700;
      display:flex;
      align-items:center;
      justify-content:center;
      box-shadow:0 0 8px ${color}99;
      font-family:monospace;
    ">${dayIdx + 1}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function PlaceMap({ places, dayAssignment, hoveredId, onMarkerClick }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [48.8566, 2.3522],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO",
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Rebuild markers when places or assignment changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove old cluster group
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
    }

    const group = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 40,
      iconCreateFunction: (cluster: any) => L.divIcon({
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:#1a1a1a;border:2px solid #00ff88;
          color:#00ff88;font-size:12px;font-weight:700;
          display:flex;align-items:center;justify-content:center;
          font-family:monospace;box-shadow:0 0 8px #00ff8844;
        ">${cluster.getChildCount()}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    });

    markersRef.current = {};

    places.forEach((place) => {
      const dayIdx = dayAssignment[place.id];
      const icon = dayIdx !== undefined
        ? makeDayIcon(dayIdx, DAY_COLORS[dayIdx % DAY_COLORS.length])
        : makeIcon(CAT_COLOR[place.category] ?? "#888");

      const marker = L.marker([place.lat, place.lng], { icon })
        .bindPopup(`<b style="font-family:monospace;font-size:12px">${place.name}</b><br><span style="font-size:11px;color:#999">${place.address}</span>`)
        .on("click", () => onMarkerClick(place.id));

      group.addLayer(marker);
      markersRef.current[place.id] = marker;
    });

    group.addTo(map);
    clusterGroupRef.current = group;
  }, [places, dayAssignment]);

  // Highlight hovered marker
  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const el = marker.getElement();
      if (!el) return;
      const div = el.querySelector("div") as HTMLElement | null;
      if (!div) return;
      if (id === hoveredId) {
        div.style.transform = "scale(1.6)";
        div.style.zIndex = "9999";
        marker.openPopup();
      } else {
        div.style.transform = "scale(1)";
        div.style.zIndex = "";
        marker.closePopup();
      }
    });
  }, [hoveredId]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#111" }}
    />
  );
}
