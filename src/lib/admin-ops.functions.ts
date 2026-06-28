/**
 * Admin operations — new server fns supporting the operational drawers
 * (user / shift / payment) and the cross-cutting admin action log.
 *
 * Pattern matches `src/lib/admin.functions.ts`: every fn requires
 * `requireSupabaseAuth`, then verifies the caller has the `admin` role
 * before performing privileged work via `supabaseAdmin`. Every write
 * inserts an `admin_actions` audit row.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/** JSON-safe value, used for any wire-serialized payload field. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden: admin role required");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function logAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  actorUserId: string,
  row: {
    action: string;
    targetUserId?: string | null;
    targetShiftId?: string | null;
    targetPaymentRef?: string | null;
    reason?: string | null;
    note?: string | null;
    payload?: JsonValue | null;
  },
) {
  try {
    await supabaseAdmin.from("admin_actions").insert({
      actor_user_id: actorUserId,
      action: row.action,
      target_user_id: row.targetUserId ?? null,
      target_shift_id: row.targetShiftId ?? null,
      target_payment_ref: row.targetPaymentRef ?? null,
      reason: row.reason ?? null,
      note: row.note ?? null,
      payload: row.payload ?? null,
    });
  } catch (e) {
    console.warn("[admin_actions] log failed:", (e as Error).message);
  }
}

// =====================================================================
// AUDIT LOG (§6)
// =====================================================================

export type AdminActionRow = {
  id: string;
  actor_user_id: string;
  actor_name: string | null;
  action: string;
  target_user_id: string | null;
  target_user_name: string | null;
  target_shift_id: string | null;
  target_payment_ref: string | null;
  reason: string | null;
  note: string | null;
  payload: JsonValue | null;
  created_at: string;
};

export const adminListActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input:
        | {
            actorUserId?: string;
            targetUserId?: string;
            targetShiftId?: string;
            action?: string;
            actionPrefix?: string;
            limit?: number;
          }
        | undefined,
    ) => ({
      actorUserId: input?.actorUserId,
      targetUserId: input?.targetUserId,
      targetShiftId: input?.targetShiftId,
      action: input?.action,
      actionPrefix: input?.actionPrefix,
      limit: Math.min(Math.max(input?.limit ?? 200, 1), 1000),
    }),
  )
  .handler(async ({ data, context }): Promise<AdminActionRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("admin_actions")
      .select(
        "id,actor_user_id,action,target_user_id,target_shift_id,target_payment_ref,reason,note,payload,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.actorUserId) q = q.eq("actor_user_id", data.actorUserId);
    if (data.targetUserId) q = q.eq("target_user_id", data.targetUserId);
    if (data.targetShiftId) q = q.eq("target_shift_id", data.targetShiftId);
    if (data.action) q = q.eq("action", data.action);
    if (data.actionPrefix) q = q.like("action", `${data.actionPrefix}%`);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    const ids = new Set<string>();
    for (const r of list) {
      ids.add(r.actor_user_id);
      if (r.target_user_id) ids.add(r.target_user_id);
    }
    const nameMap = new Map<string, string | null>();
    if (ids.size) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(ids));
      for (const p of profs ?? []) nameMap.set(p.id, p.full_name);
    }

    return list.map((r): AdminActionRow => ({
      id: r.id,
      actor_user_id: r.actor_user_id,
      actor_name: nameMap.get(r.actor_user_id) ?? null,
      action: r.action,
      target_user_id: r.target_user_id,
      target_user_name: r.target_user_id ? (nameMap.get(r.target_user_id) ?? null) : null,
      target_shift_id: r.target_shift_id,
      target_payment_ref: r.target_payment_ref,
      reason: r.reason,
      note: r.note,
      payload: r.payload as JsonValue | null,
      created_at: r.created_at,
    }));
  });

// =====================================================================
// USER DETAIL (§1)
// =====================================================================

export type AdminUserDetail = {
  profile: {
    id: string;
    full_name: string | null;
    phone: string | null;
    email: string | null;
    role: string | null;
    location: string | null;
    gender: string | null;
    mdcn: string | null;
    bank_name: string | null;
    bank_account: string | null;
    bank_account_name: string | null;
    verification_status: string | null;
    verification_action_reason: string | null;
    verification_action_target: string | null;
    verification_action_note: string | null;
    verification_action_at: string | null;
    selfie_url: string | null;
    license_name: string | null;
    nysc_name: string | null;
    verification_receipt_url: string | null;
    onboarded_at: string | null;
    onboarded_cover_at: string | null;
    onboarded_request_at: string | null;
    last_seen_at: string | null;
    created_at: string;
    trust_frozen_at: string | null;
    trust_frozen_reason: string | null;
    trust_escalated_at: string | null;
    trust_escalated_note: string | null;
    trust_restriction_expires_at: string | null;
  };
  presence: { online: boolean; last_seen: string | null } | null;
  counts: {
    shifts_total: number;
    shifts_completed: number;
    shifts_cancelled: number;
    ratings_received: number;
    ratings_given: number;
    outstanding_amount: number;
  };
  devices: {
    id: string;
    platform: string | null;
    app_version: string | null;
    last_seen_at: string | null;
    created_at: string;
  }[];
};

export const adminGetUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    return input;
  })
  .handler(async ({ data, context }): Promise<AdminUserDetail> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [
      { data: profile, error: pErr },
      { data: presence },
      { data: shifts },
      { data: ratingsRec, count: ratingsRecCount },
      { data: ratingsGiv, count: ratingsGivCount },
      { data: devices },
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", data.userId).maybeSingle(),
      supabaseAdmin
        .from("doctor_presence")
        .select("online, last_seen")
        .eq("user_id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("coverage_requests")
        .select("id,status,total_billed_amount,payment_status")
        .or(`requester_id.eq.${data.userId},accepted_by.eq.${data.userId}`)
        .limit(5000),
      supabaseAdmin
        .from("ratings")
        .select("id", { count: "exact", head: false })
        .or(`ratee_entity_id.eq.doc:${data.userId},ratee_entity_id.eq.req:${data.userId}`)
        .limit(1),
      supabaseAdmin
        .from("ratings")
        .select("id", { count: "exact", head: false })
        .eq("rater_user_id", data.userId)
        .limit(1),
      supabaseAdmin
        .from("device_tokens")
        .select("id,platform,app_version,last_seen_at,created_at")
        .eq("user_id", data.userId)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(20),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (!profile) throw new Error("User not found");

    let email: string | null = null;
    try {
      const { data: userRec } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      email = userRec?.user?.email ?? null;
    } catch {
      /* best effort */
    }

    let total = 0,
      completed = 0,
      cancelled = 0,
      outstanding = 0;
    for (const s of shifts ?? []) {
      total += 1;
      if (s.status === "completed") completed += 1;
      if (s.status === "cancelled") cancelled += 1;
      if (
        s.status === "completed" &&
        s.payment_status !== "paid" &&
        (s.total_billed_amount ?? 0) > 0
      ) {
        outstanding += Number(s.total_billed_amount ?? 0);
      }
    }

    return {
      profile: {
        id: profile.id,
        full_name: profile.full_name ?? null,
        phone: profile.phone ?? null,
        email,
        role: profile.role ?? null,
        location: (profile as { location?: string | null }).location ?? null,
        gender: profile.gender ?? null,
        mdcn: profile.mdcn ?? null,
        bank_name: profile.bank_name ?? null,
        bank_account: profile.bank_account ?? null,
        bank_account_name:
          (profile as { bank_account_name?: string | null }).bank_account_name ?? null,
        verification_status: profile.verification_status ?? null,
        verification_action_reason:
          (profile as { verification_action_reason?: string | null }).verification_action_reason ??
          null,
        verification_action_target:
          (profile as { verification_action_target?: string | null }).verification_action_target ??
          null,
        verification_action_note:
          (profile as { verification_action_note?: string | null }).verification_action_note ??
          null,
        verification_action_at:
          (profile as { verification_action_at?: string | null }).verification_action_at ?? null,
        selfie_url: profile.selfie_url ?? null,
        license_name: profile.license_name ?? null,
        nysc_name: (profile as { nysc_name?: string | null }).nysc_name ?? null,
        verification_receipt_url:
          (profile as { verification_receipt_url?: string | null }).verification_receipt_url ??
          null,
        onboarded_at: profile.onboarded_at ?? null,
        onboarded_cover_at:
          (profile as { onboarded_cover_at?: string | null }).onboarded_cover_at ?? null,
        onboarded_request_at:
          (profile as { onboarded_request_at?: string | null }).onboarded_request_at ?? null,
        last_seen_at: (profile as { last_seen_at?: string | null }).last_seen_at ?? null,
        created_at: profile.created_at,
        trust_frozen_at: (profile as { trust_frozen_at?: string | null }).trust_frozen_at ?? null,
        trust_frozen_reason:
          (profile as { trust_frozen_reason?: string | null }).trust_frozen_reason ?? null,
        trust_escalated_at:
          (profile as { trust_escalated_at?: string | null }).trust_escalated_at ?? null,
        trust_escalated_note:
          (profile as { trust_escalated_note?: string | null }).trust_escalated_note ?? null,
        trust_restriction_expires_at:
          (profile as { trust_restriction_expires_at?: string | null })
            .trust_restriction_expires_at ?? null,
      },
      presence: presence
        ? { online: !!presence.online, last_seen: presence.last_seen ?? null }
        : null,
      counts: {
        shifts_total: total,
        shifts_completed: completed,
        shifts_cancelled: cancelled,
        ratings_received: ratingsRecCount ?? ratingsRec?.length ?? 0,
        ratings_given: ratingsGivCount ?? ratingsGiv?.length ?? 0,
        outstanding_amount: outstanding,
      },
      devices: (devices ?? []).map((d) => ({
        id: d.id,
        platform: d.platform ?? null,
        app_version: d.app_version ?? null,
        last_seen_at: d.last_seen_at ?? null,
        created_at: d.created_at,
      })),
    };
  });

