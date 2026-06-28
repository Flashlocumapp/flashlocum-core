// Native (Capacitor) implementation of GoogleMapBackground.
//
// This is the ONLY file in the project that imports @capacitor/google-maps.
// The splitter at src/components/GoogleMapBackground.tsx selects this impl
// when (isNative() && isNativeMapsEnabled()); on the web the JS impl in
// ./GoogleMapBackground.web.tsx renders instead.
//
// Prop contract is identical to the web component. Behavior parity is
// documented in CAPACITOR.md#native-maps-verification.
//
// API key:
//   The native Google Maps SDKs read their key directly from
//   android/app/src/main/AndroidManifest.xml (com.google.android.geo.API_KEY)
//   and ios/App/App/Info.plist (GMSApiKey). The Capacitor plugin still
//   requires a string argument to GoogleMap.create({ apiKey }); we pass
//   VITE_CAPACITOR_MAPS_API_KEY, which scripts/check-native-map-key.mjs
//   verifies is the same value present in the platform manifests. The
//   browser key is NEVER used here as a fallback.
//
// Blank-map guard rails (see plan: native Google Map blank on Android):
//   1. Only fields declared on @capacitor/google-maps v8 GoogleMapConfig
//      are passed to GoogleMap.create. Web-only options (restriction,
//      disableDefaultUI, gestureHandling, clickableIcons, backgroundColor)
//      are intentionally omitted — they are silently ignored or trigger
//      init errors on Android. Lagos clamping is enforced in JS via
//      inLagos(...) before every setCamera and addMarker call.
//   2. The host div, its wrapper, and the html/body/#root chain are made
//      transparent while the native map is mounted, so the MapView the
//      plugin draws behind the WebView is actually visible.
//   3. GoogleMap.create is wrapped in begin/ok/failed logs with the full
//      exception object; the fallback overlay surfaces the message on
//      device so failures are never silent.
//   4. Creation is deferred until the host has a non-zero bounding rect.

import { useEffect, useRef, useState } from "react";
import { GoogleMap } from "@capacitor/google-maps";
import type { Marker as PresenceMarker } from "@/components/MapBackground";
import { getLastKnown, requestOnce, subscribe } from "@/lib/location";
import {
  FALLBACK_CENTER,
  inLagos,
  type Coords,
} from "./lagos-bounds";
import { LIGHT_STYLE } from "./map-style";
import { doctorMarkerArt, requesterDotMarkerArt } from "./marker-icons";

export type PlaceMapMarker = Coords & { key: string; title?: string };

const NATIVE_KEY = import.meta.env.VITE_CAPACITOR_MAPS_API_KEY as string | undefined;

let MAP_ID_SEQ = 0;

