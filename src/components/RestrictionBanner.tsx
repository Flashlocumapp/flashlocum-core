// Mounted globally in the app shell. Polls the server for the current user's
// payment-restriction status (set when a shift has gone through two payment
// extensions without being paid) and renders a non-dismissable banner with
// the list of overdue settlements. Backend is the source of truth — this
// component never decides whether the user is restricted, it only displays.

import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyPaymentRestriction } from "@/lib/shift.functions";

type Restriction = Awaited<ReturnType<typeof getMyPaymentRestriction>>;

export function RestrictionBanner() {
  const fetchRestriction = useServerFn(getMyPaymentRestriction);
  const [state, setState] = useState<Restriction | null>(null);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const r = await fetchRestriction();
        if (mounted) setState(r);
      } catch {
        /* swallow — banner is non-critical */
      }
    };
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, [fetchRestriction]);

  if (!state?.restricted) return null;

  const overdue = state.overdue ?? [];
  const total = overdue.reduce((s, o) => s + (o.total_billed_amount ?? 0), 0);

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 top-0 z-[70] px-3 pt-[max(env(safe-area-inset-top),0.5rem)]"
      role="alert"
    >
      <div
        className="rounded-2xl border px-3 py-2.5 text-[12px] font-medium shadow-sm"
        style={{
          background: "color-mix(in oklab, #dc2626 12%, var(--color-surface-elevated, #fff))",
          borderColor: "color-mix(in oklab, #dc2626 30%, transparent)",
          color: "#7f1d1d",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            Account restricted
          </span>
          <span className="tabular-nums text-[11px]">
            ₦{total.toLocaleString("en-NG")} due
          </span>
        </div>
        <p className="mt-1 leading-snug">
          You have {overdue.length} unpaid shift{overdue.length === 1 ? "" : "s"}.
          Settle outstanding payments to create or end new shifts.
        </p>
      </div>
    </div>
  );
}