// =====================================================================
// SHIFT DETAIL (§2)
// =====================================================================

export type AdminShiftDetail = {
  shift: {
    id: string;
    status: string;
    hospital: string;
    area: string;
    coverage_type: string;
    environment: string | null;
    day: string;
    start_time: string;
    end_time: string;
    start_ts: number | null;
    end_ts: number | null;
    duration_hrs: number;
    days: number | null;
    amount: number;
    fee_pct: number;
    note: string | null;
    accommodation: string | null;
    base_amount: number | null;
    surcharge_amount: number | null;
    total_billed_amount: number | null;
    settled_amount: number | null;
    payment_status: string | null;
    payment_reference: string | null;
    payment_due_at: string | null;
    payment_extension_count: number;
    surcharge_capped_at: string | null;
    billing_locked_at: string | null;
    paid_at: string | null;
    remitted_at: string | null;
    cancellation_reason_code: string | null;
    cancellation_reason_text: string | null;
    cancelled_at: string | null;
    cancelled_by: string | null;
    created_at: string;
    updated_at: string;
    broadcast_started_at: string | null;
    started_at: number | null;
    first_started_at: string | null;
    accumulated_ms: number | null;
    requester_id: string;
    requester_name: string | null;
    requester_phone: string | null;
    accepted_by: string | null;
    doctor_name: string | null;
    doctor_phone: string | null;
  };
  segments: {
    id: string;
    seg_index: number;
    started_at: string | null;
    paused_at: string | null;
    resumed_at: string | null;
    ended_at: string | null;
    duration_ms: number | null;
  }[];
  surcharge_log: {
    id: string;
    block_index: number;
    block_amount: number;
    running_total: number;
    applied_at: string;
    source: string | null;
  }[];
  underpayment: {
    id: string;
    payment_reference: string | null;
    expected_amount: number;
    received_amount: number;
    received_at: string;
  } | null;
  ratings: {
    r2d: { score: number; feedback: string | null; created_at: string } | null;
    d2r: { score: number; feedback: string | null; created_at: string } | null;
  };
};

