// Supabase-backed doctor presence.
//
// Stores each doctor's online flag, last-seen heartbeat, and stable map
// position as a row in `doctor_presence`. All clients subscribe to realtime
// changes so that requesters immediately see doctors come online / go
// offline, and the dispatch map reflects the true backend state.

import { supabase } from "@/integrations/supabase/client";
import { onUserIdChange, getCurrentUserIdSync } from "./coverage-remote";

export type PresenceRow = {
  user_id: string;
  online: boolean;
  top: number;
  left: number;
  last_seen: string;
};

const TABLE = "doctor_presence";

let channel: ReturnType<typeof supabase.channel> | null = null;
let cachedRows: PresenceRow[] = [];
const snapshotListeners = new Set<(rows: PresenceRow[]) => void>();
let activeSubscribers = 0;

async function fetchAll(): Promise<PresenceRow[]> {
  const { data, error } = await supabase.from(TABLE).select("*");
  if (error) {
    console.warn("[presence-remote] fetch error:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    user_id: r.user_id,
    online: !!r.online,
    top: Number(r.top ?? 0.5),
    left: Number(r.left ?? 0.5),
    last_seen: r.last_seen,
  }));
}

async function refreshSnapshot() {
  cachedRows = await fetchAll();
  snapshotListeners.forEach((fn) => fn(cachedRows));
}

export function subscribePresence(
  onSnapshot: (rows: PresenceRow[]) => void,
): () => void {
  snapshotListeners.add(onSnapshot);
  activeSubscribers++;
  refreshSnapshot();

  if (!channel) {
    channel = supabase
      .channel("doctor_presence_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE },
        () => {
          refreshSnapshot();
        },
      )
      .subscribe();
  }

  const offAuth = onUserIdChange(() => {
    refreshSnapshot();
  });

  return () => {
    snapshotListeners.delete(onSnapshot);
    offAuth();
    activeSubscribers--;
    if (activeSubscribers === 0 && channel) {
      supabase.removeChannel(channel);
      channel = null;
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
  const row: Record<string, unknown> = {
    user_id: uid,
    online: fields.online,
    last_seen: new Date().toISOString(),
  };
  if (fields.top !== undefined) row.top = fields.top;
  if (fields.left !== undefined) row.left = fields.left;
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
  await supabase.from(TABLE).update({ online: false, last_seen: new Date().toISOString() }).eq("user_id", uid);
}
