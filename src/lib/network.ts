// FlashLocum simulated operational network.
//
// Shared across browser windows via BroadcastChannel + localStorage.
// Each tab is an independent "session" (sessionStorage), so opening N
// Cover & Earn tabs simulates N doctor sessions, and opening a Request
// Coverage tab in another window participates in the same network.
//
// This is frontend-only simulation. No backend yet.

import { useEffect, useState } from "react";
import { getRole } from "./role";

function actorOf(): Actor {
  if (typeof window === "undefined") return "system";
  return getRole() === "cover" ? "doctor" : "requester";
}

const SCHEMA_VERSION = 2;
const CHANNEL = "flashlocum.net.v2";
const STORAGE = "flashlocum.net.v2";
const LEGACY_STORAGE = "flashlocum.net.v1";
const SESSION_KEY = "flashlocum.session";
const HEARTBEAT_MS = 4000;
const STALE_MS = 12000;
const BROADCAST_TTL_MS = 30 * 60 * 1000;
const MAX_CONFIRMED_SHIFTS = 3;
const BUFFER_MS = 60 * 60 * 1000;

export type DoctorPresence = {
  sessionId: string;
  online: boolean;
  acceptedCount: number;
  // Stable, slightly randomized map position per session.
  top: number; // 0..1
  left: number; // 0..1
  lastSeen: number;
  declined: string[]; // request ids this session declined
};

export type NetRequestStatus =
  | "broadcasting"
  | "paused"
  | "accepted"
  | "active"
  | "completed"
  | "cancelled";

export type NetRequest = {
  id: string;
  requesterSessionId: string;
  hospital: string;
  area: string;
  coverage: string; // "Standard" | "24-Hour" | "Weekend Call" | "Home Care"
  day: string;
  start: string;
  end: string;
  durationHrs: number;
  amount: number;
  feePct: number;
  phone: string;
  note?: string;
  status: NetRequestStatus;
  acceptedBy?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  // Absolute timestamps for the scheduled coverage window — single source
  // of truth for conflict detection across all coverage types.
  startTs?: number;
  endTs?: number;
};

export type Actor = "requester" | "doctor" | "system";
export type NetActionType =
  | "publish"
  | "accept"
  | "decline"
  | "start"
  | "complete"
  | "cancel"
  | "update"
  | "pause"
  | "resume"
  | "remove"
  | "presence";

export type NetEvent = {
  actor: Actor;
  actorId: string;
  shiftId?: string;
  action: NetActionType;
  at: number;
};

export type NetState = {
  schemaVersion?: number;
  doctors: Record<string, DoctorPresence>;
  requests: Record<string, NetRequest>;
  lastEvent?: NetEvent;
};

export type AcceptBlockReason = "max" | "overlap" | "buffer" | "claimed" | "unavailable";
export type AcceptRequestResult = { ok: true } | { ok: false; reason: AcceptBlockReason };

const emptyState = (): NetState => ({ schemaVersion: SCHEMA_VERSION, doctors: {}, requests: {} });

/* ---------------- session id ---------------- */

export function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let s = window.sessionStorage.getItem(SESSION_KEY);
    if (!s) {
      s = "s_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      window.sessionStorage.setItem(SESSION_KEY, s);
    }
    return s;
  } catch {
    return "s_local";
  }
}

/* ---------------- storage + channel ---------------- */

let channel: BroadcastChannel | null = null;
let state: NetState = emptyState();
const listeners = new Set<(s: NetState) => void>();

function load(): NetState {
  if (typeof window === "undefined") return emptyState();
  try {
    window.localStorage.removeItem(LEGACY_STORAGE);
    const raw = window.localStorage.getItem(STORAGE);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as NetState;
    if (parsed.schemaVersion !== SCHEMA_VERSION) return emptyState();
    return {
      schemaVersion: SCHEMA_VERSION,
      doctors: parsed.doctors ?? {},
      requests: parsed.requests ?? {},
      lastEvent: parsed.lastEvent,
    };
  } catch {
    return emptyState();
  }
}

function refreshState(): NetState {
  state = pruneStale(load());
  return state;
}

