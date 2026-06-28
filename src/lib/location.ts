// Single location service for FlashLocum.
//
// All geolocation reads in the app go through this module. No other file
// may call `navigator.geolocation` directly. This is the seam that lets us
// switch the underlying transport (browser Geolocation today, Capacitor
// Geolocation later) without touching feature code or the UI.
//
// Design:
//  - One in-memory cache of the last accepted fix, shared by every consumer
//    (the map's "you are here" dot, the requester's search origin, the
//    doctor presence writer).
//  - One accuracy + drift filter — wild IP/cell-tower hops are rejected
//    centrally so each consumer sees a stable point.
//  - Event-driven by default. `requestOnce()` is the canonical entry. A
//    `subscribe()` channel exists so consumers re-render when a newer fix
//    arrives, but we do NOT start a `watchPosition` — FlashLocum is not a
//    real-time tracking platform (see `doctor-gps.ts` history).
//  - Permission is requested through `ensurePermission()` / implicit on the
//    first `requestOnce()`. Either way, the browser prompt fires from a
//    single code path so consumers never race against each other.

export type Coords = { lat: number; lng: number; accuracy: number };
export type PermissionState = "unknown" | "granted" | "denied" | "unavailable";

const MAX_ACCEPTED_ACCURACY_METERS = 2_000;

let cached: Coords | null = null;
let permissionState: PermissionState = "unknown";
const listeners = new Set<(c: Coords) => void>();
let inFlight: Promise<Coords | null> | null = null;

function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function acceptSample(next: Coords): Coords | null {
  if (next.accuracy > MAX_ACCEPTED_ACCURACY_METERS) return null;
  if (cached) {
    if (next.accuracy > 2000 && next.accuracy > cached.accuracy * 1.5) return null;
    const jump = distanceMeters(cached, next);
    if (jump > 3000 && next.accuracy >= cached.accuracy) return null;
  }
  cached = next;
  for (const l of listeners) {
    try {
      l(next);
    } catch {
      /* noop */
    }
  }
  return next;
}

// The ONE place that reads the underlying platform geolocation. To switch
// to `@capacitor/geolocation` later, replace the body of this function with
// a dynamic import gated on `isNative()` from `@/lib/native`. No other file
// changes.
function readPosition(highAccuracy: boolean): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      permissionState = "unavailable";
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        permissionState = "granted";
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? Number.POSITIVE_INFINITY,
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) permissionState = "denied";
        resolve(null);
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 10_000 : 15_000,
        maximumAge: 60_000,
      },
    );
  });
}

/** Last accepted fix, if any. Synchronous — safe for first paint. */
export function getLastKnown(): Coords | null {
  return cached;
}

/** Current known permission state. Does not trigger a prompt. */
export function getPermissionState(): PermissionState {
  return permissionState;
}

/** Read permission via the Permissions API when available. Does not prompt. */
export async function ensurePermission(): Promise<PermissionState> {
  if (permissionState !== "unknown") return permissionState;
  try {
    const perms = (
      navigator as Navigator & {
        permissions?: { query: (d: { name: PermissionName }) => Promise<PermissionStatus> };
      }
    ).permissions;
    if (perms?.query) {
      const status = await perms.query({ name: "geolocation" as PermissionName });
      if (status.state === "granted") permissionState = "granted";
      else if (status.state === "denied") permissionState = "denied";
    }
  } catch {
    /* noop */
  }
  return permissionState;
}

/** Acquire a single fix. Coalesces concurrent calls. Tries high accuracy
 *  first, falls back to coarse. Returns the accepted fix or null. */
export function requestOnce(): Promise<Coords | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    let sample = await readPosition(true);
    if (!sample) sample = await readPosition(false);
    inFlight = null;
    if (!sample) return cached;
    return acceptSample(sample) ?? cached;
  })();
  return inFlight;
}

/** Subscribe to accepted fixes. Returns an unsubscribe function. The
 *  callback is invoked synchronously with the current cache (if any) and
 *  then again whenever a newer accepted sample arrives. */
export function subscribe(cb: (c: Coords) => void): () => void {
  listeners.add(cb);
  if (cached) {
    try {
      cb(cached);
    } catch {
      /* noop */
    }
  }
  return () => {
    listeners.delete(cb);
  };
}
