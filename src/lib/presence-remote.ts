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

const TABLE = "doctor_presence";

let channel: ReturnType<typeof supabase.channel> | null = null;
let profilesChannel: ReturnType<typeof supabase.channel> | null = null;

// Raw caches — backend truth.
const rawRows = new Map<string, PresenceRow>();
const approvedIds = new Set<string>();

const snapshotListeners = new Set<(rows: PresenceRow[]) => void>();
let activeSubscribers = 0;

/** Presence rows older than this are treated as offline / stale. */
const STALE_MS = 2 * 60 * 1000;

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

async function initialFetch() {
  const auth = await ensureAuthReady();
  if (!auth.userId) return;
  const [presenceRes, approvedRes] = await Promise.all([
    supabase.from(TABLE).select("user_id, online, top, left, last_seen"),
    supabase.from("profiles").select("id").eq("verification_status", "approved"),
  ]);
  if (presenceRes.error) {
    console.warn("[presence-remote] fetch error:", presenceRes.error.message);
  } else {
    rawRows.clear();
    for (const r of presenceRes.data ?? []) {
      rawRows.set(r.user_id, r as PresenceRow);
    }
  }
  if (!approvedRes.error) {
    approvedIds.clear();
    for (const p of approvedRes.data ?? []) approvedIds.add((p as any).id);
  }
  emit();
}

function applyPresencePayload(payload: any) {
  const evt = payload.eventType ?? payload.event;
  if (evt === "DELETE") {
    const id = payload.old?.user_id;
    if (id) rawRows.delete(id);
  } else {
    const row = payload.new as PresenceRow | undefined;
    if (row?.user_id) rawRows.set(row.user_id, row);
  }
  emit();
}

function applyProfilePayload(payload: any) {
  const evt = payload.eventType ?? payload.event;
  if (evt === "DELETE") {
    const id = payload.old?.id;
    if (id) {
      approvedIds.delete(id);
      rawRows.delete(id);
    }
  } else {
    const row = payload.new as { id: string; verification_status: string } | undefined;
    if (row?.id) {
      if (row.verification_status === "approved") approvedIds.add(row.id);
      else {
        approvedIds.delete(row.id);
        rawRows.delete(row.id);
      }
    }
  }
  emit();
}

export function subscribePresence(
  onSnapshot: (rows: PresenceRow[]) => void,
): () => void {
  snapshotListeners.add(onSnapshot);
  activeSubscribers++;
  // Emit current cache synchronously so subscriber gets instant data.
  onSnapshot(buildSnapshot());
  void initialFetch();

  if (!channel) {
    channel = supabase
      .channel("doctor_presence_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE },
        (payload) => applyPresencePayload(payload),
      )
      .subscribe();
  }
  if (!profilesChannel) {
    profilesChannel = supabase
      .channel("profiles_verification_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload) => applyProfilePayload(payload),
      )
      .subscribe();
  }

  const offAuth = onUserIdChange((id) => {
    if (id) void initialFetch();
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
      if (profilesChannel) {
        supabase.removeChannel(profilesChannel);
        profilesChannel = null;
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

  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: "user_id" });

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