function save(next: NetState, event?: Omit<NetEvent, "at">) {
  // CORRECT SYNC ORDER:
  //   1) update global state  → 2) persist  → 3) notify  → 4) broadcast
  const { lastEvent: _previousEvent, ...withoutEvent } = next;
  const stamped: NetState = event
    ? { ...withoutEvent, schemaVersion: SCHEMA_VERSION, lastEvent: { ...event, at: Date.now() } }
    : { ...withoutEvent, schemaVersion: SCHEMA_VERSION };
  state = stamped;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(stamped));
  } catch {
    /* noop */
  }
  listeners.forEach((l) => l(state));
  channel?.postMessage({ type: "state", state: stamped });
}

function pruneStale(s: NetState): NetState {
  const now = Date.now();
  const doctors: Record<string, DoctorPresence> = {};
  for (const [k, d] of Object.entries(s.doctors)) {
    if (now - d.lastSeen < STALE_MS) doctors[k] = d;
  }
  const requests: Record<string, NetRequest> = {};
  for (const [k, r] of Object.entries(s.requests)) {
    if (r.status === "broadcasting" && now - r.createdAt > BROADCAST_TTL_MS) continue;
    requests[k] = r;
  }
  return { ...s, schemaVersion: SCHEMA_VERSION, doctors, requests };
}

function init() {
  if (typeof window === "undefined") return;
  if (channel) return;
  state = pruneStale(load());
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => {
      const incoming = message.data?.state as NetState | undefined;
      state = pruneStale(incoming?.schemaVersion === SCHEMA_VERSION ? incoming : load());
      listeners.forEach((l) => l(state));
    };
  } catch {
    /* noop */
  }
  // Cross-tab fallback via storage events.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE) {
      state = pruneStale(load());
      listeners.forEach((l) => l(state));
    }
  });
}

if (typeof window !== "undefined") init();

