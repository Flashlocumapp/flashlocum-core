import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type VerificationStatus =
  | "pending"
  | "approved"
  | "suspended"
  | "rejected"
  | "action_required";
const ALLOWED: VerificationStatus[] = [
  "pending",
  "approved",
  "suspended",
  "rejected",
  "action_required",
];

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
  .inputValidator(
    (input: {
      doctorId: string;
      status: VerificationStatus;
      reason?: string;
      target?: string;
      note?: string;
    }) => {
      if (!isUuid(input?.doctorId)) throw new Error("Invalid doctor id");
      if (!ALLOWED.includes(input?.status)) throw new Error("Invalid status");
      if (input.status === "action_required" && !input.reason?.trim()) {
        throw new Error("A reason is required for Action Required.");
      }
      return input;
    },
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const patch: Record<string, unknown> = { verification_status: data.status };
    if (data.status === "action_required") {
      patch.verification_action_reason = data.reason?.trim() ?? null;
      patch.verification_action_target = data.target?.trim() || null;
      patch.verification_action_note = data.note?.trim() || null;
      patch.verification_action_at = new Date().toISOString();
    } else {
      // Clear the action-required metadata once admin moves the doctor
      // out of that state (approve / suspend / reject / pending).
      patch.verification_action_reason = null;
      patch.verification_action_target = null;
      patch.verification_action_note = null;
    }

    const { data: updated, error } = await context.supabase
      .from("profiles")
      // types.ts may not yet include the new action-required columns or
      // the new enum value — cast to bypass generated row types.
      .update(patch as never)
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
        action_required: "Action required on your verification",
      };
      const bodyByStatus: Record<VerificationStatus, string> = {
        approved: "You can now accept shifts on FlashLocum.",
        rejected: "Your verification was not approved. Open the app for details.",
        suspended: "Your account has been suspended. Contact support.",
        pending: "Your account is back under review.",
        action_required:
          data.reason?.trim() ||
          "Additional information is required to complete your verification.",
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
  total_billed_amount: number | null;
  settled_amount: number | null;
  paid_at: string | null;
  billing_locked_at: string | null;
  cancelled_by: string | null;
  started_at: number | null;
  created_at: string;
  updated_at: string;
  requester_name: string | null;
  requester_email: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  requester_to_doctor: { score: number; feedback: string | null; created_at: string } | null;
  doctor_to_requester: { score: number; feedback: string | null; created_at: string } | null;
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
        "id,status,requester_id,accepted_by,hospital,area,coverage_type,day,start_time,end_time,start_ts,end_ts,duration_hrs,amount,fee_pct,payment_status,total_billed_amount,settled_amount,paid_at,billing_locked_at,cancelled_by,started_at,created_at,updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.status && data.status !== "all") {
      query = query.eq("status", data.status as "searching" | "accepted" | "active" | "paused" | "completed" | "cancelled");
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

    const shiftIds = shifts.map((s) => s.id);
    const ratingsByShift = new Map<
      string,
      { r2d: { score: number; feedback: string | null; created_at: string } | null;
        d2r: { score: number; feedback: string | null; created_at: string } | null }
    >();
    if (shiftIds.length) {
      const { data: ratingRows } = await supabaseAdmin
        .from("ratings")
        .select("shift_id, ratee_entity_id, score, feedback, created_at")
        .in("shift_id", shiftIds);
      for (const r of ratingRows ?? []) {
        const cur = ratingsByShift.get(r.shift_id) ?? { r2d: null, d2r: null };
        const entry = { score: r.score, feedback: r.feedback, created_at: r.created_at };
        if (r.ratee_entity_id?.startsWith("doc:")) cur.r2d = entry;
        else if (r.ratee_entity_id?.startsWith("req:")) cur.d2r = entry;
        ratingsByShift.set(r.shift_id, cur);
      }
    }

    const out: AdminShiftRow[] = shifts.map((r) => {
      const req = profileMap.get(r.requester_id);
      const doc = r.accepted_by ? profileMap.get(r.accepted_by) : undefined;
      const rt = ratingsByShift.get(r.id);
      return {
        ...r,
        requester_name: req?.full_name ?? null,
        requester_email: emailMap.get(r.requester_id) ?? null,
        doctor_name: doc?.full_name ?? null,
        doctor_phone: doc?.phone ?? null,
        requester_to_doctor: rt?.r2d ?? null,
        doctor_to_requester: rt?.d2r ?? null,
      };
    });
    return out;
  });

