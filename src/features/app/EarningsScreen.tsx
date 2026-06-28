import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getRole, subscribeRoleChange, type Role } from "@/lib/role";
import { fmtNairaK, shortWeekdays } from "@/lib/format";
import { useDispatch, type HistoryItem } from "@/features/cover/dispatch";

// Doctor net payout = total paid − FlashLocum service fee (15%).
const FEE_PCT = 15;
const netPayout = (gross: number) => Math.max(0, Math.round(gross * (1 - FEE_PCT / 100)));

type Payout = {
  id: string;
  facility: string;
  coverage: string;
  completedOn: string;
  completedAt: number;
  gross: number;
  amount: number; // NET amount due to doctor
  durationHrs: number;
  // Lifecycle:
  //  - pending: requester has paid FlashLocum; doctor not yet remitted.
  //  - settled: FlashLocum has remitted to the doctor's bank.
  //  - awaiting_payment: shift completed but requester hasn't paid yet.
  state: "settled" | "pending" | "awaiting_payment";
  paidAt?: number;
  remittedAt?: number;
  paymentReference?: string;
  environment?: "normal" | "busy";
};

function toPayout(h: HistoryItem): Payout {
  const requesterPaid = h.paymentStatus === "paid" && !!h.paidAt;
  const remitted = !!h.remittedAt;
  const state: Payout["state"] = remitted
    ? "settled"
    : requesterPaid
      ? "pending"
      : "awaiting_payment";
  return {
    id: h.id,
    facility: h.hospital,
    coverage: h.coverage,
    completedOn: h.completedOn,
    completedAt: h.updatedAt,
    gross: h.amount,
    amount: netPayout(h.amount),
    durationHrs: h.durationHrs,
    state,
    paidAt: h.paidAt,
    remittedAt: h.remittedAt,
    paymentReference: h.paymentReference,
    environment: h.environment,
  };
}

/* ---------- Range filter ---------- */

type RangeKey = "this_week" | "last_week" | "last_month" | "last_3_months";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "last_month", label: "Last month" },
  { key: "last_3_months", label: "Last 3 months" },
];

function startOfWeek(d: Date) {
  // Monday-anchored week.
  const day = (d.getDay() + 6) % 7;
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - day);
  return copy.getTime();
}

function rangeBounds(key: RangeKey, now = Date.now()): { from: number; to: number } {
  const today = new Date(now);
  if (key === "this_week") {
    return { from: startOfWeek(today), to: now };
  }
  if (key === "last_week") {
    const thisWeek = startOfWeek(today);
    return { from: thisWeek - 7 * 24 * 60 * 60 * 1000, to: thisWeek };
  }
  if (key === "last_month") {
    return { from: now - 30 * 24 * 60 * 60 * 1000, to: now };
  }
  return { from: now - 90 * 24 * 60 * 60 * 1000, to: now };
}

/* ---------- Component ---------- */