export function useNetwork() {
  const [s, setS] = useState<NetState>(state);
  useEffect(() => {
    init();
    setS(state);
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

/** Subscribe to network state outside of React. */
export function subscribeNetwork(fn: (s: NetState) => void): () => void {
  init();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/* ---------------- doctor presence ---------------- */

function randomPos(seed: string): { top: number; left: number } {
  // deterministic-ish from session id
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const a = (h % 1000) / 1000;
  const b = ((h >>> 10) % 1000) / 1000;
  // Keep within a comfortable band of the map.
  const top = 0.18 + a * 0.5; // 18%..68%
  const left = 0.12 + b * 0.72; // 12%..84%
  return { top, left };
}

export function registerDoctor(initialOnline: boolean) {
  refreshState();
  const sid = getSessionId();
  const current = state.doctors[sid];
  const pos = current ?? randomPos(sid);
  const next: NetState = {
    ...state,
    doctors: {
      ...state.doctors,
      [sid]: {
        sessionId: sid,
        online: current ? current.online : initialOnline,
        acceptedCount: current?.acceptedCount ?? 0,
        top: pos.top,
        left: pos.left,
        lastSeen: Date.now(),
        declined: current?.declined ?? [],
      },
    },
  };
  save(next);
}

export function unregisterDoctor() {
  refreshState();
  const sid = getSessionId();
  if (!state.doctors[sid]) return;
  const { [sid]: _gone, ...rest } = state.doctors;
  save({ ...state, doctors: rest });
}

export function heartbeat() {
  refreshState();
  const sid = getSessionId();
  const d = state.doctors[sid];
  if (!d) return;
  save({
    ...state,
    doctors: { ...state.doctors, [sid]: { ...d, lastSeen: Date.now() } },
  });
}

export function setDoctorOnline(online: boolean) {
  refreshState();
  const sid = getSessionId();
  const d = state.doctors[sid];
  if (!d) {
    registerDoctor(online);
    return;
  }
  save({
    ...state,
    doctors: {
      ...state.doctors,
      [sid]: { ...d, online, lastSeen: Date.now() },
    },
  });
}

export function setDoctorAcceptedCount(n: number) {
  refreshState();
  const sid = getSessionId();
  const d = state.doctors[sid];
  if (!d) return;
  save({
    ...state,
    doctors: {
      ...state.doctors,
      [sid]: { ...d, acceptedCount: n, lastSeen: Date.now() },
    },
  });
}

export function markDeclined(requestId: string) {
  refreshState();
  const sid = getSessionId();
  const d = state.doctors[sid];
  if (!d) return;
  if (d.declined.includes(requestId)) return;
  save({
    ...state,
    doctors: {
      ...state.doctors,
      [sid]: { ...d, declined: [...d.declined, requestId] },
    },
  });
}

export function startHeartbeat() {
  if (typeof window === "undefined") return () => {};
  const t = window.setInterval(() => heartbeat(), HEARTBEAT_MS);
  const visibility = () => {
    if (document.visibilityState === "visible") heartbeat();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("beforeunload", unregisterDoctor);
  return () => {
    window.clearInterval(t);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("beforeunload", unregisterDoctor);
  };
}

/* ---------------- requests ---------------- */

export function publishRequest(
  req: Omit<NetRequest, "id" | "requesterSessionId" | "status" | "createdAt" | "updatedAt">,
): NetRequest {
  refreshState();
  const sid = getSessionId();
  const now = Date.now();
  const id = "r_" + now.toString(36) + Math.random().toString(36).slice(2, 6);
  const full: NetRequest = {
    ...req,
    id,
    requesterSessionId: sid,
    status: "broadcasting",
    createdAt: now,
    updatedAt: now,
  };
  save(
    { ...state, requests: { ...state.requests, [id]: full } },
    { actor: "requester", actorId: sid, shiftId: id, action: "publish" },
  );
  return full;
}

function applyPatch(
  id: string,
  patch: Partial<NetRequest>,
  event: Omit<NetEvent, "at" | "shiftId">,
) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  save(
    {
      ...state,
      requests: {
        ...state.requests,
        [id]: { ...cur, ...patch, updatedAt: Date.now() },
      },
    },
    { ...event, shiftId: id },
  );
}

/** Generic patch — actor inferred from current session role. */
export function updateRequest(id: string, patch: Partial<NetRequest>) {
  applyPatch(id, patch, {
    actor: actorOf(),
    actorId: getSessionId(),
    action: "update",
  });
}

export function acceptRequest(id: string): boolean {
  refreshState();
  const cur = state.requests[id];
  const sid = getSessionId();
  if (!cur || cur.status !== "broadcasting" || cur.acceptedBy) return false;
  save(
    {
      ...state,
      requests: {
        ...state.requests,
        [id]: { ...cur, status: "accepted", acceptedBy: sid, updatedAt: Date.now() },
      },
    },
    { actor: "doctor", actorId: sid, action: "accept", shiftId: id },
  );
  return true;
}

export function cancelRequest(id: string) {
  applyPatch(
    id,
    { status: "cancelled" },
    { actor: actorOf(), actorId: getSessionId(), action: "cancel" },
  );
}

export function startRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  save(
    {
      ...state,
      requests: {
        ...state.requests,
        [id]: { ...cur, status: "active", startedAt: Date.now(), updatedAt: Date.now() },
      },
    },
    { actor: "requester", actorId: getSessionId(), action: "start", shiftId: id },
  );
}

export function completeRequest(id: string) {
  applyPatch(
    id,
    { status: "completed" },
    { actor: "requester", actorId: getSessionId(), action: "complete" },
  );
}

/** Pause broadcasting (hides from doctors) without losing request. */
export function pauseRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur || cur.status !== "broadcasting") return;
  applyPatch(
    id,
    { status: "paused" },
    { actor: "requester", actorId: getSessionId(), action: "pause" },
  );
}

/** Resume a paused request back to broadcasting. */
export function resumeRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur || cur.status !== "paused") return;
  applyPatch(
    id,
    { status: "broadcasting" },
    { actor: "requester", actorId: getSessionId(), action: "resume" },
  );
}

/** Hard-remove a request (use for pre-acceptance cancellation). */
export function removeRequest(id: string) {
  refreshState();
  if (!state.requests[id]) return;
  const { [id]: _gone, ...rest } = state.requests;
  save(
    { ...state, requests: rest },
    { actor: "requester", actorId: getSessionId(), action: "remove", shiftId: id },
  );
}

/* ---------------- selectors ---------------- */

export function onlineDoctors(s: NetState): DoctorPresence[] {
  return Object.values(s.doctors).filter((d) => d.online);
}

export function broadcastingRequests(s: NetState): NetRequest[] {
  const now = Date.now();
  return Object.values(s.requests)
    .filter((r) => r.status === "broadcasting" && now - r.createdAt <= BROADCAST_TTL_MS)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getNetworkSnapshot(): NetState {
  return refreshState();
}
