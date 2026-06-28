/**
 * Compact audit-log table reused by the System page, user/shift/payment
 * drawers, and any other surface that needs to show admin_actions filtered
 * to a target.
 */
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminListActions, type AdminActionRow } from "@/lib/admin-ops.functions";
import { Empty, fmt } from "@/lib/admin-ui";

export function AuditLogPanel({
  filter,
  limit = 100,
  emptyLabel = "No admin actions recorded yet.",
}: {
  filter: {
    targetUserId?: string;
    targetShiftId?: string;
    actorUserId?: string;
    action?: string;
    actionPrefix?: string;
  };
  limit?: number;
  emptyLabel?: string;
}) {
  const fetchActions = useServerFn(adminListActions);
  const q = useQuery({
    queryKey: ["admin", "actions", filter, limit],
    queryFn: () => fetchActions({ data: { ...filter, limit } }),
    staleTime: 30_000,
  });

  const rows = q.data ?? [];

  if (q.isLoading) {
    return <div className="px-2 py-3 text-[12.5px] text-muted-foreground">Loading…</div>;
  }
  if (q.isError) {
    return (
      <div className="px-2 py-3 text-[12.5px] text-destructive">{(q.error as Error).message}</div>
    );
  }
  if (rows.length === 0) {
    return <Empty>{emptyLabel}</Empty>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-[12.5px]">
        <thead className="bg-secondary/60 text-left text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Action</th>
            <th className="px-3 py-2 font-medium">Actor</th>
            <th className="px-3 py-2 font-medium">Target</th>
            <th className="px-3 py-2 font-medium">Reason / note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t align-top">
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                {fmt(r.created_at)}
              </td>
              <td className="px-3 py-2 font-mono text-[11.5px]">{r.action}</td>
              <td className="px-3 py-2">
                <div>{r.actor_name || "—"}</div>
                <div className="text-[10.5px] font-mono text-muted-foreground">
                  {r.actor_user_id.slice(0, 8)}…
                </div>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <TargetCell row={r} />
              </td>
              <td className="px-3 py-2">
                {r.reason && <div>{r.reason}</div>}
                {r.note && <div className="text-[11.5px] text-muted-foreground">{r.note}</div>}
                {r.payload && (
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                    {JSON.stringify(r.payload)}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TargetCell({ row }: { row: AdminActionRow }) {
  const parts: string[] = [];
  if (row.target_user_name) parts.push(`user: ${row.target_user_name}`);
  else if (row.target_user_id) parts.push(`user: ${row.target_user_id.slice(0, 8)}…`);
  if (row.target_shift_id) parts.push(`shift: ${row.target_shift_id.slice(0, 8)}…`);
  if (row.target_payment_ref) parts.push(`ref: ${row.target_payment_ref}`);
  return <>{parts.join(" · ") || "—"}</>;
}