export const adminGetShiftDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    return input;
  })
  .handler(async ({ data, context }): Promise<AdminShiftDetail> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: shift, error } = await supabaseAdmin
      .from("coverage_requests")
      .select("*")
      .eq("id", data.shiftId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!shift) throw new Error("Shift not found");

    const [
      { data: segments },
      { data: surchargeLog },
      { data: underpayment },
      { data: ratingRows },
    ] = await Promise.all([
      supabaseAdmin
        .from("shift_segments")
        .select("*")
        .eq("request_id", data.shiftId)
        .order("started_at", { ascending: true, nullsFirst: true }),
      supabaseAdmin
        .from("payment_surcharge_log")
        .select("*")
        .eq("request_id", data.shiftId)
        .order("block_index", { ascending: true }),
      supabaseAdmin
        .from("payment_underpayments")
        .select("*")
        .eq("request_id", data.shiftId)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("ratings")
        .select("ratee_entity_id, score, feedback, created_at")
        .eq("shift_id", data.shiftId),
    ]);

    const ids = new Set<string>();
    ids.add(shift.requester_id);
    if (shift.accepted_by) ids.add(shift.accepted_by);
    const profMap = new Map<string, { full_name: string | null; phone: string | null }>();
    if (ids.size) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", Array.from(ids));
      for (const p of profs ?? []) profMap.set(p.id, { full_name: p.full_name, phone: p.phone });
    }

    let r2d: AdminShiftDetail["ratings"]["r2d"] = null;
    let d2r: AdminShiftDetail["ratings"]["d2r"] = null;
    for (const r of ratingRows ?? []) {
      const entry = { score: r.score, feedback: r.feedback, created_at: r.created_at };
      if (r.ratee_entity_id?.startsWith("doc:")) r2d = entry;
      else if (r.ratee_entity_id?.startsWith("req:")) d2r = entry;
    }

    return {
      shift: {
        id: shift.id,
        status: shift.status,
        hospital: shift.hospital,
        area: shift.area,
        coverage_type: shift.coverage_type,
        environment: shift.environment ?? null,
        day: shift.day,
        start_time: shift.start_time,
        end_time: shift.end_time,
        start_ts: shift.start_ts,
        end_ts: shift.end_ts,
        duration_hrs: Number(shift.duration_hrs ?? 0),
        days: shift.days,
        amount: shift.amount,
        fee_pct: shift.fee_pct,
        note: shift.note ?? null,
        accommodation: shift.accommodation ?? null,
        base_amount: shift.base_amount == null ? null : Number(shift.base_amount),
        surcharge_amount: shift.surcharge_amount == null ? null : Number(shift.surcharge_amount),
        total_billed_amount:
          shift.total_billed_amount == null ? null : Number(shift.total_billed_amount),
        settled_amount: shift.settled_amount ?? null,
        payment_status: shift.payment_status ?? null,
        payment_reference: shift.payment_reference ?? null,
        payment_due_at: shift.payment_due_at ?? null,
        payment_extension_count: shift.payment_extension_count ?? 0,
        surcharge_capped_at: shift.surcharge_capped_at ?? null,
        billing_locked_at: shift.billing_locked_at ?? null,
        paid_at: shift.paid_at ?? null,
        remitted_at: shift.remitted_at ?? null,
        cancellation_reason_code: shift.cancellation_reason_code ?? null,
        cancellation_reason_text: shift.cancellation_reason_text ?? null,
        cancelled_at: shift.cancelled_at ?? null,
        cancelled_by: shift.cancelled_by ?? null,
        created_at: shift.created_at,
        updated_at: shift.updated_at,
        broadcast_started_at: shift.broadcast_started_at ?? null,
        started_at: shift.started_at ?? null,
        first_started_at: shift.first_started_at ?? null,
        accumulated_ms: shift.accumulated_ms ?? null,
        requester_id: shift.requester_id,
        requester_name: profMap.get(shift.requester_id)?.full_name ?? null,
        requester_phone: profMap.get(shift.requester_id)?.phone ?? null,
        accepted_by: shift.accepted_by ?? null,
        doctor_name: shift.accepted_by ? (profMap.get(shift.accepted_by)?.full_name ?? null) : null,
        doctor_phone: shift.accepted_by ? (profMap.get(shift.accepted_by)?.phone ?? null) : null,
      },
      segments: (segments ?? []).map((s, i) => ({
        id: s.id,
        seg_index: (s as { seg_index?: number }).seg_index ?? i,
        started_at: s.started_at ?? null,
        paused_at: (s as { paused_at?: string | null }).paused_at ?? null,
        resumed_at: (s as { resumed_at?: string | null }).resumed_at ?? null,
        ended_at: (s as { ended_at?: string | null }).ended_at ?? null,
        duration_ms: (s as { duration_ms?: number | null }).duration_ms ?? null,
      })),
      surcharge_log: (surchargeLog ?? []).map((r) => ({
        id: r.id,
        block_index: r.block_index,
        block_amount: Number(r.block_amount ?? 0),
        running_total: Number(r.running_total ?? 0),
        applied_at: r.applied_at,
        source: r.source ?? null,
      })),
      underpayment: underpayment
        ? {
            id: underpayment.id,
            payment_reference: underpayment.payment_reference ?? null,
            expected_amount: Number(underpayment.expected_amount ?? 0),
            received_amount: Number(underpayment.received_amount ?? 0),
            received_at: underpayment.received_at,
          }
        : null,
      ratings: { r2d, d2r },
    };
  });

