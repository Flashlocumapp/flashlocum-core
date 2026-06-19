// Server functions that combine a state change with a push notification.
// Keeping these out of presence/coverage modules avoids pulling server-only
// code into the realtime client.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
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
          kind: "offer.accepted",
          entityId: data.requestId,
          version: Date.now(),
          occurredAt: Date.now(),
          audience: "requester",
          data: { type: "coverage_accepted", requestId: data.requestId },
        });
      }
    } catch (e) {
      console.warn("[claim-notify] push failed:", (e as Error).message);
    }

    return { won: true };
  });

/**
 * Cancel an owned coverage request with server-side authorization. This avoids
 * silent zero-row browser updates when RLS filters the row out of the PATCH.
 */
export const cancelAndNotifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string; reason?: string }) => {
    if (!isUuid(input?.requestId)) throw new Error("Invalid request id");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: readError } = await supabaseAdmin
      .from("coverage_requests")
      .select("id, requester_id, accepted_by, status, cancelled_by, hospital")
      .eq("id", data.requestId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!row) return { ok: false, reason: "missing" as const };

    const actor =
      row.accepted_by === userId ? "doctor" : row.requester_id === userId ? "requester" : null;
    if (!actor) throw new Error("Not authorized");
    if (row.status === "cancelled") return { ok: true, cancelledBy: row.cancelled_by ?? actor };

    const { error: updateError } = await supabaseAdmin
      .from("coverage_requests")
      .update({ status: "cancelled", cancelled_by: actor })
      .eq("id", data.requestId);
    if (updateError) throw new Error(updateError.message);

    try {
      const notifyUserId = actor === "doctor" ? row.requester_id : row.accepted_by;
      if (notifyUserId) {
        const { sendPushToUser } = await import("@/lib/push.server");
        await sendPushToUser(notifyUserId, {
          title: "Shift cancelled",
          body: `${actor === "doctor" ? "The doctor" : "The requester"} cancelled${row.hospital ? ` the shift at ${row.hospital}` : " this shift"}.`,
          data: { type: "coverage_cancelled", requestId: data.requestId },
        });
      }
    } catch (e) {
      console.warn("[cancel-notify] push failed:", (e as Error).message);
    }

    return { ok: true, cancelledBy: actor };
  });

/**
 * Start a shift (calls start_shift RPC) AND push the assigned doctor so they
 * see the active timer even if the app is backgrounded. Returns the
 * server-authoritative `started_at_ms` for the client to anchor its timer on.
 */
export const startAndNotifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) => {
    if (!isUuid(input?.requestId)) throw new Error("Invalid request id");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let alreadyStarted = false;
    const { error } = await supabase.rpc("start_shift", { _request_id: data.requestId });
    if (error) {
      if (/already started/i.test(error.message)) {
        alreadyStarted = true;
      } else {
        throw new Error(error.message);
      }
    }

    // Read the server-authoritative started_at (bigint epoch ms on the row).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("coverage_requests")
      .select("started_at, accepted_by, hospital, requester_id")
      .eq("id", data.requestId)
      .maybeSingle();
    const startedAtMs = row?.started_at != null ? Number(row.started_at) : null;

    // Fire-and-forget push to the doctor (skip on idempotent already-started).
    if (!alreadyStarted && row?.accepted_by) {
      try {
        const { data: requester } = await supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", userId)
          .maybeSingle();
        const { sendPushToUser } = await import("@/lib/push.server");
        await sendPushToUser(row.accepted_by, {
          title: "Shift started",
          body: `${requester?.full_name ?? "The requester"} started your shift${row.hospital ? ` at ${row.hospital}` : ""}.`,
          data: { type: "shift_started", requestId: data.requestId },
        });
      } catch (e) {
        console.warn("[start-notify] push failed:", (e as Error).message);
      }
    }

    return { ok: true as const, alreadyStarted, startedAtMs };
  });
