// Supabase-backed doctor presence.
//
// Stores each doctor's online flag, last-seen heartbeat, and stable map
// position as a row in `doctor_presence`. All clients subscribe to realtime
// changes so that requesters immediately see doctors come online / go
// offline, and the dispatch map reflects the true backend state.

import { supabase } from "@/integrations/supabase/client";
import { onUserIdChange, getCurrentUserIdSync } from "./coverage-remote";
import { ensureAuthReady } from "@/lib/auth-ready";

export type PresenceRow = {
  user_id: string;
  online: boolean;
  top: number;
  left: number;
  last_seen: string;
};

type RealtimePayload = {
  eventType?: string;
  event?: string;
  new?: unknown;
  old?: unknown;
};

const TABLE = "doctor_presence";

let channel: ReturnType<typeof supabase.channel> | null = null;
let ownProfileChannel: ReturnType<typeof supabase.channel> | null = null;
let ownProfileChannelUserId: string | null = null;

// Raw caches — backend truth.
const rawRows = new Map<string, PresenceRow>();
const approvedIds = new Set<string>();
// Profiles we've already checked verification for — avoids re-fetching the
// same unknown id on every heartbeat update.
const checkedProfileIds = new Set<string>();
const inFlightProfileChecks = new Set<string>();

const snapshotListeners = new Set<(rows: PresenceRow[]) => void>();
let activeSubscribers = 0;

/** Presence rows older than this are treated as offline / stale. */
const STALE_MS = 60 * 1000;

function buildSnapshot(): PresenceRow[] {
  const now = Date.now();
  const out: PresenceRow[] = [];
  for (const r of rawRows.values()) {
    if (!approvedIds.has(r.user_id)) continue;
    const lastSeenMs = r.last_seen ? new Date(r.last_seen).getTime() : 0;
    const fresh = now - lastSeenMs < STALE_MS;
    out.push({
      user_id: r.user_id,
      online: !!r.online && fresh,
      top: Number(r.top ?? 0.5),
      left: Number(r.left ?? 0.5),
      last_seen: r.last_seen,
    });
  }
  return out;
}

function emit() {
  const snap = buildSnapshot();
  snapshotListeners.forEach((fn) => fn(snap));
}

// Guards against re-running the initial fetch on every TOKEN_REFRESHED /
// INITIAL_SESSION event. We only refetch when the signed-in user identity
// actually changes (sign-in / sign-out / user-switch).
let lastFetchedUserId: string | null = null;
let initialFetchInFlight: Promise<void> | null = null;

async function initialFetch(force = false) {
  const auth = await ensureAuthReady();
  if (!auth.userId) {
    lastFetchedUserId = null;
    return;
  }
  if (!force && lastFetchedUserId === auth.userId) return;
  if (initialFetchInFlight) return initialFetchInFlight;
  initialFetchInFlight = (async () => {
    // Only fetch presence rows; approval status is resolved lazily per
    // user_id via ensureApprovalKnown(). Shipping the full approved-doctor
    // ID list to every requester on every token refresh was wasteful and
    // leaked the doctor roster.
    const presenceRes = await supabase
      .from(TABLE)
      .select("user_id, online, top, left, last_seen");
    if (presenceRes.error) {
      console.warn("[presence-remote] fetch error:", presenceRes.error.message);
    } else {
      rawRows.clear();
      for (const r of presenceRes.data ?? []) {
        rawRows.set(r.user_id, r as PresenceRow);
      }
      // Kick off lazy approval checks for any unknown ids; ensureApprovalKnown
      // dedupes in-flight requests and caches results, so repeated calls are
      // cheap.
      for (const r of presenceRes.data ?? []) {
        if (!checkedProfileIds.has(r.user_id)) void ensureApprovalKnown(r.user_id);
      }
    }
    lastFetchedUserId = auth.userId;
    emit();
  })().finally(() => {
    initialFetchInFlight = null;
  });
  return initialFetchInFlight;
}


/** Lazily verify doctors' approval status in batches. Coalesces all unknown
 *  ids requested within a microtask + 50ms window into a single
 *  `id IN (...)` query, so a fresh page-load that surfaces N online doctors
 *  costs 1 round-trip instead of N. */
const pendingApprovalChecks = new Set<string>();
let approvalFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushApprovalChecks() {
  approvalFlushTimer = null;
  const ids = Array.from(pendingApprovalChecks).filter(
    (id) => !checkedProfileIds.has(id) && !inFlightProfileChecks.has(id),
  );
  pendingApprovalChecks.clear();
  if (ids.length === 0) return;
  ids.forEach((id) => inFlightProfileChecks.add(id));
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, verification_status")
      .in("id", ids);
    if (error) {
      ids.forEach((id) => inFlightProfileChecks.delete(id));
      return;
    }
    const approvedSet = new Set(
      (data ?? [])
        .filter((r) => r.verification_status === "approved")
        .map((r) => r.id as string),
    );
    let changed = false;
    for (const id of ids) {
      checkedProfileIds.add(id);
      if (approvedSet.has(id)) {
        if (!approvedIds.has(id)) {
          approvedIds.add(id);
          changed = true;
        }
      } else if (rawRows.delete(id)) {
        changed = true;
      }
    }
    ids.forEach((id) => inFlightProfileChecks.delete(id));
    if (changed) emit();
  } catch {
    ids.forEach((id) => inFlightProfileChecks.delete(id));
  }
}

function ensureApprovalKnown(userId: string) {
  if (checkedProfileIds.has(userId) || inFlightProfileChecks.has(userId)) return;
  pendingApprovalChecks.add(userId);
  if (approvalFlushTimer == null) {
    approvalFlushTimer = setTimeout(flushApprovalChecks, 50);
  }
}

