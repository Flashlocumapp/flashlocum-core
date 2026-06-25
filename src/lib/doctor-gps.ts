// Event-driven GPS writes for doctor presence.
//
// FlashLocum is NOT a real-time tracking platform. We do not use
// `watchPosition`, background tasks, or any Capacitor background-geolocation
// plugin. The doctor's approximate location is refreshed only on:
//
//   * doctor app mount (sign-in / app open)
//   * doctor toggles Online on
//   * a low-frequency 20-minute foreground tick while online
//
// This module is a thin PRESENCE WRITER. It does not call
// `navigator.geolocation` itself — every position read goes through the
// single location service in `src/lib/location.ts`. If permission is denied
// or no fix is available, presence still writes with lat/lng=null; the
// requester map simply omits the marker.

import { requestOnce } from "@/lib/location";
import { upsertMyPresence } from "@/lib/presence-remote";

const REFRESH_INTERVAL_MS = 20 * 60 * 1000;

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let currentlyOnline = false;

/** Capture one fix via the central location service and write it to
 *  presence. Safe to call when GPS is denied — writes online state with
 *  lat/lng=null in that case. */
export function refreshDoctorLocation(online: boolean): void {
  void requestOnce().then((c) => {
    if (c) {
      void upsertMyPresence({ online, lat: c.lat, lng: c.lng });
    } else {
      void upsertMyPresence({ online, lat: null, lng: null });
    }
  });
}

/** Start the 20-minute foreground refresh tick. Idempotent. */
export function startDoctorLocationRefresh(): void {
  currentlyOnline = true;
  if (refreshTimer) return;
  refreshTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (!currentlyOnline) return;
    refreshDoctorLocation(true);
  }, REFRESH_INTERVAL_MS);
}

export function stopDoctorLocationRefresh(): void {
  currentlyOnline = false;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
