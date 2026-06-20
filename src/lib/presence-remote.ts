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

/** Presence rows older than this are treated as offline / stale. */
const STALE_MS = 60 * 1000;

function buildSnapshot(): PresenceRow[] {
  const now = Date.now();
  const out: PresenceRow[] = [];
  for (const r of rawRows.values()) {
    const lastSeenMs = r.last_seen ? new Date(r.last_seen).getTime() : 0;
    const fresh = now - lastSeenMs < STALE_MS;
    if (!r.online || !fresh) continue;
    out.push({
      user_id: r.user_id,
      online: true,
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
    channel = supabase
      .channel("doctor_presence_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload) =>
        applyPresencePayload(payload),
      )
      .subscribe();
  }

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
    }
  };
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
