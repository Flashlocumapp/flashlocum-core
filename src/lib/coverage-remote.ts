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
  status: "searching" | "accepted" | "active" | "paused" | "completed" | "cancelled";
  accepted_by: string | null;
  started_at: number | null;
  accumulated_ms: number;
  settled_amount: number | null;
  days: number;
  day_index: number;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "coverage_requests";
const LS_KEY = "fl:coverage-cache:v1";

type PersistedCoverage = { uid: string; rows: NetRequest[]; savedAt: number };

function activeCacheUserId(): string | null {
  return cachedUserId ?? getCachedProfileUserId();
}

function readPersistedSnapshot(): NetRequest[] {
  if (typeof window === "undefined") return [];
  const uid = activeCacheUserId();
  if (!uid) return [];
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw) as PersistedCoverage;
    if (!payload || payload.uid !== uid || !Array.isArray(payload.rows)) return [];
    return payload.rows;
  } catch {
    return [];
  }
}

function writePersistedSnapshot(rows: NetRequest[]) {
  if (typeof window === "undefined") return;
  const uid = activeCacheUserId();
  if (!uid) return;
  try {
    const payload: PersistedCoverage = { uid, rows, savedAt: Date.now() };
    window.localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

const dbStatusToNet: Record<Row["status"], NetRequestStatus> = {
  searching: "broadcasting",
  accepted: "accepted",
  active: "active",
  paused: "paused",
  completed: "completed",
  cancelled: "cancelled",
};
const netStatusToDb: Record<NetRequestStatus, Row["status"]> = {
  broadcasting: "searching",
  accepted: "accepted",
  active: "active",
  paused: "paused",
  completed: "completed",
  cancelled: "cancelled",
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
  subscribeAuthState(({ userId }) => {
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
let invalidationChannel: ReturnType<typeof supabase.channel> | null = null;
const eventListeners = new Set<(e: RemoteEvent) => void>();
const snapshotListeners = new Set<(rows: NetRequest[]) => void>();
const initialPersistedSnapshot = readPersistedSnapshot();
let cachedSnapshot: NetRequest[] = initialPersistedSnapshot;
let cachedSnapshotUserId: string | null = initialPersistedSnapshot.length > 0 ? activeCacheUserId() : null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

async function fetchAll(): Promise<NetRequest[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[coverage-remote] fetch error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => rowToNet(r as Row));
}

async function refreshSnapshot() {
  cachedSnapshot = await fetchAll();
  cachedSnapshotUserId = activeCacheUserId();
  writePersistedSnapshot(cachedSnapshot);
  snapshotListeners.forEach((fn) => fn(cachedSnapshot));
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

export function subscribeCoverageRemote(opts: SubscribeOpts): () => void {
  eventListeners.add(opts.onEvent);
  snapshotListeners.add(opts.onSnapshot);
  activeSubscribers++;

  // Paint the last known operational state immediately. The async backend
  // snapshot reconciles afterward, but Coverage never flashes through an
  // empty/loading state after long inactivity or a fresh sign-in.
  const uid = activeCacheUserId();
  const persisted = readPersistedSnapshot();
  if (persisted.length > 0) {
    cachedSnapshot = persisted;
    cachedSnapshotUserId = uid;
  }
  if (uid && cachedSnapshotUserId === uid && cachedSnapshot.length > 0) {
    opts.onSnapshot(cachedSnapshot);
  }

  // Fetch only after auth storage is hydrated. A cold-start null session would
  // return an empty RLS scope and briefly wipe the cached operational state.
  void ensureAuthReady().then((auth) => {
    if (auth.userId) void refreshSnapshot();
  });

  if (!channel) {
    channel = supabase
      .channel("coverage_requests_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = rowToNet(payload.new as Row);
            eventListeners.forEach((fn) => fn({ type: "INSERT", row }));
            refreshSnapshot();
          } else if (payload.eventType === "UPDATE") {
            const row = rowToNet(payload.new as Row);
            const old = payload.old ? rowToNet(payload.old as Row) : null;
            eventListeners.forEach((fn) => fn({ type: "UPDATE", row, old }));
            refreshSnapshot();
          } else if (payload.eventType === "DELETE") {
            const id = (payload.old as Row | undefined)?.id;
            if (id) eventListeners.forEach((fn) => fn({ type: "DELETE", id }));
            refreshSnapshot();
          }
        },
      )
      .subscribe();
  }

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

  // Re-fetch whenever auth changes so a sign-in/out picks up the new RLS scope.
  const offAuth = onUserIdChange((id) => {
    if (id) void refreshSnapshot();
  });

  return () => {
    eventListeners.delete(opts.onEvent);
    snapshotListeners.delete(opts.onSnapshot);
    offAuth();
    activeSubscribers--;
    if (activeSubscribers === 0) {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      if (invalidationChannel) {
        supabase.removeChannel(invalidationChannel);
        invalidationChannel = null;
      }
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
  patch: Partial<NetRequest>,
): Promise<void> {
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
export async function remoteClaimRequest(
  id: string,
  doctorUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: "accepted", accepted_by: doctorUserId })
    .eq("id", id)
    .eq("status", "searching")
    .is("accepted_by", null)
    .select("id");
  if (error) {
    console.warn("[coverage-remote] claim error:", error.message);
    return false;
  }
  const won = (data?.length ?? 0) > 0;
  if (won) emitInvalidate(id);
  return won;
}

export async function remoteDeleteRequest(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) {
    console.warn("[coverage-remote] delete error:", error.message);
    return;
  }
  emitInvalidate(id);
}
