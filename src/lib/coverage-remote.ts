// Supabase-backed coverage requests store.
//
// Owns:
//   - row <-> NetRequest mapping
//   - initial fetch + Realtime subscription
//   - INSERT / UPDATE / DELETE helpers
//
// Doctor presence (online flag, declined list, map position) stays local
// in network.ts. Only the request lifecycle is backend-driven.

import { supabase } from "@/integrations/supabase/client";
import { ensureAuthReady, subscribeAuthState } from "@/lib/auth-ready";
import { getCachedProfileUserId } from "@/lib/profile-remote";
import type { NetRequest, NetRequestStatus } from "./network";
import { setChannelHealth } from "./realtime-health";


type Row = {
  id: string;
  requester_id: string;
  hospital: string;
  area: string;
  coverage_type: string;
  day: string;
  start_time: string;
  end_time: string;
  start_ts: number | null;
  end_ts: number | null;
  duration_hrs: number;
  amount: number;
  fee_pct: number;
  phone: string;
  note: string | null;
  accommodation: string | null;
  status: "searching" | "accepted" | "active" | "paused" | "awaiting_payment" | "completed" | "cancelled" | "expired";
  accepted_by: string | null;
  started_at: number | null;
  accumulated_ms: number;
  settled_amount: number | null;
  total_billed_amount: number | null;
  days: number;
  day_index: number;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
  payment_status: string | null;
  payment_reference: string | null;
  payment_due_at: string | null;
  paid_at: string | null;
  remitted_at: string | null;
  environment: string;
  rev: number;
  broadcast_started_at: string;
  expired_at: string | null;
  first_started_at: string | null;
};




const TABLE = "coverage_requests";
// v2: cache is scoped to the doctor's OWN rows only. The open SEARCHING
// pool is intentionally never persisted — it must always come from a live
// server fetch so Incoming Coverage cannot resurrect stale broadcasts on
// login / refresh / reconnect / reopen.
const LS_KEY = "fl:coverage-cache:v2";
const LEGACY_LS_KEYS = ["fl:coverage-cache:v1"];

type PersistedCoverage = { uid: string; rows: NetRequest[]; savedAt: number };

function activeCacheUserId(): string | null {
  return cachedUserId ?? getCachedProfileUserId();
}

/**
 * A row qualifies for the persisted snapshot only if it belongs to the
 * doctor directly (their own request, or one they accepted). Open-pool
 * rows from `list_open_coverage_requests` are EXCLUDED — they must always
 * be re-fetched live so a cancelled / accepted / completed broadcast can
 * never reappear after a reload.
 */
function isOwnRow(r: NetRequest, uid: string): boolean {
  return r.requesterSessionId === uid || r.acceptedBy === uid;
}

function readPersistedSnapshot(): NetRequest[] {
  if (typeof window === "undefined") return [];
  const uid = activeCacheUserId();
  if (!uid) return [];
  try {
    // Drop any pre-existing v1 cache from older builds — it may contain
    // open-pool rows that would otherwise be replayed as Incoming.
    for (const k of LEGACY_LS_KEYS) window.localStorage.removeItem(k);
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw) as PersistedCoverage;
    if (!payload || payload.uid !== uid || !Array.isArray(payload.rows)) return [];
    // Belt-and-braces filter: even if a regression writes pool rows into
    // the cache, the read path strips anything not owned by this user.
    return payload.rows.filter((r) => isOwnRow(r, uid));
  } catch {
    return [];
  }
}

