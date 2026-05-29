import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getRole } from "@/lib/role";
import { fmtNairaK, shortWeekdays } from "@/lib/format";
import { useDispatch, type HistoryItem } from "@/features/cover/dispatch";

export const Route = createFileRoute("/_app/earnings")({
  component: EarningsScreen,
});

// Doctor net payout = total paid − FlashLocum service fee (15%).
const FEE_PCT = 15;
const netPayout = (gross: number) => Math.max(0, Math.round(gross * (1 - FEE_PCT / 100)));

type Payout = {
  id: string;
  facility: string;
  coverage: string;
  completedOn: string;
  amount: number; // NET amount due to doctor
  state: "settled" | "pending";
  ts: number;
};

// Operational rule: Pending until FlashLocum remits payout (simulated as
// settled once a completed shift is older than 12h). Keeps the lifecycle
// visible — doctor sees money owed immediately after requester payment.
const SETTLEMENT_DELAY_MS = 12 * 60 * 60 * 1000;
const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

function toPayout(h: HistoryItem & { updatedAtMs?: number }, now: number): Payout {
  const ts = (h as unknown as { updatedAtMs?: number }).updatedAtMs ?? now;
  const settled = now - ts > SETTLEMENT_DELAY_MS;
  return {
    id: h.id,
    facility: h.hospital,
    coverage: h.coverage,
    completedOn: h.completedOn,
    amount: netPayout(h.amount),
    state: settled ? "settled" : "pending",
    ts,
  };
}

function EarningsScreen() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const { history } = useDispatch();
  useEffect(() => {
    if (getRole() !== "cover") {
      navigate({ to: "/home" });
      return;
    }
    setReady(true);
  }, [navigate]);

  const payouts = useMemo<Payout[]>(() => {
    const now = Date.now();
    const cutoff = now - THREE_MONTHS_MS;
    return history
      .filter((h) => h.outcome === "completed")
      .map((h) => {
        // updatedAt isn't directly on HistoryItem but completedOn is human;
        // fall back to "now" so freshly completed shifts appear immediately.
        const parsed = Date.parse(h.completedOn + " " + new Date().getFullYear());
        const ts = Number.isFinite(parsed) ? parsed : now;
        return toPayout({ ...h, updatedAtMs: ts } as HistoryItem & { updatedAtMs?: number }, now);
      })
      .filter((p) => p.ts >= cutoff)
      .sort((a, b) => b.ts - a.ts);
  }, [history]);

  const { thisMonth, pending } = useMemo(() => {
    const month = payouts.filter((p) => p.state === "settled").reduce((a, p) => a + p.amount, 0);
    const pend = payouts.filter((p) => p.state === "pending").reduce((a, p) => a + p.amount, 0);
    return { thisMonth: month, pending: pend };
  }, [payouts]);

  if (!ready) return <div className="h-full w-full bg-background" />;

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="safe-top px-5 pt-4">
        <div className="mx-auto max-w-md">
          <h1 className="text-[26px] font-semibold tracking-tight">Earnings</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Net payouts · last 3 months
          </p>
        </div>
      </header>

      <div className="mx-auto mt-5 max-w-md px-5 pb-10">
        {/* Balance card */}
        <div
          className="rounded-2xl px-5 py-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Settled
          </div>
          <div className="mt-1 text-[32px] font-semibold tracking-tight tabular-nums">
            {fmtNairaK(thisMonth)}
          </div>
          {pending > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-presence)" }}
              />
              {fmtNairaK(pending)} pending settlement
            </div>
          )}
        </div>

        {/* Activity */}
        <div className="mt-6 px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Recent
        </div>
        {payouts.length === 0 ? (
          <div
            className="mt-2 rounded-2xl px-4 py-6 text-center text-[13px] text-muted-foreground"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            No payouts yet. Completed shifts will appear here.
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {payouts.map((p) => (
              <li key={p.id}>
                <PayoutRow payout={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PayoutRow({ payout }: { payout: Payout }) {
  const pending = payout.state === "pending";
  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-4 py-3.5"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-medium">{payout.facility}</div>
        <div className="truncate text-[12.5px] text-muted-foreground">
          {payout.coverage} · {shortWeekdays(payout.completedOn)}
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <div className="text-[14.5px] font-semibold tabular-nums">
          {fmtNairaK(payout.amount)}
        </div>
        <div
          className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.1em]"
          style={{
            color: pending
              ? "var(--color-presence)"
              : "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
          }}
        >
          {pending && (
            <span
              className="h-1 w-1 rounded-full"
              style={{ background: "var(--color-presence)" }}
            />
          )}
          {pending ? "Pending" : "Settled"}
        </div>
      </div>
    </div>
  );
}
