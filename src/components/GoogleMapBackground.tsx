/// <reference types="google.maps" />
// Live Google Map background. Drop-in replacement for MapBackground.
// Renders the Maps JS API behind the floating UI on Cover & Earn and Request Coverage.

import { useEffect, useRef, useState } from "react";
import type { Marker } from "@/components/MapBackground";
import { hasMapsKey, loadMapsApi } from "@/lib/google-maps";

type Coords = { lat: number; lng: number };
export type PlaceMapMarker = Coords & { key: string; title?: string };

// Lagos as a sensible fallback center for FlashLocum's launch market.
const FALLBACK_CENTER: Coords = { lat: 6.5244, lng: 3.3792 };

const BROWSER_KEY_PRESENT = hasMapsKey();

// Soft, warm-cream basemap with gentle hues for parks, water, and roads.
// Aims for a calm editorial feel — colorful, but never loud.
const LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f1f3f4" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b6f76" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f1f3f4" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#3c4043" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#cfe6c9" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#5a8a4a" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#e8ecee" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#c9d4ea" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#a9bbdc" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#aedaf0" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4a90a8" }] },
];


// Stethoscope-style SVG marker, mirrors the original MapBackground vibe.
function markerIcon(): google.maps.Icon {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
  <circle cx="22" cy="22" r="14" fill="#ffffff" stroke="#3a8a5e" stroke-width="1.8"/>
  <g stroke="#3a8a5e" stroke-width="1.8" fill="none" stroke-linecap="round" transform="translate(13 12)">
    <path d="M3 1v6a4 4 0 008 0V1"/>
    <path d="M7 11v2a4 4 0 008 0v-2"/>
    <circle cx="15" cy="9" r="1.6" fill="#3a8a5e" stroke="none"/>
  </g>
</svg>`.trim();
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(44, 44),
    anchor: new google.maps.Point(22, 22),
  };
}

export function GoogleMapBackground({
  markers,
  center,
  placeMarkers,
}: {
  markers?: Marker[];
  center?: Coords | null;
  placeMarkers?: PlaceMapMarker[];
} = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerObjs = useRef<google.maps.Marker[]>([]);
  const placeMarkerObjs = useRef<google.maps.Marker[]>([]);
  const selfMarker = useRef<google.maps.Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [userCenter, setUserCenter] = useState<Coords | null>(null);

  // Geolocate once on mount (best-effort, silent on denial).
  useEffect(() => {
    if (center) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300_000 },
    );
  }, [center]);

  // Init map.
  useEffect(() => {
    let cancelled = false;
    loadMapsApi()
      .then((g) => {
        if (cancelled || !ref.current || mapRef.current) return;
        const initial = center ?? userCenter ?? FALLBACK_CENTER;
        mapRef.current = new g.maps.Map(ref.current, {
          center: initial,
          zoom: 13,
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          styles: LIGHT_STYLE,
          backgroundColor: "#f3ede0",
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter when we acquire geolocation (only if caller didn't pin center).
  useEffect(() => {
    if (!mapRef.current) return;
    const c = center ?? userCenter;
    if (!c) return;
    mapRef.current.panTo(c);
    if (center) mapRef.current.setZoom(15);
  }, [center, userCenter]);

  // Self marker for the doctor's own location.
  useEffect(() => {
    if (!mapRef.current) return;
    const c = center ?? userCenter;
    if (!c) {
      selfMarker.current?.setMap(null);
      selfMarker.current = null;
      return;
    }
    if (!selfMarker.current) {
      selfMarker.current = new google.maps.Marker({
        position: c,
        map: mapRef.current,
        icon: markerIcon(),
        optimized: true,
        zIndex: 50,
      });
    } else {
      selfMarker.current.setPosition(c);
    }
  }, [center, userCenter]);

  // Render presence markers. We treat the provided Marker.top/left (0..1) as a
  // pseudo-spread around the current center so the map feels populated without
  // requiring real coordinates from the presence layer yet.
  useEffect(() => {
    if (!mapRef.current) return;
    markerObjs.current.forEach((m) => m.setMap(null));
    markerObjs.current = [];
    if (!markers || markers.length === 0) return;
    const c = center ?? userCenter ?? FALLBACK_CENTER;
    // ~3km spread
    const spread = 0.03;
    markers.forEach((m) => {
      const pos = {
        lat: c.lat + (0.5 - m.top) * spread,
        lng: c.lng + (m.left - 0.5) * spread,
      };
      const marker = new google.maps.Marker({
        position: pos,
        map: mapRef.current!,
        icon: markerIcon(),
        optimized: true,
      });
      markerObjs.current.push(marker);
    });
  }, [markers, center, userCenter]);

  // Render real hospital/place markers from Google Places results.
  useEffect(() => {
    if (!mapRef.current) return;
    placeMarkerObjs.current.forEach((m) => m.setMap(null));
    placeMarkerObjs.current = [];
    if (!placeMarkers || placeMarkers.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    placeMarkers.forEach((p) => {
      const position = { lat: p.lat, lng: p.lng };
      bounds.extend(position);
      const marker = new google.maps.Marker({
        position,
        map: mapRef.current!,
        title: p.title,
        icon: markerIcon(),
        optimized: true,
        zIndex: 100,
      });
      placeMarkerObjs.current.push(marker);
    });

    if (!center) {
      if (placeMarkers.length === 1) {
        mapRef.current.panTo({ lat: placeMarkers[0].lat, lng: placeMarkers[0].lng });
        mapRef.current.setZoom(15);
      } else {
        mapRef.current.fitBounds(bounds, 72);
      }
    }
  }, [placeMarkers, center]);

  if (failed || !BROWSER_KEY_PRESENT) {
    // Graceful fallback to the stylized map so the UI never goes blank.
    return (
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-map)" }}
        aria-hidden
      />
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#f3ede0" }}>
      <div ref={ref} className="absolute inset-0 h-full w-full" />
      {/* Subtle bottom fade so floating UI reads against the map */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklab, var(--color-background) 30%, transparent), transparent)",
        }}
      />
    </div>
  );
}
