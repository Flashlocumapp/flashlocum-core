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
    paidAt: r.paid_at ? new Date(r.paid_at).getTime() : undefined,
    remittedAt: r.remitted_at ? new Date(r.remitted_at).getTime() : undefined,
    environment: r.environment === "busy" ? "busy" : "normal",
    rev: r.rev ?? 1,
    broadcastStartedAt: r.broadcast_started_at
      ? new Date(r.broadcast_started_at).getTime()
      : new Date(r.created_at).getTime(),
    everStarted: !!r.first_started_at,
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
if (typeof window !== "undefined") {
  subscribeAuthState(({ event, userId }) => {
    if (event === "SIGNED_OUT") clearPersistedSnapshot();
    cachedUserId = userId;
    userIdResolved = true;
    userListeners.forEach((fn) => fn(cachedUserId));
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
    supabase.rpc("list_open_coverage_requests"),
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
    snapshotListeners.forEach((fn) => fn(cachedSnapshot));
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
        void refreshSnapshot();
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        scheduleChannelDownBlank();
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
    invalidationChannel = supabase
      .channel("coverage_invalidations", {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "invalidate" }, () => {
        // RLS may have filtered the postgres_changes event for this client;
        // re-fetching reconciles cache divergence.
        scheduleRefresh();
      })
      .subscribe();
  }

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
  let onOnline: (() => void) | null = null;
  if (typeof document !== "undefined") {
    onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshSnapshot();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (typeof window !== "undefined") {
    onOnline = () => {
      void refreshSnapshot();
    };
    window.addEventListener("online", onOnline);
  }

  // Re-bind the filtered channel whenever auth identity changes — the
  // previous channel's filter is hard-coded to the prior uid. Audit 11:
  // also discard any in-memory state carried over from the previous
  // identity so a previously-cached row cannot survive sign-in as a
  // different user. UI shows empty until the fresh server snapshot arrives.
  const offAuth = onUserIdChange((id) => {
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
    if (onOnline && typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
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

export async function remoteUpdateRequest(id: string, patch: Partial<NetRequest>): Promise<void> {
  if (patch.status === "cancelled") {
    try {
      const { cancelAndNotifyFn } = await import("@/lib/coverage-notify.functions");
      const res = await cancelAndNotifyFn({ data: { requestId: id } });
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