function writePersistedSnapshot(rows: NetRequest[]) {
  if (typeof window === "undefined") return;
  const uid = activeCacheUserId();
  if (!uid) return;
  try {
    const ownOnly = rows.filter((r) => isOwnRow(r, uid));
    const payload: PersistedCoverage = { uid, rows: ownOnly, savedAt: Date.now() };
    window.localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

function clearPersistedSnapshot() {
  if (typeof window === "undefined") return;
  cachedSnapshot = [];
  cachedSnapshotUserId = null;
  setLiveSnapshotSeen(false);
  try {
    window.localStorage.removeItem(LS_KEY);
    for (const k of LEGACY_LS_KEYS) window.localStorage.removeItem(k);
  } catch {
    /* ignore storage errors */
  }
  snapshotListeners.forEach((fn) => fn(cachedSnapshot));
}

/**
 * Set to true ONLY after a live server snapshot has been received in the
 * current session. Consumers (e.g. Incoming Coverage) gate UI on this so
 * cached rows can never be presented as authoritative server state.
 *
 * Reset on: sign-out, auth user change, and any realtime-channel drop.
 */
let liveSnapshotSeen = false;
const liveSnapshotListeners = new Set<() => void>();

export function hasLiveSnapshot(): boolean {
  return liveSnapshotSeen;
}

export function onLiveSnapshotChange(fn: () => void): () => void {
  liveSnapshotListeners.add(fn);
  return () => liveSnapshotListeners.delete(fn);
}

function setLiveSnapshotSeen(v: boolean) {
  if (liveSnapshotSeen === v) return;
  liveSnapshotSeen = v;
  liveSnapshotListeners.forEach((fn) => fn());
}

const dbStatusToNet: Record<Row["status"], NetRequestStatus> = {
  searching: "broadcasting",
  accepted: "accepted",
  active: "active",
  paused: "paused",
  awaiting_payment: "awaiting_payment",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",

};
const netStatusToDb: Record<NetRequestStatus, Row["status"]> = {
  broadcasting: "searching",
  accepted: "accepted",
  active: "active",
  paused: "paused",
  awaiting_payment: "awaiting_payment",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",
};


export function rowToNet(r: Row): NetRequest {
  return {
    id: r.id,
    requesterSessionId: r.requester_id,
    hospital: r.hospital,
    area: r.area,
    coverage: r.coverage_type,
    day: r.day,
    start: r.start_time,
    end: r.end_time,
    durationHrs: Number(r.duration_hrs ?? 0),
    amount: r.amount,
    feePct: r.fee_pct,
    phone: r.phone ?? "",
    note: r.note ?? undefined,
    status: dbStatusToNet[r.status],
    acceptedBy: r.accepted_by ?? undefined,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: new Date(r.updated_at).getTime(),
    startedAt: r.started_at ?? undefined,
    accumulatedMs: r.accumulated_ms ?? 0,
    startTs: r.start_ts ?? undefined,
    endTs: r.end_ts ?? undefined,
    cancelledBy: (r.cancelled_by as "requester" | "doctor" | undefined) ?? undefined,
    days: r.days,
    dayIndex: r.day_index,
    settledAmount: r.settled_amount ?? undefined,
    totalBilledAmount: r.total_billed_amount ?? undefined,
    paymentStatus: r.payment_status ?? undefined,
    paymentReference: r.payment_reference ?? undefined,
    paymentDueAt: r.payment_due_at ?? undefined,
    paidAt: r.paid_at ? new Date(r.paid_at).getTime() : undefined,
    remittedAt: r.remitted_at ? new Date(r.remitted_at).getTime() : undefined,
    environment: r.environment === "busy" ? "busy" : "normal",
    rev: r.rev ?? 1,
    broadcastStartedAt: r.broadcast_started_at
      ? new Date(r.broadcast_started_at).getTime()
      : new Date(r.created_at).getTime(),
    everStarted: !!r.first_started_at,
    firstStartedAt: r.first_started_at ? Date.parse(r.first_started_at) : undefined,
  };
}


function netPatchToRow(p: Partial<NetRequest>): Partial<Row> {
  const out: Partial<Row> = {};
  if (p.hospital !== undefined) out.hospital = p.hospital;
  if (p.area !== undefined) out.area = p.area;
  if (p.coverage !== undefined) out.coverage_type = p.coverage;
  if (p.day !== undefined) out.day = p.day;
  if (p.start !== undefined) out.start_time = p.start;
  if (p.end !== undefined) out.end_time = p.end;
  if (p.durationHrs !== undefined) out.duration_hrs = p.durationHrs;
  if (p.amount !== undefined) out.amount = p.amount;
  if (p.feePct !== undefined) out.fee_pct = p.feePct;
  if (p.phone !== undefined) out.phone = p.phone;
  if (p.note !== undefined) out.note = p.note ?? null;
  if (p.status !== undefined) out.status = netStatusToDb[p.status];
  if (p.acceptedBy !== undefined) out.accepted_by = p.acceptedBy ?? null;
  if (p.startedAt !== undefined) out.started_at = p.startedAt ?? null;
  if (p.accumulatedMs !== undefined) out.accumulated_ms = p.accumulatedMs;
  if (p.startTs !== undefined) out.start_ts = p.startTs ?? null;
  if (p.endTs !== undefined) out.end_ts = p.endTs ?? null;
  if (p.cancelledBy !== undefined) out.cancelled_by = p.cancelledBy ?? null;
  if (p.days !== undefined) out.days = p.days;
  if (p.dayIndex !== undefined) out.day_index = p.dayIndex;
  if (p.settledAmount !== undefined) out.settled_amount = p.settledAmount ?? null;
  if (p.environment !== undefined) out.environment = p.environment;
  // Republish-only: when resumeRequest fires (paused → broadcasting OR a
  // forced re-broadcast over an already-broadcasting row), we send fresh
  // values for broadcast_started_at and rev. Mapping them here makes the
  // server-side `coverage_requests_emit_invalidate` trigger fan out the
  // invalidate even when the status transition itself is a no-op (e.g.
  // pause hadn't committed yet when the requester tapped Find Doctor),
  // and advances the doctor-side `(id, rev)` decline key so previously
  // declined doctors see the offer again. The trigger
  // `bump_request_rev_on_change` still owns paused→searching transitions
  // and will override NEW.rev/NEW.broadcast_started_at to authoritative
  // server values when that transition happens; passing them here is a
  // safety net for the no-transition case, not a replacement.
  if (p.broadcastStartedAt !== undefined) {
    out.broadcast_started_at = new Date(p.broadcastStartedAt).toISOString();
  }
  if (p.rev !== undefined) out.rev = p.rev;
  return out;
}

let cachedUserId: string | null = null;
let userIdResolved = false;
const userListeners = new Set<(id: string | null) => void>();

export function getCurrentUserIdSync(): string | null {
  return cachedUserId;
}

export async function primeUserId(): Promise<string | null> {
  if (userIdResolved) return cachedUserId;
  try {
    const auth = await ensureAuthReady();
    cachedUserId = auth.userId;
  } catch {
    cachedUserId = null;
  }
  userIdResolved = true;
  userListeners.forEach((fn) => fn(cachedUserId));
  return cachedUserId;
}

export function onUserIdChange(fn: (id: string | null) => void): () => void {
  userListeners.add(fn);
  if (userIdResolved) fn(cachedUserId);
  return () => userListeners.delete(fn);
}

// Keep the cached id in sync with auth events (sign-in, sign-out, refresh).
// Only notify listeners on actual identity transitions — TOKEN_REFRESHED,
// INITIAL_SESSION, and tab focus re-fire auth events with the same uid; a
// blanket notify would blank the coverage cache (History tab flashes empty
// for ~1s until refreshSnapshot repopulates).
if (typeof window !== "undefined") {
  subscribeAuthState(({ event, userId }) => {
    if (event === "SIGNED_OUT") clearPersistedSnapshot();
    const changed = cachedUserId !== userId;
    cachedUserId = userId;
    userIdResolved = true;
    if (changed) userListeners.forEach((fn) => fn(cachedUserId));
  });
}

/* ---------------- Fetch + Realtime ---------------- */

export type RemoteEvent =
  | { type: "INSERT"; row: NetRequest }
  | { type: "UPDATE"; row: NetRequest; old: NetRequest | null }
  | { type: "DELETE"; id: string };

type SubscribeOpts = {
  onSnapshot: (rows: NetRequest[]) => void;
  onEvent: (event: RemoteEvent) => void;
};

let activeSubscribers = 0;
let channel: ReturnType<typeof supabase.channel> | null = null;
let channelUserId: string | null = null;
let invalidationChannel: ReturnType<typeof supabase.channel> | null = null;
const eventListeners = new Set<(e: RemoteEvent) => void>();
const snapshotListeners = new Set<(rows: NetRequest[]) => void>();
const initialPersistedSnapshot = readPersistedSnapshot();
let cachedSnapshot: NetRequest[] = initialPersistedSnapshot;
let cachedSnapshotUserId: string | null =
  initialPersistedSnapshot.length > 0 ? activeCacheUserId() : null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// Hash of the last fan-out. The reconcile interval re-fetches the snapshot
// every 60s; without this guard, an identical roster still emits a new
// array identity to every useNetwork() consumer, contributing to the
// global periodic re-render blink the user reports.
let lastCoverageSnapshotHash: string | null = null;
function hashCoverageSnapshot(rows: NetRequest[]): string {
  let h = "";
  for (const r of rows) {
    // Include rev + broadcastStartedAt so rev-only bumps (Save during Edit,
    // material-field updates while paused) still propagate to subscribers.
    // Include acceptedBy so accepted-by handoffs fan out to subscribers even
    // if a future trigger regression leaves `updated_at` unchanged.
    h += `${r.id}:${r.updatedAt ?? ""}:${r.status ?? ""}:${r.rev ?? ""}:${r.broadcastStartedAt ?? ""}:${r.acceptedBy ?? ""}|`;
  }
  return h;
}


// --- Stage 0 safety net: reconciliation timer + channel watchdog ---------
//
// `lastRealtimeEventAt` tracks the last time we received ANY realtime signal
// (postgres_changes, invalidate broadcast, or a SUBSCRIBED callback). If we
// have been silent for longer than `RECONCILE_AFTER_SILENCE_MS` while the
// tab is visible, the reconciliation interval forces a snapshot refresh.
// This eliminates the "silent stale UI" failure mode where a websocket
// quietly dies without firing CHANNEL_ERROR.

let lastRealtimeEventAt = Date.now();


function markRealtimeActivity() {
  lastRealtimeEventAt = Date.now();
}

const RECONCILE_INTERVAL_MS = 60_000;
const RECONCILE_AFTER_SILENCE_MS = 45_000;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

function startReconcileTimer() {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (Date.now() - lastRealtimeEventAt < RECONCILE_AFTER_SILENCE_MS) return;
    void refreshSnapshot();
  }, RECONCILE_INTERVAL_MS);
}
function stopReconcileTimer() {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
}

