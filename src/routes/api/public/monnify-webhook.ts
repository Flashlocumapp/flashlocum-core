// Monnify transaction webhook.
// Verifies the monnify-signature header (HMAC-SHA512 of the raw body using
// MONNIFY_SECRET_KEY) and idempotently marks the matching settlement as paid.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

type MonnifyEvent = {
  eventType?: string;
  eventData?: {
    paymentReference?: string;
    paymentStatus?: string;
    amountPaid?: number | string;
  };
};

// Monnify signs with HMAC-SHA512 — output is exactly 128 hex chars.
const SIG_HEX_LEN = 128;
const HEX_RE = /^[0-9a-fA-F]+$/;

function verifyMonnifySignature(signature: string | null, rawBody: string): boolean {
  if (!signature) return false;
  const sig = signature.trim().toLowerCase();
  if (sig.length !== SIG_HEX_LEN || !HEX_RE.test(sig)) return false;

  const secret = process.env.MONNIFY_SECRET_KEY;
  if (!secret) {
    console.error("[monnify-webhook] MONNIFY_SECRET_KEY is not set; rejecting");
    return false;
  }

  // HMAC the RAW request body — re-serializing parsed JSON would change
  // byte order / whitespace and break verification.
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}


export const Route = createFileRoute("/api/public/monnify-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const sig = request.headers.get("monnify-signature");
        if (!verifyMonnifySignature(sig, raw)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: MonnifyEvent;
        try {
          event = JSON.parse(raw) as MonnifyEvent;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const ref = event.eventData?.paymentReference;
        const status = event.eventData?.paymentStatus ?? event.eventType ?? "";
        const amount = Number(event.eventData?.amountPaid ?? 0);

        if (!ref) return new Response("Missing reference", { status: 400 });
        const isSuccess =
          status === "PAID" ||
          status === "SUCCESS" ||
          status === "SUCCESSFUL_TRANSACTION" ||
          event.eventType === "SUCCESSFUL_TRANSACTION";

        if (!isSuccess) {
          // Acknowledge but do nothing for non-success notifications.
          return new Response("ok", { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("mark_settlement_paid", {
          _payment_reference: ref,
          _amount: Math.max(0, Math.round(amount)),
        });
        if (error) {
          console.error("[monnify-webhook] mark_settlement_paid failed:", error);
          return new Response("Server error", { status: 500 });
        }

        // Broadcast an instant invalidate so the requester's settlement
        // screen flips to "paid" the moment we mark it, instead of waiting
        // for the 6-30s polling fallback. coverage_requests is not in the
        // supabase_realtime publication so postgres_changes won't fire here.
        try {
          const ch = supabaseAdmin.channel("coverage_invalidations", {
            config: { broadcast: { self: false } },
          });
          await ch.subscribe();
          await ch.send({
            type: "broadcast",
            event: "invalidate",
            payload: { reference: ref, at: Date.now() },
          });
          await supabaseAdmin.removeChannel(ch);
        } catch (e) {
          console.warn("[monnify-webhook] broadcast failed:", (e as Error).message);
        }

        // Push BOTH parties on confirmed payment (Audit-10 contract).
        try {
          const { data: row } = await supabaseAdmin
            .from("coverage_requests")
            .select("id, accepted_by, requester_id, hospital, settled_amount, updated_at")
            .eq("payment_reference", ref)
            .maybeSingle();
          if (row) {
            const { notifyUser } = await import("@/lib/notify.server");
            const naira = Number(row.settled_amount ?? amount ?? 0);
            const hospital = row.hospital ?? "the hospital";
            const t = row.updated_at ? Date.parse(row.updated_at as string) : Date.now();
            const version = Number.isFinite(t) ? t : Date.now();

            // Look up the doctor's display name once for the requester-facing copy.
            let doctorName = "your doctor";
            if (row.accepted_by) {
              const { data: doc } = await supabaseAdmin
                .from("profiles")
                .select("full_name")
                .eq("id", row.accepted_by)
                .maybeSingle();
              if (doc?.full_name) doctorName = doc.full_name;
            }

            const tasks: Promise<unknown>[] = [];

            if (row.accepted_by) {
              const doctorExtras: Record<string, string> = {
                type: "payment_settled",
                paymentReference: ref,
                requestId: row.id,
              };
              if (row.hospital) doctorExtras.hospitalName = row.hospital;
              if (naira > 0) doctorExtras.amount = String(naira);
              tasks.push(
                notifyUser(row.accepted_by, {
                  title: "Payment received",
                  body: `Payment received for your shift with ${hospital}. Remittance will be made by 10PM today.`,
                  kind: "payment.settled",
                  entityId: ref,
                  version,
                  occurredAt: version,
                  audience: "doctor",
                  data: doctorExtras,
                }),
              );
            }

            // NOTE: requester does NOT receive a background push for
            // payment.settled — they initiated the payment and only need
            // an in-app toast (delivered via the realtime paid_at flip →
            // engine `payment.settled`). Push is doctor-only here.
            void doctorName;


            await Promise.allSettled(tasks);
          }
        } catch (e) {
          console.warn("[monnify-webhook] push failed:", (e as Error).message);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
