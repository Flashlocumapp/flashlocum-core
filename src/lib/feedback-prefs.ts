// User-controlled feedback preferences.
//
// Two booleans persisted in localStorage and broadcast to subscribers so
// the Account panel can flip them and the feedback engine / push listener
// react immediately without a page reload.
//
//  - haptics: gates lifecycle vibrations in feedback.ts. OS-level reduced
//    motion still wins (G9); this is an additional user-level off switch.
//  - push: gates foreground push routing through the engine. Cannot
//    revoke the OS permission; users disable banners at the OS level.
//    When false we drop pushes from the in-app dedup pipeline so foreground
//    arrivals don't re-trigger toasts.

const HAPTICS_KEY = "flashlocum.feedback.haptics";
const PUSH_KEY = "flashlocum.feedback.push";

type PrefKey = "haptics" | "push";
type Listener = (key: PrefKey, value: boolean) => void;

const listeners = new Set<Listener>();

function read(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1";
  } catch {
    return fallback;
  }
}

function write(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* noop */
  }
}

export function hapticsEnabled(): boolean {
  return read(HAPTICS_KEY, true);
}

export function pushEnabled(): boolean {
  return read(PUSH_KEY, true);
}

export function setHapticsEnabled(value: boolean) {
  write(HAPTICS_KEY, value);
  for (const l of listeners) l("haptics", value);
}

export function setPushEnabled(value: boolean) {
  write(PUSH_KEY, value);
  for (const l of listeners) l("push", value);
}

export function subscribeFeedbackPrefs(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
