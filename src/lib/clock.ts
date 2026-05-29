// FlashLocum simulation clock.
//
// Single source of truth for "now" across the entire app. All operational
// time reads (reminders, elapsed timers, settlement countdowns, grace
// periods, overtime billing, multi-day rollover) go through `simNow()`
// so a dev fast-forward instantly synchronizes Cover & Earn AND
// Request Coverage on both the current tab and every other open tab.
//
// Internal / testing only. Not exposed in production UX.

const STORAGE = "flashlocum.sim.offset.v1";
const CHANNEL = "flashlocum.sim.clock.v1";

type Listener = (offsetMs: number) => void;

let offsetMs = 0;
let channel: BroadcastChannel | null = null;
const listeners = new Set<Listener>();

function load(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(STORAGE);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function persist(value: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE, String(value));
  } catch {
    /* noop */
  }
}

function init() {
  if (typeof window === "undefined") return;
  if (channel) return;
  offsetMs = load();
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (m) => {
      const next = Number(m.data?.offset);
      if (Number.isFinite(next) && next !== offsetMs) {
        offsetMs = next;
        listeners.forEach((l) => l(offsetMs));
      }
    };
  } catch {
    /* noop */
  }
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE) {
      offsetMs = load();
      listeners.forEach((l) => l(offsetMs));
    }
  });
}

if (typeof window !== "undefined") init();

/** The current simulated wall-clock timestamp in ms. */
export function simNow(): number {
  return Date.now() + offsetMs;
}

/** Read the current fast-forward offset (ms). 0 = Real Time. */
export function getSimOffset(): number {
  return offsetMs;
}

/** Replace the offset (used for "Real Time" reset). */
export function setSimOffset(next: number) {
  init();
  offsetMs = next;
  persist(offsetMs);
  listeners.forEach((l) => l(offsetMs));
  channel?.postMessage({ offset: offsetMs });
}

/** Add to the current offset (fast-forward by `deltaMs`). */
export function advanceSim(deltaMs: number) {
  setSimOffset(offsetMs + deltaMs);
}

/** Reset to wall clock. */
export function resetSim() {
  setSimOffset(0);
}

/** Subscribe to offset changes (returns unsubscribe). */
export function subscribeSim(fn: Listener): () => void {
  init();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------- React glue ---------- */

import { useEffect, useState } from "react";

/** Re-render when the sim offset changes. Returns current offset. */
export function useSimOffset(): number {
  const [o, setO] = useState<number>(offsetMs);
  useEffect(() => {
    init();
    setO(offsetMs);
    return subscribeSim(setO);
  }, []);
  return o;
}

/**
 * Live ticking simulated clock. Returns `simNow()` and re-renders every
 * `intervalMs` and on every offset change. Use for elapsed/countdown UI.
 */
export function useSimClock(intervalMs = 1000): number {
  const [t, setT] = useState<number>(() => simNow());
  useEffect(() => {
    init();
    const tick = () => setT(simNow());
    tick();
    const id = window.setInterval(tick, intervalMs);
    const off = subscribeSim(tick);
    return () => {
      window.clearInterval(id);
      off();
    };
  }, [intervalMs]);
  return t;
}
