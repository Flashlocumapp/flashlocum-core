// Server functions that combine a state change with a push notification.
// Keeping these out of presence/coverage modules avoids pulling server-only
// code into the realtime client.
//
// Audit-10 contract:
//   - Push bodies use the real actor name (doctor full_name / requester
//     hospital). Generic "the doctor" / "the hospital" wording is a data bug.
//   - `version` is the row's `updated_at` epoch ms so the foreground push
//     re-ingest collapses cleanly with the realtime/local emit of the same
//     event (single outcome per recipient).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

function rowVersion(updatedAt: string | null | undefined): number {
  if (!updatedAt) return Date.now();
  const t = Date.parse(updatedAt);
  return Number.isFinite(t) ? t : Date.now();
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
          .select("requester_id, hospital, updated_at")
          .eq("id", data.requestId)
          .maybeSingle(),
        supabaseAdmin.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      ]);
      if (req?.requester_id) {
        const { sendPushToUser } = await import("@/lib/push.server");
        const doctorName = doc?.full_name ?? "your doctor";
        const version = rowVersion(req.updated_at as string | null);
        const extras: Record<string, string> = {
          type: "coverage_accepted",
          requestId: data.requestId,
          doctorName,
        };
        if (req.hospital) extras.hospitalName = req.hospital;
        await sendPushToUser(req.requester_id, {
          title: "Request accepted",
          body: `Dr. ${doctorName} accepted your request.`,
          kind: "offer.accepted",
          entityId: data.requestId,
          version,
          occurredAt: version,
          audience: "requester",
          data: extras,
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

    // Re-read to get the post-update row timestamp for version stability.
    const { data: afterRow } = await supabaseAdmin
      .from("coverage_requests")
      .select("updated_at")
      .eq("id", data.requestId)
      .maybeSingle();
    const version = rowVersion(afterRow?.updated_at as string | null);

    try {
      const notifyUserId = actor === "doctor" ? row.requester_id : row.accepted_by;
      if (notifyUserId) {
        // Fetch the actor's display name so the push body names them.
        let doctorName: string | undefined;
        if (actor === "doctor" && row.accepted_by) {
          const { data: doc } = await supabaseAdmin
            .from("profiles")
            .select("full_name")
            .eq("id", row.accepted_by)
            .maybeSingle();
          doctorName = doc?.full_name ?? undefined;
        }
        const hospital = row.hospital ?? "the hospital";
        const body =
          actor === "doctor"
            ? `Dr. ${doctorName ?? "your doctor"} cancelled the shift.`
            : `${hospital} cancelled the shift.`;
        const { sendPushToUser } = await import("@/lib/push.server");
        const cancelExtras: Record<string, string> = {
          type: "coverage_cancelled",
          requestId: data.requestId,
        };
        if (doctorName) cancelExtras.doctorName = doctorName;
        if (row.hospital) cancelExtras.hospitalName = row.hospital;
        await sendPushToUser(notifyUserId, {
          title: "Shift cancelled",
          body,
          kind: "shift.cancelled",
          entityId: data.requestId,
          version,
          occurredAt: version,
          audience: actor === "doctor" ? "requester" : "doctor",
          data: cancelExtras,
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
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Use service-role RPC to avoid RLS edge cases on lifecycle starts.
    let alreadyStarted = false;
    const { error } = await supabaseAdmin.rpc("start_shift", { _request_id: data.requestId });
    if (error) {
      if (/already started/i.test(error.message)) {
        alreadyStarted = true;
      } else {
        throw new Error(error.message);
      }
    }

    // Read the server-authoritative started_at (bigint epoch ms on the row).
    const { data: row } = await supabaseAdmin
      .from("coverage_requests")
      .select("started_at, accepted_by, hospital, requester_id, updated_at")
      .eq("id", data.requestId)
      .maybeSingle();
    const startedAtMs = row?.started_at != null ? Number(row.started_at) : null;
    const version = rowVersion(row?.updated_at as string | null);

    // Fire-and-forget push to the doctor (skip on idempotent already-started).
    if (!alreadyStarted && row?.accepted_by) {
      try {
        const hospital = row.hospital ?? "the hospital";
        const { sendPushToUser } = await import("@/lib/push.server");
        await sendPushToUser(row.accepted_by, {
          title: "Shift started",
          body: `Your shift with ${hospital} has started.`,
          kind: "shift.started",
          entityId: data.requestId,
          version,
          occurredAt: startedAtMs ?? version,
          audience: "doctor",
          data: (() => {
            const e: Record<string, string> = {
              type: "shift_started",
              requestId: data.requestId,
            };
            if (row.hospital) e.hospitalName = row.hospital;
            return e;
          })(),
        });
      } catch (e) {
        console.warn("[start-notify] push failed:", (e as Error).message);
      }
    }

    return { ok: true as const, alreadyStarted, startedAtMs };
  });
