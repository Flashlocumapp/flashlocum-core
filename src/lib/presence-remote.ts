// Supabase-backed doctor presence.
//
// Stores each doctor's online flag, last-seen heartbeat, and (when GPS
// permission is granted) their real lat/lng as a row in `doctor_presence`.
// All clients subscribe to realtime changes so requesters immediately see
// doctors come online / go offline, and the map renders each doctor at
// their absolute coordinates.

import { supabase } from "@/integrations/supabase/client";
import { onUserIdChange, getCurrentUserIdSync } from "./coverage-remote";
import { ensureAuthReady } from "@/lib/auth-ready";
import { setChannelHealth } from "./realtime-health";
import { pushToast } from "@/lib/notifications";


export type PresenceRow = {
  user_id: string;
  online: boolean;
  top: number;
  left: number;
  last_seen: string;
  lat?: number | null;
  lng?: number | null;
};

type RealtimePayload = {
  eventType?: string;
  event?: string;
  new?: unknown;
  old?: unknown;
};

const TABLE = "doctor_presence";

let channel: ReturnType<typeof supabase.channel> | null = null;

// Raw caches — backend truth. Only approved + online doctors are ever
// loaded into rawRows (the SECURITY DEFINER RPC filters server-side), so
// no client-side approval bookkeeping is needed.
const rawRows = new Map<string, PresenceRow>();

const snapshotListeners = new Set<(rows: PresenceRow[]) => void>();
let activeSubscribers = 0;

// Audit 11: presence is server-authoritative. The server (pg_cron job
// `expire_stale_doctor_presence`) is the only authority that decides a
// doctor has gone dark; it flips `online=false`, which propagates as a
// normal realtime UPDATE. The client therefore renders the server-truth
// `online` flag directly — no client-side staleness window, no inference.

function buildSnapshot(): PresenceRow[] {
  // Pass-through: emit every cached row, including online=false. The
  // rendering layer (e.g. `onlineDoctors()` selector, map markers) is the
  // single authority that filters by `online`. Filtering here would hide
  // the online→offline transition entirely — the downstream merge would
  // see the doctor "missing" from the snapshot and fall back to a stale
  // online=true entry, delaying the offline event by minutes.
  const out: PresenceRow[] = [];
  for (const r of rawRows.values()) {
    out.push({
      user_id: r.user_id,
      online: !!r.online,
      top: Number(r.top ?? 0.5),
      left: Number(r.left ?? 0.5),
      lat: r.lat ?? null,
      lng: r.lng ?? null,
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
// INITIAL_SESSION event.
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
    // Server-side filtered to online + approved doctors; no profile roster
    // is fetched to the client.
    const { data, error } = await supabase.rpc("list_online_approved_doctors");
    if (error) {
      console.warn("[presence-remote] rpc error:", error.message);
    } else {
      rawRows.clear();
      for (const r of (data ?? []) as Array<{
        user_id: string;
        online: boolean;
        last_seen: string;
        top: number | null;
        left: number | null;
        lat: number | null;
        lng: number | null;
      }>) {
        rawRows.set(r.user_id, {
          user_id: r.user_id,
          online: !!r.online,
          last_seen: r.last_seen,
          top: Number(r.top ?? 0.5),
          left: Number(r.left ?? 0.5),
          lat: r.lat,
          lng: r.lng,
        });
      }
    }
    lastFetchedUserId = auth.userId;
    emit();
  })().finally(() => {
    initialFetchInFlight = null;
  });
  return initialFetchInFlight;
}

function applyPresencePayload(payload: RealtimePayload) {
  const evt = payload.eventType ?? payload.event;
  if (evt === "DELETE") {
    const id = (payload.old as Partial<PresenceRow> | undefined)?.user_id;
    if (id) rawRows.delete(id);
  } else {
    const row = payload.new as PresenceRow | undefined;
    if (row?.user_id) {
      // Realtime delivers everyone, but RLS gates SELECT to online+approved
      // (plus self/admin/assigned-requester). Offline rows are stripped in
      // buildSnapshot via the fresh+online check.
      rawRows.set(row.user_id, {
        user_id: row.user_id,
        online: !!row.online,
        last_seen: row.last_seen,
        top: Number(row.top ?? 0.5),
        left: Number(row.left ?? 0.5),
        lat: row.lat ?? null,
        lng: row.lng ?? null,
      });
    }
  }
  emit();
}

export function subscribePresence(onSnapshot: (rows: PresenceRow[]) => void): () => void {
  snapshotListeners.add(onSnapshot);
  activeSubscribers++;
  onSnapshot(buildSnapshot());
  void initialFetch();

  if (!channel) {
    openPresenceChannel();
  }

  startPresenceReconcileTimer();

  const offAuth = onUserIdChange((id) => {
    if (id) {
      void initialFetch();
    } else {
      lastFetchedUserId = null;
      rawRows.clear();
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
      stopPresenceReconcileTimer();
    }
  };
}

// --- Stage 0 safety net ---------------------------------------------------

let lastPresenceActivityAt = Date.now();
function markPresenceActivity() {
  lastPresenceActivityAt = Date.now();
}

const PRESENCE_RECONCILE_INTERVAL_MS = 60_000;
const PRESENCE_RECONCILE_SILENCE_MS = 45_000;
let presenceReconcileTimer: ReturnType<typeof setInterval> | null = null;

function startPresenceReconcileTimer() {
  if (presenceReconcileTimer) return;
  presenceReconcileTimer = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (Date.now() - lastPresenceActivityAt < PRESENCE_RECONCILE_SILENCE_MS) return;
    void initialFetch(true);
  }, PRESENCE_RECONCILE_INTERVAL_MS);
}
function stopPresenceReconcileTimer() {
  if (presenceReconcileTimer) {
    clearInterval(presenceReconcileTimer);
    presenceReconcileTimer = null;
  }
}

