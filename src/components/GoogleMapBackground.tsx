/// <reference types="google.maps" />
// Live Google Map background. Drop-in replacement for MapBackground.
// Renders the Maps JS API behind the floating UI on Cover & Earn and Request Coverage.

import { useEffect, useRef, useState } from "react";
import type { Marker } from "@/components/MapBackground";
import { hasMapsKey, loadMapsApi } from "@/lib/google-maps";

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
let cachedAccuracy: number | null = null;

const MAX_ACCEPTED_ACCURACY_METERS = 1_000;

// Coarse great-circle distance in metres. Good enough for drift filtering.
function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function GoogleMapBackground({
  markers,
  center,
  placeMarkers,
  showSelf = true,
  selfMarkerKind = "requester",
  active = true,
}: {
  markers?: Marker[];
  center?: Coords | null;
  placeMarkers?: PlaceMapMarker[];
  showSelf?: boolean;
  selfMarkerKind?: "requester" | "doctor";
  active?: boolean;
} = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerObjs = useRef<google.maps.Marker[]>([]);
  const placeMarkerObjs = useRef<google.maps.Marker[]>([]);
  const selfMarker = useRef<google.maps.Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [userCenter, setUserCenterState] = useState<Coords | null>(cachedUserCenter);

  // Accept a new geolocation sample only if it's reasonably accurate AND
  // not a wild jump from the last known fix. IP-based fallbacks routinely
  // hop between Ikeja / Lagos Island with accuracy in the kilometres —
  // filtering those out keeps the blue dot stable.
  const acceptSample = (coords: GeolocationCoordinates) => {
    const next: Coords = { lat: coords.latitude, lng: coords.longitude };
    const acc = coords.accuracy ?? Number.POSITIVE_INFINITY;
    // Only browser-provided location is allowed to drive the requester/doctor
    // position. Coarse IP/cell-tower fixes are what caused the Lagos Island ↔
    // Ikeja jumps, so never treat those as the user's exact map location.
    if (acc > MAX_ACCEPTED_ACCURACY_METERS) {
      console.warn("[map] ignoring coarse geolocation sample", Math.round(acc));
      return;
    }
    if (cachedUserCenter && cachedAccuracy != null) {
      // Reject samples noticeably worse than what we already have.
      if (acc > 2000 && acc > cachedAccuracy * 1.5) return;
      // Reject a large jump unless the new fix is clearly more accurate.
      const jump = distanceMeters(cachedUserCenter, next);
      if (jump > 3000 && acc >= cachedAccuracy) return;
    }
    cachedUserCenter = next;
    cachedAccuracy = acc;
    setUserCenterState(next);
  };

  // Geolocate on mount and keep watching, so the requester "you are here"
  // dot is on screen as quickly as possible and stays accurate as the user
  // moves. High accuracy + short cache window prevents drift between cells.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      console.warn("[map] navigator.geolocation unavailable");
      return;
    }

    let gotFix = false;
    const onErr = (err: GeolocationPositionError) => {
      console.warn("[map] geolocation error", err.code, err.message);
    };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        gotFix = true;
        acceptSample(pos.coords);
      },
      onErr,
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        gotFix = true;
        acceptSample(pos.coords);
      },
      onErr,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 },
    );

    // If high-accuracy fails or takes too long, also try a low-accuracy
    // fix in parallel — some devices/browsers refuse high-accuracy outright.
    const lowAccTimer = window.setTimeout(() => {
      if (gotFix) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          gotFix = true;
          acceptSample(pos.coords);
        },
        onErr,
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
      );
    }, 4_000);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(lowAccTimer);
    };
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
  }, [markers, center, userCenter, mapReady]);

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
      {/* Hide Google Maps attribution / terms / report links */}
      <style>{`
        .gm-style-cc,
        .gm-style > div > a,
        .gmnoprint a[href*="google.com"],
        .gm-style > div > div > span,
        .gm-style .gm-style-cc a,
        a[href*="maps.google.com"],
        a[href*="www.google.com/intl"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
      `}</style>
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
