/// <reference types="google.maps" />
// Live Google Map background. Drop-in replacement for MapBackground.
// Renders the Maps JS API behind the floating UI on Cover & Earn and Request Coverage.

import { useEffect, useRef, useState } from "react";
import type { Marker } from "@/components/MapBackground";
import { hasMapsKey, loadMapsApi } from "@/lib/google-maps";
import { getLastKnown, requestOnce, subscribe } from "@/lib/location";

type Coords = { lat: number; lng: number };
export type PlaceMapMarker = Coords & { key: string; title?: string };

// Lagos is FlashLocum's only operating market at launch. The map is hard-
// restricted to these bounds so the user can't pan/zoom out of Lagos State.
const LAGOS_BOUNDS_LITERAL: google.maps.LatLngBoundsLiteral = {
  south: 6.35,
  west: 2.70,
  north: 6.80,
  east: 4.40,
};

function inLagos(c: Coords): boolean {
  return (
    c.lat >= LAGOS_BOUNDS_LITERAL.south &&
    c.lat <= LAGOS_BOUNDS_LITERAL.north &&
    c.lng >= LAGOS_BOUNDS_LITERAL.west &&
    c.lng <= LAGOS_BOUNDS_LITERAL.east
  );
}

// Lagos as a sensible fallback center for FlashLocum's launch market.
const FALLBACK_CENTER: Coords = { lat: 6.5244, lng: 3.3792 };

const BROWSER_KEY_PRESENT = hasMapsKey();

// Darker, sharper basemap. Cooler graphite ground, crisp label contrast,
// roads that read clearly without shouting. Tuned so type looks premium
// against the surface instead of washing out into the grey.
const LIGHT_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#aab2bd" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#11161d" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#e8ecf2" }, { weight: 2.5 }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#0b1117" }] },
  { featureType: "administrative.locality", elementType: "labels.text.stroke", stylers: [{ color: "#e8ecf2" }, { weight: 3 }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#7fa07c" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#1f3a1f" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#9ea6b1" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#cfd4dc" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#cfd4dc" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#7e8aa3" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#4f5a72" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#4f8aa8" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#0b2a38" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#bcd6e4" }, { weight: 2 }] },
];



// Stethoscope marker — used ONLY for online doctors available nearby.
// Subtle pulse via SMIL keeps the marker feeling alive without being flashy.
function doctorIcon(scale = 1): google.maps.Icon {
  const size = Math.max(20, Math.round(56 * scale));
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
  <circle cx="28" cy="28" r="22" fill="#3a8a5e" fill-opacity="0.18">
    <animate attributeName="r" values="16;22;16" dur="2.4s" repeatCount="indefinite"/>
    <animate attributeName="fill-opacity" values="0.28;0.08;0.28" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <circle cx="28" cy="28" r="14" fill="#ffffff" stroke="#3a8a5e" stroke-width="1.8"/>
  <g stroke="#3a8a5e" stroke-width="1.8" fill="none" stroke-linecap="round" transform="translate(19 18)">
    <path d="M3 1v6a4 4 0 008 0V1"/>
    <path d="M7 11v2a4 4 0 008 0v-2"/>
    <circle cx="15" cy="9" r="1.6" fill="#3a8a5e" stroke="none"/>
  </g>
</svg>`.trim();
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  };
}


// Requester "you are here" dot — calm pulsing blue marker.
function requesterDotIcon(): google.maps.Icon {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="20" fill="#3b82f6" fill-opacity="0.18">
    <animate attributeName="r" values="12;20;12" dur="2.6s" repeatCount="indefinite"/>
    <animate attributeName="fill-opacity" values="0.32;0.06;0.32" dur="2.6s" repeatCount="indefinite"/>
  </circle>
  <circle cx="24" cy="24" r="10" fill="#ffffff"/>
  <circle cx="24" cy="24" r="7" fill="#3b82f6"/>
</svg>`.trim();
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(48, 48),
    anchor: new google.maps.Point(24, 24),
  };
}

