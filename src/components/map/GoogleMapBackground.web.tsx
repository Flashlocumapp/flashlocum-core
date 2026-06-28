/// <reference types="google.maps" />
// Web (google.maps JS) implementation of GoogleMapBackground.
// This is the original implementation, moved here behind the splitter at
// src/components/GoogleMapBackground.tsx. Behavior is identical — only the
// shared bits (bounds, style, marker SVGs) have been extracted to siblings.

import { useEffect, useRef, useState } from "react";
import type { Marker } from "@/components/MapBackground";
import { hasMapsKey, loadMapsApi } from "@/lib/google-maps";
import { getLastKnown, requestOnce, subscribe } from "@/lib/location";
import { FALLBACK_CENTER, LAGOS_BOUNDS_LITERAL, inLagos, type Coords } from "./lagos-bounds";
import { LIGHT_STYLE } from "./map-style";
import { doctorMarkerArt, requesterDotMarkerArt } from "./marker-icons";

export type PlaceMapMarker = Coords & { key: string; title?: string };

const BROWSER_KEY_PRESENT = hasMapsKey();

function doctorIcon(scale = 1): google.maps.Icon {
  const art = doctorMarkerArt(scale);
  return {
    url: art.url,
    scaledSize: new google.maps.Size(art.size, art.size),
    anchor: new google.maps.Point(art.size / 2, art.size / 2),
  };
}

function requesterDotIcon(): google.maps.Icon {
  const art = requesterDotMarkerArt();
  return {
    url: art.url,
    scaledSize: new google.maps.Size(art.size, art.size),
    anchor: new google.maps.Point(art.size / 2, art.size / 2),
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
  markerScale?: number;
} = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerObjs = useRef<Map<string, google.maps.Marker>>(new Map());
  const selfMarker = useRef<google.maps.Marker | null>(null);
  const [failed, setFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [userCenter, setUserCenterState] = useState<Coords | null>(() => {
    const k = getLastKnown();
    return k ? { lat: k.lat, lng: k.lng } : null;
  });

  useEffect(() => {
    const unsub = subscribe((c) => setUserCenterState({ lat: c.lat, lng: c.lng }));
    void requestOnce();
    return unsub;
  }, []);

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

  useEffect(() => {
    if (!mapRef.current) return;
    const c = center ?? userCenter;
    if (!c) return;
    mapRef.current.panTo(inLagos(c) ? c : FALLBACK_CENTER);
  }, [center, userCenter, mapReady]);

  useEffect(() => {
    if (!active || !mapRef.current) return;
    const c = center ?? userCenter;
    if (!c) return;
    mapRef.current.panTo(inLagos(c) ? c : FALLBACK_CENTER);
  }, [active, center, userCenter, mapReady]);

  useEffect(() => {
    if (!mapRef.current) return;
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
        optimized: false,
        zIndex: 60,
        title: selfMarkerKind === "doctor" ? "Doctor location" : "You are here",
      });
    } else {
      selfMarker.current.setIcon(selfMarkerKind === "doctor" ? doctorIcon() : requesterDotIcon());
      selfMarker.current.setPosition(userCenter);
    }
  }, [userCenter, showSelf, selfMarkerKind, mapReady]);

  useEffect(() => {
    if (!mapRef.current) return;
    const pool = markerObjs.current;
    const next = markers ?? [];
    const seen = new Set<string>();
    next.forEach((m) => {
      if (m.lat == null || m.lng == null) return;
      const pos = { lat: m.lat, lng: m.lng };
      if (!inLagos(pos)) return;
      seen.add(m.key);
      const existing = pool.get(m.key);
      if (existing) {
        existing.setPosition(pos);
        existing.setIcon(doctorIcon(markerScale));
      } else {
        pool.set(
          m.key,
          new google.maps.Marker({
            position: pos,
            map: mapRef.current!,
            icon: doctorIcon(markerScale),
            optimized: false,
            zIndex: 40,
          }),
        );
      }
    });
    for (const [key, marker] of pool) {
      if (!seen.has(key)) {
        marker.setMap(null);
        pool.delete(key);
      }
    }
  }, [markers, markerScale, mapReady]);

  // Hospital / place markers are intentionally NOT rendered (parity note).
  void placeMarkers;

  if (failed || !BROWSER_KEY_PRESENT) {
    return (
      <div className="absolute inset-0" style={{ background: "var(--color-map)" }} aria-hidden />
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "#aab2bd" }}>
      <div ref={ref} className="absolute inset-0 h-full w-full" />
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
