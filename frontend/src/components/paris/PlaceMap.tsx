import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import "leaflet.markercluster";

// Vibrant colors work well on the cream/light map tile
const CAT_COLOR: Record<string, string> = {
  monumento:   "#0E7A4B",
  museu:       "#3B82F6",
  bairro:      "#C2851A",
  parque:      "#22A04B",
  gastronomia: "#E05A1A",
};

const DAY_COLORS = ["#0E7A4B", "#3B82F6", "#C2851A", "#E05A1A", "#7C3AED", "#DB2777", "#059669"];

interface Place {
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}

interface Props {
  places: Place[];
  dayAssignment: Record<string, number | undefined>;
  hoveredId: string | null;
  onMarkerClick: (id: string) => void;
}

function makeIcon(color: string, size = 11) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;
      border-radius:50%;
      background:${color};
      border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 1px 4px rgba(0,0,0,0.30);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeDayIcon(dayIdx: number, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:24px;height:24px;
      border-radius:50%;
      background:${color};
      border:2px solid rgba(255,255,255,0.9);
      color:#fff;
      font-size:11px;
      font-weight:700;
      display:flex;
      align-items:center;
      justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,0.25);
      font-family:monospace;
    ">${dayIdx + 1}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export function PlaceMap({ places, dayAssignment, hoveredId, onMarkerClick }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [48.8566, 2.3522],
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO",
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
    }

    const group = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 40,
      iconCreateFunction: (cluster: any) => L.divIcon({
        html: `<div style="
          width:30px;height:30px;border-radius:50%;
          background:#FBF8F2;border:2px solid #0E7A4B;
          color:#0E7A4B;font-size:12px;font-weight:700;
          display:flex;align-items:center;justify-content:center;
          font-family:monospace;box-shadow:0 2px 8px rgba(0,0,0,0.18);
        ">${cluster.getChildCount()}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    });

    markersRef.current = {};

    places.forEach((place) => {
      const dayIdx = dayAssignment[place.id];
      const icon = dayIdx !== undefined
        ? makeDayIcon(dayIdx, DAY_COLORS[dayIdx % DAY_COLORS.length])
        : makeIcon(CAT_COLOR[place.category] ?? "#888");

      const marker = L.marker([place.lat, place.lng], { icon })
        .bindPopup(`<b style="font-family:monospace;font-size:12px;color:#1A1712">${place.name}</b><br><span style="font-size:11px;color:#9A9384">${place.address}</span>`)
        .on("click", () => onMarkerClick(place.id));

      group.addLayer(marker);
      markersRef.current[place.id] = marker;
    });

    group.addTo(map);
    clusterGroupRef.current = group;
  }, [places, dayAssignment]);

  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const el = marker.getElement();
      if (!el) return;
      const div = el.querySelector("div") as HTMLElement | null;
      if (!div) return;
      if (id === hoveredId) {
        div.style.transform = "scale(1.7)";
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
      style={{ width: "100%", height: "100%", background: "var(--surface)" }}
    />
  );
}
