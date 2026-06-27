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
import { fromRealtime, ingest } from "@/lib/feedback";
import {
  bookedMinutesFromWindow,
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
  remoteExpireRequest,
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
import { supabase } from "@/integrations/supabase/client";

/**
 * Fire backend-authoritative shift lifecycle RPC. Returns the server payload
 * so callers can anchor local state (e.g. `started_at`) on server values
 * instead of optimistically guessing from simNow(). UI must NOT mutate
 * lifecycle state until this promise resolves successfully.
 */
type LifecycleResult =
  | { ok: true; startedAtMs?: number | null; totalBilledAmount?: number; paymentDueAt?: string; already?: boolean; dayIndex?: number }
  | { ok: false; error: string; finalDay?: boolean };

async function callServerLifecycle(
  kind: "start" | "pause" | "resume" | "end",
  requestId: string,
): Promise<LifecycleResult> {
  if (typeof window === "undefined") return { ok: true };
  try {
    if (kind === "start") {
      const m = await import("./coverage-notify.functions");
      const res = await m.startAndNotifyFn({ data: { requestId } });
      notifyCoverageChanged(requestId);
      return { ok: true, startedAtMs: res?.startedAtMs ?? null, already: !!res?.alreadyStarted };
    }
    const m = await import("./shift.functions");
    if (kind === "pause") {
      const res: any = await m.pauseShift({ data: { requestId } });
      if (res && res.ok === false && res.finalDay) {
        return { ok: false, error: "Final day - use End Shift to complete this booking", finalDay: true };
      }
      notifyCoverageChanged(requestId);
      return { ok: true, dayIndex: typeof res?.day_index === "number" ? res.day_index : undefined };
    }
    if (kind === "resume") {
      const res: any = await m.resumeShift({ data: { requestId } });
      notifyCoverageChanged(requestId);
      return { ok: true, startedAtMs: res?.startedAtMs ?? null, already: !!res?.alreadyActive };
    }
    // end
    const res: any = await m.endShift({ data: { requestId } });
    notifyCoverageChanged(requestId);
    return {
      ok: true,
      totalBilledAmount: typeof res?.total_billed_amount === "number" ? res.total_billed_amount : undefined,
      paymentDueAt: res?.payment_due_at,
      already: !!res?.already,
    };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    console.warn(`[network] ${kind}Shift RPC failed:`, msg);
    return { ok: false, error: msg };
  }
}

/* ---------------- lifecycle pending tracker (per-tab, in-memory) ---------------- */

export type LifecyclePendingKind = "starting" | "pausing" | "resuming" | "ending";
const lifecycleInFlight = new Map<string, LifecyclePendingKind>();
const lifecycleListeners = new Set<() => void>();
function setLifecyclePending(id: string, kind: LifecyclePendingKind | null) {
  if (kind) lifecycleInFlight.set(id, kind);
  else lifecycleInFlight.delete(id);
  lifecycleListeners.forEach((fn) => fn());
}
export function getLifecyclePending(id: string): LifecyclePendingKind | null {
  return lifecycleInFlight.get(id) ?? null;
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
// Pre-acceptance broadcast lifetime. After this window the request transitions
// to a persistent 'expired' state (server cron + client RPC). Doctor feeds use
// broadcast_started_at, not createdAt, so edit re-publish and dismiss-resume
// restart the window.
const BROADCAST_TTL_MS = 180 * 1000;

const MAX_CONFIRMED_SHIFTS = 3;
const BUFFER_MS = 60 * 60 * 1000;

export type DoctorPresence = {
  sessionId: string;
  online: boolean;
  acceptedCount: number;
  // Stable, slightly randomized map position per session (legacy fallback
  // for the stylized map). The live Google map uses lat/lng instead.
  top: number; // 0..1
  left: number; // 0..1
  // Real GPS coords — written event-driven from the doctor app. May be null
  // when the doctor has denied geolocation permission; in that case the
  // map omits the marker rather than synthesizing a fake position.
  lat: number | null;
  lng: number | null;
  lastSeen: number;
  declined: string[]; // request ids this session declined
};

export type NetRequestStatus =
  | "broadcasting"
  | "paused"
  | "accepted"
  | "active"
  | "awaiting_payment"
  | "completed"
  | "cancelled"
  | "expired";


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
  /** Server-frozen sum of `shift_segments.billed_amount` written by end_shift /
   *  pause_shift. Authoritative pending bill before payment lands; never the
   *  booked estimate. */
  totalBilledAmount?: number;
  /** Requester→FlashLocum payment state ('pending' | 'paid'). */
  paymentStatus?: string;
  paymentReference?: string;
  /** Server-owned absolute deadline for the 15-minute settlement window
   *  (ISO timestamp). Set by end_shift; the settlement UI derives the
   *  countdown from this so it survives refresh / reconnect / reopen. */
  paymentDueAt?: string;
  /** Timestamp (ms) when requester payment cleared. */
  paidAt?: number;
  /** Timestamp (ms) when FlashLocum remitted the payout to the doctor. */
  remittedAt?: number;
  /** Environment toggle at booking time; multiplies pricing ×1.25 when 'busy'. */
  environment?: "normal" | "busy";
  /** Monotonic offer revision. Bumped server-side whenever the requester edits
   *  material fields while the row is pre-acceptance, or resumes after a
   *  dismiss (paused → searching). Doctor decline keys are scoped to
   *  `${id}:${rev}` so a new offer reaches doctors who previously declined.
   */
  rev?: number;
  /** When this offer was last broadcast (publish, edit re-publish, or
   *  dismiss-resume). Drives the 180s pre-acceptance expiry timer and the
   *  doctor open-pool freshness gate.
   */
  broadcastStartedAt?: number;
  /** True once the shift has ever been activated (server-owned, monotonic).
   *  Drives Start-Shift-vs-Resume-Shift label deterministically — never
   *  cleared by pause/resume. Sourced from `coverage_requests.first_started_at`.
   */
  everStarted?: boolean;
  /** First time this shift ever transitioned into Active (ms epoch). Sourced
   *  from `coverage_requests.first_started_at`. Monotonic — survives pauses. */
  firstStartedAt?: number;
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


const REQUESTS_LS_KEY = "fl:requests-snapshot:v1";
const REQUESTS_LS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REQUESTS_LS_MAX = 80;

function readRequestsSnapshot(): Record<string, NetRequest> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REQUESTS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      v?: number;
      ts?: number;
      requests?: Record<string, NetRequest>;
    };
    if (!parsed || parsed.v !== SCHEMA_VERSION) return {};
    if (typeof parsed.ts === "number" && Date.now() - parsed.ts > REQUESTS_LS_TTL_MS) return {};
    return parsed.requests ?? {};
  } catch {
    return {};
  }
}

