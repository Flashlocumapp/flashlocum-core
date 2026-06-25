// Daily reconciliation for Monnify disbursements.
//
// Backstop for `monnify-disbursement-webhook`: if Monnify ever drops a
// SUCCESSFUL_DISBURSEMENT callback (network blip, signature mismatch,
// dashboard not wired yet), this cron picks up any paid request whose
// settlement is still unremitted after 36h, asks Monnify for the current
// disbursement status by reference, and idempotently marks completions
// via `mark_settlement_remitted`.
//
// Auth: standard `apikey` header (Supabase anon key) — `/api/public/*`
// bypasses Lovable's published-site auth, so we gate inside the handler.

import { createFileRoute } from "@tanstack/react-router";

type DisbursementSummary = {
  amount?: number | string;
  status?: string;
  reference?: string;
};

const POLL_LIMIT = 50;

export const Route = createFileRoute("/api/public/hooks/reconcile-settlements")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("x-api-key");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();

        const { data: rows, error } = await supabaseAdmin
          .from("coverage_requests")
          .select("id, payment_reference, paid_at, remitted_at, payment_status, accepted_by, hospital, updated_at")
          .eq("payment_status", "paid")
          .is("remitted_at", null)
          .lt("paid_at", cutoff)
          .not("payment_reference", "is", null)
          .limit(POLL_LIMIT);

        if (error) {
          console.error("[reconcile-settlements] query failed:", error);
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!rows || rows.length === 0) {
          return Response.json({ checked: 0, remitted: 0 });
        }

        const { monnifyFetch } = await import("@/lib/monnify/client.server");
        let remitted = 0;

        for (const row of rows) {
          const ref = row.payment_reference as string | null;
          if (!ref) continue;
          try {
            const summary = await monnifyFetch<DisbursementSummary>(
              `/api/v2/disbursements/single/summary?reference=${encodeURIComponent(ref)}`,
            );
            const status = (summary.status ?? "").toUpperCase();
            if (status !== "SUCCESS" && status !== "SUCCESSFUL" && status !== "COMPLETED") {
              continue;
            }
            const amount = Number(summary.amount ?? 0);
            const { error: rpcErr } = await supabaseAdmin.rpc("mark_settlement_remitted", {
              _payment_reference: ref,
              _amount: Math.max(0, Math.round(amount)),
            });
            if (rpcErr) {
              console.error("[reconcile-settlements] mark failed for", ref, rpcErr);
              continue;
            }
            remitted += 1;

            // Notify doctor + broadcast invalidation (mirrors webhook path).
            try {
              const ch = supabaseAdmin.channel("coverage_invalidations", {
                config: { broadcast: { self: false } },
              });
              await ch.subscribe();
              await ch.send({
                type: "broadcast",
                event: "invalidate",
                payload: { reference: ref, at: Date.now(), source: "reconcile" },
              });
              await supabaseAdmin.removeChannel(ch);
            } catch (e) {
              console.warn("[reconcile-settlements] broadcast failed:", (e as Error).message);
            }

            if (row.accepted_by) {
              try {
                const { notifyUser } = await import("@/lib/notify.server");
                const hospital = row.hospital ?? "the hospital";
                const t = row.updated_at ? Date.parse(row.updated_at as string) : Date.now();
                const version = Number.isFinite(t) ? t : Date.now();
                await notifyUser(row.accepted_by as string, {
                  title: "Earnings remitted",
                  body: `Your earnings for ${hospital} have been successfully remitted to your bank account.`,
                  kind: "payment.settled",
                  entityId: ref,
                  version,
                  occurredAt: version,
                  audience: "doctor",
                  data: {
                    type: "settlement_remitted",
                    paymentReference: ref,
                    requestId: row.id as string,
                    ...(row.hospital ? { hospitalName: row.hospital as string } : {}),
                  },
                });
              } catch (e) {
                console.warn("[reconcile-settlements] push failed:", (e as Error).message);
              }
            }
          } catch (e) {
            console.warn("[reconcile-settlements] monnify lookup failed for", ref, (e as Error).message);
          }
        }

        return Response.json({ checked: rows.length, remitted });
      },
    },
  },
});
