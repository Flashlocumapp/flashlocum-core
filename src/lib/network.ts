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
import { simNow } from "./clock";
import {
  billableMinutes,
  computeWorkedPricing,
  coverageKindFromLabel,
} from "./pricing";
import {
  getCurrentUserIdSync,
  notifyCoverageChanged,
  onUserIdChange,
  primeUserId,
  remoteClaimRequest,
  remoteDeleteRequest,
  remoteInsertRequest,
  remoteUpdateRequest,
  subscribeCoverageRemote,
  type RemoteEvent,
} from "./coverage-remote";
import {
  clearMyPresence,
  heartbeatPresence,
  subscribePresence,
  upsertMyPresence,
  type PresenceRow,
} from "./presence-remote";

/**
 * Fire backend-authoritative shift lifecycle RPC. Errors are surfaced to the
 * console only — the optimistic local network state already gives UI feedback,
 * and the backend remains the source of truth for billing on settlement read.
 */
function callServerLifecycle(kind: "start" | "pause" | "resume" | "end", requestId: string) {
  if (typeof window === "undefined") return Promise.resolve();
  return import("./shift.functions")
    .then((m) => {
      const fn =
        kind === "start" ? m.startShift
        : kind === "pause" ? m.pauseShift
        : kind === "resume" ? m.resumeShift
        : m.endShift;
      return fn({ data: { requestId } });
    })
    .then(() => {
      // coverage_requests is excluded from supabase_realtime; without this
      // explicit invalidate broadcast the OTHER party (e.g. the doctor when
      // the requester starts the shift) never sees started_at / status flip
      // and their LiveTimer never starts ticking.
      notifyCoverageChanged(requestId);
    })
    .catch((err) => {
      console.warn(`[network] ${kind}Shift RPC failed:`, err?.message ?? err);
    });
}




function actorOf(): Actor {
  if (typeof window === "undefined") return "system";
  const role = getRole();
  if (!role) return "system";
  return role === "cover" ? "doctor" : "requester";
}

const SCHEMA_VERSION = 3;
const CHANNEL = "flashlocum.net.v3";
const STORAGE = "flashlocum.net.v3";
const LEGACY_STORAGE = "flashlocum.net.v2";
const SESSION_KEY = "flashlocum.session";
// Presence heartbeat cadence. 25s keeps doctors comfortably within the 2-min
// STALE_MS window (presence-remote) while cutting write load ~6x vs the old
// 4s cadence — critical at 500+ concurrent doctors.
const HEARTBEAT_MS = 25000;
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
  /**
   * Accumulated worked milliseconds carried across pause/resume cycles.
   * Total worked time of a shift is:
   *   accumulatedMs + (status==='active' ? simNow() - startedAt : 0)
   * Preserved through Pause → Upcoming → Resume → Active so multi-day or
   * interrupted shifts bill on ONE continuous operational timer.
   */
  accumulatedMs?: number;
  // Absolute timestamps for the scheduled coverage window — single source
  // of truth for conflict detection across all coverage types.
  startTs?: number;
  endTs?: number;
  // Who triggered the cancellation (for history labelling).
  cancelledBy?: "requester" | "doctor";
  // Total operational days scheduled (informational only — End Shift may be
  // tapped at any time; lifecycle is driven by start/pause/resume/end).
  days?: number;
  dayIndex?: number;
  /** Final billed amount captured at completeRequest time (worked-time based). */
  settledAmount?: number;
  /** Requester→FlashLocum payment state ('pending' | 'paid'). */
  paymentStatus?: string;
  paymentReference?: string;
  /** Timestamp (ms) when requester payment cleared. */
  paidAt?: number;
  /** Timestamp (ms) when FlashLocum remitted the payout to the doctor. */
  remittedAt?: number;
  /** Environment toggle at booking time; multiplies pricing ×1.25 when 'busy'. */
  environment?: "normal" | "busy";
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

/**
 * Session identifier used for ownership comparisons throughout the app.
 * Prefers the authenticated Supabase user id when available so requester
 * and doctor sides see the same id across tabs/devices. Falls back to a
 * per-tab sessionStorage id (only used pre-auth or during SSR).
 */
export function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const authId = getCurrentUserIdSync();
  if (authId) return authId;
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

/* ---------------- storage + channel ----------------
 * Requests live in Supabase (coverage_requests) — see coverage-remote.ts.
 * localStorage / BroadcastChannel still back doctor PRESENCE (online flag,
 * declined list, map position) which is intentionally per-tab / per-device.
 */