// Exponential-backoff watchdogs per channel. When subscribe reports a
// non-OK status, we tear the channel down and schedule a re-create with
// capped backoff (1s → 30s).
type WatchdogKey = "coverage" | "invalidations" | "presence";
const backoffMs: Record<WatchdogKey, number> = {
  coverage: 500,
  invalidations: 500,
  presence: 500,
};
const backoffTimers: Partial<Record<WatchdogKey, ReturnType<typeof setTimeout>>> = {};
// Cap: 5s. With ±30% jitter, 700 doctors reconnecting simultaneously after a
// Realtime restart spread their retries across a ~3.5–6.5s window instead of
// stampeding on the same tick.
const MAX_BACKOFF_MS = 5_000;

function resetBackoff(k: WatchdogKey) {
  backoffMs[k] = 500;
  const t = backoffTimers[k];
  if (t) {
    clearTimeout(t);
    backoffTimers[k] = undefined;
  }
}

function scheduleReconnect(k: WatchdogKey, run: () => void) {
  if (backoffTimers[k]) return;
  const base = backoffMs[k];
  // ±30% jitter prevents reconnect-storm alignment after a Realtime restart.
  const jitter = (Math.random() - 0.5) * 0.6;
  const delay = Math.max(250, Math.round(base * (1 + jitter)));
  backoffMs[k] = Math.min(MAX_BACKOFF_MS, base * 2);
  setChannelHealth(k, "reconnecting");
  backoffTimers[k] = setTimeout(() => {
    backoffTimers[k] = undefined;
    try {
      run();
    } catch (e) {
      console.warn(`[coverage-remote] reconnect ${k} failed:`, (e as Error).message);
    }
  }, delay);
}

// Local fan-out for `coverage_invalidations` broadcasts. Lets feature code
// (e.g. ShiftSettlement) react to invalidation pings WITHOUT opening a
// duplicate Realtime channel with the same topic name — duplicates were
// tearing down the shared subscription on cleanup and surfacing as a
// phantom "Reconnecting…" pill after payment.
type InvalidationPingListener = (id: string | null) => void;
const invalidationPingListeners = new Set<InvalidationPingListener>();
export function subscribeInvalidationPing(cb: InvalidationPingListener): () => void {
  invalidationPingListeners.add(cb);
  return () => {
    invalidationPingListeners.delete(cb);
  };
}


// Hard cap on the snapshot. Coverage UI only renders the user's own requests,
// shifts they have accepted, and the currently-searching pool — at realistic
// scale this is well under 500. The LIMIT bounds worst-case payload + parse
// cost if the searching pool ever spikes (load shedding > crashing the tab).
const SNAPSHOT_LIMIT = 500;