function waitForHostSize(el: HTMLDivElement, timeoutMs = 1500): Promise<DOMRect> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        resolve(rect);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`host element has zero size after ${timeoutMs}ms`));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
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
  markers?: PresenceMarker[];
  center?: Coords | null;
  placeMarkers?: PlaceMapMarker[];
  showSelf?: boolean;
  selfMarkerKind?: "requester" | "doctor";
  active?: boolean;
  markerScale?: number;
} = {}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMap | null>(null);
  const mapReadyRef = useRef(false);
  const [failed, setFailed] = useState(!NATIVE_KEY);
  const [lastError, setLastError] = useState<string | null>(
    NATIVE_KEY ? null : "VITE_CAPACITOR_MAPS_API_KEY is missing at build time"
  );
  const [mapReady, setMapReady] = useState(false);

  // Pool: marker key (presence row id) → native marker id returned by addMarker.
  const markerPool = useRef<Map<string, string>>(new Map());
  // Cache last position so we can detect moves and avoid no-op re-adds.
  const markerPositions = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const selfMarkerId = useRef<string | null>(null);
  const selfMarkerKey = useRef<string | null>(null);

  const [userCenter, setUserCenter] = useState<Coords | null>(() => {
    const k = getLastKnown();
    return k ? { lat: k.lat, lng: k.lng } : null;
  });

  // GPS subscription — identical contract to the web impl.
  useEffect(() => {
    const unsub = subscribe((c) => setUserCenter({ lat: c.lat, lng: c.lng }));
    void requestOnce();
    return unsub;
  }, []);

  // Mark the html chain transparent while a native map is mounted so the
  // MapView the plugin draws behind the WebView is visible.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    html.classList.add("capacitor-native-map");
    return () => {
      html.classList.remove("capacitor-native-map");
    };
  }, []);

  // Create the native map once. Destroy on unmount.
  useEffect(() => {
    let cancelled = false;
    if (!NATIVE_KEY) {
      console.error("[capacitor-maps] create:skipped", {
        reason: "VITE_CAPACITOR_MAPS_API_KEY missing — native key was not bundled",
      });
      setFailed(true);
      return;
    }
    if (!hostRef.current) return;

    const id = `flashlocum-map-${++MAP_ID_SEQ}`;
    const rawInitial = center ?? userCenter ?? FALLBACK_CENTER;
    const initial = inLagos(rawInitial) ? rawInitial : FALLBACK_CENTER;

    (async () => {
      const host = hostRef.current;
      if (!host) return;
      let rect: DOMRect;
      try {
        rect = await waitForHostSize(host);
      } catch (sizeErr) {
        console.error("[capacitor-maps] create:skipped zero-size host", {
          id,
          message: (sizeErr as Error)?.message,
        });
        if (!cancelled) {
          setFailed(true);
          setLastError((sizeErr as Error)?.message ?? "zero-size host");
        }
        return;
      }
      if (cancelled) return;

      console.info("[capacitor-maps] create:begin", {
        id,
        hasKey: !!NATIVE_KEY,
        keyLen: NATIVE_KEY?.length,
        center: initial,
        hostRect: { width: rect.width, height: rect.height, x: rect.x, y: rect.y },
        pluginVersion: "8.x",
      });

      try {
        const map = await GoogleMap.create({
          id,
          element: host,
          apiKey: NATIVE_KEY,
          // Recover cleanly if a previous instance with the same id lingers
          // (HMR / strict-mode double-mount). Cheap on real devices.
          forceCreate: true,
          // Only fields declared on @capacitor/google-maps v8 GoogleMapConfig
          // are honoured on Android/iOS. JS Maps API options like
          // restriction / disableDefaultUI / gestureHandling / clickableIcons
          // / backgroundColor are intentionally NOT passed here — they are
          // web-only and have caused silent init failures on Android.
          config: {
            center: { lat: initial.lat, lng: initial.lng },
            zoom: 12,
            minZoom: 10,
            maxZoom: 18,
            styles: LIGHT_STYLE,
            devicePixelRatio:
              typeof window !== "undefined" && window.devicePixelRatio
                ? window.devicePixelRatio
                : 1,
          },
        });

        if (cancelled) {
          await map.destroy().catch(() => {});
          return;
        }
        mapRef.current = map;
        mapReadyRef.current = true;
        setMapReady(true);
        console.info("[capacitor-maps] create:ok", { id });
      } catch (err) {
        const e = err as { message?: string; code?: string; stack?: string };
        console.error("[capacitor-maps] create:failed", {
          id,
          message: e?.message ?? String(err),
          code: e?.code,
          stack: e?.stack,
          raw: err,
        });
        if (!cancelled) {
          setFailed(true);
          setLastError(e?.message ?? String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      const m = mapRef.current;
      mapRef.current = null;
      mapReadyRef.current = false;
      markerPool.current.clear();
      markerPositions.current.clear();
      selfMarkerId.current = null;
      selfMarkerKey.current = null;
      if (m) {
        m.destroy().catch((err) => {
          console.warn("[capacitor-maps] destroy:failed", err);
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pan camera (never zoom) when center/userCenter/active changes. Lagos
  // clamp replaces the (web-only) `restriction` config option.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const c = center ?? userCenter;
    if (!c) return;
    const safe = inLagos(c) ? c : FALLBACK_CENTER;
    map
      .setCamera({
        coordinate: { lat: safe.lat, lng: safe.lng },
        animate: true,
      })
      .catch((err) => console.warn("[capacitor-maps] setCamera failed", err));
  }, [center, userCenter, active, mapReady]);

  // Self marker (requester dot or doctor stethoscope).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const shouldShow = !!userCenter && showSelf && inLagos(userCenter);

    (async () => {
      // Remove existing self marker if hidden or kind changed.
      const expectedKey = shouldShow ? `self:${selfMarkerKind}` : null;
      if (selfMarkerId.current && selfMarkerKey.current !== expectedKey) {
        const id = selfMarkerId.current;
        selfMarkerId.current = null;
        selfMarkerKey.current = null;
        await map.removeMarker(id).catch(() => {});
      }
      if (!shouldShow || !userCenter) return;

      const art = selfMarkerKind === "doctor" ? doctorMarkerArt() : requesterDotMarkerArt();
      if (!selfMarkerId.current) {
        try {
          const id = await map.addMarker({
            coordinate: { lat: userCenter.lat, lng: userCenter.lng },
            iconUrl: art.url,
            iconSize: { width: art.size, height: art.size },
            iconAnchor: { x: art.size / 2, y: art.size / 2 },
            zIndex: 60,
            title: selfMarkerKind === "doctor" ? "Doctor location" : "You are here",
          });
          selfMarkerId.current = id;
          selfMarkerKey.current = expectedKey;
        } catch {
          // ignore
        }
      } else {
        // The plugin has no setPosition; remove + re-add to move the self pin.
        const old = selfMarkerId.current;
        selfMarkerId.current = null;
        await map.removeMarker(old).catch(() => {});
        try {
          const id = await map.addMarker({
            coordinate: { lat: userCenter.lat, lng: userCenter.lng },
            iconUrl: art.url,
            iconSize: { width: art.size, height: art.size },
            iconAnchor: { x: art.size / 2, y: art.size / 2 },
            zIndex: 60,
          });
          selfMarkerId.current = id;
          selfMarkerKey.current = expectedKey;
        } catch {
          // ignore
        }
      }
    })();
  }, [userCenter, showSelf, selfMarkerKind, mapReady]);

  // Doctor marker pool — diff by key, parity with the web Marker pool.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const next = markers ?? [];
    const seen = new Set<string>();

    (async () => {
      const art = doctorMarkerArt(markerScale);
      for (const m of next) {
        if (m.lat == null || m.lng == null) continue;
        const pos = { lat: m.lat, lng: m.lng };
        if (!inLagos(pos)) continue;
        seen.add(m.key);

        const existingId = markerPool.current.get(m.key);
        const lastPos = markerPositions.current.get(m.key);
        const moved =
          !lastPos || lastPos.lat !== pos.lat || lastPos.lng !== pos.lng;

        if (existingId && !moved) continue;

        // The plugin lacks an in-place move; remove and re-add when moved.
        if (existingId) {
          markerPool.current.delete(m.key);
          markerPositions.current.delete(m.key);
          await map.removeMarker(existingId).catch(() => {});
        }
        try {
          const id = await map.addMarker({
            coordinate: pos,
            iconUrl: art.url,
            iconSize: { width: art.size, height: art.size },
            iconAnchor: { x: art.size / 2, y: art.size / 2 },
            zIndex: 40,
          });
          markerPool.current.set(m.key, id);
          markerPositions.current.set(m.key, pos);
        } catch {
          // ignore individual marker failures
        }
      }

      // Remove markers no longer present.
      for (const [key, id] of Array.from(markerPool.current.entries())) {
        if (!seen.has(key)) {
          markerPool.current.delete(key);
          markerPositions.current.delete(key);
          await map.removeMarker(id).catch(() => {});
        }
      }
    })();
  }, [markers, markerScale, mapReady]);

  // Hospital / place markers — accepted but not rendered, matching web parity.
  void placeMarkers;

  if (failed) {
    return (
      <div
        className="absolute inset-0"
        style={{ background: "var(--color-map)" }}
        aria-hidden={false}
      >
        {lastError ? (
          <div
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 12,
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.72)",
              color: "#fff",
              fontSize: 11,
              lineHeight: 1.35,
              fontFamily: "monospace",
              maxHeight: "40%",
              overflow: "auto",
              pointerEvents: "auto",
              zIndex: 5,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              Native map failed to initialise
            </div>
            <div>{lastError}</div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: "transparent" }}
    >
      <div
        ref={hostRef}
        className="absolute inset-0 h-full w-full capacitor-google-map"
        style={{ background: "transparent" }}
      />
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
