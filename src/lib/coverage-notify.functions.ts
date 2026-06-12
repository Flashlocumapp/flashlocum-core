// Server functions that combine a state change with a push notification.
// Keeping these out of presence/coverage modules avoids pulling server-only
// code into the realtime client.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Claim a searching coverage request (RLS-safe RPC) and, on success, push
 * the requester so they see the acceptance even if the app is backgrounded.
 */
export const claimAndNotifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => {
    if (!isUuid(input?.requestId)) throw new Error("Invalid request id");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: won, error } = await supabase.rpc("claim_coverage_request", {
      _request_id: data.requestId,
    });
    if (error) throw new Error(error.message);
    if (!won) return { won: false };

    // Fire-and-forget notify; never let push failure break the claim.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: req }, { data: doc }] = await Promise.all([
        supabaseAdmin
          .from("coverage_requests")
          .select("requester_id, hospital")
          .eq("id", data.requestId)
          .maybeSingle(),
        supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      ]);
      if (req?.requester_id) {
        const { sendPushToUser } = await import("@/lib/push.server");
        await sendPushToUser(req.requester_id, {
          title: "Shift accepted",
          body: `${doc?.full_name ?? "A doctor"} accepted your shift${req.hospital ? ` at ${req.hospital}` : ""}.`,
          data: { type: "coverage_accepted", requestId: data.requestId },
        });
      }
    } catch (e) {
      console.warn("[claim-notify] push failed:", (e as Error).message);
    }

    return { won: true };
  });