// Last successful pool fetch, kept so a transient `list_open_coverage_requests`
// error doesn't blank Incoming Coverage for ~15s until the next poll. Rows
// here are still subject to the doctor-side `broadcastingRequests` freshness
// filter (180s TTL) so a stale row cannot resurrect indefinitely.
let lastPoolRows: Row[] = [];

// -- Open-coverage list read-coalescer (1.5s) -----------------------------
//
// Coalesces simultaneous duplicate fetches of `list_open_coverage_requests`
// into a single round trip. CONTRACT (do not weaken):
//   - This cache ONLY guards the open-pool RPC. Own-row reads, presence,
//     postgres_changes, payment updates, and shift lifecycle use separate
//     paths and are never delayed.
//   - Every Realtime listener that ingests an open-list change MUST call
//     `bustOpenListCache()` BEFORE triggering its refetch. The next fetch
//     then bypasses the cache and reads fresh DB truth.
//   - The 1.5s window therefore only collapses *simultaneous duplicates*
//     (two components mounting at once, tab-focus + reconcile timer firing
//     on the same instant). Those produce identical results; collapsing
//     them is invisible to the user.
const OPEN_LIST_TTL_MS = 1500;
type PoolFetchResult = { data: Row[] | null; error: { message: string } | null };
let openListInFlight: Promise<PoolFetchResult> | null = null;
let openListCachedAt = 0;
let openListCached: PoolFetchResult | null = null;

export function bustOpenListCache(): void {
  openListInFlight = null;
  openListCached = null;
  openListCachedAt = 0;
}

function fetchOpenListCoalesced(): Promise<PoolFetchResult> {
  const now = Date.now();
  if (openListInFlight) return openListInFlight;
  if (openListCached && now - openListCachedAt < OPEN_LIST_TTL_MS) {
    return Promise.resolve(openListCached);
  }
  openListInFlight = (async () => {
    const res = await supabase.rpc("list_open_coverage_requests");
    const out: PoolFetchResult = {
      data: (res.data as Row[] | null) ?? null,
      error: res.error ? { message: res.error.message } : null,
    };
    openListCached = out;
    openListCachedAt = Date.now();
    return out;
  })().finally(() => {
    openListInFlight = null;
  });
  return openListInFlight;
}



async function fetchAll(userId: string): Promise<NetRequest[] | null> {
  // Doctors can only directly read coverage_requests rows they accepted
  // (`accepted_by = auth.uid()`); the SELECT policy intentionally hides
  // sensitive columns of the open `searching` pool. The pool is fetched
  // separately via a SECURITY DEFINER RPC that strips phone, payment, note,
  // accommodation, and billing fields so doctors only see what they need to
  // claim a job.
  const ownFilter = `requester_id.eq.${userId},accepted_by.eq.${userId}`;
  const [ownRes, poolRes] = await Promise.all([
    supabase
      .from(TABLE)
      .select("*")
      .or(ownFilter)
      .order("created_at", { ascending: true })
      .limit(SNAPSHOT_LIMIT),
    fetchOpenListCoalesced(),
  ]);
  if (ownRes.error) {
    console.warn("[coverage-remote] fetch error:", ownRes.error.message);
    return null;
  }
  let poolRows: Row[];
  if (poolRes.error) {
    // Non-fatal: own rows still render and the previous pool snapshot is
    // reused so a single transient RPC failure doesn't flicker Incoming
    // Coverage off-screen between polls.
    console.warn("[coverage-remote] pool fetch error:", poolRes.error.message);
    poolRows = lastPoolRows;
  } else {
    poolRows = (poolRes.data ?? []) as Row[];
    lastPoolRows = poolRows;
  }
  const merged = new Map<string, Row>();
  for (const r of (ownRes.data ?? []) as Row[]) merged.set(r.id, r);
  for (const r of poolRows) {
    if (!merged.has(r.id)) merged.set(r.id, r);
  }
  // Phone is column-restricted in RLS: only the requester or the accepted
  // doctor can read it, via a SECURITY DEFINER RPC.
  const phoneMap = new Map<string, string>();
  const { data: phones, error: phoneErr } = await supabase.rpc("list_my_request_phones");
  if (!phoneErr && Array.isArray(phones)) {
    for (const p of phones as Array<{ id: string; phone: string | null }>) {
      if (p?.id) phoneMap.set(p.id, p.phone ?? "");
    }
  }
  return Array.from(merged.values()).map((row) =>
    rowToNet({ ...row, phone: phoneMap.get(row.id) ?? row.phone ?? "" }),
  );
}


// In-flight dedup for refreshSnapshot. Realtime bursts + manual refresh
// calls can overlap; we coalesce concurrent callers onto a single fetch
// and queue at most one follow-up so the latest state always wins.
let refreshInFlight: Promise<void> | null = null;
let refreshPending = false;

async function refreshSnapshot(): Promise<void> {
  if (refreshInFlight) {
    refreshPending = true;
    return refreshInFlight;
  }
  refreshInFlight = (async () => {
    const auth = await ensureAuthReady();
    if (!auth.userId) return;
    const rows = await fetchAll(auth.userId);
    if (!rows) return;
    cachedSnapshot = rows;
    cachedSnapshotUserId = activeCacheUserId();
    writePersistedSnapshot(cachedSnapshot);
    // Mark that the current session has received an authoritative server
    // snapshot. Incoming Coverage gates on this so cached rows can never
    // be presented as live broadcasts.
    setLiveSnapshotSeen(true);
    markRealtimeActivity();
    // Skip the fanout when the reconcile produced an identical roster.
    // Emitting a new array identity every 60s would re-render every
    // useNetwork() consumer and contribute to the global blink.
    const nextHash = hashCoverageSnapshot(cachedSnapshot);
    if (nextHash !== lastCoverageSnapshotHash) {
      lastCoverageSnapshotHash = nextHash;
      snapshotListeners.forEach((fn) => fn(cachedSnapshot));
    }

  })().finally(() => {
    refreshInFlight = null;
    if (refreshPending) {
      refreshPending = false;
      void refreshSnapshot();
    }
  });
  return refreshInFlight;
}