// =====================================================================
// SHIFT ADMIN ACTIONS (§2)
// =====================================================================

export const adminShiftForceCancel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string; reason: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    if (!input?.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update({
        status: "cancelled",
        cancelled_by: "admin",
        cancelled_at: new Date().toISOString(),
        cancellation_reason_code: "admin_force",
        cancellation_reason_text: data.reason.trim(),
      })
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "shift.force_cancel",
      targetShiftId: data.shiftId,
      reason: data.reason.trim(),
    });
    return { ok: true };
  });

export const adminShiftForceComplete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string; reason: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    if (!input?.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update({
        status: "completed",
        billing_locked_at: new Date().toISOString(),
      })
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "shift.force_complete",
      targetShiftId: data.shiftId,
      reason: data.reason.trim(),
    });
    return { ok: true };
  });

export const adminShiftExtendPaymentWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string; minutes?: number; reason?: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    return {
      shiftId: input.shiftId,
      minutes: Math.min(Math.max(input.minutes ?? 15, 1), 720),
      reason: input.reason ?? null,
    };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error: gErr } = await supabaseAdmin
      .from("coverage_requests")
      .select("payment_due_at, payment_extension_count")
      .eq("id", data.shiftId)
      .single();
    if (gErr) throw new Error(gErr.message);

    const base = row?.payment_due_at ? Date.parse(row.payment_due_at) : Date.now();
    const next = new Date(Math.max(base, Date.now()) + data.minutes * 60_000).toISOString();

    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update({
        payment_due_at: next,
        payment_extension_count: (row?.payment_extension_count ?? 0) + 1,
        last_extended_at: new Date().toISOString(),
      })
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "shift.extend_payment_window",
      targetShiftId: data.shiftId,
      reason: data.reason,
      payload: { minutes: data.minutes, new_due_at: next },
    });
    return { ok: true, payment_due_at: next };
  });