export type AdminUnpaidShiftRow = {
  id: string;
  hospital: string;
  area: string;
  requester_id: string;
  requester_name: string | null;
  requester_email: string | null;
  doctor_name: string | null;
  doctor_phone: string | null;
  total_billed_amount: number | null;
  payment_status: string | null;
  payment_due_at: string | null;
  payment_extension_count: number;
  billing_locked_at: string | null;
  updated_at: string;
};

/** Admin-only: list completed shifts whose payment is still outstanding. */
export const adminListUnpaidShifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("coverage_requests")
      .select(
        "id,hospital,area,requester_id,accepted_by,total_billed_amount,payment_status,payment_due_at,payment_extension_count,billing_locked_at,updated_at",
      )
      .eq("status", "completed")
      .neq("payment_status", "paid")
      .gt("total_billed_amount", 0)
      .order("payment_due_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    const ids = new Set<string>();
    for (const r of list) {
      ids.add(r.requester_id);
      if (r.accepted_by) ids.add(r.accepted_by);
    }
    const idList = Array.from(ids);
    const profileMap = new Map<string, { full_name: string | null; phone: string | null }>();
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
        emailMap = new Map((usersData?.users ?? []).map((u) => [u.id, u.email ?? null]));
      } catch {
        /* email enrichment best-effort */
      }
    }

    const out: AdminUnpaidShiftRow[] = list.map((r) => {
      const req = profileMap.get(r.requester_id);
      const doc = r.accepted_by ? profileMap.get(r.accepted_by) : undefined;
      return {
        id: r.id,
        hospital: r.hospital,
        area: r.area,
        requester_id: r.requester_id,
        requester_name: req?.full_name ?? null,
        requester_email: emailMap.get(r.requester_id) ?? null,
        doctor_name: doc?.full_name ?? null,
        doctor_phone: doc?.phone ?? null,
        total_billed_amount: r.total_billed_amount,
        payment_status: r.payment_status,
        payment_due_at: r.payment_due_at,
        payment_extension_count: r.payment_extension_count ?? 0,
        billing_locked_at: r.billing_locked_at,
        updated_at: r.updated_at,
      };
    });
    return out;
  });



// ---------- Analytics shared helpers ----------