export function EarningsScreen({ active = true }: { active?: boolean }) {
  const navigate = useNavigate();
  const { history } = useDispatch();
  const [role, setLocalRole] = useState<Role | null>(() => getRole());
  const [range, setRange] = useState<RangeKey>("this_week");
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => subscribeRoleChange(() => setLocalRole(getRole())), []);
  const isDoctor = role === "cover";
  useEffect(() => {
    if (active && role && !isDoctor) {
      navigate({ to: "/home" });
    }
  }, [active, isDoctor, navigate, role]);

  const payouts = useMemo<Payout[]>(() => {
    const { from, to } = rangeBounds(range);
    return history
      .filter((h) => h.outcome === "completed")
      .map(toPayout)
      .filter((p) => p.completedAt >= from && p.completedAt <= to)
      .sort((a, b) => b.completedAt - a.completedAt);
  }, [history, range]);

  const { settled, pending } = useMemo(() => {
    const s = payouts.filter((p) => p.state === "settled").reduce((a, p) => a + p.amount, 0);
    const pend = payouts.filter((p) => p.state === "pending").reduce((a, p) => a + p.amount, 0);
    return { settled: s, pending: pend };
  }, [payouts]);

  if (!role || !isDoctor) return null;

  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="px-5 pt-4">
        <div className="mx-auto max-w-md">
          <h1 className="text-[26px] font-semibold tracking-tight">Earnings</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Net payouts after the 15% service fee
          </p>
        </div>
      </header>

      <div className="mx-auto mt-4 max-w-md px-5 pb-10">
        {/* Range dropdown */}
        <div className="relative">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            className="w-full appearance-none rounded-full px-4 py-2.5 pr-9 text-[13px] font-medium outline-none"
            style={{
              background: "var(--color-surface-elevated)",
              color: "var(--color-foreground)",
            }}
            aria-label="Earnings period"
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
        </div>

        {/* Balance card */}
        <div
          className="mt-4 rounded-2xl px-5 py-5"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Settled · {rangeLabel}
          </div>
          <div className="mt-1 text-[32px] font-semibold tracking-tight tabular-nums">
            {fmtNairaK(settled)}
          </div>
          {pending > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-presence)" }}
              />
              {fmtNairaK(pending)} pending remittance
            </div>
          )}
        </div>

        {/* Activity */}
        <div className="mt-6 px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Transactions
        </div>
        {payouts.length === 0 ? (
          <div
            className="mt-2 rounded-2xl px-4 py-6 text-center text-[13px] text-muted-foreground"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            No payouts in this period.
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {payouts.map((p) => (
              <li key={p.id}>
                <PayoutRow
                  payout={p}
                  open={expanded === p.id}
                  onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ---------- Row ---------- */

const stateLabel = (s: Payout["state"]) =>
  s === "settled" ? "Settled" : s === "pending" ? "Pending" : "Awaiting payment";

function PayoutRow({
  payout,
  open,
  onToggle,
}: {
  payout: Payout;
  open: boolean;
  onToggle: () => void;
}) {
  const pending = payout.state !== "settled";
  return (
    <div className="rounded-2xl" style={{ background: "var(--color-surface-elevated)" }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:opacity-90"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14.5px] font-medium">{payout.facility}</span>
          </div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            {payout.coverage} · {shortWeekdays(payout.completedOn)}
          </div>
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <div className="text-[14.5px] font-semibold tabular-nums">{fmtNairaK(payout.amount)}</div>
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
            {stateLabel(payout.state)}
          </div>
        </div>
        <ChevronDown
          size={14}
          className="ml-1 text-muted-foreground transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>

      {open && <PayoutDetails payout={payout} />}
    </div>
  );
}

function PayoutDetails({ payout }: { payout: Payout }) {
  const fee = payout.gross - payout.amount;
  const fmtDT = (ts?: number) =>
    ts
      ? new Date(ts).toLocaleString("en-NG", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";
  return (
    <div
      className="border-t px-4 py-3 text-[12.5px]"
      style={{ borderColor: "color-mix(in oklab, var(--color-foreground) 8%, transparent)" }}
    >
      <Section title="Shift">
        <Row label="Facility" value={payout.facility} />
        <Row label="Coverage" value={payout.coverage} />
        <Row
          label="Duration"
          value={`${payout.durationHrs.toFixed(payout.durationHrs % 1 === 0 ? 0 : 2)} hr`}
        />
        <Row label="Completed" value={fmtDT(payout.completedAt)} />
      </Section>

      <Section title="Settlement">
        <Row label="Gross" value={fmtNairaK(payout.gross)} />
        <Row label={`Service fee (${FEE_PCT}%)`} value={`− ${fmtNairaK(fee)}`} />
        <Row label="Net payout" value={fmtNairaK(payout.amount)} strong />
      </Section>

      <Section title="Payment trail">
        <Row label="Requester paid" value={fmtDT(payout.paidAt)} />
        <Row label="Remitted to you" value={fmtDT(payout.remittedAt)} />
        <Row label="Status" value={stateLabel(payout.state)} />
        <Row label="Reference" value={payout.paymentReference ?? "—"} mono />
        <Row label="Shift ID" value={payout.id} mono />
      </Section>

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        For dispute, share the Reference and Shift ID with FlashLocum support.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`text-right ${strong ? "font-semibold" : "font-medium"} ${mono ? "font-mono text-[11.5px] break-all" : "tabular-nums"}`}
      >
        {value}
      </span>
    </div>
  );
}
