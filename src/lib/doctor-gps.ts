// Event-driven GPS writes for doctor presence.
//
// FlashLocum is NOT a real-time tracking platform. We do not use
// `watchPosition`, background tasks, or any Capacitor background-geolocation
// plugin. The doctor's approximate location is refreshed only on:
//
//   * doctor app mount (sign-in / app open)
//   * doctor toggles Online on
//   * doctor taps "Refresh location"
//   * a low-frequency 20-minute foreground tick while online
//
// If GPS permission is denied, presence still writes online=true with
// lat/lng=null; the requester map simply omits the marker.

import { upsertMyPresence } from "@/lib/presence-remote";

const MAX_ACCEPTED_ACCURACY_METERS = 2_000;
const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes — see comment above

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandlerInstalled = false;
let currentlyOnline = false;

/** Capture a single GPS sample and write it to presence.
 *  Returns silently on permission denial / timeout — presence is still
 *  written with online=true and lat/lng=null elsewhere. */
export function refreshDoctorLocation(online: boolean): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    void upsertMyPresence({ online, lat: null, lng: null });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      if (accuracy != null && accuracy > MAX_ACCEPTED_ACCURACY_METERS) {
        // Coarse fix — write online state without leaking a misleading point.
        void upsertMyPresence({ online, lat: null, lng: null });
        return;
      }
      void upsertMyPresence({ online, lat: latitude, lng: longitude });
    },
    () => {
      void upsertMyPresence({ online, lat: null, lng: null });
    },
    { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
  );
}

/** Start the 20-minute foreground refresh tick. Idempotent. Cleared via
 *  stopDoctorLocationRefresh(). */
export function startDoctorLocationRefresh(): void {
  currentlyOnline = true;
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (!currentlyOnline) return;
    refreshDoctorLocation(true);
  }, REFRESH_INTERVAL_MS);
  if (!visibilityHandlerInstalled && typeof document !== "undefined") {
    visibilityHandlerInstalled = true;
    // No-op handler — visibility is read inside the interval itself. We
    // install a stub so future expansion (e.g. on-visible refresh) is easy.
  }
}

export function stopDoctorLocationRefresh(): void {
  currentlyOnline = false;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