async function assertAdmin(context: { supabase: ReturnType<typeof Object>; userId: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = context.supabase as any;
  const { data: isAdmin, error } = await sb.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Forbidden: admin role required");
}

function dayKey(ts: string | number | Date): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ---------- Financial Analytics ----------

export type FinanceSeriesPoint = {
  date: string;
  gross: number;
  fees: number;
  net: number;
  count: number;
};

export type FinanceAnalytics = {
  totals: {
    gross: number;
    fees: number;
    net: number;
    paid_count: number;
    unpaid_count: number;
    unremitted_amount: number;
    pending_payout_count: number;
  };
  series: FinanceSeriesPoint[];
  topHospitals: { hospital: string; gross: number; count: number }[];
  topDoctors: { doctor_id: string; name: string | null; net: number; count: number }[];
  paymentStatus: { status: string; count: number; amount: number }[];
};

export const adminFinanceAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => ({
    days: Math.min(Math.max(input?.days ?? 30, 1), 180),
  }))
  .handler(async ({ data, context }): Promise<FinanceAnalytics> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from("coverage_requests")
      .select(
        "id,accepted_by,hospital,amount,fee_pct,settled_amount,payment_status,paid_at,remitted_at,created_at",
      )
      .gte("created_at", since)
      .limit(20000);
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    // Build daily buckets (paid revenue by paid_at when available).
    const dayMap = new Map<string, FinanceSeriesPoint>();
    for (let i = data.days - 1; i >= 0; i--) {
      const k = dayKey(Date.now() - i * 86_400_000);
      dayMap.set(k, { date: k, gross: 0, fees: 0, net: 0, count: 0 });
    }

    let gross = 0,
      fees = 0,
      net = 0,
      paidCount = 0,
      unpaidCount = 0,
      unremittedAmount = 0,
      pendingPayoutCount = 0;
    const hospitalMap = new Map<string, { gross: number; count: number }>();
    const doctorMap = new Map<string, { net: number; count: number }>();
    const statusMap = new Map<string, { count: number; amount: number }>();

    for (const r of list) {
      const amt = Number(r.amount ?? 0);
      const fee = Math.round((amt * Number(r.fee_pct ?? 0)) / 100);
      const doctorNet = amt - fee;
      const status = r.payment_status ?? "unpaid";
      const s = statusMap.get(status) ?? { count: 0, amount: 0 };
      s.count += 1;
      s.amount += amt;
      statusMap.set(status, s);

      if (status === "paid") {
        paidCount += 1;
        gross += amt;
        fees += fee;
        net += doctorNet;
        const k = dayKey(r.paid_at ?? r.created_at);
        const bucket = dayMap.get(k);
        if (bucket) {
          bucket.gross += amt;
          bucket.fees += fee;
          bucket.net += doctorNet;
          bucket.count += 1;
        }
        if (!r.remitted_at) {
          unremittedAmount += doctorNet;
          pendingPayoutCount += 1;
        }
        const h = hospitalMap.get(r.hospital) ?? { gross: 0, count: 0 };
        h.gross += amt;
        h.count += 1;
        hospitalMap.set(r.hospital, h);
        if (r.accepted_by) {
          const d = doctorMap.get(r.accepted_by) ?? { net: 0, count: 0 };
          d.net += doctorNet;
          d.count += 1;
          doctorMap.set(r.accepted_by, d);
        }
      } else {
        unpaidCount += 1;
      }
    }

    const topHospitals = [...hospitalMap.entries()]
      .map(([hospital, v]) => ({ hospital, ...v }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 8);

    const topDoctorIds = [...doctorMap.entries()]
      .sort((a, b) => b[1].net - a[1].net)
      .slice(0, 8);
    let nameMap = new Map<string, string | null>();
    if (topDoctorIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in(
          "id",
          topDoctorIds.map(([id]) => id),
        );
      nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
    }
    const topDoctors = topDoctorIds.map(([id, v]) => ({
      doctor_id: id,
      name: nameMap.get(id) ?? null,
      ...v,
    }));

    return {
      totals: {
        gross,
        fees,
        net,
        paid_count: paidCount,
        unpaid_count: unpaidCount,
        unremitted_amount: unremittedAmount,
        pending_payout_count: pendingPayoutCount,
      },
      series: [...dayMap.values()],
      topHospitals,
      topDoctors,
      paymentStatus: [...statusMap.entries()]
        .map(([status, v]) => ({ status, ...v }))
        .sort((a, b) => b.count - a.count),
    };
  });

// ---------- Doctor Flashboard ----------

export type DoctorFlashboardRow = {
  doctor_id: string;
  name: string | null;
  online: boolean;
  last_seen: string | null;
  accepted: number;
  completed: number;
  cancelled: number;
  active: number;
  total_amount: number;
  net_earnings: number;
  completion_rate: number;
  rating: number;
  rating_count: number;
};

export type DoctorFlashboard = {
  online_count: number;
  approved_count: number;
  total_completed: number;
  total_cancelled: number;
  acceptance_rate: number;
  completion_rate: number;
  rating_distribution: { score: number; count: number }[];
  rows: DoctorFlashboardRow[];
};

