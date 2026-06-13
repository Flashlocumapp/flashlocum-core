import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type VerificationStatus = "pending" | "approved" | "suspended" | "rejected";
const ALLOWED: VerificationStatus[] = ["pending", "approved", "suspended", "rejected"];

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/** Server-authoritative admin gate. Returns true only if the calling user has the 'admin' role. */
export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) throw new Error(error.message);
    return { isAdmin: !!data };
  });

/** Update a doctor's verification status. Server-side admin check; runs as the signed-in admin so DB triggers allow the change. */
export const updateDoctorVerificationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { doctorId: string; status: VerificationStatus }) => {
    if (!isUuid(input?.doctorId)) throw new Error("Invalid doctor id");
    if (!ALLOWED.includes(input?.status)) throw new Error("Invalid status");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { data: updated, error } = await context.supabase
      .from("profiles")
      .update({ verification_status: data.status })
      .eq("id", data.doctorId)
      .select("id, verification_status")
      .single();
    if (error) throw new Error(error.message);
    if (updated.verification_status !== data.status) {
      throw new Error("Verification status did not change.");
    }

    // Notify the doctor of the verification decision.
    try {
      const { sendPushToUser } = await import("@/lib/push.server");
      const titleByStatus: Record<VerificationStatus, string> = {
        approved: "You're approved",
        rejected: "Verification update",
        suspended: "Account suspended",
        pending: "Verification pending",
      };
      const bodyByStatus: Record<VerificationStatus, string> = {
        approved: "You can now accept shifts on FlashLocum.",
        rejected: "Your verification was not approved. Open the app for details.",
        suspended: "Your account has been suspended. Contact support.",
        pending: "Your account is back under review.",
      };
      await sendPushToUser(data.doctorId, {
        title: titleByStatus[data.status],
        body: bodyByStatus[data.status],
        data: { type: "verification_status", status: data.status },
      });
    } catch (e) {
      console.warn("[verify-notify] push failed:", (e as Error).message);
    }

    return { ok: true };
  });

export type AdminShiftRow = {
  id: string;
  status: string;
  requester_id: string;
  accepted_by: string | null;
  hospital: string;
  area: string;
  coverage_type: string;
  day: string;
  start_time: string;
  end_time: string;
  start_ts: number | null;
  end_ts: number | null;
  duration_hrs: number;
  amount: number;
  fee_pct: number;
  payment_status: string | null;
  cancelled_by: string | null;
  started_at: number | null;
  created_at: string;
  updated_at: string;
  requester_name: string | null;
  requester_email: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
};

/** Admin-only: list all coverage_requests with requester/doctor names joined.
 * Uses service role because coverage_requests RLS does not grant admin reads. */
export const adminListShifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string; limit?: number } | undefined) => ({
    status: input?.status,
    limit: Math.min(Math.max(input?.limit ?? 500, 1), 1000),
  }))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("coverage_requests")
      .select(
        "id,status,requester_id,accepted_by,hospital,area,coverage_type,day,start_time,end_time,start_ts,end_ts,duration_hrs,amount,fee_pct,payment_status,cancelled_by,started_at,created_at,updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status && data.status !== "all") {
      query = query.eq("status", data.status);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const shifts = rows ?? [];

    // Hydrate profile lookups in two batches (requesters + accepted doctors).
    const ids = new Set<string>();
    for (const r of shifts) {
      ids.add(r.requester_id);
      if (r.accepted_by) ids.add(r.accepted_by);
    }
    const idList = Array.from(ids);
    const profileMap = new Map<
      string,
      { full_name: string | null; phone: string | null }
    >();
    let emailMap = new Map<string, string | null>();
    if (idList.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", idList);
      for (const p of profs ?? []) {
        profileMap.set(p.id, { full_name: p.full_name, phone: p.phone });
      }
      try {
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        emailMap = new Map(
          (usersData?.users ?? []).map((u) => [u.id, u.email ?? null]),
        );
      } catch {
        /* email enrichment is best-effort */
      }
    }

    const out: AdminShiftRow[] = shifts.map((r) => {
      const req = profileMap.get(r.requester_id);
      const doc = r.accepted_by ? profileMap.get(r.accepted_by) : undefined;
      return {
        ...r,
        requester_name: req?.full_name ?? null,
        requester_email: emailMap.get(r.requester_id) ?? null,
        doctor_name: doc?.full_name ?? null,
        doctor_phone: doc?.phone ?? null,
      };
    });
    return out;
  });
