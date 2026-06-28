// Mounted globally in the app shell. Polls the server for the current user's
// payment-flag and restriction status. Backend is the source of truth — this
// component never decides flag/restrict state, it only displays.
//
// Three states surfaced (in priority order):
//   1. ACCOUNT RESTRICTED   — admin set account_restricted_at
//   2. PAYMENT RESTRICTED   — admin set payment_restricted_at
//   3. PAYMENT FLAGGED      — system reached 24h surcharge cap; awaiting admin
//
// Memoization: this component is mounted directly in the AppShell, which
// re-renders on every route / heartbeat. We wrap the export in React.memo
// and isolate the rendered DOM behind a useMemo keyed on the actual fields
// the banner displays, so AppShell re-renders never bubble through.

import { memo, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getMyPaymentRestriction } from "@/lib/shift.functions";

type Restriction = Awaited<ReturnType<typeof getMyPaymentRestriction>>;

function RestrictionBannerInner() {
  const fetchRestriction = useServerFn(getMyPaymentRestriction);
  const [state, setState] = useState<Restriction | null>(null);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const r = await fetchRestriction();
        if (mounted) {
          // Only update state when the displayed fields actually change so
          // a no-op poll doesn't trigger a re-render.
          setState((prev) => (shallowEqualRestriction(prev, r) ? prev : r));
        }
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
    // fetchRestriction identity is stable from useServerFn; depend on []
    // so the poll isn't restarted by parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restricted = !!state?.restricted;
  const flagged = !!(state as { payment_flagged?: boolean } | null)?.payment_flagged;
  const accountRestricted = !!state?.account_restricted;
  const paymentRestricted = !!state?.payment_restricted;
  const overdueCount = state?.overdue?.length ?? 0;
  const total = useMemo(
    () => (state?.overdue ?? []).reduce((s, o) => s + (o.total_billed_amount ?? 0), 0),
    [state?.overdue],
  );
  const accountReason = state?.account_restricted_reason ?? null;

  const body = useMemo(() => {
    if (!restricted && !flagged) return null;
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
            <span className="font-semibold uppercase tracking-[0.14em] text-[10px]">{label}</span>
            {total > 0 && (
              <span className="tabular-nums text-[11px]">₦{total.toLocaleString("en-NG")} due</span>
            )}
          </div>
          {accountRestricted ? (
            <p className="mt-1 leading-snug">
              Your account has been restricted by an administrator.
              {accountReason ? ` Reason: ${accountReason}.` : ""} You can still log in, view your
              dashboard, pay outstanding balances, and contact support.
            </p>
          ) : paymentRestricted ? (
            <p className="mt-1 leading-snug">
              An administrator has restricted booking until your {overdueCount} outstanding shift
              {overdueCount === 1 ? "" : "s"} {overdueCount === 1 ? "is" : "are"} paid.
            </p>
          ) : (
            <p className="mt-1 leading-snug">
              A shift exceeded the 24-hour payment window and is awaiting admin review. Pay
              outstanding balances to clear the flag.
            </p>
          )}
        </div>
      </div>
    );
  }, [
    restricted,
    flagged,
    accountRestricted,
    paymentRestricted,
    overdueCount,
    total,
    accountReason,
  ]);

  return body;
}

function shallowEqualRestriction(a: Restriction | null, b: Restriction | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ax = a as Record<string, unknown>;
  const bx = b as Record<string, unknown>;
  if (
    ax.restricted !== bx.restricted ||
    ax.account_restricted !== bx.account_restricted ||
    ax.payment_restricted !== bx.payment_restricted ||
    ax.account_restricted_reason !== bx.account_restricted_reason ||
    (ax as { payment_flagged?: boolean }).payment_flagged !==
      (bx as { payment_flagged?: boolean }).payment_flagged
  ) {
    return false;
  }
  const ao = (a.overdue ?? []) as { id?: string; total_billed_amount?: number }[];
  const bo = (b.overdue ?? []) as { id?: string; total_billed_amount?: number }[];
  if (ao.length !== bo.length) return false;
  for (let i = 0; i < ao.length; i++) {
    if (ao[i]?.id !== bo[i]?.id) return false;
    if (ao[i]?.total_billed_amount !== bo[i]?.total_billed_amount) return false;
  }
  return true;
}

export const RestrictionBanner = memo(RestrictionBannerInner);
