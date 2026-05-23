import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getRole } from "@/lib/role";
import { fmtNairaK, shortWeekdays } from "@/lib/format";

export const Route = createFileRoute("/_app/earnings")({
  component: EarningsScreen,
});

type Payout = {
  id: string;
  facility: string;
  coverage: "Standard" | "24-Hour" | "Weekend Call" | "Home Care";
  completedOn: string; // e.g. "Mon 17 Nov"
  amount: number;
  state: "settled" | "pending";
};

const PAYOUTS: Payout[] = [
  { id: "p1", facility: "Evercare Hospital", coverage: "Standard", completedOn: "Today · 06:12", amount: 36000, state: "pending" },
  { id: "p2", facility: "Reddington", coverage: "Weekend Call", completedOn: "Sat 22 Nov", amount: 80000, state: "settled" },
  { id: "p3", facility: "Lagoon Hospital", coverage: "24-Hour", completedOn: "Tue 18 Nov", amount: 80000, state: "settled" },
  { id: "p4", facility: "St. Nicholas", coverage: "Standard", completedOn: "Mon 17 Nov", amount: 36000, state: "settled" },
  { id: "p5", facility: "First Cardiology", coverage: "Home Care", completedOn: "Fri 14 Nov", amount: 45000, state: "settled" },
];

function EarningsScreen() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (getRole() !== "cover") {
      navigate({ to: "/home" });
      return;
    }
    setReady(true);
  }, [navigate]);

  const { thisMonth, pending } = useMemo(() => {
    const month = PAYOUTS.filter((p) => p.state === "settled").reduce((a, p) => a + p.amount, 0);
    const pend = PAYOUTS.filter((p) => p.state === "pending").reduce((a, p) => a + p.amount, 0);
    return { thisMonth: month, pending: pend };
  }, []);

  if (!ready) return <div className="h-full w-full bg-background" />;

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="safe-top px-5 pt-4">
        <div className="mx-auto max-w-md">
          <h1 className="text-[26px] font-semibold tracking-tight">Earnings</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Payouts from completed coverage
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
            This month
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
        <ul className="mt-2 space-y-2">
          {PAYOUTS.map((p) => (
            <li key={p.id}>
              <PayoutRow payout={p} />
            </li>
          ))}
        </ul>
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
