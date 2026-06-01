import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchVerificationStatus, type VerificationStatus } from "@/lib/profile-remote";

/**
 * useVerificationStatus — subscribes to the current user's verification status
 * with realtime updates. Default: "pending" until a profile row is loaded.
 */
export function useVerificationStatus(): VerificationStatus {
  const [status, setStatus] = useState<VerificationStatus>("pending");

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const s = await fetchVerificationStatus();
      if (!cancelled) setStatus(s);

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
            if (next) setStatus(next);
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return status;
}
