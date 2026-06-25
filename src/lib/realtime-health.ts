// Tiny pub/sub for realtime channel health.
//
// Stage 0 safety net: surface when a realtime channel (coverage_requests,
// coverage_invalidations, doctor_presence) is disconnected/reconnecting so the
// UI can render a "Reconnecting…" indicator and so internal modules can react.
// Independent of any specific channel; coverage-remote and presence-remote
// each report into it.

export type ChannelKey = "coverage" | "invalidations" | "presence";
export type ChannelHealth = "ok" | "reconnecting" | "down";

type HealthMap = Record<ChannelKey, ChannelHealth>;

const state: HealthMap = {
  coverage: "ok",
  invalidations: "ok",
  presence: "ok",
};

const listeners = new Set<(h: HealthMap) => void>();

export function setChannelHealth(key: ChannelKey, health: ChannelHealth) {
  if (state[key] === health) return;
  state[key] = health;
  const snap: HealthMap = { ...state };
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* noop */
    }
  });
}

export function getChannelHealth(): HealthMap {
  return { ...state };
}

/** True when any tracked channel is not OK (reconnecting or down). */
export function isAnyReconnecting(h: HealthMap = state): boolean {
  return h.coverage !== "ok" || h.invalidations !== "ok" || h.presence !== "ok";
}

/**
 * Reconnecting indicator scoped to surfaces that depend on coverage data
 * (Coverage screen, RequesterHome, CoverHome). Presence is intentionally
 * excluded — it is a doctor-roster signal; the requester-side presence
 * channel does not reach SUBSCRIBED, so including it would leave the pill
 * stuck on "Reconnecting…" forever.
 */
export function isCoverageReconnecting(h: HealthMap = state): boolean {
  return h.coverage !== "ok" || h.invalidations !== "ok";
}

export function subscribeRealtimeHealth(cb: (h: HealthMap) => void): () => void {
  listeners.add(cb);
  cb({ ...state });
  return () => {
    listeners.delete(cb);
  };
}