let channel: BroadcastChannel | null = null;
let state: NetState = emptyState();
const listeners = new Set<(s: NetState) => void>();
let remoteUnsubscribe: (() => void) | null = null;
let presenceUnsubscribe: (() => void) | null = null;


function load(): NetState {
  // Doctor presence is sourced from Supabase Realtime (doctor_presence
  // table) — we no longer rehydrate it from localStorage so the backend is
  // the single source of truth. Requests are likewise remote-backed.
  if (typeof window === "undefined") return emptyState();
  try {
    window.localStorage.removeItem(LEGACY_STORAGE);
    window.localStorage.removeItem(STORAGE);
  } catch {
    /* noop */
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    doctors: state.doctors ?? {},
    requests: state.requests ?? {},
    lastEvent: state.lastEvent,
  };
}

function refreshState(): NetState {
  state = load();
  return state;
}

function save(next: NetState, event?: Omit<NetEvent, "at">) {
  const { lastEvent: _previousEvent, ...withoutEvent } = next;
  const stamped: NetState = event
    ? { ...withoutEvent, schemaVersion: SCHEMA_VERSION, lastEvent: { ...event, at: simNow() } }
    : { ...withoutEvent, schemaVersion: SCHEMA_VERSION };
  state = stamped;
  if (typeof window === "undefined") return;
  listeners.forEach((l) => l(state));
  channel?.postMessage({ type: "state", state: stamped });
}



function applyRemoteEvent(ev: RemoteEvent) {
  const requests = { ...state.requests };
  let netEvent: Omit<NetEvent, "at"> | undefined;
  if (ev.type === "INSERT") {
    requests[ev.row.id] = ev.row;
    if (ev.row.status === "broadcasting") {
      netEvent = {
        actor: "requester",
        actorId: ev.row.requesterSessionId,
        shiftId: ev.row.id,
        action: "publish",
      };
    }
  } else if (ev.type === "UPDATE") {
    requests[ev.row.id] = ev.row;
    const oldStatus = ev.old?.status;
    const newStatus = ev.row.status;
    let action: NetActionType | null = null;
    let actor: Actor = "requester";
    let actorId: string = ev.row.requesterSessionId;
    if (oldStatus === "broadcasting" && newStatus === "accepted") {
      action = "accept";
      actor = "doctor";
      actorId = ev.row.acceptedBy ?? actorId;
    } else if (oldStatus === "accepted" && newStatus === "active") {
      action = (ev.old?.accumulatedMs ?? 0) > 0 ? "resume" : "start";
    } else if (oldStatus === "active" && newStatus === "accepted") {
      action = "pause";
    } else if (newStatus === "completed" && oldStatus !== "completed") {
      action = "complete";
    } else if (newStatus === "cancelled" && oldStatus !== "cancelled") {
      action = "cancel";
      if (ev.row.cancelledBy === "doctor") {
        actor = "doctor";
        actorId = ev.row.acceptedBy ?? actorId;
      }
    } else if (oldStatus === "broadcasting" && newStatus === "paused") {
      action = "pause";
    } else if (oldStatus === "paused" && newStatus === "broadcasting") {
      action = "resume";
    } else if (oldStatus === newStatus) {
      action = "update";
    }
    if (action) netEvent = { actor, actorId, shiftId: ev.row.id, action };
  } else if (ev.type === "DELETE") {
    delete requests[ev.id];
    netEvent = {
      actor: "requester",
      actorId: getSessionId(),
      shiftId: ev.id,
      action: "remove",
    };
  }
  save({ ...state, requests }, netEvent);
}