/**
 * Debounced refresh — coalesces invalidation bursts into one re-fetch.
 */
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshSnapshot();
  }, 80);
}

/**
 * Authoritative single-row re-read. Triggered by the `coverage_invalidations`
 * broadcast with a row id — fetches just that row, applies it to the local
 * cache, and notifies subscribers. If the row has left this user's RLS scope
 * (accepted by someone else, expired out of the open pool, deleted), the
 * fetch returns no row and we DROP it from the cache. This is the queue
 * advancement path: accept / cancel / pause / edit / expire / delete all
 * route through here, so every doctor's `.find()` advances within ~1s
 * without waiting on a full snapshot refresh.
 */
async function fetchAndIngestRow(id: string): Promise<void> {
  // CONTRACT (see fetchOpenListCoalesced): bust the open-list cache before
  // any event-driven re-read so Realtime invalidations never serve stale
  // pool data. The 1.5s coalesce window is for *simultaneous duplicates*
  // only — never for propagating database truth.
  bustOpenListCache();
  // First try a direct read — works for own/accepted rows under RLS.
  let row: Row | null = null;
  let directOk = true;
  let poolOk = true;

  const direct = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
  if (direct.error) {
    directOk = false;
  } else if (direct.data) {
    row = direct.data as Row;
  }
  if (!row) {
    // Row may belong to the open searching pool (RLS hides it from a
    // direct select for non-accepting doctors). Look it up via the RPC.
    const pool = await fetchOpenListCoalesced();
    if (pool.error) {
      poolOk = false;
    } else if (Array.isArray(pool.data)) {
      const found = (pool.data as Row[]).find((r) => r.id === id);
      if (found) row = found;
    }
  }

  const strip = (r: Row) => ({ ...r, phone: "" });
  if (row) {
    const net = rowToNet(strip(row));
    const idx = cachedSnapshot.findIndex((r) => r.id === net.id);
    if (idx === -1) cachedSnapshot = [...cachedSnapshot, net];
    else {
      const next = cachedSnapshot.slice();
      next[idx] = net;
      cachedSnapshot = next;
    }
    writePersistedSnapshot(cachedSnapshot);
    eventListeners.forEach((fn) =>
      fn({ type: idx === -1 ? "INSERT" : "UPDATE", row: net, old: null } as RemoteEvent),
    );
    snapshotListeners.forEach((fn) => fn(cachedSnapshot));
  } else {
    // Row not returned by either read path. We DROP it from the cache only
    // when:
    //   (1) both reads completed successfully (absence is authoritative), AND
    //   (2) the cached row is non-terminal (still in-flight / claimable).
    // Terminal rows (completed/cancelled) are historical and must never be
    // evicted by a transient RLS hiccup, a stray DELETE invalidation, or a
    // network blip — that was the root cause of History Coverage briefly
    // emptying and then re-populating on the next snapshot refresh.
    if (!directOk || !poolOk) return;
    const existing = cachedSnapshot.find((r) => r.id === id);
    if (!existing) return;
    if (existing.status === "completed" || existing.status === "cancelled") return;
    cachedSnapshot = cachedSnapshot.filter((r) => r.id !== id);
    writePersistedSnapshot(cachedSnapshot);
    eventListeners.forEach((fn) => fn({ type: "DELETE", id }));
    snapshotListeners.forEach((fn) => fn(cachedSnapshot));
  }
}

/**
 * Broadcast a coverage_requests change to every subscribed client.
 *
 * Why: Supabase postgres_changes events are filtered by RLS against the NEW
 * row. When a doctor accepts (status: searching → accepted) the row exits
 * other doctors' RLS scope, so they receive NO update event and their local
 * cache stays stuck on "broadcasting". A broadcast channel is not RLS-gated,
 * so we use it as an out-of-band signal: every client refreshes the snapshot
 * and the row simply drops out of its fetch result.
 */
function emitInvalidate(id: string) {
  if (!invalidationChannel) return;
  void invalidationChannel.send({
    type: "broadcast",
    event: "invalidate",
    payload: { id, at: Date.now() },
  });
}

/**
 * Public helper — call after a server RPC (start/pause/resume/end) mutates
 * a coverage_requests row so other clients (e.g. the doctor watching the
 * requester's shift start) refresh their snapshot. coverage_requests is
 * not in the supabase_realtime publication, so postgres_changes won't fire
 * for these mutations and the invalidate broadcast is the only signal.
 */
export function notifyCoverageChanged(id: string) {
  emitInvalidate(id);
}

/**
 * Universal reconciliation surface. Realtime stays the primary update
 * mechanism; these two helpers are the safety net every lifecycle screen
 * uses to recover from a missed event (channel down during the event,
 * reconnect race, app backgrounded, etc.).
 *
 *   - `reconcileNow()` — full snapshot re-read; coalesces concurrent callers.
 *   - `reconcileRequest(id)` — single-row authoritative re-read; cheap.
 */
export function reconcileNow(): Promise<void> {
  return refreshSnapshot();
}

export function reconcileRequest(id: string): Promise<void> {
  if (!id) return Promise.resolve();
  return fetchAndIngestRow(id);
}

/**
 * Handle a single postgres_changes payload. Shared between the per-user
 * filtered bindings (own rows + open searching rows) so the dedupe logic
 * lives in one place. Bindings can overlap — e.g. when a doctor accepts
 * their own searching row, both the `accepted_by=eq.uid` and the prior
 * `status=eq.searching` bindings may fire — so we de-duplicate by event id.
 */