export const adminDoctorFlashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<DoctorFlashboard> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: doctors }, { data: presence }, { data: shifts }, { data: ratings }] =
      await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("id, full_name, verification_status")
          .eq("verification_status", "approved"),
        supabaseAdmin.from("doctor_presence").select("user_id, online, last_seen"),
        supabaseAdmin
          .from("coverage_requests")
          .select("accepted_by, status, amount, fee_pct")
          .not("accepted_by", "is", null)
          .limit(20000),
        supabaseAdmin.from("ratings").select("ratee_entity_id, score").limit(20000),
      ]);

    const presenceMap = new Map(
      (presence ?? []).map((p) => [p.user_id, p]),
    );
    const stats = new Map<
      string,
      { accepted: number; completed: number; cancelled: number; active: number; total_amount: number; net: number }
    >();
    for (const s of shifts ?? []) {
      if (!s.accepted_by) continue;
      const cur =
        stats.get(s.accepted_by) ??
        { accepted: 0, completed: 0, cancelled: 0, active: 0, total_amount: 0, net: 0 };
      cur.accepted += 1;
      if (s.status === "completed") cur.completed += 1;
      if (s.status === "cancelled") cur.cancelled += 1;
      if (s.status === "active" || s.status === "paused") cur.active += 1;
      if (s.status === "completed") {
        const amt = Number(s.amount ?? 0);
        cur.total_amount += amt;
        cur.net += amt - Math.round((amt * Number(s.fee_pct ?? 0)) / 100);
      }
      stats.set(s.accepted_by, cur);
    }

    const ratingAgg = new Map<string, { sum: number; count: number }>();
    const distribution = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
    ]);
    for (const r of ratings ?? []) {
      distribution.set(r.score, (distribution.get(r.score) ?? 0) + 1);
      if (!r.ratee_entity_id?.startsWith("doc:")) continue;
      const id = r.ratee_entity_id.slice(4);
      const cur = ratingAgg.get(id) ?? { sum: 0, count: 0 };
      cur.sum += r.score;
      cur.count += 1;
      ratingAgg.set(id, cur);
    }

    const rows: DoctorFlashboardRow[] = (doctors ?? []).map((d) => {
      const p = presenceMap.get(d.id);
      const s =
        stats.get(d.id) ??
        { accepted: 0, completed: 0, cancelled: 0, active: 0, total_amount: 0, net: 0 };
      const ra = ratingAgg.get(d.id);
      const finished = s.completed + s.cancelled;
      return {
        doctor_id: d.id,
        name: d.full_name,
        online:
          !!p?.online &&
          !!p?.last_seen &&
          Date.now() - new Date(p.last_seen).getTime() < 60_000,
        last_seen: p?.last_seen ?? null,
        accepted: s.accepted,
        completed: s.completed,
        cancelled: s.cancelled,
        active: s.active,
        total_amount: s.total_amount,
        net_earnings: s.net,
        completion_rate: finished ? s.completed / finished : 0,
        rating: ra && ra.count ? ra.sum / ra.count : 0,
        rating_count: ra?.count ?? 0,
      };
    });
    rows.sort((a, b) => b.completed - a.completed || b.net_earnings - a.net_earnings);

    let totalCompleted = 0,
      totalCancelled = 0,
      totalAccepted = 0;
    for (const r of rows) {
      totalCompleted += r.completed;
      totalCancelled += r.cancelled;
      totalAccepted += r.accepted;
    }
    const onlineCount = rows.filter((r) => r.online).length;
    const finished = totalCompleted + totalCancelled;

    return {
      online_count: onlineCount,
      approved_count: rows.length,
      total_completed: totalCompleted,
      total_cancelled: totalCancelled,
      acceptance_rate: totalAccepted ? totalAccepted / (totalAccepted + 0) : 0, // accepted / accepted (placeholder; we lack rejection data)
      completion_rate: finished ? totalCompleted / finished : 0,
      rating_distribution: [...distribution.entries()].map(([score, count]) => ({ score, count })),
      rows,
    };
  });

// ---------- Requester Analytics ----------

export type RequesterRow = {
  requester_id: string;
  name: string | null;
  total: number;
  completed: number;
  cancelled: number;
  in_progress: number;
  unfilled: number;
  amount: number;
  avg_time_to_fill_min: number | null;
  cancellation_rate: number;
};

export type RequesterAnalytics = {
  totals: {
    requests: number;
    requesters: number;
    completed: number;
    cancelled: number;
    unfilled: number;
    avg_time_to_fill_min: number | null;
    cancellation_rate: number;
    repeat_requester_rate: number;
  };
  topHospitals: { hospital: string; count: number; amount: number }[];
  topAreas: { area: string; count: number }[];
  rows: RequesterRow[];
};

