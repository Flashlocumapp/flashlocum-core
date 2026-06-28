import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminFinanceAnalytics, type FinanceAnalytics } from "@/lib/admin.functions";
import { pushToast } from "@/lib/notifications";
import { AdminPageHeader, Empty, RefreshButton, StatCard, fmtNaira } from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/finance")({
  ssr: false,
  component: FinancePage,
});

const RANGES: { id: number; label: string }[] = [
  { id: 7, label: "7d" },
  { id: 30, label: "30d" },
  { id: 90, label: "90d" },
];

function FinancePage() {
  const fn = useServerFn(adminFinanceAnalytics);
  const [data, setData] = useState<FinanceAnalytics | null>(null);
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

  const maxBar = useMemo(() => Math.max(1, ...(data?.series.map((s) => s.gross) ?? [0])), [data]);
  const maxHospital = useMemo(
    () => Math.max(1, ...(data?.topHospitals.map((h) => h.gross) ?? [0])),
    [data],
  );
  const maxDoctor = useMemo(
    () => Math.max(1, ...(data?.topDoctors.map((d) => d.net) ?? [0])),
    [data],
  );

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="Financial Analytics"
        subtitle="Gross revenue, platform fees, doctor net, and payouts pending remittance."
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
        <StatCard label="Gross Revenue" value={fmtNaira(data?.totals.gross ?? 0)} tone="presence" />
        <StatCard label="Platform Fees" value={fmtNaira(data?.totals.fees ?? 0)} />
        <StatCard label="Doctor Net" value={fmtNaira(data?.totals.net ?? 0)} />
        <StatCard
          label="Payouts Pending"
          value={fmtNaira(data?.totals.unremitted_amount ?? 0)}
          tone="warn"
          hint={`${data?.totals.pending_payout_count ?? 0} shifts awaiting remittance`}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section
          className="rounded-2xl p-5 lg:col-span-2"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <h2 className="text-[13px] font-semibold tracking-tight">Daily gross revenue</h2>
          <p className="text-[11.5px] text-muted-foreground">
            Paid coverage requests, bucketed by payment date.
          </p>
          {!data || data.series.length === 0 ? (
            <div className="mt-4">
              <Empty>No revenue in this window.</Empty>
            </div>
          ) : (
            <div className="mt-4 flex h-44 items-end gap-1">
              {data.series.map((s) => {
                const h = (s.gross / maxBar) * 100;
                return (
                  <div
                    key={s.date}
                    className="group relative flex-1"
                    title={`${s.date}: ${fmtNaira(s.gross)} (${s.count})`}
                  >
                    <div
                      className="w-full rounded-t-sm"
                      style={{
                        height: `${h}%`,
                        background:
                          s.gross > 0
                            ? "var(--color-presence)"
                            : "color-mix(in oklab, var(--color-muted-foreground) 14%, transparent)",
                        minHeight: 2,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex justify-between text-[10.5px] text-muted-foreground">
            <span>{data?.series[0]?.date}</span>
            <span>{data?.series[data.series.length - 1]?.date}</span>
          </div>
        </section>

        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <h2 className="text-[13px] font-semibold tracking-tight">Payment status</h2>
          <div className="mt-3 space-y-2.5">
            {(data?.paymentStatus ?? []).map((p) => (
              <div key={p.status} className="flex items-center justify-between text-[12.5px]">
                <span className="capitalize">{p.status}</span>
                <span className="text-muted-foreground">
                  {p.count} · {fmtNaira(p.amount)}
                </span>
              </div>
            ))}
            {(!data || data.paymentStatus.length === 0) && <Empty>No payments yet.</Empty>}
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <h2 className="text-[13px] font-semibold tracking-tight">Top hospitals by gross</h2>
          <div className="mt-3 space-y-2">
            {(data?.topHospitals ?? []).map((h) => (
              <div key={h.hospital}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="truncate pr-3">{h.hospital}</span>
                  <span className="text-muted-foreground">
                    {fmtNaira(h.gross)} · {h.count}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(h.gross / maxHospital) * 100}%`,
                      background: "var(--color-presence)",
                    }}
                  />
                </div>
              </div>
            ))}
            {(!data || data.topHospitals.length === 0) && <Empty>No paid shifts yet.</Empty>}
          </div>
        </section>

        <section
          className="rounded-2xl p-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <h2 className="text-[13px] font-semibold tracking-tight">Top earning doctors (net)</h2>
          <div className="mt-3 space-y-2">
            {(data?.topDoctors ?? []).map((d) => (
              <div key={d.doctor_id}>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="truncate pr-3">{d.name || "Unnamed doctor"}</span>
                  <span className="text-muted-foreground">
                    {fmtNaira(d.net)} · {d.count}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(d.net / maxDoctor) * 100}%`,
                      background: "#2563eb",
                    }}
                  />
                </div>
              </div>
            ))}
            {(!data || data.topDoctors.length === 0) && <Empty>No earnings yet.</Empty>}
          </div>
        </section>
      </div>
    </div>
  );
}