const recentEventIds = new Map<string, number>();
function handlePayload(payload: {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: unknown;
  old?: unknown;
}) {
  markRealtimeActivity();
  // postgres_changes signals underlying truth has moved — bust so any
  // concurrent or follow-up open-list refetch is fresh.
  bustOpenListCache();

  const row = (payload.new ?? payload.old) as Row | undefined;
  if (!row?.id) return;

  // Crude per-row event coalescing across overlapping filtered bindings.
  const key = `${row.id}:${payload.eventType}:${(row as Row).updated_at ?? ""}`;
  const now = Date.now();
  const last = recentEventIds.get(key);
  if (last && now - last < 1500) return;
  recentEventIds.set(key, now);
  // Light GC.
  if (recentEventIds.size > 256) {
    for (const [k, t] of recentEventIds) {
      if (now - t > 5000) recentEventIds.delete(k);
    }
  }

  const strip = (r: Row | undefined) => (r ? { ...r, phone: "" } : r);
  // Apply the change to the in-memory snapshot so newly-mounting subscribers
  // see fresh state without us paying for a full SELECT on every event.
  // Phone is intentionally blanked here — the RPC-backed phone map is only
  // refreshed by refreshSnapshot(); event-driven rows show "" until the next
  // explicit refresh, which is fine because phone is only revealed in the
  // requester/cover settlement views where a refresh has already run.
  const upsertCached = (net: NetRequest) => {
    const idx = cachedSnapshot.findIndex((r) => r.id === net.id);
    if (idx === -1) cachedSnapshot = [...cachedSnapshot, net];
    else {
      const next = cachedSnapshot.slice();
      next[idx] = net;
      cachedSnapshot = next;
    }
    writePersistedSnapshot(cachedSnapshot);
  };

  if (payload.eventType === "INSERT") {
    const net = rowToNet(strip(payload.new as Row) as Row);
    upsertCached(net);
    eventListeners.forEach((fn) => fn({ type: "INSERT", row: net }));
  } else if (payload.eventType === "UPDATE") {
    const net = rowToNet(strip(payload.new as Row) as Row);
    const old = payload.old ? rowToNet(strip(payload.old as Row) as Row) : null;
    upsertCached(net);
    eventListeners.forEach((fn) => fn({ type: "UPDATE", row: net, old }));
  } else if (payload.eventType === "DELETE") {
    const id = (payload.old as Row | undefined)?.id;
    if (id) {
      cachedSnapshot = cachedSnapshot.filter((r) => r.id !== id);
      writePersistedSnapshot(cachedSnapshot);
      eventListeners.forEach((fn) => fn({ type: "DELETE", id }));
    }
  }
  // NOTE: intentionally no scheduleRefresh() here. Consumers receive the
  // mutation via onEvent and the cachedSnapshot is updated above, so the
  // previous "refetch the whole table on every event" pattern is gone.
  // The invalidation broadcast channel is still the fallback path when an
  // RLS-filtered postgres_changes event never reaches us (e.g. a row leaving
  // our scope after an accept).
}

/**
 * Build a coverage_requests channel scoped to the signed-in user. RLS is
 * still the source of truth; these filters just keep the WAL fan-out narrow
 * so each client only receives events for rows it actually cares about:
 *   - rows it created (requester)
 *   - rows it accepted (cover doctor)
 *
 * NOTE: there is intentionally no `status=eq.searching` binding. The SELECT
 * policy now hides searching rows from doctors so RLS would never deliver
 * those events anyway. New open-pool rows are surfaced via the
 * `coverage_invalidations` broadcast, which triggers a re-fetch through the
 * `list_open_coverage_requests` RPC (sensitive columns stripped server-side).
 */