export const adminRequesterAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => ({
    days: Math.min(Math.max(input?.days ?? 30, 1), 180),
  }))
  .handler(async ({ data, context }): Promise<RequesterAnalytics> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();

    const { data: rows, error } = await supabaseAdmin
      .from("coverage_requests")
      .select(
        "id, requester_id, hospital, area, status, amount, accepted_by, created_at, updated_at",
      )
      .gte("created_at", since)
      .limit(20000);
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    const perReq = new Map<
      string,
      {
        total: number;
        completed: number;
        cancelled: number;
        in_progress: number;
        unfilled: number;
        amount: number;
        fillTimes: number[];
      }
    >();
    const hospitalMap = new Map<string, { count: number; amount: number }>();
    const areaMap = new Map<string, number>();
    let completed = 0,
      cancelled = 0,
      unfilled = 0;
    const fillTimes: number[] = [];

    for (const r of list) {
      const cur =
        perReq.get(r.requester_id) ??
        {
          total: 0,
          completed: 0,
          cancelled: 0,
          in_progress: 0,
          unfilled: 0,
          amount: 0,
          fillTimes: [],
        };
      cur.total += 1;
      cur.amount += Number(r.amount ?? 0);
      if (r.status === "completed") {
        cur.completed += 1;
        completed += 1;
      } else if (r.status === "cancelled") {
        cur.cancelled += 1;
        cancelled += 1;
      } else if (r.status === "active" || r.status === "paused" || r.status === "accepted") {
        cur.in_progress += 1;
      } else if (r.status === "searching" || r.status === "expired") {
        // Treat expired (no doctor accepted within 180s) as unfilled demand —
        // surfaces in admin analytics alongside truly stuck searching rows.
        cur.unfilled += 1;
        unfilled += 1;
      }

      // Time-to-fill: created_at → updated_at when accepted_by is set.
      if (r.accepted_by && r.created_at && r.updated_at) {
        const mins =
          (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 60_000;
        if (mins > 0 && mins < 7 * 24 * 60) {
          cur.fillTimes.push(mins);
          fillTimes.push(mins);
        }
      }
      perReq.set(r.requester_id, cur);

      const h = hospitalMap.get(r.hospital) ?? { count: 0, amount: 0 };
      h.count += 1;
      h.amount += Number(r.amount ?? 0);
      hospitalMap.set(r.hospital, h);
      areaMap.set(r.area, (areaMap.get(r.area) ?? 0) + 1);
    }

    const requesterIds = [...perReq.keys()];
    let nameMap = new Map<string, string | null>();
    if (requesterIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", requesterIds);
      nameMap = new Map((profs ?? []).map((p) => [p.id, p.full_name]));
    }

    const rowsOut: RequesterRow[] = [...perReq.entries()]
      .map(([id, v]) => {
        const finished = v.completed + v.cancelled;
        return {
          requester_id: id,
          name: nameMap.get(id) ?? null,
          total: v.total,
          completed: v.completed,
          cancelled: v.cancelled,
          in_progress: v.in_progress,
          unfilled: v.unfilled,
          amount: v.amount,
          avg_time_to_fill_min: v.fillTimes.length
            ? v.fillTimes.reduce((a, b) => a + b, 0) / v.fillTimes.length
            : null,
          cancellation_rate: finished ? v.cancelled / finished : 0,
        };
      })
      .sort((a, b) => b.total - a.total);

    const repeat = rowsOut.filter((r) => r.total >= 2).length;
    const finishedAll = completed + cancelled;
    const avgFill = fillTimes.length
      ? fillTimes.reduce((a, b) => a + b, 0) / fillTimes.length
      : null;

    return {
      totals: {
        requests: list.length,
        requesters: rowsOut.length,
        completed,
        cancelled,
        unfilled,
        avg_time_to_fill_min: avgFill,
        cancellation_rate: finishedAll ? cancelled / finishedAll : 0,
        repeat_requester_rate: rowsOut.length ? repeat / rowsOut.length : 0,
      },
      topHospitals: [...hospitalMap.entries()]
        .map(([hospital, v]) => ({ hospital, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      topAreas: [...areaMap.entries()]
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      rows: rowsOut.slice(0, 50),
    };
  });

// ---------- Reliability & Risk Monitoring ----------

export type RiskActor = {
  user_id: string;
  name: string | null;
  total: number;
  cancelled: number;
  completed: number;
  cancellation_rate: number;
};

export type DuplicateMdcn = {
  mdcn: string;
  count: number;
  users: { id: string; name: string | null; verification_status: string | null; created_at: string }[];
};

export type SignupSpike = { day: string; signups: number };

export type RiskOverview = {
  totals: {
    cancellation_rate_doctor: number;
    cancellation_rate_requester: number;
    suspended_doctors: number;
    rejected_doctors: number;
    pending_doctors: number;
    duplicate_mdcn_groups: number;
    requests_cancelled_after_accept: number;
    requests_unfilled_24h: number;
    requests_expired: number;
  };

  topDoctorCancellers: RiskActor[];
  topRequesterCancellers: RiskActor[];
  duplicateMdcn: DuplicateMdcn[];
  signupTrend: SignupSpike[];
  stuckSearching: { id: string; hospital: string; area: string; created_at: string; requester_id: string; requester_name: string | null }[];
};

export const adminRiskOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => ({
    days: Math.min(Math.max(input?.days ?? 30, 1), 180),
  }))
  .handler(async ({ data, context }): Promise<RiskOverview> => {
    // The RPC is admin-gated (`has_role` check inside) and runs as SECURITY
    // DEFINER, so the admin's user-scoped supabase client is enough — no
    // service-role and no wide table scans in app code.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: payload, error } = await sb.rpc("admin_risk_overview", {
      _days: data.days,
    });
    if (error) throw new Error(error.message);
    return payload as RiskOverview;
  });


