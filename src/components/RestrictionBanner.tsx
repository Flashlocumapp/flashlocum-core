// Mounted globally in the app shell. Polls the server for the current user's
// payment-flag and restriction status. Backend is the source of truth — this
// component never decides flag/restrict state, it only displays.
//
// Three states surfaced (in priority order):
//   1. ACCOUNT RESTRICTED   — admin set account_restricted_at
//   2. PAYMENT RESTRICTED   — admin set payment_restricted_at
//   3. PAYMENT FLAGGED      — system reached 24h surcharge cap; awaiting admin

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

  const restricted = !!state?.restricted;
  const flagged = !!(state as { payment_flagged?: boolean } | null)?.payment_flagged;
  if (!restricted && !flagged) return null;

  const overdue = state?.overdue ?? [];
  const total = overdue.reduce((s, o) => s + (o.total_billed_amount ?? 0), 0);
  const accountRestricted = !!state?.account_restricted;
  const paymentRestricted = !!state?.payment_restricted;

  // Color: red for restricted, amber for flagged-only.
  const tone = restricted ? "#dc2626" : "#d97706";
  const text = restricted ? "#7f1d1d" : "#78350f";
  const label = accountRestricted
    ? "Account restricted"
    : paymentRestricted
      ? "Payment restricted"
      : "Payment flagged for review";

  return (
    <div
      className="pointer-events-auto absolute inset-x-0 top-0 z-[70] px-3 pt-[max(env(safe-area-inset-top),0.5rem)]"
      role="alert"
    >
      <div
        className="rounded-2xl border px-3 py-2.5 text-[12px] font-medium shadow-sm"
        style={{
          background: `color-mix(in oklab, ${tone} 12%, var(--color-surface-elevated, #fff))`,
          borderColor: `color-mix(in oklab, ${tone} 30%, transparent)`,
          color: text,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">
            {label}
          </span>
          {total > 0 && (
            <span className="tabular-nums text-[11px]">
              ₦{total.toLocaleString("en-NG")} due
            </span>
          )}
        </div>
        {accountRestricted ? (
          <p className="mt-1 leading-snug">
            Your account has been restricted by an administrator.
            {state?.account_restricted_reason
              ? ` Reason: ${state.account_restricted_reason}.`
              : ""}{" "}
            You can still log in, view your dashboard, pay outstanding
            balances, and contact support.
          </p>
        ) : paymentRestricted ? (
          <p className="mt-1 leading-snug">
            An administrator has restricted booking until your{" "}
            {overdue.length} outstanding shift
            {overdue.length === 1 ? "" : "s"} {overdue.length === 1 ? "is" : "are"}{" "}
            paid.
          </p>
        ) : (
          <p className="mt-1 leading-snug">
            A shift exceeded the 24-hour payment window and is awaiting admin
            review. Pay outstanding balances to clear the flag.
          </p>
        )}
      </div>
    </div>
  );
}