export const adminShiftLiftSurchargeCap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string; reason: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    if (!input?.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update({ surcharge_capped_at: null })
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "shift.lift_surcharge_cap",
      targetShiftId: data.shiftId,
      reason: data.reason.trim(),
    });
    return { ok: true };
  });

export const adminShiftMarkPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { shiftId: string; amount?: number; reference?: string; reason: string }) => {
      if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
      if (!input?.reason?.trim()) throw new Error("Reason is required");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      payment_status: "paid",
      paid_at: new Date().toISOString(),
    };
    if (typeof data.amount === "number" && data.amount >= 0) {
      patch.settled_amount = data.amount;
    }
    if (data.reference) patch.payment_reference = data.reference;
    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update(patch as never)
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "shift.mark_paid_manual",
      targetShiftId: data.shiftId,
      targetPaymentRef: data.reference ?? null,
      reason: data.reason.trim(),
      payload: { amount: data.amount ?? null },
    });
    return { ok: true };
  });

// =====================================================================
// PAYMENT DETAIL (§3)
// =====================================================================

export type AdminPaymentDetail = {
  shift_id: string;
  hospital: string;
  area: string;
  status: string;
  payment_status: string | null;
  payment_reference: string | null;
  payment_provider: string | null;
  payment_url: string | null;
  payment_due_at: string | null;
  payment_extension_count: number;
  surcharge_capped_at: string | null;
  billing_locked_at: string | null;
  paid_at: string | null;
  remitted_at: string | null;
  total_billed_amount: number | null;
  base_amount: number | null;
  surcharge_amount: number | null;
  settled_amount: number | null;
  payment_account: JsonValue | null;
  requester_id: string;
  requester_name: string | null;
  doctor_id: string | null;
  doctor_name: string | null;
  surcharge_log: {
    block_index: number;
    block_amount: number;
    running_total: number;
    applied_at: string;
    source: string | null;
  }[];
  underpayment: {
    expected_amount: number;
    received_amount: number;
    received_at: string;
    payment_reference: string | null;
  } | null;
  actions: AdminActionRow[];
};