// ---------- Support Tools ----------

export type SupportSearchHit =
  | {
      kind: "user";
      id: string;
      title: string;
      subtitle: string;
      meta: string;
    }
  | {
      kind: "shift";
      id: string;
      title: string;
      subtitle: string;
      meta: string;
    };

export const adminSupportSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string }) => {
    const q = (input?.q ?? "").trim();
    if (q.length < 2) throw new Error("Query too short");
    return { q };
  })
  .handler(async ({ data, context }): Promise<SupportSearchHit[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const term = `%${data.q.replace(/[%_]/g, "")}%`;

    const [{ data: users }, { data: shifts }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("id, full_name, phone, mdcn, role, verification_status")
        .or(
          `full_name.ilike.${term},phone.ilike.${term},mdcn.ilike.${term},id.eq.${isUuid(data.q) ? data.q : "00000000-0000-0000-0000-000000000000"}`,
        )
        .limit(20),
      supabaseAdmin
        .from("coverage_requests")
        .select("id, hospital, area, status, payment_reference, phone, created_at")
        .or(
          `hospital.ilike.${term},area.ilike.${term},payment_reference.ilike.${term},phone.ilike.${term}`,
        )
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const hits: SupportSearchHit[] = [];
    for (const u of users ?? []) {
      hits.push({
        kind: "user",
        id: u.id,
        title: u.full_name ?? "Unnamed",
        subtitle: [u.role ?? "—", u.phone ?? "—", u.mdcn ?? ""].filter(Boolean).join(" · "),
        meta: u.verification_status ?? "—",
      });
    }
    for (const s of shifts ?? []) {
      hits.push({
        kind: "shift",
        id: s.id,
        title: `${s.hospital} · ${s.area}`,
        subtitle: s.payment_reference ?? s.phone ?? "",
        meta: s.status,
      });
    }
    return hits;
  });

export const adminSendPushFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; title: string; body: string }) => {
    if (!isUuid(input?.userId)) throw new Error("Invalid user id");
    const title = (input?.title ?? "").trim();
    const body = (input?.body ?? "").trim();
    if (!title || title.length > 80) throw new Error("Title must be 1-80 chars");
    if (!body || body.length > 240) throw new Error("Body must be 1-240 chars");
    return { userId: input.userId, title, body };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { sendPushToUser } = await import("@/lib/push.server");
    await sendPushToUser(data.userId, {
      title: data.title,
      body: data.body,
      data: { type: "admin_broadcast" },
    });
    return { ok: true };
  });

// ---------- System Health ----------

export type SystemHealth = {
  email: {
    queues: { queue_name: string; depth: number; oldest_enqueued_at: string | null }[];
    last24h: { sent: number; failed: number; suppressed: number };
    suppressed_total: number;
  };
  push: {
    device_tokens: number;
    users_with_tokens: number;
    platforms: { platform: string; count: number }[];
  };
  database: {
    profiles: number;
    coverage_requests: number;
    ratings: number;
    active_subscriptions_estimate: number;
  };
  activity: {
    signups_24h: number;
    requests_24h: number;
    completed_24h: number;
    cancelled_24h: number;
  };
};