function init() {
  if (typeof window === "undefined") return;
  if (channel) return;
  // Resolve auth user id ASAP so getSessionId() returns it for ownership checks.
  primeUserId();
  state = load();
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (message) => {
      const incoming = message.data?.state as NetState | undefined;
      if (incoming?.schemaVersion === SCHEMA_VERSION) {
        // Keep request state local-only; presence is sourced from backend.
        state = { ...incoming, requests: state.requests, doctors: state.doctors };
        listeners.forEach((l) => l(state));
      }
    };
  } catch {
    /* noop */
  }


  // Subscribe to Supabase coverage_requests realtime.
  //
  // onSnapshot diffs the new snapshot against the in-memory requests and
  // synthesizes a NetEvent for any status transition the postgres_changes
  // path missed (RLS-filtered, dropped subscription, race with the
  // invalidate-broadcast refresh, etc.). This is what drives doctor-side
  // pendingRating on `complete` and the incoming card on `publish`. If
  // postgres_changes already fired, applyRemoteEvent has already updated
  // state.requests, so the diff is a no-op and nothing double-fires.
  let firstSnapshot = true;
  remoteUnsubscribe = subscribeCoverageRemote({
    onSnapshot: (rows) => {
      const requests: Record<string, NetRequest> = {};
      for (const r of rows) requests[r.id] = r;
      const prev = state.requests;
      const isFirst = firstSnapshot;
      firstSnapshot = false;
      let netEvent: Omit<NetEvent, "at"> | undefined;
      for (const r of rows) {
        const old = prev[r.id];
        if (!old) {
          // Suppress synthesized publish events on the initial snapshot —
          // they represent pre-existing rows the doctor is just now
          // discovering, NOT a brand-new request made for them.
          if (!isFirst && r.status === "broadcasting") {
            netEvent = {
              actor: "requester",
              actorId: r.requesterSessionId,
              shiftId: r.id,
              action: "publish",
            };
          }
          continue;
        }
        if (old.status === r.status) continue;
        if (r.status === "completed") {
          netEvent = {
            actor: "requester",
            actorId: r.requesterSessionId,
            shiftId: r.id,
            action: "complete",
          };
        } else if (r.status === "cancelled") {
          netEvent = {
            actor: r.cancelledBy === "doctor" ? "doctor" : "requester",
            actorId:
              r.cancelledBy === "doctor"
                ? (r.acceptedBy ?? r.requesterSessionId)
                : r.requesterSessionId,
            shiftId: r.id,
            action: "cancel",
          };
        } else if (old.status === "broadcasting" && r.status === "accepted") {
          netEvent = {
            actor: "doctor",
            actorId: r.acceptedBy ?? "",
            shiftId: r.id,
            action: "accept",
          };
        } else if (old.status === "accepted" && r.status === "active") {
          netEvent = {
            actor: "requester",
            actorId: r.requesterSessionId,
            shiftId: r.id,
            action: (old.accumulatedMs ?? 0) > 0 ? "resume" : "start",
          };
        } else if (old.status === "active" && r.status === "accepted") {
          netEvent = {
            actor: "requester",
            actorId: r.requesterSessionId,
            shiftId: r.id,
            action: "pause",
          };
        }
      }
      state = { ...state, requests };
      if (netEvent) {
        save(state, netEvent);
      } else {
        listeners.forEach((l) => l(state));
      }
    },
    onEvent: applyRemoteEvent,
  });

  // Subscribe to backend doctor presence realtime — true shared state.
  presenceUnsubscribe = subscribePresence((rows) => {
    state = { ...state, doctors: mergePresenceRows(rows) };
    listeners.forEach((l) => l(state));
  });

  // Re-emit listeners when auth resolves (so derived selectors pick up id).
  onUserIdChange(() => {
    listeners.forEach((l) => l(state));
  });
}

function mergePresenceRows(rows: PresenceRow[]): Record<string, DoctorPresence> {
  const out: Record<string, DoctorPresence> = {};
  for (const r of rows) {
    const prev = state.doctors[r.user_id];
    out[r.user_id] = {
      sessionId: r.user_id,
      online: r.online,
      acceptedCount: prev?.acceptedCount ?? 0,
      top: r.top,
      left: r.left,
      lastSeen: new Date(r.last_seen).getTime(),
      declined: prev?.declined ?? [],
    };
  }
  return out;
}


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
  const desiredOnline = current ? current.online : initialOnline;
  const next: NetState = {
    ...state,
    doctors: {
      ...state.doctors,
      [sid]: {
        sessionId: sid,
        online: desiredOnline,
        acceptedCount: current?.acceptedCount ?? 0,
        top: pos.top,
        left: pos.left,
        lastSeen: simNow(),
        declined: current?.declined ?? [],
      },
    },
  };
  save(next);
  // Backend write only when registering online. App boot calls this with
  // initialOnline=false; writing that immediately would incorrectly clear an
  // already-online doctor before the backend presence snapshot hydrates.
  if (desiredOnline) void upsertMyPresence({ online: desiredOnline, top: pos.top, left: pos.left });
}