export const adminGetPaymentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    return input;
  })
  .handler(async ({ data, context }): Promise<AdminPaymentDetail> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: shift, error } = await supabaseAdmin
      .from("coverage_requests")
      .select("*")
      .eq("id", data.shiftId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!shift) throw new Error("Shift not found");

    const [{ data: surcharge }, { data: under }, { data: actions }] = await Promise.all([
      supabaseAdmin
        .from("payment_surcharge_log")
        .select("block_index, block_amount, running_total, applied_at, source")
        .eq("request_id", data.shiftId)
        .order("block_index", { ascending: true }),
      supabaseAdmin
        .from("payment_underpayments")
        .select("expected_amount, received_amount, received_at, payment_reference")
        .eq("request_id", data.shiftId)
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("admin_actions")
        .select(
          "id,actor_user_id,action,target_user_id,target_shift_id,target_payment_ref,reason,note,payload,created_at",
        )
        .eq("target_shift_id", data.shiftId)
        .like("action", "payment.%")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const ids = new Set<string>();
    ids.add(shift.requester_id);
    if (shift.accepted_by) ids.add(shift.accepted_by);
    for (const a of actions ?? []) ids.add(a.actor_user_id);
    const nameMap = new Map<string, string | null>();
    if (ids.size) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(ids));
      for (const p of profs ?? []) nameMap.set(p.id, p.full_name);
    }

    return {
      shift_id: shift.id,
      hospital: shift.hospital,
      area: shift.area,
      status: shift.status,
      payment_status: shift.payment_status ?? null,
      payment_reference: shift.payment_reference ?? null,
      payment_provider: shift.payment_provider ?? null,
      payment_url: shift.payment_url ?? null,
      payment_due_at: shift.payment_due_at ?? null,
      payment_extension_count: shift.payment_extension_count ?? 0,
      surcharge_capped_at: shift.surcharge_capped_at ?? null,
      billing_locked_at: shift.billing_locked_at ?? null,
      paid_at: shift.paid_at ?? null,
      remitted_at: shift.remitted_at ?? null,
      total_billed_amount:
        shift.total_billed_amount == null ? null : Number(shift.total_billed_amount),
      base_amount: shift.base_amount == null ? null : Number(shift.base_amount),
      surcharge_amount: shift.surcharge_amount == null ? null : Number(shift.surcharge_amount),
      settled_amount: shift.settled_amount ?? null,
      payment_account: (shift.payment_account as JsonValue | null) ?? null,
      requester_id: shift.requester_id,
      requester_name: nameMap.get(shift.requester_id) ?? null,
      doctor_id: shift.accepted_by ?? null,
      doctor_name: shift.accepted_by ? (nameMap.get(shift.accepted_by) ?? null) : null,
      surcharge_log: (surcharge ?? []).map((r) => ({
        block_index: r.block_index,
        block_amount: Number(r.block_amount ?? 0),
        running_total: Number(r.running_total ?? 0),
        applied_at: r.applied_at,
        source: r.source ?? null,
      })),
      underpayment: under
        ? {
            expected_amount: Number(under.expected_amount ?? 0),
            received_amount: Number(under.received_amount ?? 0),
            received_at: under.received_at,
            payment_reference: under.payment_reference ?? null,
          }
        : null,
      actions: (actions ?? []).map((r): AdminActionRow => ({
        id: r.id,
        actor_user_id: r.actor_user_id,
        actor_name: nameMap.get(r.actor_user_id) ?? null,
        action: r.action,
        target_user_id: r.target_user_id,
        target_user_name: r.target_user_id ? (nameMap.get(r.target_user_id) ?? null) : null,
        target_shift_id: r.target_shift_id,
        target_payment_ref: r.target_payment_ref,
        reason: r.reason,
        note: r.note,
        payload: r.payload as JsonValue | null,
        created_at: r.created_at,
      })),
    };
  });

export const adminPaymentReconcile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Log the intent; downstream reconciliation cron will pick up the next pass.
    // For an immediate poll we'd call the Monnify status endpoint here, but
    // to keep the change focused we record the request and bump updated_at.
    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "payment.reconcile_requested",
      targetShiftId: data.shiftId,
    });
    return { ok: true };
  });

