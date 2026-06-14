// Monnify transaction webhook.
// Verifies the monnify-signature header (HMAC-SHA512 of the raw body using
// MONNIFY_SECRET_KEY) and idempotently marks the matching settlement as paid.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

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

function verify(signature: string | null, rawBody: string): boolean {
  // Reject missing / empty / malformed signatures up front so we never reach
  // timingSafeEqual with attacker-controlled length.
  if (!signature) return false;
  const sig = signature.trim().toLowerCase();
  if (sig.length !== SIG_HEX_LEN || !HEX_RE.test(sig)) return false;

  const secret = process.env.MONNIFY_SECRET_KEY;
  if (!secret) {
    console.error("[monnify-webhook] MONNIFY_SECRET_KEY is not set; rejecting");
    return false;
  }

  // HMAC the RAW request body (not parsed JSON — re-serializing would change
  // byte order / whitespace and break verification).
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");

  // Compare as fixed-length hex buffers; timingSafeEqual requires equal length.
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
        if (!verify(sig, raw)) {
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

        // Push the doctor who covered this shift.
        try {
          const { data: row } = await supabaseAdmin
            .from("coverage_requests")
            .select("accepted_by, hospital, settled_amount")
            .eq("payment_reference", ref)
            .maybeSingle();
          if (row?.accepted_by) {
            const { sendPushToUser } = await import("@/lib/push.server");
            const naira = Number(row.settled_amount ?? amount ?? 0);
            await sendPushToUser(row.accepted_by, {
              title: "Payment received",
              body: `You've been paid${naira > 0 ? ` ₦${naira.toLocaleString()}` : ""}${row.hospital ? ` for ${row.hospital}` : ""}.`,
              data: { type: "payment_settled", paymentReference: ref },
            });
          }
        } catch (e) {
          console.warn("[monnify-webhook] push failed:", (e as Error).message);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
