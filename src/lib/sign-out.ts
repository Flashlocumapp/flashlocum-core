// Sign-out path that guarantees the doctor's presence row flips to offline
// BEFORE the Supabase session is torn down. Without this, the SIGNED_OUT
// auth event fires after auth.uid() is already null, so the presence write
// is a no-op and the doctor appears "online" to other requesters until the
// 60s freshness window expires.

import { supabase } from "@/integrations/supabase/client";
import { clearMyPresenceForUser } from "./presence-remote";
import { getCurrentUserIdSync } from "./coverage-remote";

export async function signOutAndClearPresence(): Promise<void> {
  let uid: string | null = null;
  try {
    uid = getCurrentUserIdSync();
    if (!uid) {
      const { data } = await supabase.auth.getUser();
      uid = data.user?.id ?? null;
    }
  } catch {
    /* best-effort */
  }
  if (uid) {
    try {
      await clearMyPresenceForUser(uid);
    } catch {
      /* best-effort: do not block sign-out */
    }
  }
  await supabase.auth.signOut();
}