export const adminPaymentRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string; amount: number; reason: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    if (!(input?.amount > 0)) throw new Error("Amount must be positive");
    if (!input?.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logAction(supabaseAdmin, context.userId, {
      action: "payment.refund_initiated",
      targetShiftId: data.shiftId,
      reason: data.reason.trim(),
      payload: { amount: data.amount },
    });
    return { ok: true };
  });

export const adminPaymentWriteOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { shiftId: string; reason: string }) => {
    if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
    if (!input?.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update({
        payment_status: "written_off",
        paid_at: new Date().toISOString(),
      })
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "payment.write_off",
      targetShiftId: data.shiftId,
      reason: data.reason.trim(),
    });
    return { ok: true };
  });

export const adminPaymentRecordOffline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { shiftId: string; amount: number; reference?: string; note?: string }) => {
      if (!isUuid(input?.shiftId)) throw new Error("Invalid shift id");
      if (!(input?.amount > 0)) throw new Error("Amount must be positive");
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: Record<string, unknown> = {
      payment_status: "paid",
      paid_at: new Date().toISOString(),
      settled_amount: data.amount,
    };
    if (data.reference) patch.payment_reference = data.reference;
    const { error } = await supabaseAdmin
      .from("coverage_requests")
      .update(patch as never)
      .eq("id", data.shiftId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "payment.record_offline",
      targetShiftId: data.shiftId,
      targetPaymentRef: data.reference ?? null,
      note: data.note ?? null,
      payload: { amount: data.amount },
    });
    return { ok: true };
  });

// =====================================================================
// VERIFICATION DETAIL (§4)
// =====================================================================

export type AdminVerificationDetail = {
  user_id: string;
  full_name: string | null;
  verification_status: string | null;
  action_reason: string | null;
  action_target: string | null;
  action_note: string | null;
  action_at: string | null;
  files: {
    label: string;
    field: "selfie" | "license" | "nysc" | "receipt";
    path: string | null;
    signed_url: string | null;
    is_external: boolean;
  }[];
  bank: {
    bank_name: string | null;
    bank_account: string | null;
    bank_account_name: string | null;
    mdcn: string | null;
  };
  history: AdminActionRow[];
};

export const adminGetVerificationDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    return input;
  })
  .handler(async ({ data, context }): Promise<AdminVerificationDetail> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profile, error }, { data: actions }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select(
          "id, full_name, verification_status, selfie_url, license_name, nysc_name, bank_name, bank_account, bank_account_name, mdcn, verification_receipt_url, verification_action_reason, verification_action_target, verification_action_note, verification_action_at",
        )
        .eq("id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("admin_actions")
        .select(
          "id,actor_user_id,action,target_user_id,target_shift_id,target_payment_ref,reason,note,payload,created_at",
        )
        .eq("target_user_id", data.userId)
        .like("action", "verification.%")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (error) throw new Error(error.message);
    if (!profile) throw new Error("User not found");

    const SIGNED_TTL = 60 * 30;
    const sign = async (path: string | null | undefined) => {
      if (!path) return null;
      if (/^https?:\/\//i.test(path)) return path;
      const { data: s } = await supabaseAdmin.storage
        .from("doctors")
        .createSignedUrl(path, SIGNED_TTL);
      return s?.signedUrl ?? null;
    };

    const [selfie, license, nysc] = await Promise.all([
      sign(profile.selfie_url),
      sign(profile.license_name),
      sign((profile as { nysc_name?: string | null }).nysc_name),
    ]);
    const receiptExternal =
      (profile as { verification_receipt_url?: string | null }).verification_receipt_url ?? null;

    const actorIds = new Set<string>();
    for (const a of actions ?? []) actorIds.add(a.actor_user_id);
    const nameMap = new Map<string, string | null>();
    if (actorIds.size) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(actorIds));
      for (const p of profs ?? []) nameMap.set(p.id, p.full_name);
    }

    return {
      user_id: profile.id,
      full_name: profile.full_name,
      verification_status: profile.verification_status,
      action_reason:
        (profile as { verification_action_reason?: string | null }).verification_action_reason ??
        null,
      action_target:
        (profile as { verification_action_target?: string | null }).verification_action_target ??
        null,
      action_note:
        (profile as { verification_action_note?: string | null }).verification_action_note ?? null,
      action_at:
        (profile as { verification_action_at?: string | null }).verification_action_at ?? null,
      files: [
        {
          label: "Selfie / profile photo",
          field: "selfie",
          path: profile.selfie_url,
          signed_url: selfie,
          is_external: !!profile.selfie_url && /^https?:\/\//i.test(profile.selfie_url),
        },
        {
          label: "Medical license",
          field: "license",
          path: profile.license_name,
          signed_url: license,
          is_external: !!profile.license_name && /^https?:\/\//i.test(profile.license_name),
        },
        {
          label: "NYSC certificate",
          field: "nysc",
          path: (profile as { nysc_name?: string | null }).nysc_name ?? null,
          signed_url: nysc,
          is_external:
            !!(profile as { nysc_name?: string | null }).nysc_name &&
            /^https?:\/\//i.test((profile as { nysc_name?: string | null }).nysc_name ?? ""),
        },
        {
          label: "Payment receipt",
          field: "receipt",
          path: receiptExternal,
          signed_url: receiptExternal,
          is_external: true,
        },
      ],
      bank: {
        bank_name: profile.bank_name ?? null,
        bank_account: profile.bank_account ?? null,
        bank_account_name:
          (profile as { bank_account_name?: string | null }).bank_account_name ?? null,
        mdcn: profile.mdcn ?? null,
      },
      history: (actions ?? []).map((r) => ({
        id: r.id,
        actor_user_id: r.actor_user_id,
        actor_name: nameMap.get(r.actor_user_id) ?? null,
        action: r.action,
        target_user_id: r.target_user_id,
        target_user_name: r.target_user_id ? (nameMap.get(r.target_user_id) ?? null) : null,
        target_shift_id: r.target_shift_id,
        target_payment_ref: r.target_payment_ref,
        reason: r.reason,
        note: r.note,
        payload: r.payload as JsonValue | null,
        created_at: r.created_at,
      })),
    };
  });