export function unregisterDoctor() {
  refreshState();
  const sid = getSessionId();
  // Mark offline in backend (don't delete — keeps stable position).
  void clearMyPresence();
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
    doctors: { ...state.doctors, [sid]: { ...d, lastSeen: simNow() } },
  });
  // Backend heartbeat keeps last_seen fresh and re-asserts online flag.
  void heartbeatPresence(d.online);
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
      [sid]: { ...d, online, lastSeen: simNow() },
    },
  });
  // Backend write — true shared operational state.
  void upsertMyPresence({ online, top: d.top, left: d.left });
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
      [sid]: { ...d, acceptedCount: n, lastSeen: simNow() },
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

/* ---------------- requests (backend-backed) ----------------
 *
 * All request lifecycle is persisted in Supabase (coverage_requests).
 * Each mutation applies an optimistic local update and fires a
 * background write. The realtime subscription reconciles any drift.
 */

function newRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch { /* noop */ }
  // RFC4122-ish fallback
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function publishRequest(
  req: Omit<NetRequest, "id" | "requesterSessionId" | "status" | "createdAt" | "updatedAt">,
): NetRequest {
  refreshState();
  const sid = getSessionId();
  const now = simNow();
  const id = newRequestId();
  const full: NetRequest = {
    ...req,
    id,
    requesterSessionId: sid,
    status: "broadcasting",
    createdAt: now,
    updatedAt: now,
  };
  // Optimistic local update
  save(
    { ...state, requests: { ...state.requests, [id]: full } },
    { actor: "requester", actorId: sid, shiftId: id, action: "publish" },
  );
  // Backend write
  void remoteInsertRequest(full);
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
  const next = { ...cur, ...patch, updatedAt: simNow() };
  save(
    { ...state, requests: { ...state.requests, [id]: next } },
    { ...event, shiftId: id },
  );
  void remoteUpdateRequest(id, patch);
}

function applyLocalPatch(
  id: string,
  patch: Partial<NetRequest>,
  event: Omit<NetEvent, "at" | "shiftId">,
) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: simNow() };
  save(
    { ...state, requests: { ...state.requests, [id]: next } },
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

function confirmedForDoctor(s: NetState, doctorId: string): NetRequest[] {
  return Object.values(s.requests).filter(
    (r) => r.acceptedBy === doctorId && (r.status === "accepted" || r.status === "active"),
  );
}

function conflictReason(mine: NetRequest[], incoming: NetRequest): "overlap" | "buffer" | null {
  if (!incoming.startTs || !incoming.endTs) return null;
  for (const m of mine) {
    if (!m.startTs || !m.endTs) continue;
    if (incoming.startTs < m.endTs && m.startTs < incoming.endTs) return "overlap";
    if (incoming.startTs < m.endTs + BUFFER_MS && m.startTs < incoming.endTs + BUFFER_MS) return "buffer";
  }
  return null;
}

/**
 * Accept a broadcasting request. Local pre-checks run first; the backend
 * UPDATE-with-WHERE is the authoritative claim — it only succeeds if the
 * row is still searching and unclaimed (race-safe).
 *
 * Returns synchronously based on local state. Backend reconciliation may
 * flip a local "ok" to a no-op when another doctor wins; the realtime
 * subscription will then refresh state.
 */
export function acceptRequest(id: string): AcceptRequestResult {
  refreshState();
  const cur = state.requests[id];
  const sid = getSessionId();
  if (!cur || cur.status !== "broadcasting") return { ok: false, reason: "unavailable" };
  if (cur.acceptedBy) return { ok: false, reason: "claimed" };
  const mine = confirmedForDoctor(state, sid);
  if (mine.length >= MAX_CONFIRMED_SHIFTS) return { ok: false, reason: "max" };
  const conflict = conflictReason(mine, cur);
  if (conflict) return { ok: false, reason: conflict };
  // Optimistic local
  save(
    {
      ...state,
      requests: {
        ...state.requests,
        [id]: { ...cur, status: "accepted", acceptedBy: sid, updatedAt: simNow() },
      },
    },
    { actor: "doctor", actorId: sid, action: "accept", shiftId: id },
  );
  // Backend atomic claim
  void remoteClaimRequest(id, sid).then((won) => {
    if (!won) {
      // Roll back local optimistic accept — another doctor won.
      const now = state.requests[id];
      if (now && now.acceptedBy === sid && now.status === "accepted") {
        save({
          ...state,
          requests: {
            ...state.requests,
            [id]: { ...now, status: "broadcasting", acceptedBy: undefined, updatedAt: simNow() },
          },
        });
      }
    }
  });
  return { ok: true };
}

export function cancelRequest(id: string) {
  const actor = actorOf();
  applyPatch(
    id,
    { status: "cancelled", cancelledBy: actor === "doctor" ? "doctor" : "requester" },
    { actor, actorId: getSessionId(), action: "cancel" },
  );
}

export function startRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  // Multi-day shifts reset accumulatedMs to 0 on pause so each new day's
  // timer starts at zero. Use dayIndex > 1 as the secondary signal so the
  // doctor still receives a "resume" cue (not "start") on Day 2+.
  const isResume = (cur.accumulatedMs ?? 0) > 0 || (cur.dayIndex ?? 1) > 1;
  // Anchor startedAt to simNow() so a brand-new shift always renders
  // segment = simNow() - startedAt = 0, regardless of any prior simulation
  // fast-forward offset. LiveTimer uses simNow() on both sides, so the
  // computed elapsed remains in sync across requester/doctor.
  const patch: Partial<NetRequest> = {
    status: "active",
    startedAt: simNow(),
    accumulatedMs: cur.accumulatedMs ?? 0,
  };
  applyPatch(id, patch, {
    actor: "requester",
    actorId: getSessionId(),
    action: isResume ? "resume" : "start",
  });
  callServerLifecycle(isResume ? "resume" : "start", id);
}

