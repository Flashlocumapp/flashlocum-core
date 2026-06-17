import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListRatings, type AdminRatingRow } from "@/lib/admin.functions";
import { AdminPageHeader, RefreshButton, Empty } from "@/lib/admin-ui";

export const Route = createFileRoute("/_admin/admin/ratings")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    ratee: typeof s.ratee === "string" ? s.ratee : undefined,
  }),
  component: RatingsPage,
});

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-500" aria-label={`${n} of 5`}>
      {"★".repeat(n)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function fmtDate(s: string) {
  const d = new Date(s);
  return d.toLocaleString();
}

function RatingsPage() {
  const { ratee } = Route.useSearch();
  const [onlyComments, setOnlyComments] = useState(false);
  const [minScore, setMinScore] = useState<number | "">("");
  const fetchRatings = useServerFn(adminListRatings);

  const q = useQuery({
    queryKey: ["admin", "ratings", ratee ?? "all", onlyComments, minScore],
    queryFn: () =>
      fetchRatings({
        data: {
          ratee_entity_id: ratee,
          only_with_feedback: onlyComments,
          min_score: typeof minScore === "number" ? minScore : undefined,
          limit: 200,
        },
      }) as Promise<AdminRatingRow[]>,
    staleTime: 30_000,
  });

  const rows = q.data ?? [];

  return (
    <div className="space-y-6 p-6">
      <AdminPageHeader
        title="Ratings & Comments"
        subtitle="Every star and written comment submitted across shifts."
        right={<RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />}
      />

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyComments}
            onChange={(e) => setOnlyComments(e.target.checked)}
          />
          Only show with comments
        </label>
        <label className="flex items-center gap-2">
          Min stars:
          <select
            className="rounded border px-2 py-1 bg-background"
            value={minScore === "" ? "" : String(minScore)}
            onChange={(e) =>
              setMinScore(e.target.value === "" ? "" : Number(e.target.value))
            }
          >
            <option value="">Any</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}+
              </option>
            ))}
          </select>
        </label>
        {ratee && (
          <div className="flex items-center gap-2 text-muted-foreground">
            Filtered by user:
            <code className="font-mono text-xs">{ratee}</code>
            <Link to="/admin/ratings" className="text-xs underline">
              clear
            </Link>
          </div>
        )}
        <span className="text-muted-foreground">
          — {rows.length} rating{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {q.isLoading ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No ratings yet</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Stars</th>
                <th className="px-3 py-2">Comment</th>
                <th className="px-3 py-2">Reviewer</th>
                <th className="px-3 py-2">Reviewee</th>
                <th className="px-3 py-2">Shift</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap">
                    {fmtDate(r.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <Stars n={r.score} />
                  </td>
                  <td className="px-3 py-2 max-w-[420px]">
                    {r.feedback ? (
                      <span className="whitespace-pre-wrap">{r.feedback}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.rater_name || "—"}</div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {r.rater_user_id.slice(0, 8)}…
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{r.ratee_name || "—"}</div>
                    <div className="text-[11px] text-muted-foreground capitalize">
                      {r.ratee_role || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.shift_hospital || "—"}
                    {r.shift_id && (
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {r.shift_id.slice(0, 8)}…
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
