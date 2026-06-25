// Monnify disbursement webhook.
// Fires when Monnify completes the T+1 sub-account settlement to the
// doctor's linked bank. Verifies the monnify-signature header (HMAC-SHA512
// of the raw body using MONNIFY_SECRET_KEY) and idempotently marks the
// matching settlement as remitted via `mark_settlement_remitted`.

import { createFileRoute } from "@tanstack/react-router";

type DisbursementEvent = {
  eventType?: string;
  eventData?: {
    reference?: string;
    paymentReference?: string;
    transactionReference?: string;
    amount?: number | string;
    status?: string;
  };
};

export const Route = createFileRoute("/api/public/monnify-disbursement-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const sig = request.headers.get("monnify-signature");
        const { verifyMonnifySignature } = await import("./_monnify-signature.server");
        if (!verifyMonnifySignature(sig, raw, "monnify-disbursement-webhook")) {
          return new Response("Invalid signature", { status: 401 });
        }

        let event: DisbursementEvent;
        try {
          event = JSON.parse(raw) as DisbursementEvent;
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const ref =
          event.eventData?.paymentReference ??
          event.eventData?.reference ??
          event.eventData?.transactionReference;
        const status = (event.eventData?.status ?? event.eventType ?? "").toUpperCase();
        const amount = Number(event.eventData?.amount ?? 0);
        if (!ref) return new Response("Missing reference", { status: 400 });

        const isSuccess =
          status === "SUCCESS" ||
          status === "SUCCESSFUL" ||
          status === "COMPLETED" ||
          event.eventType === "SUCCESSFUL_DISBURSEMENT";

        if (!isSuccess) {
          // Acknowledge but do nothing for failures / pending notifications.
          return new Response("ok", { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("mark_settlement_remitted", {
          _payment_reference: ref,
          _amount: Math.max(0, Math.round(amount)),
        });
        if (error) {
          console.error("[monnify-disbursement-webhook] mark_settlement_remitted failed:", error);
          return new Response("Server error", { status: 500 });
        }

        // Broadcast invalidate so Earnings + Admin Finance refresh instantly.
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
          console.warn("[monnify-disbursement-webhook] broadcast failed:", (e as Error).message);
        }

        // Notify the doctor that remittance has hit their bank.
        try {
          const { data: row } = await supabaseAdmin
            .from("coverage_requests")
            .select("id, accepted_by, hospital, updated_at")
            .eq("payment_reference", ref)
            .maybeSingle();
          if (row?.accepted_by) {
            const hospital = row.hospital ?? "the hospital";
            const t = row.updated_at ? Date.parse(row.updated_at as string) : Date.now();
            const version = Number.isFinite(t) ? t : Date.now();
            const { notifyUser } = await import("@/lib/notify.server");
            const extras: Record<string, string> = {
              type: "settlement_remitted",
              paymentReference: ref,
              requestId: row.id,
            };
            if (row.hospital) extras.hospitalName = row.hospital;
            await notifyUser(row.accepted_by, {
              title: "Earnings remitted",
              body: `Your earnings for ${hospital} have been successfully remitted to your bank account.`,
              kind: "payment.settled",
              entityId: ref,
              version,
              occurredAt: version,
              audience: "doctor",
              data: extras,
            });
          }
        } catch (e) {
          console.warn("[monnify-disbursement-webhook] push failed:", (e as Error).message);
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