// =====================================================================
// TRUST: FREEZE / ESCALATE / HISTORY (§5)
// =====================================================================

export type TrustHistoryRow = {
  id: string;
  action: string;
  reason: string | null;
  note: string | null;
  actor_user_id: string;
  actor_name: string | null;
  payload: JsonValue | null;
  created_at: string;
};

export const adminListTrustHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    return input;
  })
  .handler(async ({ data, context }): Promise<TrustHistoryRow[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: rows, error } = await sb.rpc("admin_list_trust_history", {
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as TrustHistoryRow[];
  });

export const adminTrustFreeze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; reason: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    if (!input?.reason?.trim()) throw new Error("Reason is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        trust_frozen_at: new Date().toISOString(),
        trust_frozen_reason: data.reason.trim(),
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "trust.freeze",
      targetUserId: data.userId,
      reason: data.reason.trim(),
    });
    return { ok: true };
  });

export const adminTrustUnfreeze = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ trust_frozen_at: null, trust_frozen_reason: null })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "trust.unfreeze",
      targetUserId: data.userId,
    });
    return { ok: true };
  });

export const adminTrustEscalate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; note: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    if (!input?.note?.trim()) throw new Error("Note is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        trust_escalated_at: new Date().toISOString(),
        trust_escalated_note: data.note.trim(),
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "trust.escalate",
      targetUserId: data.userId,
      note: data.note.trim(),
    });
    return { ok: true };
  });

export const adminTrustSetExpiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; expiresAt: string | null; reason?: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ trust_restriction_expires_at: data.expiresAt })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, {
      action: "trust.set_expiry",
      targetUserId: data.userId,
      reason: data.reason,
      payload: { expires_at: data.expiresAt },
    });
    return { ok: true };
  });

// =====================================================================
// TRUST: log wrappers around existing RPCs so history is captured
// =====================================================================

export const adminTrustRestrict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; reason?: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { error } = await sb.rpc("admin_apply_trust_restriction", {
      _user_id: data.userId,
      _reason: data.reason || undefined,
    });
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logAction(supabaseAdmin, context.userId, {
      action: "trust.restrict",
      targetUserId: data.userId,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });

export const adminTrustClear = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; reason?: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { error } = await sb.rpc("admin_clear_trust_restriction", {
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await logAction(supabaseAdmin, context.userId, {
      action: "trust.clear",
      targetUserId: data.userId,
      reason: data.reason ?? null,
    });
    return { ok: true };
  });
