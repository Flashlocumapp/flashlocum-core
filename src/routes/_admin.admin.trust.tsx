import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminPageHeader, RefreshButton, Empty } from "@/lib/admin-ui";
import type { TrustSnapshot } from "@/lib/trust";

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
  const [onlyFlagged, setOnlyFlagged] = useState(true);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["admin", "trust", onlyFlagged],
    queryFn: () => fetchTrustList(onlyFlagged),
    staleTime: 30_000,
  });

  const restrict = useMutation({
    mutationFn: async (vars: { userId: string; reason: string }) => {
      const { error } = await supabase.rpc("admin_apply_trust_restriction", {
        _user_id: vars.userId,
        _reason: vars.reason || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "trust"] }),
  });

  const clear = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.rpc("admin_clear_trust_restriction", { _user_id: userId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "trust"] }),
  });

  const rows = q.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Trust Snapshots"
        subtitle="Computed rating + reliability per user. Restriction is admin-controlled only — scores never auto-restrict."
        right={<RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />}
      />

      <div className="flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyFlagged}
            onChange={(e) => setOnlyFlagged(e.target.checked)}
          />
          Only show flagged (doctor rating &lt; 4.0 / requester &lt; 3.5, or reliability below role threshold)
        </label>
        <span className="text-muted-foreground">— {rows.length} user{rows.length === 1 ? "" : "s"}</span>
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
                <th className="px-3 py-2">Last block</th>
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
                const lastRel = s?.reliability?.last_block;
                return (
                  <tr key={row.user_id} className="border-t align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{row.full_name || "—"}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">{row.user_id.slice(0, 8)}…</div>
                      <Link
                        to="/admin/ratings"
                        search={{
                          ratee:
                            row.role === "doctor"
                              ? `doc:${row.user_id}`
                              : `req:${row.user_id}`,
                        }}
                        className="text-[11px] underline text-muted-foreground hover:text-foreground"
                      >
                        View comments
                      </Link>
                    </td>
                    <td className="px-3 py-2 capitalize">{row.role || "—"}</td>
                    <td className="px-3 py-2">
                      <div className={s?.eligibility?.rating_below_threshold ? "text-destructive font-semibold" : ""}>
                        {Number(s?.rating?.score ?? 5).toFixed(2)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {s?.rating?.block_index ?? 0} block{(s?.rating?.block_index ?? 0) === 1 ? "" : "s"} · {s?.rating?.in_progress_count ?? 0}/{s?.rating?.block_size ?? 20} pending
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className={s?.eligibility?.reliability_below_threshold ? "text-destructive font-semibold" : ""}>
                        {Math.round(Number(s?.reliability?.score ?? 100))}%
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {s?.reliability?.block_index ?? 0} block{(s?.reliability?.block_index ?? 0) === 1 ? "" : "s"} · {s?.reliability?.in_progress_count ?? 0}/{s?.reliability?.block_size ?? 20} pending
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {lastRel
                        ? `${lastRel.completed}c · ${lastRel.cancelled}x · ${lastRel.no_show}ns`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {flagged ? (
                        <div className="space-y-1">
                          <span className="inline-block rounded bg-destructive/10 text-destructive px-1.5 py-0.5 text-[11px] font-semibold">
                            FLAGGED
                          </span>
                          {(s?.eligibility?.reasons ?? []).map((r, i) => (
                            <div key={i} className="text-[11px] text-muted-foreground">{r}</div>
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
                      {restricted ? (
                        <button
                          className="text-xs rounded border px-2 py-1 hover:bg-muted"
                          onClick={() => {
                            if (confirm(`Clear restriction for ${row.full_name || row.user_id}?`)) {
                              clear.mutate(row.user_id);
                            }
                          }}
                          disabled={clear.isPending}
                        >
                          Clear restriction
                        </button>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <input
                            className="text-xs rounded border px-2 py-1 w-40"
                            placeholder="Reason (optional)"
                            value={reasonDraft[row.user_id] ?? ""}
                            onChange={(e) =>
                              setReasonDraft((prev) => ({ ...prev, [row.user_id]: e.target.value }))
                            }
                          />
                          <button
                            className="text-xs rounded bg-destructive text-destructive-foreground px-2 py-1"
                            onClick={() => {
                              if (confirm(`Restrict account for ${row.full_name || row.user_id}?`)) {
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
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
