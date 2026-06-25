import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminSystemHealth } from "@/lib/admin.functions";
import { AdminPageHeader, RefreshButton, StatCard, Empty, fmtRelative } from "@/lib/admin-ui";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";

export const Route = createFileRoute("/_admin/admin/system")({
  ssr: false,
  component: SystemPage,
});

function SystemPage() {
  const fetchHealth = useServerFn(adminSystemHealth);
  const q = useQuery({
    queryKey: ["admin", "system"],
    queryFn: () => fetchHealth({ data: {} }),
    staleTime: 30_000,
  });

  const data = q.data;
  const queueAlert = (data?.email.queues ?? []).some((qd) => qd.depth > 25);

  return (
    <div className="mx-auto max-w-[1300px] space-y-6 p-6">
      <AdminPageHeader
        title="System Health"
        subtitle="Platform vitals. Use Refresh for a live snapshot."
        right={<RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />}
      />

      <div>
        <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Activity · last 24h
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Signups" value={data?.activity.signups_24h ?? "—"} />
          <StatCard label="Requests created" value={data?.activity.requests_24h ?? "—"} />
          <StatCard
            label="Completed"
            value={data?.activity.completed_24h ?? "—"}
            tone="presence"
          />
          <StatCard
            label="Cancelled"
            value={data?.activity.cancelled_24h ?? "—"}
            tone={data && data.activity.cancelled_24h > 0 ? "warn" : undefined}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel
          title="Email queues"
          right={queueAlert ? <span className="text-[11px] font-medium text-[#c2410c]">Backlog</span> : null}
        >
          {!data?.email.queues.length ? (
            <Empty>No queues reporting.</Empty>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1.5">Queue</th>
                  <th className="py-1.5 text-right">Depth</th>
                  <th className="py-1.5 text-right">Oldest</th>
                </tr>
              </thead>
              <tbody>
                {data.email.queues.map((qd) => {
                  const isDlq = qd.queue_name.endsWith("_dlq");
                  const tone =
                    qd.depth > 0 && isDlq
                      ? "#b91c1c"
                      : qd.depth > 25
                        ? "#c2410c"
                        : undefined;
                  return (
                    <tr key={qd.queue_name} className="border-t">
                      <td className="py-1.5 font-mono text-[12px]">{qd.queue_name}</td>
                      <td className="py-1.5 text-right tabular-nums" style={{ color: tone }}>
                        {qd.depth}
                      </td>
                      <td className="py-1.5 text-right text-muted-foreground">
                        {qd.oldest_enqueued_at ? fmtRelative(qd.oldest_enqueued_at) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3">
            <Mini label="Sent 24h" value={data?.email.last24h.sent ?? "—"} />
            <Mini
              label="Failed 24h"
              value={data?.email.last24h.failed ?? "—"}
              tone={data && data.email.last24h.failed > 0 ? "#b91c1c" : undefined}
            />
            <Mini label="Suppressed total" value={data?.email.suppressed_total ?? "—"} />
          </div>
        </Panel>

        <Panel title="Push delivery">
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Device tokens" value={data?.push.device_tokens ?? "—"} />
            <StatCard label="Users with tokens" value={data?.push.users_with_tokens ?? "—"} />
          </div>
          {!data?.push.platforms.length ? (
            <div className="mt-3">
              <Empty>No device tokens registered.</Empty>
            </div>
          ) : (
            <div className="mt-4 space-y-1.5">
              {data.push.platforms.map((p) => (
                <div
                  key={p.platform}
                  className="flex items-center justify-between rounded-lg bg-secondary px-3 py-1.5 text-[12.5px]"
                >
                  <span className="font-medium capitalize">{p.platform}</span>
                  <span className="tabular-nums text-muted-foreground">{p.count}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Database">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Profiles" value={data?.database.profiles ?? "—"} />
          <StatCard label="Coverage requests" value={data?.database.coverage_requests ?? "—"} />
          <StatCard label="Ratings" value={data?.database.ratings ?? "—"} />
          <StatCard
            label="Status"
            value={q.isError ? "Error" : q.isFetching ? "Checking…" : "Healthy"}
            tone={q.isError ? "danger" : "presence"}
            live
          />
        </div>
        {q.isError && (
          <div className="mt-3 rounded-lg bg-destructive/10 p-3 text-[12.5px] text-destructive">
            {(q.error as Error).message}
          </div>
        )}
      </Panel>

      <Panel title="Admin action log">
        <p className="mb-3 text-[12px] text-muted-foreground">
          Every privileged admin action — verification decisions, trust changes,
          shift overrides, payment write-offs — is recorded here.
        </p>
        <AuditLogPanel filter={{}} limit={200} />
      </Panel>
    </div>
  );
}

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}
