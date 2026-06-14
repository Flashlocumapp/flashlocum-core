// Server functions for backend-authoritative shift control + pricing.
// All time, validation, billing and payment-window logic happens on the
// database. The client only passes inputs and renders the returned values.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Server wall clock (Africa/Lagos). Public so the booking UI can probe clock skew. */
export const getServerNow = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("server_now");
  if (error) throw new Error(error.message);
  return { now: data as unknown as string };
});

const QuoteInput = z.object({
  start: z.string(), // ISO timestamp
  end: z.string(),
  environment: z.enum(["normal", "busy"]).default("normal"),
  coverageKind: z.enum(["standard", "home"]).default("standard"),
});

export const quoteShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => QuoteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: q, error } = await context.supabase.rpc("compute_quote", {
      _start: data.start,
      _end: data.end,
      _environment: data.environment,
      _coverage_kind: data.coverageKind,
    });
    if (error) throw new Error(error.message);
    return q as { amount: number; breakdown: any };
  });

const ValidateInput = z.object({ start: z.string(), end: z.string() });
export const validateSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ValidateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("validate_shift_schedule", {
      _start: data.start,
      _end: data.end,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

const RequestIdInput = z.object({ requestId: z.string().uuid() });

export const startShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RequestIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("start_shift", {
      _request_id: data.requestId,
    });
    if (error) {
      // Idempotent: another tab/optimistic call may have already started it.
      if (/already started/i.test(error.message)) return { ok: true, already: true } as any;
      throw new Error(error.message);
    }
    return r as any;
  });

export const pauseShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RequestIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("pause_shift", {
      _request_id: data.requestId,
    });
    if (error) {
      if (/not in progress|already paused|not active|no open segment/i.test(error.message)) return { ok: true, already: true } as any;
      throw new Error(error.message);
    }
    return r as any;
  });

export const resumeShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RequestIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("resume_shift", {
      _request_id: data.requestId,
    });
    if (error) {
      if (/already (active|started|in progress)|not paused/i.test(error.message)) return { ok: true, already: true } as any;
      throw new Error(error.message);
    }
    return r as any;
  });

export const endShift = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RequestIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("end_shift", {
      _request_id: data.requestId,
    });
    if (error) {
      if (/already (ended|completed)|not in progress/i.test(error.message)) return { ok: true, already: true } as any;
      throw new Error(error.message);
    }
    return r as { total_billed_amount: number; payment_due_at: string };
  });

export const extendPaymentWindow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RequestIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("extend_payment_window", {
      _request_id: data.requestId,
    });
    if (error) throw new Error(error.message);
    return r as any;
  });

export const getRequestBillingState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RequestIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("get_request_billing_state", {
      _request_id: data.requestId,
    });
    if (error) throw new Error(error.message);
    return r as {
      status: string;
      environment: string;
      total_billed_amount: number | null;
      payment_status: string | null;
      payment_due_at: string | null;
      payment_extension_count: number;
      billing_locked_at: string | null;
      server_now: string;
      segments: Array<{
        id: string;
        segment_index: number;
        started_at: string;
        ended_at: string | null;
        billed_minutes: number | null;
        billed_amount: number | null;
        settled_at: string | null;
      }>;
    };
  });

export const getMyPaymentRestriction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_my_payment_restriction");
    if (error) throw new Error(error.message);
    return data as {
      restricted: boolean;
      restricted_at: string | null;
      overdue: Array<{
        id: string;
        hospital: string | null;
        total_billed_amount: number | null;
        payment_due_at: string | null;
        payment_extension_count: number;
      }>;
    };
  });