function applyPresencePayload(payload: RealtimePayload) {
  const evt = payload.eventType ?? payload.event;
  if (evt === "DELETE") {
    const id = (payload.old as Partial<PresenceRow> | undefined)?.user_id;
    if (id) rawRows.delete(id);
  } else {
    const row = payload.new as PresenceRow | undefined;
    if (row?.user_id) {
      rawRows.set(row.user_id, row);
      if (!checkedProfileIds.has(row.user_id)) void ensureApprovalKnown(row.user_id);
    }
  }
  emit();
}

/** Per-user channel for the signed-in user's own profile — used to track
 *  their own verification status flipping (e.g. admin approves them while
 *  they're online). Replaces the previous global profiles channel which
 *  fired on every heartbeat for every user. */
function applyOwnProfilePayload(payload: RealtimePayload) {
  const evt = payload.eventType ?? payload.event;
  if (evt === "DELETE") {
    const id = (payload.old as { id?: string } | undefined)?.id;
    if (id) {
      approvedIds.delete(id);
      rawRows.delete(id);
      checkedProfileIds.delete(id);
      emit();
    }
    return;
  }
  const row = payload.new as { id: string; verification_status: string } | undefined;
  if (!row?.id) return;
  checkedProfileIds.add(row.id);
  if (row.verification_status === "approved") {
    approvedIds.add(row.id);
  } else {
    approvedIds.delete(row.id);
    rawRows.delete(row.id);
  }
  emit();
}

function ensureOwnProfileChannel(userId: string) {
  if (ownProfileChannelUserId === userId && ownProfileChannel) return;
  if (ownProfileChannel) {
    supabase.removeChannel(ownProfileChannel);
    ownProfileChannel = null;
  }
  ownProfileChannelUserId = userId;
  ownProfileChannel = supabase
    .channel(`own-profile-verification-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      (payload) => applyOwnProfilePayload(payload),
    )
    .subscribe();
}

export function subscribePresence(onSnapshot: (rows: PresenceRow[]) => void): () => void {
  snapshotListeners.add(onSnapshot);
  activeSubscribers++;
  // Emit current cache synchronously so subscriber gets instant data.
  onSnapshot(buildSnapshot());
  void initialFetch();

  if (!channel) {
    channel = supabase
      .channel("doctor_presence_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) =>
        applyPresencePayload(payload),
      )
      .subscribe();
  }
  void ensureAuthReady().then((auth) => {
    if (auth.userId) ensureOwnProfileChannel(auth.userId);
  });

  const offAuth = onUserIdChange((id) => {
    if (id) {
      ensureOwnProfileChannel(id);
      // initialFetch() is a no-op when id matches lastFetchedUserId, so
      // TOKEN_REFRESHED events that re-fire this listener don't trigger a
      // refetch. A genuine sign-in / user-switch will refetch once.
      void initialFetch();
    } else {
      // Signed out — clear caches so the next sign-in starts clean.
      lastFetchedUserId = null;
      rawRows.clear();
      approvedIds.clear();
      checkedProfileIds.clear();
      emit();
    }
  });


  return () => {
    snapshotListeners.delete(onSnapshot);
    offAuth();
    activeSubscribers--;
    if (activeSubscribers === 0) {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      if (ownProfileChannel) {
        supabase.removeChannel(ownProfileChannel);
        ownProfileChannel = null;
        ownProfileChannelUserId = null;
      }
    }
  };
}

/** Upsert my presence row. No-op if not signed in. */
export async function upsertMyPresence(fields: {
  online: boolean;
  top?: number;
  left?: number;
}): Promise<void> {
  const uid = getCurrentUserIdSync();
  if (!uid) return;
  const row: {
    user_id: string;
    online: boolean;
    last_seen: string;
    top?: number;
    left?: number;
  } = {
    user_id: uid,
    online: fields.online,
    last_seen: new Date().toISOString(),
  };
  if (fields.top !== undefined) row.top = fields.top;
  if (fields.left !== undefined) row.left = fields.left;

  // Optimistically update local cache so the toggling client sees the
  // change immediately, without waiting for the realtime echo.
  const existing = rawRows.get(uid);
  rawRows.set(uid, {
    user_id: uid,
    online: fields.online,
    top: fields.top ?? existing?.top ?? 0.5,
    left: fields.left ?? existing?.left ?? 0.5,
    last_seen: row.last_seen,
  });
  emit();

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "user_id" });

  if (error) console.warn("[presence-remote] upsert error:", error.message);
}

/** Heartbeat last_seen + keep online flag. */
export async function heartbeatPresence(online: boolean): Promise<void> {
  const uid = getCurrentUserIdSync();
  if (!uid) return;
  const { error } = await supabase
    .from(TABLE)
    .update({ online, last_seen: new Date().toISOString() })
    .eq("user_id", uid);
  if (error && error.code !== "PGRST116") {
    // If no row yet, upsert one.
    await upsertMyPresence({ online });
  }
}

/** Remove my presence row (e.g. on sign-out / unload). */
export async function clearMyPresence(): Promise<void> {
  const uid = getCurrentUserIdSync();
  if (!uid) return;
  // Optimistic local clear.
  const existing = rawRows.get(uid);
  if (existing) {
    rawRows.set(uid, { ...existing, online: false, last_seen: new Date().toISOString() });
    emit();
  }
  await supabase
    .from(TABLE)
    .update({ online: false, last_seen: new Date().toISOString() })
    .eq("user_id", uid);
}