export function GoogleMapBackground({
  markers,
  center,
  placeMarkers,
  showSelf = true,
  selfMarkerKind = "requester",
  active = true,
  markerScale = 1,
}: {
  markers?: Marker[];
  center?: Coords | null;
  placeMarkers?: PlaceMapMarker[];
  showSelf?: boolean;
  selfMarkerKind?: "requester" | "doctor";
  active?: boolean;
  /** Multiplier for doctor avatar marker size. Requester Home uses ~0.78
   *  so the map reads as a cleaner roster; Doctor Home stays at 1. */
  markerScale?: number;
} = {}) {

  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerObjs = useRef<Map<string, google.maps.Marker>>(new Map());
  const placeMarkerObjs = useRef<google.maps.Marker[]>([]);
  const selfMarker = useRef<google.maps.Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [userCenter, setUserCenterState] = useState<Coords | null>(() => {
    const k = getLastKnown();
    return k ? { lat: k.lat, lng: k.lng } : null;
  });

  // Map is a pure consumer of the central location service. It does NOT
  // own geolocation — see `src/lib/location.ts`.
  useEffect(() => {
    const unsub = subscribe((c) => setUserCenterState({ lat: c.lat, lng: c.lng }));
    void requestOnce();
    return unsub;
  }, []);

  // Init map.
  useEffect(() => {
    let cancelled = false;
    loadMapsApi()
      .then((g) => {
        if (cancelled || !ref.current || mapRef.current) return;
        const rawInitial = center ?? userCenter ?? FALLBACK_CENTER;
        const initial = inLagos(rawInitial) ? rawInitial : FALLBACK_CENTER;
        mapRef.current = new g.maps.Map(ref.current, {
          center: initial,
          zoom: 12,
          minZoom: 10,
          maxZoom: 18,
          restriction: {
            latLngBounds: LAGOS_BOUNDS_LITERAL,
            strictBounds: true,
          },
          disableDefaultUI: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          styles: LIGHT_STYLE,
          backgroundColor: "#aab2bd",
        });
        setMapReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pan (never zoom) when caller pins a center or we acquire geolocation.
  // Preserving the user's zoom level keeps the viewport stable as new markers
  // appear — the map should never auto-reframe under the user.
  useEffect(() => {
    if (!mapRef.current) return;
    const c = center ?? userCenter;
    if (!c) return;
    mapRef.current.panTo(inLagos(c) ? c : FALLBACK_CENTER);
  }, [center, userCenter, mapReady]);

  // When this surface becomes the active tab, snap the viewport back to the
  // user's location. Users expect "home" to recenter on them after they've
  // panned away — switching tabs is the natural reset gesture.
  useEffect(() => {
    if (!active || !mapRef.current) return;
    const c = center ?? userCenter;
    if (!c) return;
    mapRef.current.panTo(inLagos(c) ? c : FALLBACK_CENTER);
  }, [active, center, userCenter, mapReady]);


  // Requester "you are here" dot — always anchored to real geolocation.
  useEffect(() => {
    if (!mapRef.current) return;
    // Don't drop the "you are here" pin outside Lagos — FlashLocum only
    // operates inside Lagos State, so the pin would be misleading.
    if (!userCenter || !showSelf || !inLagos(userCenter)) {
      selfMarker.current?.setMap(null);
      selfMarker.current = null;
      return;
    }
    if (!selfMarker.current) {
      selfMarker.current = new google.maps.Marker({
        position: userCenter,
        map: mapRef.current,
        icon: selfMarkerKind === "doctor" ? doctorIcon() : requesterDotIcon(),
        optimized: false, // SMIL pulse requires non-optimized rendering
        zIndex: 60,
        title: selfMarkerKind === "doctor" ? "Doctor location" : "You are here",
      });
    } else {
      selfMarker.current.setIcon(selfMarkerKind === "doctor" ? doctorIcon() : requesterDotIcon());
      selfMarker.current.setPosition(userCenter);
    }
  }, [userCenter, showSelf, selfMarkerKind, mapReady]);

  // Render available-doctor presence markers at their ABSOLUTE lat/lng
  // (written by the doctor app on app open, sign-in, going online, manual
  // refresh, and a 20-minute foreground tick). The map `center` is camera-
  // only — selecting a hospital pans the camera but never relocates any
  // doctor marker. Doctors without a GPS fix are simply omitted from the
  // map (no synthesized fallback position).
  //
  // Diff by marker.key — adds / removes / moves are O(changed), so existing
  // Marker instances and their SMIL pulse animations stay alive across ticks.
  useEffect(() => {
    if (!mapRef.current) return;
    const pool = markerObjs.current;
    const next = markers ?? [];
    const seen = new Set<string>();
    next.forEach((m) => {
      if (m.lat == null || m.lng == null) return; // no GPS fix → no marker
      const pos = { lat: m.lat, lng: m.lng };
      if (!inLagos(pos)) return; // doctors outside Lagos are not shown
      seen.add(m.key);
      const existing = pool.get(m.key);
      if (existing) {
        existing.setPosition(pos);
      } else {
        pool.set(
          m.key,
          new google.maps.Marker({
            position: pos,
            map: mapRef.current!,
            icon: doctorIcon(),
            optimized: false, // SMIL pulse requires non-optimized rendering
            zIndex: 40,
          }),
        );
      }
    });
    // Remove markers that are no longer in the input (or lost their GPS fix).
    for (const [key, marker] of pool) {
      if (!seen.has(key)) {
        marker.setMap(null);
        pool.delete(key);
      }
    }
  }, [markers, mapReady]);

  // Hospital / place markers are intentionally NOT rendered on the map.
  // Hospitals exist as data context (search, selection, dispatch), not as
  // map objects. The map's only entities are: requester + available doctors.
  // The `placeMarkers` prop is accepted for API compatibility but ignored.
  void placeMarkers;


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
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#aab2bd" }}>
      <div ref={ref} className="absolute inset-0 h-full w-full" />
      {/*
        Google Maps Platform ToS requires the "Google" logo, copyright text,
        and Terms/Report-a-problem links to remain visible and clickable.
        We previously hid them with display:none — that's a ToS violation.
        Instead, keep them visible but ensure the bottom fade overlay below
        does not intercept their clicks (pointer-events: none on the fade).
      */}
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