let presenceBackoffMs = 1000;
let presenceBackoffTimer: ReturnType<typeof setTimeout> | null = null;
const PRESENCE_MAX_BACKOFF_MS = 30_000;

function schedulePresenceReconnect() {
  if (presenceBackoffTimer) return;
  const delay = presenceBackoffMs;
  presenceBackoffMs = Math.min(PRESENCE_MAX_BACKOFF_MS, presenceBackoffMs * 2);
  setChannelHealth("presence", "reconnecting");
  presenceBackoffTimer = setTimeout(() => {
    presenceBackoffTimer = null;
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
    openPresenceChannel();
  }, delay);
}

function openPresenceChannel() {
  channel = supabase
    .channel("doctor_presence_changes")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) => {
      markPresenceActivity();
      applyPresencePayload(payload);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        presenceBackoffMs = 1000;
        if (presenceBackoffTimer) {
          clearTimeout(presenceBackoffTimer);
          presenceBackoffTimer = null;
        }
        setChannelHealth("presence", "ok");
        markPresenceActivity();
        // Reconcile on (re)connect so any updates missed while down are picked up.
        void initialFetch(true);
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        schedulePresenceReconnect();
      }
    });
}



/** Upsert my presence row. No-op if not signed in. */
export async function upsertMyPresence(fields: {
  online: boolean;
  top?: number;
  left?: number;
  lat?: number | null;
  lng?: number | null;
}): Promise<void> {
  const uid = getCurrentUserIdSync();
  if (!uid) return;
  const row: {
    user_id: string;
    online: boolean;
    last_seen: string;
    top?: number;
    left?: number;
    lat?: number | null;
    lng?: number | null;
  } = {
    user_id: uid,
    online: fields.online,
    last_seen: new Date().toISOString(),
  };
  if (fields.top !== undefined) row.top = fields.top;
  if (fields.left !== undefined) row.left = fields.left;
  if (fields.lat !== undefined) row.lat = fields.lat;
  if (fields.lng !== undefined) row.lng = fields.lng;

  // Optimistic local cache update so toggling client gets instant feedback.
  const existing = rawRows.get(uid);
  rawRows.set(uid, {
    user_id: uid,
    online: fields.online,
    top: fields.top ?? existing?.top ?? 0.5,
    left: fields.left ?? existing?.left ?? 0.5,
    lat: fields.lat !== undefined ? fields.lat : existing?.lat ?? null,
    lng: fields.lng !== undefined ? fields.lng : existing?.lng ?? null,
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
    await upsertMyPresence({ online });
  }
}

/** Mark me offline (e.g. on sign-out / explicit toggle / unload). */
export async function clearMyPresence(): Promise<void> {
  const uid = getCurrentUserIdSync();
  if (!uid) return;
  await clearMyPresenceForUser(uid);
}

/** Mark a specific user offline. Used by sign-out paths where auth.uid()
 *  may already have been cleared by the time we get here. */
export async function clearMyPresenceForUser(uid: string): Promise<void> {
  if (!uid) return;
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
