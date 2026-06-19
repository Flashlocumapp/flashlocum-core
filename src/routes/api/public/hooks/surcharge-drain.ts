// Cron hook: applies one surcharge block to every coverage_request whose
// payment_due_at has elapsed (and that hasn't hit the 24-hour cap).
// Called every minute by pg_cron via net.http_post.
//
// Auth: `apikey` header must match SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY.
// The handler calls the SECURITY DEFINER RPC drain_surcharge_due() via the
// service-role client so it bypasses RLS safely.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/surcharge-drain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data, error } = await supabaseAdmin.rpc("drain_surcharge_due" as never);
          if (error) {
            console.error("[surcharge-drain] rpc failed:", error);
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ ok: true, result: data }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("[surcharge-drain] crashed:", e);
          return new Response(JSON.stringify({ error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