export const adminSystemHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<SystemHealth> => {
    // Both RPCs self-gate on `has_role('admin')`. Aggregation runs entirely
    // in Postgres, so no row data crosses the wire — safe at 50k+ users.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const [{ data: health, error: hErr }, { data: queues, error: qErr }] = await Promise.all([
      sb.rpc("admin_system_health"),
      sb.rpc("email_queue_depth"),
    ]);
    if (hErr) throw new Error(hErr.message);
    if (qErr) throw new Error(qErr.message);

    type HealthRow = {
      email_sent_24h: number;
      email_failed_24h: number;
      suppressed_total: number;
      device_tokens: number;
      users_with_tokens: number;
      platforms: { platform: string; count: number }[];
      profiles_total: number;
      requests_total: number;
      ratings_total: number;
      signups_24h: number;
      requests_24h: number;
      completed_24h: number;
      cancelled_24h: number;
    };
    const h = health as HealthRow;

    return {
      email: {
        queues: (queues ?? []).map((q: { queue_name: string; depth: number | string; oldest_enqueued_at: string | null }) => ({
          queue_name: q.queue_name,
          depth: Number(q.depth ?? 0),
          oldest_enqueued_at: q.oldest_enqueued_at,
        })),
        last24h: {
          sent: h.email_sent_24h ?? 0,
          failed: h.email_failed_24h ?? 0,
          suppressed: 0,
        },
        suppressed_total: h.suppressed_total ?? 0,
      },
      push: {
        device_tokens: h.device_tokens ?? 0,
        users_with_tokens: h.users_with_tokens ?? 0,
        platforms: h.platforms ?? [],
      },
      database: {
        profiles: h.profiles_total ?? 0,
        coverage_requests: h.requests_total ?? 0,
        ratings: h.ratings_total ?? 0,
        active_subscriptions_estimate: 0,
      },
      activity: {
        signups_24h: h.signups_24h ?? 0,
        requests_24h: h.requests_24h ?? 0,
        completed_24h: h.completed_24h ?? 0,
        cancelled_24h: h.cancelled_24h ?? 0,
      },
    };
  });

// ---------- Ratings Feed ----------

export type AdminRatingRow = {
  id: string;
  score: number;
  feedback: string | null;
  created_at: string;
  shift_id: string | null;
  rater_user_id: string;
  ratee_entity_id: string;
  ratee_user_id: string | null;
  ratee_role: "doctor" | "requester" | null;
  rater_name: string | null;
  ratee_name: string | null;
  shift_hospital: string | null;
};

export const adminListRatings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      ratee_entity_id?: string;
      min_score?: number;
      max_score?: number;
      only_with_feedback?: boolean;
      limit?: number;
    } | undefined) => ({
      ratee_entity_id: input?.ratee_entity_id,
      min_score: input?.min_score,
      max_score: input?.max_score,
      only_with_feedback: !!input?.only_with_feedback,
      limit: Math.min(Math.max(input?.limit ?? 200, 1), 500),
    }),
  )
  .handler(async ({ data, context }): Promise<AdminRatingRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("ratings")
      .select("id,score,feedback,created_at,shift_id,rater_user_id,ratee_entity_id")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.ratee_entity_id) q = q.eq("ratee_entity_id", data.ratee_entity_id);
    if (typeof data.min_score === "number") q = q.gte("score", data.min_score);
    if (typeof data.max_score === "number") q = q.lte("score", data.max_score);
    if (data.only_with_feedback) q = q.not("feedback", "is", null);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    const userIds = new Set<string>();
    const shiftIds = new Set<string>();
    for (const r of list) {
      userIds.add(r.rater_user_id);
      const m = /^(doc|req):(.+)$/.exec(r.ratee_entity_id);
      if (m) userIds.add(m[2]);
      if (r.shift_id) shiftIds.add(r.shift_id);
    }

    const nameMap = new Map<string, string | null>();
    if (userIds.size) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", Array.from(userIds));
      for (const p of profs ?? []) nameMap.set(p.id, p.full_name);
    }

    const shiftMap = new Map<string, string | null>();
    if (shiftIds.size) {
      const { data: shifts } = await supabaseAdmin
        .from("coverage_requests")
        .select("id, hospital")
        .in("id", Array.from(shiftIds));
      for (const s of shifts ?? []) shiftMap.set(s.id, s.hospital);
    }

    return list.map((r): AdminRatingRow => {
      const m = /^(doc|req):(.+)$/.exec(r.ratee_entity_id);
      const ratee_user_id = m ? m[2] : null;
      const ratee_role: "doctor" | "requester" | null = m
        ? m[1] === "doc"
          ? "doctor"
          : "requester"
        : null;
      return {
        id: r.id,
        score: r.score,
        feedback: r.feedback,
        created_at: r.created_at,
        shift_id: r.shift_id,
        rater_user_id: r.rater_user_id,
        ratee_entity_id: r.ratee_entity_id,
        ratee_user_id,
        ratee_role,
        rater_name: nameMap.get(r.rater_user_id) ?? null,
        ratee_name: ratee_user_id ? (nameMap.get(ratee_user_id) ?? null) : null,
        shift_hospital: r.shift_id ? (shiftMap.get(r.shift_id) ?? null) : null,
      };
    });
  });