let persistRequestsScheduled = false;
function scheduleRequestsPersist() {
  if (persistRequestsScheduled || typeof window === "undefined") return;
  persistRequestsScheduled = true;
  setTimeout(() => {
    persistRequestsScheduled = false;
    try {
      // Cap at most-recently-updated REQUESTS_LS_MAX rows to bound storage.
      const entries = Object.entries(state.requests ?? {});
      entries.sort((a, b) => (b[1]?.updatedAt ?? 0) - (a[1]?.updatedAt ?? 0));
      const trimmed: Record<string, NetRequest> = {};
      for (const [id, row] of entries.slice(0, REQUESTS_LS_MAX)) trimmed[id] = row;
      window.localStorage.setItem(
        REQUESTS_LS_KEY,
        JSON.stringify({ v: SCHEMA_VERSION, ts: Date.now(), requests: trimmed }),
      );
    } catch {
      /* quota / privacy mode — ignore */
    }
  }, 400);
}

function load(): NetState {
  // Doctor presence is sourced from Supabase Realtime (doctor_presence
  // table); requests are remote-backed. We keep a small localStorage
  // snapshot of requests so cold starts paint the last-seen rows
  // immediately instead of flashing an empty/skeleton state; realtime
  // snapshots overwrite per-row within a few hundred ms of connecting.
  if (typeof window === "undefined") return emptyState();
  try {
    window.localStorage.removeItem(LEGACY_STORAGE);
    window.localStorage.removeItem(STORAGE);
  } catch {
    /* noop */
  }
  const persistedRequests = readRequestsSnapshot();
  return {
    schemaVersion: SCHEMA_VERSION,
    doctors: state.doctors ?? {},
    requests: Object.keys(state.requests ?? {}).length > 0
      ? state.requests
      : persistedRequests,
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
  scheduleRequestsPersist();
}





/**
 * Requester-side acceptance cue: emit canonical `offer.accepted` when the
 * owned coverage_requests row transitions from no-doctor to accepted. This
 * is what plays `confirm.wav` + the actor-named toast on the requester in
 * the browser (the native shell already gets it from the foreground push).
 * The feedback engine's 6 s dedup window collapses it with the push echo.
 */
function maybeEmitRequesterAccepted(
  prev: NetRequest | undefined,
  next: NetRequest,
) {
  if (next.acceptedBy == null) return;
  if (prev?.acceptedBy != null) return; // already accepted earlier
  const uid = getCurrentUserIdSync();
  if (!uid || next.requesterSessionId !== uid) return;
  ingest(
    fromRealtime({
      kind: "offer.accepted",
      entityId: next.id,
      audience: "requester",
      updatedAt: next.updatedAt || Date.now(),
      ctx: {
        hospitalName: next.hospital || undefined,
      },
    }),
  );
}

function applyRemoteEvent(ev: RemoteEvent) {
  const requests = { ...state.requests };
  let netEvent: Omit<NetEvent, "at"> | undefined;
  if (ev.type === "INSERT") {
    requests[ev.row.id] = ev.row;
    maybeEmitRequesterAccepted(undefined, ev.row);
    if (ev.row.status === "broadcasting") {
      netEvent = {
        actor: "requester",
        actorId: ev.row.requesterSessionId,
        shiftId: ev.row.id,
        action: "publish",
      };
    }
  } else if (ev.type === "UPDATE") {
    maybeEmitRequesterAccepted(ev.old ?? state.requests[ev.row.id], ev.row);
    requests[ev.row.id] = ev.row;
    const oldStatus = ev.old?.status;
    const newStatus = ev.row.status;
    let action: NetActionType | null = null;
    let actor: Actor = "requester";
    let actorId: string = ev.row.requesterSessionId;
    // Audit-10 ordering: terminal/settlement transitions are evaluated FIRST,
    // so a status-change UPDATE never falls through to the generic "update"
    // branch and misfires a "shift.updated" toast on the doctor.
    if (
      (newStatus === "completed" || newStatus === "awaiting_payment") &&
      oldStatus !== "completed" &&
      oldStatus !== "awaiting_payment"
    ) {
      // End-shift moment: requester clicked End Shift. Payment may still be
      // processing (awaiting_payment); doctor should immediately see
      // "Your shift has ended. Payment processing has started."
      action = "complete";
    } else if (newStatus === "cancelled" && oldStatus !== "cancelled") {
      action = "cancel";
      if (ev.row.cancelledBy === "doctor") {
        actor = "doctor";
        actorId = ev.row.acceptedBy ?? actorId;
      }
    } else if (oldStatus === "broadcasting" && newStatus === "accepted") {
      action = "accept";
      actor = "doctor";
      actorId = ev.row.acceptedBy ?? actorId;
    } else if (oldStatus === "accepted" && newStatus === "active") {
      action = (ev.old?.accumulatedMs ?? 0) > 0 ? "resume" : "start";
    } else if (oldStatus === "active" && newStatus === "accepted") {
      action = "pause";
    } else if (oldStatus === "active" && newStatus === "paused") {
      action = "pause";
    } else if (oldStatus === "paused" && newStatus === "active") {
      action = "resume";
    } else if (oldStatus === "broadcasting" && newStatus === "paused") {
      action = "pause";
    } else if (oldStatus === "paused" && newStatus === "broadcasting") {
      action = "resume";
    } else if (oldStatus === newStatus) {
      // Same-status row update. Only surface as a lifecycle "update" event
      // when the row is in a state where an update is meaningful to the
      // doctor — never on awaiting_payment / completed / cancelled, which
      // would misfire "Hospital X updated your shift" after End Shift.
      if (
        newStatus === "broadcasting" ||
        newStatus === "accepted" ||
        newStatus === "active" ||
        newStatus === "paused"
      ) {
        action = "update";
      }
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
        // Requester-side acceptance cue — fires whether discovered via
        // realtime UPDATE or this snapshot reconcile. G3/G4 dedup in the
        // feedback engine guarantees a single playback.
        if (!isFirst) maybeEmitRequesterAccepted(old, r);
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
        if (r.status === "completed" || r.status === "awaiting_payment") {
          // Treat both webhook-driven completion AND requester-initiated
          // end-shift (which lands in awaiting_payment first) as the
          // "shift ended" moment for the doctor.
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
        } else if (old.status === "active" && (r.status === "accepted" || r.status === "paused")) {
          netEvent = {
            actor: "requester",
            actorId: r.requesterSessionId,
            shiftId: r.id,
            action: "pause",
          };
        } else if (old.status === "paused" && r.status === "active") {
          netEvent = {
            actor: "requester",
            actorId: r.requesterSessionId,
            shiftId: r.id,
            action: "resume",
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

// Presence snapshots are server-authoritative and now include offline rows
// explicitly (see `buildSnapshot` in presence-remote.ts). The merge is a
// straight projection — no "preserve missing entry" fallback, since that
// would mask the online→offline transition and keep doctors appearing
// online for minutes after they toggle off.
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
      lat: r.lat ?? null,
      lng: r.lng ?? null,
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

/** Subscribe to per-id lifecycle pending state (Start/Pause/End RPC in flight). */
export function useLifecyclePending(id: string | null | undefined): LifecyclePendingKind | null {
  const [v, setV] = useState<LifecyclePendingKind | null>(() => (id ? lifecycleInFlight.get(id) ?? null : null));
  useEffect(() => {
    if (!id) { setV(null); return; }
    const fn = () => setV(lifecycleInFlight.get(id) ?? null);
    lifecycleListeners.add(fn);
    fn();
    return () => { lifecycleListeners.delete(fn); };
  }, [id]);
  return v;
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
        lat: current?.lat ?? null,
        lng: current?.lng ?? null,
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

/**
 * Mark an incoming request as declined for THIS doctor session. The key is
 * `${id}:${rev}` so that when the requester edits or re-broadcasts (rev is
 * bumped server-side by the bump_request_rev trigger), the previously-stored
 * decline no longer matches and the card re-enters Incoming. A bare `${id}`
 * value is treated as rev=1 for backward compatibility with prior builds.
 */
export function markDeclined(requestId: string, rev?: number) {
  refreshState();
  const sid = getSessionId();
  const d = state.doctors[sid];
  if (!d) return;
  const cur = state.requests[requestId];
  const r = rev ?? cur?.rev ?? 1;
  const key = `${requestId}:${r}`;
  if (d.declined.includes(key)) return;
  save({
    ...state,
    doctors: {
      ...state.doctors,
      [sid]: { ...d, declined: [...d.declined, key] },
    },
  });
}

/** Returns true if this session has declined the given (id, rev) pair.
 *  Legacy decline entries stored as the bare id are treated as rev=1. */
export function isDeclined(d: { declined?: string[] } | undefined, id: string, rev?: number): boolean {
  if (!d) return false;
  const list = d.declined ?? [];
  const r = rev ?? 1;
  const key = `${id}:${r}`;
  if (list.includes(key)) return true;
  if (r === 1 && list.includes(id)) return true;
  return false;
}



/** Best-effort offline write on tab close. Uses fetch keepalive + the
 *  current Supabase session bearer so the row flips to online=false even
 *  when the page is being unloaded (a normal async call wouldn't complete
 *  in time). Falls back to a regular `clearMyPresence()` write. */
async function beaconOffline() {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!url || !apikey || !uid || !session?.access_token) return;
    await fetch(`${url}/rest/v1/doctor_presence?user_id=eq.${uid}`, {
      method: "PATCH",
      keepalive: true,
      headers: {
        apikey,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ online: false, last_seen: new Date().toISOString() }),
    });
  } catch {
    // Swallow — best-effort.
  }
}

export function startHeartbeat() {
  if (typeof window === "undefined") return () => {};
  // Self-scheduling timer with ±20% jitter so N online doctors don't all
  // POST their heartbeat on the same wall-clock tick (thundering herd at
  // scale). Online/offline state changes still propagate instantly through
  // the explicit heartbeat() call on toggle — only the periodic refresh
  // cadence is jittered.
  let t: ReturnType<typeof setTimeout> | null = null;
  const scheduleNext = () => {
    const jitter = (Math.random() - 0.5) * 0.4; // ±20%
    const delay = Math.max(5000, Math.round(HEARTBEAT_MS * (1 + jitter)));
    t = setTimeout(() => {
      heartbeat();
      scheduleNext();
    }, delay);
  };
  scheduleNext();

  const visibility = () => {
    if (document.visibilityState === "visible") heartbeat();
  };
  const onPageHide = () => {
    unregisterDoctor();
    void beaconOffline();
  };
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("beforeunload", onPageHide);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    if (t) clearTimeout(t);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("beforeunload", onPageHide);
    window.removeEventListener("pagehide", onPageHide);
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
 * Server-authoritative: no optimistic local write. The row only flips to
 * `accepted` in local state when the realtime/snapshot ingester sees the
 * server-confirmed change. On a losing race the caller surfaces the failure
 * reason; local feed state is never mutated here.
 */
const claimInFlight = new Map<string, number>();
const CLAIM_INFLIGHT_TTL_MS = 8000;
export async function acceptRequest(id: string): Promise<AcceptRequestResult> {
  refreshState();
  const cur = state.requests[id];
  const sid = getSessionId();
  if (!cur || cur.status !== "broadcasting") return { ok: false, reason: "unavailable" };
  if (cur.acceptedBy) return { ok: false, reason: "claimed" };
  const mine = confirmedForDoctor(state, sid);
  if (mine.length >= MAX_CONFIRMED_SHIFTS) return { ok: false, reason: "max" };
  const conflict = conflictReason(mine, cur);
  if (conflict) return { ok: false, reason: conflict };
  // UX guard: prevent double-tap on the same card from issuing parallel
  // claims. This is purely an in-flight de-duplication; it never enters
  // `state.requests`, so the server stays the only source of truth.
  const now = Date.now();
  const prev = claimInFlight.get(id);
  if (prev && now - prev < CLAIM_INFLIGHT_TTL_MS) {
    return { ok: false, reason: "claimed" };
  }
  claimInFlight.set(id, now);
  try {
    const won = await remoteClaimRequest(id, sid);
    if (!won) return { ok: false, reason: "claimed" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    claimInFlight.delete(id);
  }
}

export function cancelRequest(
  id: string,
  reason?: { code: string; text?: string },
) {
  // Server-authoritative cancel. coverage-remote.ts routes the cancel
  // through `cancelAndNotifyFn`, which authorizes the actor, validates the
  // reason, and updates the row server-side. The realtime ingester then
  // flips local state to `cancelled` and synthesises the `cancel` event.
  const patch: Partial<NetRequest> & { __cancelReason?: { code: string; text?: string } } = {
    status: "cancelled",
    cancelledBy: actorOf() === "doctor" ? "doctor" : "requester",
  };
  if (reason) patch.__cancelReason = reason;
  void remoteUpdateRequest(id, patch);
}

/**
 * Server-confirmed start/resume. NO optimistic local writes: the UI is only
 * mutated after the RPC succeeds, and `startedAt` is anchored on the
 * server-returned epoch ms (NOT simNow()) so requester and doctor see the
 * same baseline. Multi-tap is blocked via `lifecycleInFlight`.
 */
export async function startRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return { ok: false, error: "Shift not found" };
  if (lifecycleInFlight.has(id)) return { ok: false, error: "Already in progress" };
  // everStarted is the authoritative "has this shift ever been activated?" flag.
  // Fall back to legacy signals (accumulatedMs / dayIndex) only when the server
  // snapshot has not yet been seen by this client.
  const isResume =
    !!cur.everStarted || (cur.accumulatedMs ?? 0) > 0 || (cur.dayIndex ?? 1) > 1;
  setLifecyclePending(id, isResume ? "resuming" : "starting");
  try {
    const res = await callServerLifecycle(isResume ? "resume" : "start", id);
    if (!res.ok) {
      const { pushToast } = await import("./notifications");
      pushToast({ tone: "warn", title: res.error || "Couldn't start this shift" });
      return { ok: false, error: res.error };
    }
    const startedAtMs =
      typeof res.startedAtMs === "number" && Number.isFinite(res.startedAtMs)
        ? res.startedAtMs
        : simNow(); // fallback only if the server omitted it
    applyPatch(
      id,
      {
        status: "active",
        startedAt: startedAtMs,
        accumulatedMs: cur.accumulatedMs ?? 0,
        // Monotonic once true — the server has now persisted first_started_at.
        everStarted: true,
      },
      { actor: "requester", actorId: getSessionId(), action: isResume ? "resume" : "start" },
    );
    return { ok: true };
  } finally {
    setLifecyclePending(id, null);
  }
}

/** Server-confirmed pause. The server is the source of truth for accumulated_ms
 *  (the pause_shift RPC folds the open segment into the column atomically); we
 *  only mirror the visible status + a best-effort accumulator for instant UI
 *  feedback. The next snapshot overwrites with the authoritative value. */
export async function pauseShift(id: string): Promise<{ ok: boolean; error?: string }> {
  refreshState();
  const cur = state.requests[id];
  if (!cur || cur.status !== "active") return { ok: false, error: "Shift not active" };
  if (lifecycleInFlight.has(id)) return { ok: false, error: "Already in progress" };
  setLifecyclePending(id, "pausing");
  try {
    const res = await callServerLifecycle("pause", id);
    if (!res.ok) {
      const { pushToast } = await import("./notifications");
      pushToast({
        tone: "warn",
        title: res.finalDay
          ? "Final day — use End Shift to complete this booking"
          : res.error || "Couldn't pause this shift",
      });
      return { ok: false, error: res.error };
    }
    const segment = cur.startedAt != null ? Math.max(0, simNow() - cur.startedAt) : 0;
    const accumulatedMs = (cur.accumulatedMs ?? 0) + segment;
    const nextDayIndex = res.dayIndex ?? (cur.dayIndex ?? 1) + 1;
    applyLocalPatch(
      id,
      { status: "paused", startedAt: undefined, accumulatedMs, everStarted: true, dayIndex: nextDayIndex },
      { actor: "requester", actorId: getSessionId(), action: "pause" },
    );
    return { ok: true };
  } finally {
    setLifecyclePending(id, null);
  }
}

/** Server-confirmed end. No optimistic write — webhook flips to completed. */
export async function completeRequest(id: string): Promise<{ ok: boolean; error?: string }> {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return { ok: false, error: "Shift not found" };
  if (lifecycleInFlight.has(id)) return { ok: false, error: "Already in progress" };
  setLifecyclePending(id, "ending");
  try {
    const res = await callServerLifecycle("end", id);
    if (!res.ok) {
      const { pushToast } = await import("./notifications");
      pushToast({ tone: "warn", title: res.error || "Couldn't end this shift" });
      return { ok: false, error: res.error };
    }
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
    // Prefer the server-returned total; fall back to local pricing only if
    // the RPC didn't include it (e.g. idempotent already-ended branch).
    const settledAmount =
      typeof res.totalBilledAmount === "number"
        ? res.totalBilledAmount
        : computeWorkedPricing(
            coverageKindFromLabel(cur.coverage),
            startHHMM,
            accumulatedMs / 60000,
            endHHMM,
            Math.max(1, cur.days ?? 1),
            cur.environment ?? "normal",
            bookedMinutesFromWindow(startHHMM, endHHMM),
          ).amount;
    // Status flips to 'awaiting_payment' (server already did this). Webhook
    // moves it to 'completed' once paid — do NOT write 'completed' locally.
    applyLocalPatch(
      id,
      { status: "awaiting_payment", accumulatedMs, startedAt: undefined, settledAmount },
      { actor: "requester", actorId: getSessionId(), action: "complete" },
    );
    return { ok: true };
  } finally {
    setLifecyclePending(id, null);
  }
}


/** Pause broadcasting (hides from doctors) without losing request.
 *  Pre-acceptance only — refuses to act on shifts already accepted by a
 *  doctor or already started. Post-acceptance pause is owned by the
 *  `pause_shift` RPC via `pauseShift()` below.
 */
export function pauseRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  // Pre-acceptance only — once a doctor has accepted or the shift has
  // started, the post-acceptance pause RPC owns lifecycle.
  if (cur.acceptedBy) return;
  if (cur.status === "paused") return; // no-op
  // No `status === "broadcasting"` guard: stale local mirrors during the
  // edit flow (e.g. a realtime echo briefly flipping us back) must not
  // swallow the pause. The server enforces the real precondition via RLS.

  applyPatch(
    id,
    { status: "paused" },
    { actor: "requester", actorId: getSessionId(), action: "pause" },
  );
}

/**
 * Resume a paused request back to broadcasting. Treated as a fresh offer:
 * we optimistically restart broadcastStartedAt and bump rev so the 180s
 * expiry timer resets immediately and previously-declined doctors see the
 * card again. Pre-acceptance only.
 *
 * IMPORTANT: this function is called from the requester's republish path
 * (configure → match → dispatch after "Edit Request"). It MUST bump
 * deterministically, not just when local state happens to read "paused".
 * The previous `status === "broadcasting" → return` short-circuit was the
 * second-edit bug: if a stale realtime echo had already flipped the local
 * mirror back to "broadcasting" before the user finished editing, the
 * resume was swallowed, no rev/broadcast_started_at bump happened, the
 * server-side `bump_request_rev_on_change` trigger only fires for paused→
 * searching transitions, and the doctor never saw the updated card.
 *
 * NOTE: prior guards on `startedAt != null` / `accumulatedMs > 0` were
 * removed — those fields persist across edit-sheet open/close cycles via
 * realtime echoes from `bump_request_rev_on_change` and silently blocked
 * the second resume, which is what made Edit Request stop hiding the
 * doctor card after its first use.
 */
export function resumeRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  if (cur.acceptedBy) return; // accepted shifts use resume_shift RPC
  // Strict paused→broadcasting transition. The previous "always bump"
  // version combined with effects that depend on the whole `net` object
  // created an infinite rev-bump feedback loop (each bump produced a
  // realtime echo → state change → effect re-runs → another bump). The
  // server trigger `bump_request_rev_on_change` reliably bumps rev and
  // broadcast_started_at on this status flip, and the publish/sync effect
  // ensures the row is paused before resume is ever called.
  if (cur.status !== "paused") return;
  applyPatch(
    id,
    {
      status: "broadcasting",
      broadcastStartedAt: simNow(),
      rev: (cur.rev ?? 1) + 1,
    },
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

/**
 * Pre-acceptance expiry — 180s broadcast window elapsed with no doctor
 * acceptance. The row is preserved server-side as `expired` (admin analytics
 * only); locally we drop it so the requester overlay and doctor feeds clear.
 */
export function expireRequest(id: string) {
  refreshState();
  const cur = state.requests[id];
  if (!cur) return;
  if (cur.status !== "broadcasting" && cur.status !== "paused") return;
  if (cur.acceptedBy) return;
  const { [id]: _gone, ...rest } = state.requests;
  save(
    { ...state, requests: rest },
    { actor: "system", actorId: "system", action: "remove", shiftId: id },
  );
  void remoteExpireRequest(id);
}

/* ---------------- selectors ---------------- */

export function onlineDoctors(s: NetState): DoctorPresence[] {
  return Object.values(s.doctors).filter((d) => d.online);
}

export function broadcastingRequests(s: NetState): NetRequest[] {
  // Freshness gate uses broadcastStartedAt, NOT createdAt — edit re-publish
  // and dismiss-resume (paused → searching) restart the 180s window
  // server-side via the bump_request_rev trigger. Falls back to createdAt
  // for any legacy row without a broadcast_started_at column populated.
  //
  // FIFO sort (oldest first) so every online doctor sees the same "next"
  // request as the queue head. Matches list_open_coverage_requests ASC.
  const now = Date.now();
  return Object.values(s.requests)
    .filter(
      (r) =>
        r.status === "broadcasting" &&
        now - (r.broadcastStartedAt ?? r.createdAt) < BROADCAST_TTL_MS,
    )
    .sort((a, b) => (a.broadcastStartedAt ?? a.createdAt) - (b.broadcastStartedAt ?? b.createdAt));
}



export function getNetworkSnapshot(): NetState {
  return refreshState();
}