export function pauseShift(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur || cur.status !== "active") return;
  const days = Math.max(1, cur.days ?? 1);
  const dayIndex = Math.min(days, Math.max(1, cur.dayIndex ?? 1) + 1);
  // The completed day has been billed + paid by the time pauseShift runs
  // (webhook → confirmPaymentNow → onConfirmed → here). Reset the per-day
  // timer so the next working day resumes from 0 for both the requester
  // and the doctor; advance dayIndex to the next scheduled day.
  applyLocalPatch(id, { status: "accepted", startedAt: undefined, accumulatedMs: 0, dayIndex }, {
    actor: "requester",
    actorId: getSessionId(),
    action: "pause",
  });
  void callServerLifecycle("pause", id).then(() => {
    notifyCoverageChanged(id);
  });
}



export function completeRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  const segment =
    cur.status === "active" && cur.startedAt
      ? Math.max(0, simNow() - cur.startedAt)
      : 0;
  const accumulatedMs = (cur.accumulatedMs ?? 0) + segment;
  const toHHMM = (raw: string | undefined, fallback: string): string => {
    const m = (raw ?? "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (!m) return fallback;
    let h = parseInt(m[1], 10);
    const ap = m[3]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${m[2]}`;
  };
  const startHHMM = toHHMM(cur.start, "08:00");
  const endHHMM = toHHMM(cur.end, "18:00");
  const billedMin = billableMinutes(accumulatedMs / 60000);
  const settledAmount = computeWorkedPricing(
    coverageKindFromLabel(cur.coverage),
    startHHMM,
    billedMin,
    endHHMM,
    Math.max(1, cur.days ?? 1),
    cur.environment ?? "normal",
  ).amount;
  applyLocalPatch(id, { status: "completed", accumulatedMs, startedAt: undefined, settledAmount }, {
    actor: "requester",
    actorId: getSessionId(),
    action: "complete",
  });
  void callServerLifecycle("end", id).then(() => {
    notifyCoverageChanged(id);
  });
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
  void remoteDeleteRequest(id);
}

/* ---------------- selectors ---------------- */

export function onlineDoctors(s: NetState): DoctorPresence[] {
  return Object.values(s.doctors).filter((d) => d.online);
}

export function broadcastingRequests(s: NetState): NetRequest[] {
  const now = simNow();
  return Object.values(s.requests)
    .filter(
      (r) =>
        r.status === "broadcasting" &&
        // Hide stale rows that were never accepted/cancelled: a broadcasting
        // row older than BROADCAST_TTL_MS is treated as expired and never
        // surfaces to doctors as an incoming card.
        now - r.createdAt < BROADCAST_TTL_MS &&
        // Also hide rows whose scheduled window has already passed.
        (!r.endTs || r.endTs > now),
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function getNetworkSnapshot(): NetState {
  return refreshState();
}
