import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { adminRiskOverview } from "@/lib/admin.functions";
import {
  AdminPageHeader,
  RefreshButton,
  StatCard,
  Chip,
  Empty,
  fmtRelative,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/risk")({
  ssr: false,
  component: RiskPage,
});

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function RiskPage() {
  const fetchRisk = useServerFn(adminRiskOverview);
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["admin", "risk", days],
    queryFn: () => fetchRisk({ data: { days } }),
    staleTime: 60_000,
  });
  const data = q.data;
  const maxSignup = useMemo(
    () => Math.max(1, ...(data?.signupTrend ?? []).map((d) => d.signups)),
    [data?.signupTrend],
  );

  return (
    <div className="mx-auto max-w-[1300px] space-y-6 p-6">
      <AdminPageHeader
        title="Reliability & Risk"
        subtitle="Early signal on trust-and-safety issues across doctors and requesters."
        right={
          <>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-9 rounded-full bg-secondary px-3 text-[12.5px]"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Doctor cancel rate"
          value={data ? pct(data.totals.cancellation_rate_doctor) : "—"}
          tone={data && data.totals.cancellation_rate_doctor > 0.15 ? "danger" : undefined}
        />
        <StatCard
          label="Requester cancel rate"
          value={data ? pct(data.totals.cancellation_rate_requester) : "—"}
          tone={data && data.totals.cancellation_rate_requester > 0.15 ? "warn" : undefined}
        />
        <StatCard
          label="Cancelled after accept"
          value={data?.totals.requests_cancelled_after_accept ?? "—"}
          tone="warn"
        />
        <StatCard
          label="Unfilled >24h"
          value={data?.totals.requests_unfilled_24h ?? "—"}
          tone={data && data.totals.requests_unfilled_24h > 0 ? "warn" : undefined}
        />
        <StatCard label="Pending verification" value={data?.totals.pending_doctors ?? "—"} />
        <StatCard
          label="Suspended"
          value={data?.totals.suspended_doctors ?? "—"}
          tone={data && data.totals.suspended_doctors > 0 ? "warn" : undefined}
        />
        <StatCard
          label="Rejected"
          value={data?.totals.rejected_doctors ?? "—"}
          tone={data && data.totals.rejected_doctors > 0 ? "danger" : undefined}
        />
        <StatCard
          label="Duplicate MDCN groups"
          value={data?.totals.duplicate_mdcn_groups ?? "—"}
          tone={data && data.totals.duplicate_mdcn_groups > 0 ? "danger" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Top doctor cancellers">
          {!data?.topDoctorCancellers.length ? (
            <Empty>No cancellation patterns detected.</Empty>
          ) : (
            <ActorTable rows={data.topDoctorCancellers} />
          )}
        </Panel>

        <Panel title="Top requester cancellers">
          {!data?.topRequesterCancellers.length ? (
            <Empty>No cancellation patterns detected.</Empty>
          ) : (
            <ActorTable rows={data.topRequesterCancellers} />
          )}
        </Panel>
      </div>

      <Panel title="Duplicate MDCN flags">
        {!data?.duplicateMdcn.length ? (
          <Empty>No duplicate MDCN numbers across onboarded doctors.</Empty>
        ) : (
          <div className="space-y-3">
            {data.duplicateMdcn.map((g) => (
              <div key={g.mdcn} className="rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[13px] font-semibold">{g.mdcn}</div>
                  <Chip color="#b91c1c">{g.count} accounts</Chip>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {g.users.map((u) => (
                    <Link
                      key={u.id}
                      to="/admin/users"
                      className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-[12.5px] hover:opacity-90"
                    >
                      <span className="truncate">{u.name ?? "Unnamed"}</span>
                      <span className="ml-2 shrink-0 text-muted-foreground">
                        {u.verification_status ?? "—"}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={`Signups per day · last ${days}d`}>
          {!data?.signupTrend.length ? (
            <Empty>No signup data.</Empty>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {data.signupTrend.map((d) => (
                <div key={d.day} className="flex-1" title={`${d.day}: ${d.signups}`}>
                  <div
                    className="rounded-t bg-primary/70"
                    style={{ height: `${(d.signups / maxSignup) * 100}%`, minHeight: 2 }}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Stuck searching (>24h)">
          {!data?.stuckSearching.length ? (
            <Empty>No shifts have been stuck searching for over 24h.</Empty>
          ) : (
            <div className="divide-y">
              {data.stuckSearching.map((s) => (
                <div key={s.id} className="flex items-center justify-between py-2 text-[12.5px]">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.hospital}</div>
                    <div className="truncate text-muted-foreground">
                      {s.area} · {s.requester_name ?? "—"}
                    </div>
                  </div>
                  <div className="ml-3 shrink-0 text-muted-foreground">
                    {fmtRelative(s.created_at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-2xl p-4"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ActorTable({
  rows,
}: {
  rows: { user_id: string; name: string | null; total: number; cancelled: number; completed: number; cancellation_rate: number }[];
}) {
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-1.5">Name</th>
          <th className="py-1.5 text-right">Done</th>
          <th className="py-1.5 text-right">Cancel</th>
          <th className="py-1.5 text-right">Rate</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.user_id} className="border-t">
            <td className="py-1.5">
              <div className="truncate font-medium">{r.name ?? "Unnamed"}</div>
              <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                {r.user_id.slice(0, 8)}
              </div>
            </td>
            <td className="py-1.5 text-right tabular-nums">{r.completed}</td>
            <td className="py-1.5 text-right tabular-nums">{r.cancelled}</td>
            <td className="py-1.5 text-right tabular-nums">
              <span
                style={{
                  color: r.cancellation_rate > 0.3 ? "#b91c1c" : r.cancellation_rate > 0.15 ? "#c2410c" : undefined,
                }}
              >
                {pct(r.cancellation_rate)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
