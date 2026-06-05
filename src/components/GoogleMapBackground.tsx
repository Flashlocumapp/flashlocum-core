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


// Stethoscope marker — used ONLY for online doctors available nearby.
// Subtle pulse via SMIL keeps the marker feeling alive without being flashy.
function doctorIcon(): google.maps.Icon {
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
    scaledSize: new google.maps.Size(56, 56),
    anchor: new google.maps.Point(28, 28),
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

// Module-level cache for the last known geolocation. Persists across map
// remounts (e.g. switching tabs) so the requester "you are here" dot is
// already on screen the moment Home re-renders — no second-long wait while
// geolocation re-resolves.
let cachedUserCenter: Coords | null = null;

export function GoogleMapBackground({
  markers,
  center,
  placeMarkers,
  showSelf = true,
}: {
  markers?: Marker[];
  center?: Coords | null;
  placeMarkers?: PlaceMapMarker[];
  showSelf?: boolean;
} = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerObjs = useRef<google.maps.Marker[]>([]);
  const placeMarkerObjs = useRef<google.maps.Marker[]>([]);
  const selfMarker = useRef<google.maps.Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [userCenter, setUserCenterState] = useState<Coords | null>(cachedUserCenter);
  const setUserCenter = (c: Coords) => {
    cachedUserCenter = c;
    setUserCenterState(c);
  };


  // Geolocate on mount and keep watching, so the requester "you are here"
  // dot is on screen as quickly as possible and stays accurate as the user
  // moves. Best-effort; silently no-op on permission denial.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    );
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

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
          backgroundColor: "#f1f3f4",
        });
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
    mapRef.current.panTo(c);
  }, [center, userCenter]);

  // Requester "you are here" dot — always anchored to real geolocation.
  useEffect(() => {
    if (!mapRef.current) return;
    if (!userCenter || !showSelf) {
      selfMarker.current?.setMap(null);
      selfMarker.current = null;
      return;
    }
    if (!selfMarker.current) {
      selfMarker.current = new google.maps.Marker({
        position: userCenter,
        map: mapRef.current,
        icon: requesterDotIcon(),
        optimized: false, // SMIL pulse requires non-optimized rendering
        zIndex: 60,
        title: "You are here",
      });
    } else {
      selfMarker.current.setPosition(userCenter);
    }
  }, [userCenter, showSelf]);

  // Render available-doctor presence markers. Marker.top/left (0..1) is used
  // as a pseudo-spread around the current center until real coordinates flow
  // in from the presence layer.
  useEffect(() => {
    if (!mapRef.current) return;
    markerObjs.current.forEach((m) => m.setMap(null));
    markerObjs.current = [];
    if (!markers || markers.length === 0) return;
    const c = center ?? userCenter ?? FALLBACK_CENTER;
    const spread = 0.03; // ~3km
    markers.forEach((m) => {
      const pos = {
        lat: c.lat + (0.5 - m.top) * spread,
        lng: c.lng + (m.left - 0.5) * spread,
      };
      const marker = new google.maps.Marker({
        position: pos,
        map: mapRef.current!,
        icon: doctorIcon(),
        optimized: false, // SMIL pulse requires non-optimized rendering
        zIndex: 40,
      });
      markerObjs.current.push(marker);
    });
  }, [markers, center, userCenter]);

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
