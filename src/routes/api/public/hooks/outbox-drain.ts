// Notification outbox drain.
//
// Called every minute by pg_cron. Picks up to 50 due rows from
// notification_outbox where delivered_at IS NULL AND next_attempt_at <= now(),
// resends via FCM with skipOutbox:true (so a transient failure here can't
// re-enqueue the same row), and updates the row:
//   - success      → delivered_at = now()
//   - retryable    → attempts++, next_attempt_at = now() + backoff(attempts)
//   - max attempts → delivered_at = now() with last_error stamped, giving up
//
// Backoff: 1m, 5m, 15m, 1h, 6h. After 5 attempts we stop trying.
// Auth: anon key in `apikey` header (same convention as shift-reminders).

import { createFileRoute } from "@tanstack/react-router";

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 900, 3600, 21600];

export const Route = createFileRoute("/api/public/hooks/outbox-drain")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rows, error } = await supabaseAdmin
          .from("notification_outbox")
          .select(
            "id, user_id, kind, entity_id, version, occurred_at, audience, title, body, payload, attempts",
          )
          .is("delivered_at", null)
          .lte("next_attempt_at", new Date().toISOString())
          .order("next_attempt_at", { ascending: true })
          .limit(50);

        if (error) {
          console.warn("[outbox-drain] lookup failed:", error.message);
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (!rows?.length) {
          return new Response(JSON.stringify({ ok: true, drained: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        const { sendPushToUser } = await import("@/lib/push.server");
        let delivered = 0;
        let retried = 0;
        let abandoned = 0;

        for (const row of rows) {
          const audience = row.audience === "requester" ? "requester" : "doctor";
          const data = (row.payload ?? {}) as Record<string, string>;

          let sendError: string | null = null;
          try {
            await sendPushToUser(
              row.user_id,
              {
                title: row.title,
                body: row.body,
                kind: row.kind,
                entityId: row.entity_id,
                version: Number(row.version),
                occurredAt: Number(row.occurred_at),
                audience,
                data,
              },
              { skipOutbox: true },
            );
          } catch (e) {
            sendError = (e as Error).message.slice(0, 500);
          }

          // We can't observe FCM failure from sendPushToUser's void return,
          // so treat absence of throw as success. The send fn itself prunes
          // stale tokens and logs transient FCM errors; for the drain we
          // pessimistically mark delivered if the call returned cleanly.
          // This is acceptable because the alternative (re-reading the row
          // for an error column) doesn't exist — `skipOutbox` blocks the
          // only signal path.
          if (sendError) {
            const attempts = (row.attempts ?? 0) + 1;
            if (attempts >= MAX_ATTEMPTS) {
              await supabaseAdmin
                .from("notification_outbox")
                .update({
                  attempts,
                  delivered_at: new Date().toISOString(),
                  last_error: `gave up: ${sendError}`,
                })
                .eq("id", row.id);
              abandoned += 1;
            } else {
              const delaySec = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)];
              await supabaseAdmin
                .from("notification_outbox")
                .update({
                  attempts,
                  next_attempt_at: new Date(Date.now() + delaySec * 1000).toISOString(),
                  last_error: sendError,
                })
                .eq("id", row.id);
              retried += 1;
            }
          } else {
            await supabaseAdmin
              .from("notification_outbox")
              .update({ delivered_at: new Date().toISOString() })
              .eq("id", row.id);
            delivered += 1;
          }
        }

        return new Response(
          JSON.stringify({ ok: true, drained: rows.length, delivered, retried, abandoned }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