function ensureChannelForUser(userId: string) {
  if (channelUserId === userId && channel) return;
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  channelUserId = userId;
  channel = supabase
    .channel(`coverage_requests_changes_${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `requester_id=eq.${userId}` },
      handlePayload,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `accepted_by=eq.${userId}` },
      handlePayload,
    )
    .subscribe((status) => {
      // Treat brief reconnects as background refreshes — blanking the
      // "live snapshot" guarantee on every flicker causes Incoming Coverage
      // to disappear and reappear on mobile networks where the channel
      // routinely cycles. We only invalidate the guarantee if the channel
      // stays down past a grace window.
      if (status === "SUBSCRIBED") {
        clearChannelDownGrace();
        resetBackoff("coverage");
        setChannelHealth("coverage", "ok");
        markRealtimeActivity();
        void refreshSnapshot();
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        scheduleChannelDownBlank();
        // Stage 0 watchdog: tear down and re-subscribe with exp. backoff.
        scheduleReconnect("coverage", () => {
          if (!channelUserId) return;
          if (channel) {
            supabase.removeChannel(channel);
            channel = null;
          }
          const uid = channelUserId;
          channelUserId = null;
          ensureChannelForUser(uid);
        });
      }
    });

}

// 10s grace before a dropped realtime channel invalidates the live snapshot.
// Most disconnects on mobile reconnect well inside this window; without the
// grace, every flap blanks Incoming Coverage for a full poll cycle.
const CHANNEL_DOWN_GRACE_MS = 10_000;
let channelDownTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleChannelDownBlank() {
  if (channelDownTimer) return;
  channelDownTimer = setTimeout(() => {
    channelDownTimer = null;
    setLiveSnapshotSeen(false);
  }, CHANNEL_DOWN_GRACE_MS);
}
function clearChannelDownGrace() {
  if (channelDownTimer) {
    clearTimeout(channelDownTimer);
    channelDownTimer = null;
  }
}


export function subscribeCoverageRemote(opts: SubscribeOpts): () => void {
  eventListeners.add(opts.onEvent);
  snapshotListeners.add(opts.onSnapshot);
  activeSubscribers++;

  // Paint the last known operational state immediately. The async backend
  // snapshot reconciles afterward, but Coverage never flashes through an
  // empty/loading state after long inactivity or a fresh sign-in.
  //
  // NOTE: this cache contains ONLY the doctor's own rows (see
  // writePersistedSnapshot). The open SEARCHING pool is never persisted,
  // and Incoming Coverage is gated on hasLiveSnapshot() so even own-row
  // cache replay cannot resurrect a stale broadcast.
  const uid = activeCacheUserId();
  const persisted = readPersistedSnapshot();
  if (persisted.length > 0) {
    cachedSnapshot = persisted;
    cachedSnapshotUserId = uid;
  }
  // Every new mount starts with no live snapshot; it flips true only when
  // refreshSnapshot() actually returns rows from the server in this session.
  setLiveSnapshotSeen(false);
  if (uid && cachedSnapshotUserId === uid && cachedSnapshot.length > 0) {
    opts.onSnapshot(cachedSnapshot);
  }

  // Fetch + subscribe only after auth storage is hydrated.
  void ensureAuthReady().then((auth) => {
    if (auth.userId) {
      ensureChannelForUser(auth.userId);
      void refreshSnapshot();
    }
  });

  if (!invalidationChannel) {
    const onInvalidate = (msg: { payload?: { id?: string } }) => {
      markRealtimeActivity();
      // Bust the open-list cache BEFORE any refetch — Realtime events must
      // always read fresh DB truth, never a 1.5s-stale snapshot.
      bustOpenListCache();

      const id = msg?.payload?.id;
      // Single-row re-read when the trigger gave us an id — this is the
      // queue advancement path (accept / cancel / edit-pause / expire /
      // delete). Falls back to a full snapshot refresh only when no id
      // was provided (legacy / manual invalidate).
      if (typeof id === "string" && id.length > 0) {
        void fetchAndIngestRow(id);
      } else {
        scheduleRefresh();
      }
      // Fan out to local subscribers (e.g. the settlement sheet) so callers
      // never need to open a second `coverage_invalidations` channel of
      // their own. Opening a duplicate topic and later removing it was
      // tearing down the shared subscription on the socket, which surfaced
      // as a phantom "Reconnecting…" pill right after payment.
      invalidationPingListeners.forEach((fn) => {
        try {
          fn(id ?? null);
        } catch {
          /* noop — listener errors must not break the channel */
        }
      });
    };
    // Self-healing subscribe — the reconnect path used to only handle
    // SUBSCRIBED, so a second flap (e.g. burst of invalidations during
    // payment completion) left health permanently in "reconnecting" and
    // the global pill stuck on. Mirrors the coverage / presence channels.
    const openInvalidationChannel = () => {
      if (invalidationChannel) {
        supabase.removeChannel(invalidationChannel);
        invalidationChannel = null;
      }
      invalidationChannel = supabase
        .channel("coverage_invalidations", {
          config: { broadcast: { self: false } },
        })
        .on("broadcast", { event: "invalidate" }, onInvalidate)
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            resetBackoff("invalidations");
            setChannelHealth("invalidations", "ok");
            // Recover any broadcast missed while the channel was down —
            // realtime is primary, snapshot reconcile is the safety net.
            void refreshSnapshot();
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            scheduleReconnect("invalidations", openInvalidationChannel);
          }
        });
    };
    openInvalidationChannel();
  }


  // Stage 0 safety net: low-frequency reconciliation timer. Fires only when
  // tab is visible AND no realtime activity for `RECONCILE_AFTER_SILENCE_MS`.
  startReconcileTimer();


  // Audit 11: no client-side polling. The two sources of truth are the
  // server snapshot issued on subscription activation / identity rehydration
  // (refreshSnapshot below) and realtime events. If a new searching-pool row
  // is missed, the next `coverage_invalidations` broadcast or the
  // SUBSCRIBED-triggered refresh reconciles it — never a periodic poll.


  // Tab/app reopen: refresh in the background so Incoming Coverage stays
  // visible across the visibility flip. We intentionally do NOT blank the
  // live-snapshot guarantee here — blanking caused a card flicker on every
  // mobile visibility toggle even though the server snapshot was still fresh.
  // If the refetch itself fails or returns nothing, the snapshot pipeline
  // will surface that on its own.
  let onVisibility: (() => void) | null = null;
  if (typeof document !== "undefined") {
    onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
  }
  let onOnlineWindow: (() => void) | null = null;
  let onFocus: (() => void) | null = null;
  if (typeof window !== "undefined") {
    onOnlineWindow = () => {
      void refreshSnapshot();
    };
    onFocus = () => {
      void refreshSnapshot();
    };
    window.addEventListener("online", onOnlineWindow);
    // iOS Safari / PWA shells sometimes fire `focus` without firing
    // `visibilitychange` (e.g. returning from a system sheet). Belt-and-
    // braces: reconcile on focus too. refreshSnapshot is coalesced so
    // overlapping visibility+focus events collapse to one fetch.
    window.addEventListener("focus", onFocus);
  }

  // Re-bind the filtered channel whenever auth identity changes — the
  // previous channel's filter is hard-coded to the prior uid. Audit 11:
  // also discard any in-memory state carried over from the previous
  // identity so a previously-cached row cannot survive sign-in as a
  // different user. UI shows empty until the fresh server snapshot arrives.
  const offAuth = onUserIdChange((id) => {
    // Same-user re-entry: do NOT blank the cache. Token refresh / focus /
    // INITIAL_SESSION can replay the same uid; emitting [] here is what
    // briefly empties the History tab. Quietly reconcile in the background.
    if (id && id === cachedSnapshotUserId) {
      void refreshSnapshot();
      return;
    }
    setLiveSnapshotSeen(false);
    cachedSnapshot = [];
    cachedSnapshotUserId = null;
    lastPoolRows = [];
    recentEventIds.clear();
    snapshotListeners.forEach((fn) => fn(cachedSnapshot));
    if (id) {
      ensureChannelForUser(id);
      void refreshSnapshot();
    }
  });


  return () => {
    eventListeners.delete(opts.onEvent);
    snapshotListeners.delete(opts.onSnapshot);
    offAuth();
    if (onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      if (onOnlineWindow) window.removeEventListener("online", onOnlineWindow);
      if (onFocus) window.removeEventListener("focus", onFocus);
    }
    activeSubscribers--;
    if (activeSubscribers === 0) {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
        channelUserId = null;
      }
      if (invalidationChannel) {
        supabase.removeChannel(invalidationChannel);
        invalidationChannel = null;
      }
      setLiveSnapshotSeen(false);
      stopReconcileTimer();

    }
  };
}


/* ---------------- Writes ---------------- */

export async function remoteInsertRequest(req: NetRequest): Promise<void> {
  const row = {
    id: req.id,
    requester_id: req.requesterSessionId,
    hospital: req.hospital,
    area: req.area,
    coverage_type: req.coverage,
    day: req.day,
    start_time: req.start,
    end_time: req.end,
    start_ts: req.startTs ?? null,
    end_ts: req.endTs ?? null,
    duration_hrs: req.durationHrs,
    amount: req.amount,
    fee_pct: req.feePct,
    phone: req.phone,
    note: req.note ?? null,
    status: netStatusToDb[req.status],
    accepted_by: req.acceptedBy ?? null,
    started_at: req.startedAt ?? null,
    accumulated_ms: req.accumulatedMs ?? 0,
    settled_amount: req.settledAmount ?? null,
    days: req.days ?? 1,
    day_index: req.dayIndex ?? 1,
    cancelled_by: req.cancelledBy ?? null,
    environment: req.environment ?? "normal",
  };
  const { error } = await supabase.from(TABLE).insert(row);
  if (error) {
    console.warn("[coverage-remote] insert error:", error.message);
    return;
  }
  emitInvalidate(req.id);
}

export async function remoteUpdateRequest(
  id: string,
  patch: Partial<NetRequest> & { __cancelReason?: { code: string; text?: string } },
): Promise<void> {
  if (patch.status === "cancelled") {
    try {
      const reason = patch.__cancelReason;
      // Post-acceptance cancels require a reason server-side. If the caller
      // somehow lost the reason in transit, look up accepted_by first and
      // route the call appropriately — never throw a "reason required" error
      // up the UI when we can recover silently for pre-acceptance rows.
      if (!reason?.code) {
        const { data: row } = await supabase
          .from(TABLE)
          .select("accepted_by, status")
          .eq("id", id)
          .maybeSingle();
        if (!row || row.status === "cancelled") return;
        if (row.accepted_by) {
          console.error(
            "[coverage-remote] post-acceptance cancel attempted without a reason",
            new Error("missing __cancelReason").stack,
          );
          return;
        }
        // Pre-acceptance: silent direct update; no notify path needed.
        const { error: directErr } = await supabase
          .from(TABLE)
          .update({ status: "cancelled" })
          .eq("id", id);
        if (directErr) {
          console.warn("[coverage-remote] silent cancel error:", directErr.message);
          return;
        }
        emitInvalidate(id);
        return;
      }
      const { cancelAndNotifyFn } = await import("@/lib/coverage-notify.functions");
      const res = await cancelAndNotifyFn({
        data: {
          requestId: id,
          reasonCode: reason.code,
          reasonText: reason.text,
        },
      });
      if (!res?.ok) {
        console.warn(
          "[coverage-remote] cancel skipped:",
          res && "reason" in res ? res.reason : "unknown",
        );
      } else emitInvalidate(id);
      return;
    } catch (e) {
      console.warn("[coverage-remote] cancel error:", (e as Error).message);
      return;
    }
  }
  const dbPatch = netPatchToRow(patch);
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from(TABLE).update(dbPatch).eq("id", id);
  if (error) {
    console.warn("[coverage-remote] update error:", error.message);
    return;
  }
  emitInvalidate(id);
}

/**
 * Atomic claim — only succeeds if the row is still searching & unclaimed.
 * Returns true on success, false if another doctor won the race.
 */
export async function remoteClaimRequest(id: string, _doctorUserId: string): Promise<boolean> {
  void _doctorUserId;
  // Goes through a server fn that runs the SECURITY DEFINER RPC and then
  // pushes the requester (background-safe notification on native shells).
  try {
    const { claimAndNotifyFn } = await import("@/lib/coverage-notify.functions");
    const res = await claimAndNotifyFn({ data: { requestId: id } });
    const won = !!res?.won;
    if (won) emitInvalidate(id);
    return won;
  } catch (e) {
    console.warn("[coverage-remote] claim error:", (e as Error).message);
    return false;
  }
}

export async function remoteDeleteRequest(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) {
    console.warn("[coverage-remote] delete error:", error.message);
    return;
  }
  emitInvalidate(id);
}

/**
 * Pre-acceptance expiry. The 180s broadcast window has elapsed without an
 * acceptance — the row transitions to terminal `expired` (NOT deleted) so
 * admin analytics can measure no-fill rate. Doctor feeds and requester
 * history both treat `expired` as removed; only admin dashboards surface it.
 */
export async function remoteExpireRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc("expire_request", { _id: id });
  if (error) {
    console.warn("[coverage-remote] expire error:", error.message);
    return;
  }
  emitInvalidate(id);
}

