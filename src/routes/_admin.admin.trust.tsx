import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AdminPageHeader, RefreshButton, Empty, fmt } from "@/lib/admin-ui";
import type { TrustSnapshot } from "@/lib/trust";
import {
  adminListTrustHistory,
  adminTrustClear,
  adminTrustRestrict,
  adminTrustFreeze,
  adminTrustUnfreeze,
  adminTrustEscalate,
  type TrustHistoryRow,
} from "@/lib/admin-ops.functions";
import { pushToast } from "@/lib/notifications";

export const Route = createFileRoute("/_admin/admin/trust")({
  ssr: false,
  component: TrustPage,
});

type TrustRow = {
  user_id: string;
  full_name: string | null;
  role: string | null;
  snapshot: TrustSnapshot;
};

async function fetchTrustList(onlyFlagged: boolean): Promise<TrustRow[]> {
  const { data, error } = await supabase.rpc("admin_list_trust", {
    _only_flagged: onlyFlagged,
    _limit: 500,
  });
  if (error) throw error;
  return (data ?? []) as TrustRow[];
}

function TrustPage() {
  const qc = useQueryClient();
  const restrictFn = useServerFn(adminTrustRestrict);
  const clearFn = useServerFn(adminTrustClear);
  const freezeFn = useServerFn(adminTrustFreeze);
  const unfreezeFn = useServerFn(adminTrustUnfreeze);
  const escalateFn = useServerFn(adminTrustEscalate);
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});
  const [historyFor, setHistoryFor] = useState<TrustRow | null>(null);

  const q = useQuery({
    queryKey: ["admin", "trust", onlyFlagged],
    queryFn: () => fetchTrustList(onlyFlagged),
    staleTime: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "trust"] });
    qc.invalidateQueries({ queryKey: ["admin", "trust-history"] });
    qc.invalidateQueries({ queryKey: ["admin", "actions"] });
  };

  const restrict = useMutation({
    mutationFn: (vars: { userId: string; reason: string }) =>
      restrictFn({ data: { userId: vars.userId, reason: vars.reason } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Restriction applied." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const clear = useMutation({
    mutationFn: (userId: string) => clearFn({ data: { userId } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Restriction cleared." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const freeze = useMutation({
    mutationFn: (vars: { userId: string; reason: string }) =>
      freezeFn({ data: { userId: vars.userId, reason: vars.reason } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "User trust frozen." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const unfreeze = useMutation({
    mutationFn: (userId: string) => unfreezeFn({ data: { userId } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Freeze lifted." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const escalate = useMutation({
    mutationFn: (vars: { userId: string; note: string }) =>
      escalateFn({ data: { userId: vars.userId, note: vars.note } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Escalated." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const rows = q.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Trust Snapshots"
        subtitle="Computed rating + reliability per user. Restrict, freeze, or escalate from this page; every action is recorded in the audit log."
        right={<RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />}
      />

      <div className="flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          Only show flagged (doctor rating &lt; 4.0 / requester &lt; 3.5, or reliability below role
          threshold)
        </label>
        <span className="text-muted-foreground">
          — {rows.length} user{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {q.isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>{onlyFlagged ? "No flagged users" : "No users with snapshots yet"}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Rating</th>
                <th className="px-3 py-2">Reliability</th>
                <th className="px-3 py-2">Eligibility</th>
                <th className="px-3 py-2">Restriction</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = row.snapshot;
                const flagged = s?.eligibility?.any;
                const restricted = s?.restriction?.restricted;
                return (
                  <tr key={row.user_id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.full_name || "—"}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {row.user_id.slice(0, 8)}…
                      </div>
                      <Link
                        to="/admin/ratings"
                        search={{
                          ratee:
                            row.role === "doctor" ? `doc:${row.user_id}` : `req:${row.user_id}`,
                        }}
                        className="text-[11px] underline text-muted-foreground hover:text-foreground"
                      >
                        View comments
                      </Link>
                    </td>
                    <td className="px-3 py-2 capitalize">{row.role || "—"}</td>
                    <td className="px-3 py-2">
                      <div
                        className={
                          s?.eligibility?.rating_below_threshold
                            ? "text-destructive font-semibold"
                            : ""
                        }
                      >
                        {Number(s?.rating?.score ?? 5).toFixed(2)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {s?.rating?.block_index ?? 0} block
                        {(s?.rating?.block_index ?? 0) === 1 ? "" : "s"} ·{" "}
                        {s?.rating?.in_progress_count ?? 0}/{s?.rating?.block_size ?? 20} pending
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div
                        className={
                          s?.eligibility?.reliability_below_threshold
                            ? "text-destructive font-semibold"
                            : ""
                        }
                      >
                        {Math.round(Number(s?.reliability?.score ?? 100))}%
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {s?.reliability?.block_index ?? 0} block
                        {(s?.reliability?.block_index ?? 0) === 1 ? "" : "s"} ·{" "}
                        {s?.reliability?.in_progress_count ?? 0}/{s?.reliability?.block_size ?? 20}{" "}
                        pending
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {flagged ? (
                        <div className="space-y-1">
                          <span className="inline-block rounded bg-destructive/10 text-destructive px-1.5 py-0.5 text-[11px] font-semibold">
                            FLAGGED
                          </span>
                          {(s?.eligibility?.reasons ?? []).map((r, i) => (
                            <div key={i} className="text-[11px] text-muted-foreground">
                              {r}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">ok</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {restricted ? (
                        <div>
                          <span className="inline-block rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[11px] font-semibold">
                            RESTRICTED
                          </span>
                          <div className="text-[11px] text-muted-foreground mt-1">
                            {s.restriction.reason || "—"}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        {restricted ? (
                          <button
                            className="text-xs rounded border px-2 py-1 hover:bg-muted"
                            onClick={() => {
                              if (
                                confirm(`Clear restriction for ${row.full_name || row.user_id}?`)
                              ) {
                                clear.mutate(row.user_id);
                              }
                            }}
                            disabled={clear.isPending}
                          >
                            Clear restriction
                          </button>
                        ) : (
                          <>
                            <input
                              className="text-xs rounded border px-2 py-1 w-40"
                              placeholder="Reason (optional)"
                              value={reasonDraft[row.user_id] ?? ""}
                              onChange={(e) =>
                                setReasonDraft((prev) => ({
                                  ...prev,
                                  [row.user_id]: e.target.value,
                                }))
                              }
                            />
                            <button
                              className="text-xs rounded bg-destructive text-destructive-foreground px-2 py-1"
                              onClick={() => {
                                if (
                                  confirm(`Restrict account for ${row.full_name || row.user_id}?`)
                                ) {
                                  restrict.mutate({
                                    userId: row.user_id,
                                    reason: reasonDraft[row.user_id] ?? "",
                                  });
                                }
                              }}
                              disabled={restrict.isPending}
                            >
                              Restrict account
                            </button>
                          </>
                        )}
                        <div className="flex flex-wrap gap-1">
                          <button
                            className="text-[11px] rounded border px-2 py-1 hover:bg-muted"
                            onClick={() => {
                              const reason = prompt("Reason to freeze trust?");
                              if (reason?.trim()) freeze.mutate({ userId: row.user_id, reason });
                            }}
                            disabled={freeze.isPending}
                          >
                            Freeze
                          </button>
                          <button
                            className="text-[11px] rounded border px-2 py-1 hover:bg-muted"
                            onClick={() => unfreeze.mutate(row.user_id)}
                            disabled={unfreeze.isPending}
                          >
                            Unfreeze
                          </button>
                          <button
                            className="text-[11px] rounded border px-2 py-1 hover:bg-muted"
                            onClick={() => {
                              const note = prompt("Escalation note?");
                              if (note?.trim()) escalate.mutate({ userId: row.user_id, note });
                            }}
                            disabled={escalate.isPending}
                          >
                            Escalate
                          </button>
                          <button
                            className="text-[11px] rounded border px-2 py-1 hover:bg-muted"
                            onClick={() => setHistoryFor(row)}
                          >
                            History
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {historyFor && <TrustHistoryOverlay row={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

function TrustHistoryOverlay({ row, onClose }: { row: TrustRow; onClose: () => void }) {
  const fetchHistory = useServerFn(adminListTrustHistory);
  const q = useQuery({
    queryKey: ["admin", "trust-history", row.user_id],
    queryFn: () => fetchHistory({ data: { userId: row.user_id } }),
    staleTime: 30_000,
  });
  const rows = (q.data ?? []) as TrustHistoryRow[];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground/30" />
      <div
        className="relative z-10 h-full w-full max-w-lg overflow-y-auto p-6"
        style={{ background: "var(--color-surface-elevated)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Trust history
            </div>
            <div className="text-[15px] font-semibold">{row.full_name || row.user_id}</div>
          </div>
          <button onClick={onClose} className="rounded-full bg-secondary px-3 py-1 text-[12px]">
            Close
          </button>
        </div>

        {q.isLoading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No trust actions recorded yet.</Empty>
        ) : (
          <ul className="space-y-3">
            {rows.map((h) => (
              <li key={h.id} className="rounded-xl border p-3 text-[12.5px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-[11.5px]">{h.action}</div>
                  <div className="text-[10.5px] text-muted-foreground">{fmt(h.created_at)}</div>
                </div>
                <div className="mt-1 text-[11.5px] text-muted-foreground">
                  by {h.actor_name || h.actor_user_id.slice(0, 8)}
                </div>
                {h.reason && <div className="mt-1">{h.reason}</div>}
                {h.note && <div className="mt-1 text-muted-foreground">{h.note}</div>}
                {h.payload && (
                  <div className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                    {JSON.stringify(h.payload)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
