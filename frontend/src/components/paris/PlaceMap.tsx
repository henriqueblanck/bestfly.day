import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { ParisPlan } from "../../api/paris";
import { fetchWalkRoute, haversine } from "../../utils/routing";

const DAY_COLORS = ["#C0492F", "#3B6FB5", "#2F6B4F", "#C2851A", "#7A4E8C", "#2F7E7A", "#B5536B", "#4D6A2E"];

const CAT_COLORS: Record<string, string> = {
  monument:   "#1F8A52",
  museum:     "#3B6FB5",
  hood:       "#E0A03C",
  park:       "#2F6B4F",
  food:       "#E8743B",
  experience: "#9B59B6",
};

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

// Pin with stop order number inside, colored by day
function makeStopIcon(num: number, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${color};color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:monospace;box-shadow:0 0 0 2.5px #FBF8F2,0 0 0 3.5px rgba(20,16,8,.14);">${num}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Plain dot for "Sem data" places
function makeCatIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:13px;height:13px;border-radius:50%;background:${color};box-shadow:0 0 0 2.5px #FBF8F2,0 0 0 3.5px rgba(20,16,8,.12);"></div>`,
    iconSize: [13, 13],
    iconAnchor: [6.5, 6.5],
  });
}

interface Props {
  plan: ParisPlan;
  hoveredId: string | null;
  focusId: string | null;
  onMarkerClick: (id: string) => void;
}

export function PlaceMap({ plan, hoveredId, focusId, onMarkerClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const polygonsRef = useRef<L.Polygon[]>([]);
  const polylinesRef = useRef<L.Polyline[]>([]);

  // Build lookup: placeId → { stopNum (within day), color }
  const dayPlaces = new Map<string, { num: number; color: string }>();
  plan.columns.filter(c => !c.isPool).forEach((col, idx) => {
    const color = col.color ?? DAY_COLORS[idx % DAY_COLORS.length];
    col.items.forEach((id, pos) => dayPlaces.set(id, { num: pos + 1, color }));
  });

  // Init map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [48.858, 2.347], zoom: 13 });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap · © CARTO",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Rebuild markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(markersRef.current).forEach(m => m.remove());
    markersRef.current = {};

    Object.values(plan.places).forEach(place => {
      const day = dayPlaces.get(place.id);
      const icon = day
        ? makeStopIcon(day.num, day.color)
        : makeCatIcon(CAT_COLORS[place.cat] ?? "#888");
      const marker = L.marker([place.lat, place.lng], { icon })
        .bindPopup(`<b style="font-family:monospace;font-size:12px;color:#1A1712">${place.name}</b><br><span style="font-size:11px;color:#9A9384">${place.address}</span>`)
        .on("click", () => onMarkerClick(place.id));
      marker.addTo(map);
      markersRef.current[place.id] = marker;
    });
  }, [plan.places, plan.columns]);

  // Rebuild day polygons (convex hull)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    polygonsRef.current.forEach(p => p.remove());
    polygonsRef.current = [];

    plan.columns.filter(c => !c.isPool).forEach((col, idx) => {
      const color = col.color ?? DAY_COLORS[idx % DAY_COLORS.length];
      const pts = col.items
        .map(id => plan.places[id])
        .filter(Boolean)
        .map(p => [p.lat, p.lng] as [number, number]);
      if (pts.length < 2) return;
      const hull = pts.length >= 3 ? convexHull(pts) : pts;
      const poly = L.polygon(hull, {
        color, fillColor: color,
        fillOpacity: 0.07, weight: 1.5, opacity: 0.4, dashArray: "5 5",
      }).addTo(map);
      polygonsRef.current.push(poly);
    });
  }, [plan.columns, plan.places]);

  // Draw walking routes per day
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    polylinesRef.current.forEach(p => p.remove());
    polylinesRef.current = [];

    plan.columns.filter(c => !c.isPool).forEach((col, idx) => {
      const color = col.color ?? DAY_COLORS[idx % DAY_COLORS.length];
      const coords: [number, number][] = col.items
        .map(id => plan.places[id])
        .filter(Boolean)
        .map(p => [p.lat, p.lng]);

      if (coords.length < 2) return;

      // Draw fallback straight dashed line immediately
      const fallback = L.polyline(coords, {
        color, weight: 2.5, opacity: 0.5, dashArray: "6 5",
      }).addTo(map);
      polylinesRef.current.push(fallback);

      // Try real OSRM route, replace fallback if it arrives
      fetchWalkRoute(coords).then(result => {
        if (!result) return;
        fallback.remove();
        const idx2 = polylinesRef.current.indexOf(fallback);
        if (idx2 !== -1) polylinesRef.current.splice(idx2, 1);

        // OSRM returns [lng, lat], Leaflet wants [lat, lng]
        const latlngs = result.geojson.coordinates.map(
          ([lng, lat]) => [lat, lng] as [number, number]
        );
        const real = L.polyline(latlngs, {
          color, weight: 3, opacity: 0.75,
        }).addTo(map!);
        polylinesRef.current.push(real);
      });
    });
  }, [plan.columns, plan.places]);

  // Fly to focused place
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusId) return;
    const place = plan.places[focusId];
    if (!place) return;
    map.flyTo([place.lat, place.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
  }, [focusId]);

  // Highlight hovered marker
  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      const el = marker.getElement();
      const div = el?.querySelector("div") as HTMLElement | null;
      if (!div) return;
      if (id === hoveredId) {
        div.style.transform = "scale(1.6)";
        div.style.zIndex = "9999";
        marker.openPopup();
      } else {
        div.style.transform = "";
        div.style.zIndex = "";
        marker.closePopup();
      }
    });
  }, [hoveredId]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
