import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchVerificationStatus,
  getCachedProfile,
  getCachedVerificationStatus,
  type VerificationStatus,
} from "@/lib/profile-remote";

// Module-level cache — keeps last-known status across tab switches so the
// UI does NOT flash "Pending" while the backend re-fetches on remount.
let cached: VerificationStatus | null = getCachedVerificationStatus();
const listeners = new Set<(s: VerificationStatus) => void>();
function setCached(next: VerificationStatus) {
  cached = next;
  listeners.forEach((l) => l(next));
}

/**
 * Seed value used at hook init. Prefers the live profile cache, then the
 * localStorage-persisted value, so the very first render shows the correct
 * status across sign-out / sign-in and full reloads.
 */
function seedStatus(): VerificationStatus | null {
  if (cached) return cached;
  const p = getCachedProfile();
  if (p && p.verification_status) {
    cached = p.verification_status;
    return cached;
  }
  const persisted = getCachedVerificationStatus();
  if (persisted) {
    cached = persisted;
    return cached;
  }
  return null;
}

/**
 * useVerificationStatus — subscribes to the current user's verification
 * status with realtime updates. Returns null until the real backend status
 * is known, so callers can defer rendering a placeholder ("Pending") that
 * might be wrong on first paint.
 */
export function useVerificationStatus(): VerificationStatus | null {
  const [status, setStatus] = useState<VerificationStatus | null>(() => seedStatus());

  useEffect(() => {
    let cancelled = false;
    const wrapped = (s: VerificationStatus) => setStatus(s);
    listeners.add(wrapped);
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      if (!cached) {
        const seed = seedStatus();
        if (seed && !cancelled) setStatus(seed);
      }
      const s = await fetchVerificationStatus();
      if (cancelled) return;
      if (s !== cached) setCached(s);

      const { data: u } = await supabase.auth.getUser();
      if (!u.user || cancelled) return;
      channel = supabase
        .channel(`profile-verification-${u.user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${u.user.id}`,
          },
          (payload) => {
            const next = (payload.new as { verification_status?: VerificationStatus })
              ?.verification_status;
            if (next) setCached(next);
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      listeners.delete(wrapped);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return status;
}
