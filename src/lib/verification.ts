import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchVerificationStatus, type VerificationStatus } from "@/lib/profile-remote";

// Module-level cache — keeps last-known status across tab switches so the
// UI does NOT flash "Pending" while the backend re-fetches on remount.
let cached: VerificationStatus | null = null;
const listeners = new Set<(s: VerificationStatus) => void>();
function setCached(next: VerificationStatus) {
  cached = next;
  listeners.forEach((l) => l(next));
}

/**
 * useVerificationStatus — subscribes to the current user's verification status
 * with realtime updates. Initial value comes from the module cache so tab
 * switches do not flicker.
 */
export function useVerificationStatus(): VerificationStatus {
  const [status, setStatus] = useState<VerificationStatus>(cached ?? "pending");

  useEffect(() => {
    let cancelled = false;
    listeners.add(setStatus);
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
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
      listeners.delete(setStatus);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return status;
}
