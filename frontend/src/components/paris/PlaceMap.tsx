import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import L from "leaflet";
import "leaflet.markercluster";

const CAT_COLOR: Record<string, string> = {
  monumento:   "#0E7A4B",
  museu:       "#3B82F6",
  bairro:      "#C2851A",
  parque:      "#22A04B",
  gastronomia: "#E05A1A",
};

const DAY_COLORS = ["#0E7A4B", "#3B82F6", "#C2851A", "#E05A1A", "#7C3AED", "#DB2777", "#059669"];

// Andrew's monotone chain convex hull
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const sorted = [...pts].sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
  const cross = (O: [number, number], A: [number, number], B: [number, number]) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const n = sorted.length;
  const k: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    while (k.length >= 2 && cross(k[k.length - 2], k[k.length - 1], sorted[i]) <= 0) k.pop();
    k.push(sorted[i]);
  }
  for (let i = n - 2, t = k.length + 1; i >= 0; i--) {
    while (k.length >= t && cross(k[k.length - 2], k[k.length - 1], sorted[i]) <= 0) k.pop();
    k.push(sorted[i]);
  }
  return k.slice(0, -1);
}

export interface DayPolygon {
  dayIdx: number;
  color?: string;
  points: [number, number][];
}

interface Place {
  id: string; name: string; address: string;
  lat: number; lng: number; category: string; minutes: number;
}

interface Props {
  places: Place[];
  dayAssignment: Record<string, number | undefined>;
  hoveredId: string | null;
  onMarkerClick: (id: string) => void;
  dayPolygons?: DayPolygon[];
}

function makeIcon(color: string, size = 11) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:2px solid rgba(255,255,255,0.9);
      box-shadow:0 1px 4px rgba(0,0,0,0.28);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeDayIcon(dayIdx: number, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:24px;height:24px;border-radius:50%;
      background:${color};border:2px solid rgba(255,255,255,0.9);
      color:#fff;font-size:11px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 6px rgba(0,0,0,0.22);font-family:monospace;
    ">${dayIdx + 1}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

export function PlaceMap({ places, dayAssignment, hoveredId, onMarkerClick, dayPolygons = [] }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const polygonsRef = useRef<L.Polygon[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [48.8566, 2.3522], zoom: 13 });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Rebuild markers when places or day assignment changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (clusterGroupRef.current) { map.removeLayer(clusterGroupRef.current); clusterGroupRef.current = null; }

    const group = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 40,
      iconCreateFunction: (cluster: any) => L.divIcon({
        html: `<div style="
          width:30px;height:30px;border-radius:50%;
          background:#FBF8F2;border:2px solid #0E7A4B;
          color:#0E7A4B;font-size:12px;font-weight:700;
          display:flex;align-items:center;justify-content:center;
          font-family:monospace;box-shadow:0 2px 8px rgba(0,0,0,0.16);
        ">${cluster.getChildCount()}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 15],
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

  // Draw/update day fence polygons
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    polygonsRef.current.forEach(p => p.remove());
    polygonsRef.current = [];

    dayPolygons.forEach(dp => {
      if (dp.points.length < 2) return;
      const color = dp.color ?? DAY_COLORS[dp.dayIdx % DAY_COLORS.length];
      const hull = dp.points.length >= 3 ? convexHull(dp.points) : dp.points;
      const poly = L.polygon(hull, {
        color,
        fillColor: color,
        fillOpacity: 0.08,
        weight: 2,
        opacity: 0.55,
        dashArray: "5 5",
      }).addTo(map);
      polygonsRef.current.push(poly);
    });
  }, [dayPolygons]);

  // Highlight hovered marker
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%", background: "var(--surface)" }} />;
}
