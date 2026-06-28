// Pre-shift reminder cron handler.
//
// Called every 5 minutes by pg_cron. Finds confirmed coverage requests that
// start in the next 55–65 minutes and haven't had a reminder sent yet, then
// pushes both the doctor and the requester with a "starts in 1 hour" notice.
// Stamps `reminder_sent_at` so we never double-fire.
//
// Auth: caller must present the project anon key in the `apikey` header.
// This matches the documented pg_cron pattern and avoids inventing a new
// shared-secret env var.

import { createFileRoute } from "@tanstack/react-router";

const REMINDER_WINDOW_MS = 5 * 60 * 1000;
const REMINDER_TARGET_MS = 60 * 60 * 1000; // T-60 min

export const Route = createFileRoute("/api/public/hooks/shift-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Authn: require the anon key. This route is on /api/public/* so the
        // platform doesn't gate it; we still want to reject random callers.
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
        if (!apikey || !expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = Date.now();
        const windowStart = now + REMINDER_TARGET_MS - REMINDER_WINDOW_MS;
        const windowEnd = now + REMINDER_TARGET_MS + REMINDER_WINDOW_MS;

        const { data: rows, error } = await supabaseAdmin
          .from("coverage_requests")
          .select("id, start_ts, hospital, accepted_by, requester_id, status, reminder_sent_at")
          .gte("start_ts", windowStart)
          .lte("start_ts", windowEnd)
          .is("reminder_sent_at", null)
          .in("status", ["accepted", "active", "paused"]);

        if (error) {
          console.warn("[shift-reminders] lookup failed:", error.message);
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!rows?.length) {
          return new Response(JSON.stringify({ ok: true, sent: 0 }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        const { notifyUser } = await import("@/lib/notify.server");
        let sent = 0;

        // Batch-fetch the doctor display names for every reminder we're
        // about to send so the requester-facing copy ("Dr. {name}'s shift…")
        // can name the doctor.
        const doctorIds = Array.from(
          new Set(rows.map((r) => r.accepted_by).filter((x): x is string => !!x)),
        );
        const doctorNames = new Map<string, string>();
        if (doctorIds.length) {
          const { data: docs } = await supabaseAdmin
            .from("profiles")
            .select("id, full_name")
            .in("id", doctorIds);
          for (const d of docs ?? []) {
            if (d.full_name) doctorNames.set(d.id, d.full_name);
          }
        }

        for (const row of rows) {
          if (!row.accepted_by) continue;
          const hospital = row.hospital ?? "the hospital";
          const startMs = Number(row.start_ts);
          if (!Number.isFinite(startMs)) continue;
          const doctorName = doctorNames.get(row.accepted_by) ?? "your doctor";

          // Push both audiences. Failures are tolerated — the next cron tick
          // won't retry (reminder_sent_at is stamped below regardless), but
          // FCM retries are best-effort by design and the in-app card already
          // shows the upcoming shift.
          await Promise.allSettled([
            notifyUser(row.accepted_by, {
              title: "Reminder",
              body: `Reminder: your shift with ${hospital} starts in 1 hour.`,
              kind: "reminder.preshift",
              entityId: row.id,
              version: startMs,
              occurredAt: now,
              audience: "doctor",
              data: {
                type: "preshift_reminder",
                requestId: row.id,
                hospitalName: row.hospital ?? "",
              },
            }),
            row.requester_id
              ? notifyUser(row.requester_id, {
                  title: "Reminder",
                  body: `Reminder: Dr. ${doctorName}'s shift starts in 1 hour.`,
                  kind: "reminder.preshift",
                  entityId: row.id,
                  version: startMs,
                  occurredAt: now,
                  audience: "requester",
                  data: {
                    type: "preshift_reminder",
                    requestId: row.id,
                    doctorName,
                  },
                })
              : Promise.resolve(),
          ]);

          const { error: stampError } = await supabaseAdmin
            .from("coverage_requests")
            .update({ reminder_sent_at: new Date(now).toISOString() })
            .eq("id", row.id)
            .is("reminder_sent_at", null);

          if (!stampError) sent += 1;
        }

        return new Response(JSON.stringify({ ok: true, sent }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
