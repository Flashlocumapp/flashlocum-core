import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminRequesterAnalytics,
  type RequesterAnalytics,
} from "@/lib/admin.functions";
import { pushToast } from "@/lib/notifications";
import {
  AdminPageHeader,
  Empty,
  RefreshButton,
  StatCard,
  fmtNaira,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/requesters")({
  ssr: false,
  component: RequestersPage,
});

const RANGES = [
  { id: 7, label: "7d" },
  { id: 30, label: "30d" },
  { id: 90, label: "90d" },
];

function fmtMin(m: number | null): string {
  if (m == null) return "—";
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function RequestersPage() {
  const fn = useServerFn(adminRequesterAnalytics);
  const [data, setData] = useState<RequesterAnalytics | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(30);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await fn({ data: { days } }));
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setBusy(false);
    }
  }, [fn, days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const maxHosp = Math.max(1, ...(data?.topHospitals.map((h) => h.count) ?? [0]));
  const maxArea = Math.max(1, ...(data?.topAreas.map((a) => a.count) ?? [0]));

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="Requester Analytics"
        subtitle="Demand-side health: volume, time-to-fill, cancellations, and repeat behavior."
        right={
          <div className="flex items-center gap-2">
            <div className="flex h-9 items-center rounded-full bg-secondary p-0.5">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setDays(r.id)}
                  className={`h-8 rounded-full px-3 text-[12px] font-medium ${
                    days === r.id ? "bg-background shadow" : ""
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <RefreshButton onClick={() => void refresh()} busy={busy} />
          </div>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Requests" value={data?.totals.requests ?? 0} />
        <StatCard label="Active Requesters" value={data?.totals.requesters ?? 0} />
        <StatCard
          label="Avg Time to Fill"
          value={fmtMin(data?.totals.avg_time_to_fill_min ?? null)}
          tone="presence"
        />
        <StatCard
          label="Cancellation Rate"
          value={pct(data?.totals.cancellation_rate ?? 0)}
          tone={data && data.totals.cancellation_rate > 0.15 ? "warn" : undefined}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Completed" value={data?.totals.completed ?? 0} />
        <StatCard label="Cancelled" value={data?.totals.cancelled ?? 0} />
        <StatCard label="Unfilled (Searching)" value={data?.totals.unfilled ?? 0} tone="warn" />
        <StatCard
          label="Repeat Requesters"
          value={pct(data?.totals.repeat_requester_rate ?? 0)}
          hint="2+ requests in window"
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <h2 className="text-[13px] font-semibold tracking-tight">Top hospitals by volume</h2>
          <div className="mt-3 space-y-2">
            {(data?.topHospitals ?? []).map((h) => (
              <div key={h.hospital}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="truncate pr-3">{h.hospital}</span>
                  <span className="text-muted-foreground">
                    {h.count} · {fmtNaira(h.amount)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(h.count / maxHosp) * 100}%`,
                      background: "var(--color-presence)",
                    }}
                  />
                </div>
              </div>
            ))}
            {(!data || data.topHospitals.length === 0) && <Empty>No data.</Empty>}
          </div>
        </section>

        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <h2 className="text-[13px] font-semibold tracking-tight">Top areas</h2>
          <div className="mt-3 space-y-2">
            {(data?.topAreas ?? []).map((a) => (
              <div key={a.area}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="truncate pr-3">{a.area}</span>
                  <span className="text-muted-foreground">{a.count}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(a.count / maxArea) * 100}%`,
                      background: "#2563eb",
                    }}
                  />
                </div>
              </div>
            ))}
            {(!data || data.topAreas.length === 0) && <Empty>No data.</Empty>}
          </div>
        </section>
      </div>

      <section
        className="mt-5 rounded-2xl p-5"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <h2 className="text-[13px] font-semibold tracking-tight">Requester leaderboard</h2>
        {(data?.rows ?? []).length === 0 ? (
          <div className="mt-3">
            <Empty>No requesters in this window.</Empty>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">Requester</th>
                  <th className="px-2 py-2 font-medium">Total</th>
                  <th className="px-2 py-2 font-medium">Completed</th>
                  <th className="px-2 py-2 font-medium">Cancelled</th>
                  <th className="px-2 py-2 font-medium">In Progress</th>
                  <th className="px-2 py-2 font-medium">Unfilled</th>
                  <th className="px-2 py-2 font-medium">Avg Fill</th>
                  <th className="px-2 py-2 font-medium">Cancel %</th>
                  <th className="px-2 py-2 font-medium">Spend</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((r) => (
                  <tr key={r.requester_id} className="border-t">
                    <td className="px-2 py-2 font-medium">{r.name || "Unnamed"}</td>
                    <td className="px-2 py-2">{r.total}</td>
                    <td className="px-2 py-2">{r.completed}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.cancelled}</td>
                    <td className="px-2 py-2">{r.in_progress}</td>
                    <td className="px-2 py-2">{r.unfilled}</td>
                    <td className="px-2 py-2">{fmtMin(r.avg_time_to_fill_min)}</td>
                    <td
                      className="px-2 py-2"
                      style={{
                        color: r.cancellation_rate > 0.2 ? "#b91c1c" : undefined,
                      }}
                    >
                      {pct(r.cancellation_rate)}
                    </td>
                    <td className="px-2 py-2">{fmtNaira(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
