import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListUnpaidShifts,
  type AdminUnpaidShiftRow,
} from "@/lib/admin.functions";
import { pushToast } from "@/lib/notifications";
import {
  AdminPageHeader,
  Chip,
  Empty,
  RefreshButton,
  fmtNaira,
  fmtRelative,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/unpaid")({
  ssr: false,
  component: AdminUnpaidPage,
});

function dueState(due: string | null): {
  label: string;
  color: string;
} {
  if (!due) return { label: "—", color: "var(--color-muted-foreground)" };
  const ms = Date.parse(due) - Date.now();
  if (Number.isNaN(ms)) return { label: "—", color: "var(--color-muted-foreground)" };
  if (ms <= 0) return { label: "Overdue", color: "#b91c1c" };
  if (ms < 5 * 60 * 1000) return { label: "Due now", color: "#c2410c" };
  return { label: "Pending", color: "#2563eb" };
}

function AdminUnpaidPage() {
  const list = useServerFn(adminListUnpaidShifts);
  const [rows, setRows] = useState<AdminUnpaidShiftRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [q, setQ] = useState("");

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await list({ data: undefined });
      setRows(data);
    } catch (e) {
      pushToast({ tone: "warn", title: (e as Error).message || "Refresh failed." });
    } finally {
      setRefreshing(false);
    }
  }, [list]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.hospital, r.area, r.requester_name, r.requester_email, r.doctor_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  const totals = useMemo(() => {
    let outstanding = 0;
    let cappedCount = 0;
    for (const r of rows) {
      outstanding += r.total_billed_amount ?? 0;
      const cap = (r as unknown as { surcharge_capped_at?: string | null })
        .surcharge_capped_at;
      if (cap) cappedCount += 1;
    }
    return { outstanding, cappedCount };
  }, [rows]);

  return (
    <div className="p-6 lg:p-8">
      <AdminPageHeader
        title="Unpaid Shifts"
        subtitle={`${filtered.length} of ${rows.length} outstanding · ${fmtNaira(totals.outstanding)} · ${totals.cappedCount} at 24h cap`}
        right={<RefreshButton onClick={() => void refresh()} busy={refreshing} />}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search hospital, area, requester, doctor…"
          className="h-10 flex-1 min-w-[260px] rounded-xl bg-secondary px-4 text-[13.5px] outline-none"
        />
      </div>

      <div
        className="mt-5 overflow-hidden rounded-2xl border"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        {filtered.length === 0 ? (
          <div className="p-6">
            <Empty>No outstanding payments.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                  <th className="px-4 py-2.5 font-medium">Hospital</th>
                  <th className="px-4 py-2.5 font-medium">Requester</th>
                  <th className="px-4 py-2.5 font-medium">Doctor</th>
                  <th className="px-4 py-2.5 font-medium">Outstanding</th>
                  <th className="px-4 py-2.5 font-medium">Extensions</th>
                  <th className="px-4 py-2.5 font-medium">Payment due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const ds = dueState(r.payment_due_at);
                  const cap = (r as unknown as { surcharge_capped_at?: string | null })
                    .surcharge_capped_at;
                  const capped = !!cap;
                  return (
                    <tr key={r.id} className="border-t hover:bg-secondary/30 align-top">
                      <td className="px-4 py-2.5">
                        <Chip color={ds.color}>{ds.label}</Chip>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium tracking-tight">{r.hospital}</div>
                        <div className="text-[11.5px] text-muted-foreground">{r.area}</div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        <div className="text-foreground">{r.requester_name || "—"}</div>
                        <div className="text-[11.5px] truncate max-w-[200px]">
                          {r.requester_email || ""}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        <div className="text-foreground">{r.doctor_name || "—"}</div>
                        <div className="text-[11.5px]">{r.doctor_phone || ""}</div>
                      </td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums">
                        {fmtNaira(r.total_billed_amount ?? 0)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11.5px] font-medium"
                          style={{
                            color: capped ? "#b91c1c" : "var(--color-muted-foreground)",
                            background: capped
                              ? "color-mix(in oklab, #b91c1c 14%, transparent)"
                              : "var(--color-secondary)",
                          }}
                        >
                          {r.payment_extension_count} × 15min
                          {capped ? " · 24h cap" : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        <div>{fmtRelative(r.payment_due_at)}</div>
                        <div className="text-[11px]">
                          updated {fmtRelative(r.updated_at)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
