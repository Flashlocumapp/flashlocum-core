import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Account-deletion gate + executor.
 *
 * Eligibility rules (per FlashLocum Help Center spec):
 *   - No active shift (status in: accepted, active, paused) on either side.
 *   - No upcoming accepted shift (same set — accepted/active/paused covers both
 *     in-progress and future-accepted on coverage_requests).
 *   - No outstanding payment obligation (completed coverage_requests where
 *     payment_status != 'paid' on the requester side; doctor side has no
 *     direct obligation but we still block if any accepted_by shift is
 *     completed-but-unpaid since the payout depends on settlement).
 *   - No unresolved platform dispute (no dispute table yet — placeholder
 *     always returns 0; wired so the gate can pick it up the moment such a
 *     table lands).
 */

export type DeleteEligibility = {
  ok: boolean;
  active_shifts: number;
  upcoming_shifts: number;
  outstanding_payments: number;
  open_disputes: number;
  reason: string | null;
};

const OPEN_STATUSES = ["accepted", "active", "paused"] as const satisfies readonly (
  "accepted" | "active" | "paused"
)[];

export const checkAccountDeleteEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DeleteEligibility> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    // Active / upcoming shifts: on either side.
    const [reqActive, docActive] = await Promise.all([
      supabaseAdmin
        .from("coverage_requests")
        .select("id, status, start_ts", { count: "exact", head: false })
        .eq("requester_id", uid)
        .in("status", [...OPEN_STATUSES]),
      supabaseAdmin
        .from("coverage_requests")
        .select("id, status, start_ts", { count: "exact", head: false })
        .eq("accepted_by", uid)
        .in("status", [...OPEN_STATUSES]),
    ]);

    const nowMs = Date.now();
    type Row = { status: string | null; start_ts: string | null };
    const all: Row[] = [...((reqActive.data ?? []) as Row[]), ...((docActive.data ?? []) as Row[])];
    let activeCount = 0;
    let upcomingCount = 0;
    for (const r of all) {
      const startMs = r.start_ts ? Date.parse(r.start_ts) : NaN;
      const isFuture = Number.isFinite(startMs) && startMs > nowMs;
      if (r.status === "active" || r.status === "paused") activeCount += 1;
      else if (r.status === "accepted") {
        if (isFuture) upcomingCount += 1;
        else activeCount += 1;
      }
    }

    // Outstanding payments: completed shifts that aren't fully paid.
    const [reqUnpaid, docUnpaid] = await Promise.all([
      supabaseAdmin
        .from("coverage_requests")
        .select("id, payment_status")
        .eq("requester_id", uid)
        .eq("status", "completed")
        .neq("payment_status", "paid"),
      supabaseAdmin
        .from("coverage_requests")
        .select("id, payment_status")
        .eq("accepted_by", uid)
        .eq("status", "completed")
        .neq("payment_status", "paid"),
    ]);
    const outstanding = (reqUnpaid.data?.length ?? 0) + (docUnpaid.data?.length ?? 0);

    // Disputes: no table yet — placeholder.
    const disputes = 0;

    let reason: string | null = null;
    if (activeCount > 0) {
      reason = "You have a shift in progress. Please complete it before deleting your account.";
    } else if (upcomingCount > 0) {
      reason =
        "You have an upcoming accepted shift. Please cancel or complete it before deleting your account.";
    } else if (outstanding > 0) {
      reason =
        "You have outstanding payment obligations. Please settle them before deleting your account.";
    } else if (disputes > 0) {
      reason =
        "You have an unresolved platform dispute. Please contact support to resolve it before deleting your account.";
    }

    return {
      ok: reason === null,
      active_shifts: activeCount,
      upcoming_shifts: upcomingCount,
      outstanding_payments: outstanding,
      open_disputes: disputes,
      reason,
    };
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;

    // Re-check eligibility on the server — never trust the client.
    const nowMs = Date.now();
    const [reqOpen, docOpen, reqUnpaid, docUnpaid] = await Promise.all([
      supabaseAdmin
        .from("coverage_requests")
        .select("id, status, start_ts")
        .eq("requester_id", uid)
        .in("status", [...OPEN_STATUSES]),
      supabaseAdmin
        .from("coverage_requests")
        .select("id, status, start_ts")
        .eq("accepted_by", uid)
        .in("status", [...OPEN_STATUSES]),
      supabaseAdmin
        .from("coverage_requests")
        .select("id")
        .eq("requester_id", uid)
        .eq("status", "completed")
        .neq("payment_status", "paid"),
      supabaseAdmin
        .from("coverage_requests")
        .select("id")
        .eq("accepted_by", uid)
        .eq("status", "completed")
        .neq("payment_status", "paid"),
    ]);

    const blockingShifts = [...(reqOpen.data ?? []), ...(docOpen.data ?? [])];
    const unpaid = (reqUnpaid.data?.length ?? 0) + (docUnpaid.data?.length ?? 0);
    if (blockingShifts.length > 0 || unpaid > 0) {
      throw new Error(
        "Account deletion is unavailable: you have active shifts or outstanding payments.",
      );
    }

    // Log deletion for admin review (best-effort — never block deletion on it).
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name, role")
        .eq("id", uid)
        .maybeSingle();
      let email: string | null = null;
      try {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
        email = u?.user?.email ?? null;
      } catch {
        /* best-effort */
      }
      // Use admin_audit_log if it exists; otherwise console.warn.
      const audit = await supabaseAdmin.from("admin_audit_log" as never).insert({
        actor_id: uid,
        action: "account.delete",
        target_id: uid,
        payload: {
          full_name: prof?.full_name ?? null,
          role: prof?.role ?? null,
          email,
          at: new Date(nowMs).toISOString(),
        },
      } as never);
      if (audit.error) {
        console.warn("[account-delete] audit insert failed:", audit.error.message);
      }
    } catch (e) {
      console.warn("[account-delete] audit logging failed:", e);
    }

    // Permanent removal of auth identity. Cascading FKs on public.profiles
    // (and related tables) handle the rest.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
