// Foreground-only audio cues for the canonical-event engine.
//
// Two sounds, both intentionally soft and brief:
//   - alert   → new incoming coverage request (doctor-side, foreground)
//   - confirm → server-confirmed acceptance (both doctor and requester,
//               foreground only — triggered by the realtime row echo)
//
// There is no user toggle: sound is part of the notification contract,
// not a preference. Reduced-motion and the existing haptics/push prefs
// are unaffected (they govern vibration and the foreground-push pipeline,
// not in-app audio).
//
// Capacitor compatibility:
//   HTMLAudioElement is provided by the WebView on iOS and Android, so
//   the same playback code runs unchanged inside the Capacitor shell.
//   No `@capacitor-community/native-audio` plugin is required. On iOS
//   <audio> respects the silent switch, which is the correct behaviour
//   for notification cues. No background playback, no AVAudioSession.
//
// Dedup:
//   These helpers are invoked exclusively from inside `ingest()` in
//   `src/lib/feedback.ts`, *after* the G3/G4/G7 gates. That means every
//   (kind, entityId, version) plays at most one sound across local +
//   realtime + push arrivals, including multi-tab via BroadcastChannel.

import alertUrl from "@/assets/sounds/alert.wav?url";
import confirmUrl from "@/assets/sounds/confirm.wav?url";

type Kind = "alert" | "confirm";

const URLS: Record<Kind, string> = {
  alert: alertUrl,
  confirm: confirmUrl,
};

const cache: Partial<Record<Kind, HTMLAudioElement>> = {};

function getElement(kind: Kind): HTMLAudioElement | null {
  if (typeof window === "undefined" || typeof Audio === "undefined") return null;
  const existing = cache[kind];
  if (existing) return existing;
  try {
    const el = new Audio(URLS[kind]);
    el.preload = "auto";
    // Mark as no-loop, modest gain. Volume kept slightly under 1.0 so the
    // assets themselves carry the loudness (mastered ~-16 dBFS for alert,
    // ~-20 dBFS for confirm).
    el.loop = false;
    el.volume = 1.0;
    cache[kind] = el;
    return el;
  } catch {
    return null;
  }
}

function play(kind: Kind): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    // Foreground-only. Backgrounded users receive sound via the OS push
    // (device default chime + default vibration).
    return;
  }
  const el = getElement(kind);
  if (!el) return;
  try {
    // Rewind so a rapid retrigger replaces, not stacks. Single shared
    // element per kind = at most one voice playing at any moment.
    el.pause();
    el.currentTime = 0;
    const p = el.play();
    if (p && typeof (p as Promise<void>).catch === "function") {
      (p as Promise<void>).catch(() => {
        // Autoplay rejection (no prior user gesture, OS lock, etc.). The
        // user is already interacting with the foreground app by the time
        // these events fire, so this is defensive only.
      });
    }
  } catch {
    /* noop */
  }
}

export function playAlert(): void {
  play("alert");
}

export function playConfirm(): void {
  play("confirm");
}
