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

function verify(signature: string | null, rawBody: string): boolean {
  if (!signature) return false;
  const secret = process.env.MONNIFY_SECRET_KEY;
  if (!secret) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature.toLowerCase());
  const b = Buffer.from(expected.toLowerCase());
  if (a.length !== b.length) return false;
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
