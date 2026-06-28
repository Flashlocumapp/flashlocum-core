import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminDoctorFlashboard, type DoctorFlashboard } from "@/lib/admin.functions";
import { pushToast } from "@/lib/notifications";
import {
  AdminPageHeader,
  Empty,
  RefreshButton,
  StatCard,
  fmtNaira,
  fmtRelative,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/flashboard")({
  ssr: false,
  component: FlashboardPage,
});

function FlashboardPage() {
  const fn = useServerFn(adminDoctorFlashboard);
  const [data, setData] = useState<DoctorFlashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [onlyOnline, setOnlyOnline] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      setData(await fn({ data: {} }));
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setBusy(false);
    }
  }, [fn]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = (data?.rows ?? []).filter((r) => (onlyOnline ? r.online : true));
  const maxRating = Math.max(1, ...(data?.rating_distribution.map((r) => r.count) ?? [0]));

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="Doctor Flashboard"
        subtitle="Operational pulse on the supply side — live status, throughput, and rating health."
        right={<RefreshButton onClick={() => void refresh()} busy={busy} />}
      />

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Online Now"
          value={data?.online_count ?? 0}
          tone="presence"
          live
          hint={`of ${data?.approved_count ?? 0} approved doctors`}
        />
        <StatCard label="Completed Shifts" value={data?.total_completed ?? 0} />
        <StatCard
          label="Completion Rate"
          value={`${Math.round((data?.completion_rate ?? 0) * 100)}%`}
          tone="presence"
        />
        <StatCard
          label="Cancelled Shifts"
          value={data?.total_cancelled ?? 0}
          tone={data?.total_cancelled ? "warn" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <h2 className="text-[13px] font-semibold tracking-tight">Rating distribution</h2>
          <div className="mt-3 space-y-2">
            {(data?.rating_distribution ?? [])
              .slice()
              .reverse()
              .map((r) => (
                <div key={r.score} className="flex items-center gap-2">
                  <div className="w-8 text-[12px] text-muted-foreground">{r.score}★</div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(r.count / maxRating) * 100}%`,
                        background: "var(--color-presence)",
                      }}
                    />
                  </div>
                  <div className="w-10 text-right text-[12px] text-muted-foreground">{r.count}</div>
                </div>
              ))}
            {(!data || data.rating_distribution.every((r) => r.count === 0)) && (
              <Empty>No ratings yet.</Empty>
            )}
          </div>
        </section>

        <section
          className="rounded-2xl p-5 lg:col-span-2"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold tracking-tight">Approved doctors</h2>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyOnline}
                onChange={(e) => setOnlyOnline(e.target.checked)}
              />
              Online only
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="mt-4">
              <Empty>No doctors match.</Empty>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 font-medium">Doctor</th>
                    <th className="px-2 py-2 font-medium">Status</th>
                    <th className="px-2 py-2 font-medium">Completed</th>
                    <th className="px-2 py-2 font-medium">Cancelled</th>
                    <th className="px-2 py-2 font-medium">Completion</th>
                    <th className="px-2 py-2 font-medium">Rating</th>
                    <th className="px-2 py-2 font-medium">Net Earnings</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r) => (
                    <tr key={r.doctor_id} className="border-t">
                      <td className="px-2 py-2">
                        <div className="font-medium">{r.name || "Unnamed"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtRelative(r.last_seen)}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className="inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-semibold uppercase tracking-wider"
                          style={{
                            color: r.online
                              ? "var(--color-presence)"
                              : "var(--color-muted-foreground)",
                            background: r.online
                              ? "color-mix(in oklab, var(--color-presence) 14%, transparent)"
                              : "color-mix(in oklab, currentColor 10%, transparent)",
                          }}
                        >
                          {r.online ? "Online" : "Offline"}
                        </span>
                      </td>
                      <td className="px-2 py-2">{r.completed}</td>
                      <td className="px-2 py-2 text-muted-foreground">{r.cancelled}</td>
                      <td className="px-2 py-2">
                        {r.completed + r.cancelled
                          ? `${Math.round(r.completion_rate * 100)}%`
                          : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {r.rating_count ? `${r.rating.toFixed(2)} (${r.rating_count})` : "—"}
                      </td>
                      <td className="px-2 py-2">{fmtNaira(r.net_earnings)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
