import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { RatingOverlay } from "@/components/RatingOverlay";
import { simNow, useSimClock } from "@/lib/clock";
import {
  computeWorkedPricing,
  billableMinutes,
  type CoverageKind,
} from "@/lib/pricing";
import { beginSettlementCheckout } from "@/lib/settlement.functions";
import { supabase } from "@/integrations/supabase/client";


type Phase = "active" | "settlement" | "grace" | "overtime" | "confirmed";

type ShiftMeta = {
  facility: string;
  doctor: string;
  role: string;
  /**
   * Realtime billing inputs — derived from the LIVE Active Coverage timer.
   * Total worked time = accumulatedMs + (startedAt ? now - startedAt : 0).
   * `startedAt` may be undefined when settlement opens after a Pause.
   */
  startedAt?: number;
  accumulatedMs?: number;
  startHHMM: string;
  /** End of the per-day window — required for correct multi-day pricing. */
  endHHMM?: string;
  /** Number of booked days — multi-day shifts price perDay × days. */
  days?: number;
  coverageKind: CoverageKind;
};

const SAMPLE: ShiftMeta = {
  facility: "Evercare Hospital",
  doctor: "Cover Doctor",
  role: "Standard · Active",
  startedAt: Date.now() - 60 * 60 * 1000,
  accumulatedMs: 0,
  startHHMM: "08:00",
  endHHMM: "18:00",
  days: 1,
  coverageKind: "standard",
};

const ACCOUNT = { bank: "Providus Bank", number: "0123456789" };

const VISIBLE_COUNTDOWN = 5 * 60; // 5 minutes
const GRACE_TOTAL = 15 * 60; // 15 minutes total settlement window

function fmtNaira(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}
function fmtClock(s: number) {
  const m = Math.max(0, Math.floor(s / 60));
  const sec = Math.max(0, s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function fmtHrMin(min: number) {
  const m = Math.max(0, Math.floor(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}min`;
  if (r === 0) return `${h}hr`;
  return `${h}hr ${r}min`;
}

export function ShiftSettlement({
  open,
  onClose,
  shift = SAMPLE,
  initialPhase = "active",
  onConfirmed,
  requestId,
}: {
  open: boolean;
  onClose: () => void;
  shift?: ShiftMeta;
  initialPhase?: Phase;
  onConfirmed?: () => void;
  onRebook?: () => void;
  /** When provided, settlement uses Monnify hosted checkout instead of the
   *  static demo bank-transfer block. */
  requestId?: string;
}) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  // Anchor timestamps drive every elapsed/overtime computation so that a
  // simulation fast-forward instantly advances the visible state.
  const phaseStartedAtRef = useRef<number | null>(null);
  const overtimeStartedAtRef = useRef<number | null>(null);
  const endedAtRef = useRef<number | null>(null);
  const confirmedAtRef = useRef<number | null>(null);
  const autoConfirmAt = useRef<number | null>(null);

  const tick = useSimClock(1000);

  const elapsed =
    phaseStartedAtRef.current != null && phase !== "active" && phase !== "confirmed"
      ? Math.max(0, Math.floor((tick - phaseStartedAtRef.current) / 1000))
      : 0;
  const overtimeSec =
    overtimeStartedAtRef.current != null
      ? Math.max(0, Math.floor((tick - overtimeStartedAtRef.current) / 1000))
      : 0;

  // The LIVE Active Coverage timer is the single source of truth for billing.
  // During settlement/grace the worked total freezes at End Shift; in
  // overtime it resumes; in confirmed it freezes at payment.
  const effectiveNow =
    phase === "confirmed" && confirmedAtRef.current != null
      ? confirmedAtRef.current
      : (phase === "settlement" || phase === "grace") && endedAtRef.current != null
        ? endedAtRef.current
        : tick;
  const baseMs = shift.accumulatedMs ?? 0;
  const liveSegmentMs = shift.startedAt
    ? Math.max(0, effectiveNow - shift.startedAt)
    : 0;
  const workedMin = (baseMs + liveSegmentMs) / 60000;
  const billedMin = billableMinutes(workedMin);
  const totalAmount = useMemo(
    () =>
      computeWorkedPricing(
        shift.coverageKind,
        shift.startHHMM,
        billedMin,
        shift.endHHMM,
        shift.days,
      ).amount,
    [shift.coverageKind, shift.startHHMM, shift.endHHMM, shift.days, billedMin],
  );
  // Snapshot of the bill at the moment End Shift was pressed.
  const frozenBilledMinRef = useRef<number>(0);
  const frozenAmountRef = useRef<number>(0);
  const frozenBilledMin = frozenBilledMinRef.current;
  const frozenAmount = frozenAmountRef.current;
  const extensionMin = Math.max(0, billedMin - frozenBilledMin);
  const extensionAmount = Math.max(0, totalAmount - frozenAmount);

  // Reset whenever opened fresh.
  useEffect(() => {
    if (open) {
      setPhase(initialPhase);
      const now = simNow();
      phaseStartedAtRef.current =
        initialPhase === "active" || initialPhase === "confirmed" ? null : now;
      overtimeStartedAtRef.current = initialPhase === "overtime" ? now : null;
      endedAtRef.current =
        initialPhase === "settlement" || initialPhase === "grace" ? now : null;
      confirmedAtRef.current = null;
      autoConfirmAt.current = null;
      // When opening directly into settlement (the standard path from
      // Coverage → End Shift), freeze the bill immediately using the
      // accumulated continuous timer so the page never shows ₦0.
      if (initialPhase === "settlement" || initialPhase === "grace") {
        const segment = shift.startedAt ? Math.max(0, now - shift.startedAt) : 0;
        const w = ((shift.accumulatedMs ?? 0) + segment) / 60000;
        const bm = billableMinutes(w);
        frozenBilledMinRef.current = bm;
        frozenAmountRef.current = computeWorkedPricing(
          shift.coverageKind,
          shift.startHHMM,
          bm,
          shift.endHHMM,
          shift.days,
        ).amount;
      } else {
        frozenBilledMinRef.current = 0;
        frozenAmountRef.current = 0;
      }
    }
  }, [open, initialPhase, shift.startedAt, shift.accumulatedMs, shift.coverageKind, shift.startHHMM, shift.endHHMM, shift.days]);

  const finalize = () => {
    onConfirmed?.();
    onClose();
  };

  // Passive payment detection — driven by simulated clock.
  useEffect(() => {
    if (!open) return;
    if (phase !== "settlement" && phase !== "grace" && phase !== "overtime") return;
    if (autoConfirmAt.current && tick >= autoConfirmAt.current) {
      confirmedAtRef.current = tick;
      setPhase("confirmed");
    }
  }, [open, phase, tick]);

  // Transition settlement → grace at 5min, grace → overtime at 15min.
  useEffect(() => {
    if (phase === "settlement" && elapsed >= VISIBLE_COUNTDOWN) setPhase("grace");
    if (phase === "grace" && elapsed >= GRACE_TOTAL) {
      if (overtimeStartedAtRef.current == null) {
        overtimeStartedAtRef.current =
          (phaseStartedAtRef.current ?? simNow()) + GRACE_TOTAL * 1000;
      }
      setPhase("overtime");
    }
  }, [elapsed, phase]);


  const handleEndShift = () => {
    const now = simNow();
    phaseStartedAtRef.current = now;
    endedAtRef.current = now;
    overtimeStartedAtRef.current = null;
    // Freeze the bill at the moment of End Shift.
    const segment = shift.startedAt ? Math.max(0, now - shift.startedAt) : 0;
    const w = ((shift.accumulatedMs ?? 0) + segment) / 60000;
    const bm = billableMinutes(w);
    frozenBilledMinRef.current = bm;
    frozenAmountRef.current = computeWorkedPricing(
      shift.coverageKind,
      shift.startHHMM,
      bm,
      shift.endHHMM,
      shift.days,
    ).amount;
    setPhase("settlement");
    if (Math.random() < 0.35) {
      autoConfirmAt.current = simNow() + (8 + Math.random() * 6) * 1000;
    }
  };

  const handleMadePayment = () => {
    autoConfirmAt.current = simNow() + 2500;
  };

  // ---------------- Monnify split-payment ----------------
  const beginCheckout = useServerFn(beginSettlementCheckout);
  const [payState, setPayState] = useState<"idle" | "starting" | "waiting" | "error">("idle");
  const [payError, setPayError] = useState<string | null>(null);

  const startMonnifyCheckout = async () => {
    if (!requestId) return;
    setPayError(null);
    setPayState("starting");
    try {
      const { checkoutUrl } = await beginCheckout({
        data: { requestId, amount: frozenAmountRef.current || Math.round(totalAmount) },
      });
      window.open(checkoutUrl, "_blank", "noopener");
      setPayState("waiting");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout";
      setPayError(msg);
      setPayState("error");
    }
  };

  // Poll the row for paid status; flip to confirmed when webhook lands.
  useEffect(() => {
    if (!open || !requestId) return;
    if (phase === "confirmed") return;
    let cancelled = false;
    const tickFn = async () => {
      const { data } = await supabase
        .from("coverage_requests")
        .select("payment_status")
        .eq("id", requestId)
        .maybeSingle();
      if (cancelled) return;
      if (data?.payment_status === "paid" && autoConfirmAt.current == null) {
        autoConfirmAt.current = simNow() + 500;
      }
    };
    void tickFn();
    const iv = setInterval(tickFn, 4000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [open, requestId, phase, totalAmount]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(ACCOUNT.number);
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background"
    >
      <AnimatePresence mode="wait">
        {phase === "active" && (
          <ActivePane
            key="active"
            shift={shift}
            workedMin={workedMin}
            billedMin={billedMin}
            liveAmount={totalAmount}
            onClose={onClose}
            onEnd={handleEndShift}
          />
        )}
        {(phase === "settlement" || phase === "grace") && (
          <SettlementPane
            key="settle"
            shift={shift}
            phase={phase}
            elapsed={elapsed}
            billedMin={frozenBilledMin}
            amount={frozenAmount}
            onCopy={handleCopy}
            onMadePayment={handleMadePayment}
            paymentTriggered={autoConfirmAt.current !== null}
            onPayWithMonnify={requestId ? startMonnifyCheckout : undefined}
            payState={payState}
            payError={payError}
          />
        )}
        {phase === "overtime" && (
          <OvertimePane
            key="overtime"
            shift={shift}
            overtimeSec={overtimeSec}
            total={totalAmount}
            extensionMin={extensionMin}
            extensionAmount={extensionAmount}
            onCopy={handleCopy}
            onMadePayment={handleMadePayment}
            paymentTriggered={autoConfirmAt.current !== null}
            onPayWithMonnify={requestId ? startMonnifyCheckout : undefined}
            payState={payState}
            payError={payError}
          />
        )}
        {phase === "confirmed" && (
          <ConfirmedPane
            key="done"
            shift={shift}
            total={totalAmount}
            billedMin={billedMin}
            onClose={finalize}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}


/* ---------------- Active ---------------- */

function ActivePane({
  shift,
  workedMin,
  billedMin,
  liveAmount,
  onClose,
  onEnd,
}: {
  shift: ShiftMeta;
  workedMin: number;
  billedMin: number;
  liveAmount: number;
  onClose: () => void;
  onEnd: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex h-full w-full flex-col safe-top"
    >
      <TopBar onClose={onClose} />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Live Coverage
        </div>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight">{shift.facility}</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          {shift.doctor} · {shift.role}
        </p>

        <div className="mt-6 flex items-center gap-3 rounded-2xl bg-surface-elevated px-4 py-4">
          <span className="relative flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: "color-mix(in oklab, var(--color-presence) 18%, transparent)" }}>
            <span className="absolute inset-0 rounded-full"
              style={{ background: "var(--color-presence)", opacity: 0.3, animation: "presence-pulse 1.8s ease-out infinite" }} />
            <span className="relative h-2.5 w-2.5 rounded-full" style={{ background: "var(--color-presence)" }} />
          </span>
          <div className="flex-1">
            <div className="text-[13.5px] font-medium">Coverage in progress</div>
            <div className="text-[12px] text-muted-foreground">Settlement begins after End Shift</div>
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-surface-elevated p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Worked so far
            </span>
            <span className="text-[13px] font-medium tabular-nums">{fmtHrMin(workedMin)}</span>
          </div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <div className="text-[11.5px] text-muted-foreground">Live billing</div>
              <div className="mt-1 text-[28px] font-semibold leading-none tracking-tight tabular-nums">
                {fmtNaira(liveAmount)}
              </div>
            </div>
            <span className="text-[11.5px] text-muted-foreground tabular-nums">
              billed {fmtHrMin(billedMin)}
            </span>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Tied to the live timer · 15-min half-blocks
          </p>
        </div>

        <div className="mt-auto pb-8">
          <button
            onClick={onEnd}
            className="h-14 w-full rounded-full bg-primary text-[15px] font-semibold text-primary-foreground shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] active:opacity-90"
          >
            End Shift
          </button>
        </div>
      </div>
    </motion.section>
  );
}

/* ---------------- Settlement / Grace ---------------- */

function SettlementPane({
  shift,
  phase,
  elapsed,
  billedMin,
  amount,
  onCopy,
  onMadePayment,
  paymentTriggered,
  onPayWithMonnify,
  payState,
  payError,
}: {
  shift: ShiftMeta;
  phase: "settlement" | "grace";
  elapsed: number;
  billedMin: number;
  amount: number;
  onCopy: () => void;
  onMadePayment: () => void;
  paymentTriggered: boolean;
  onPayWithMonnify?: () => void;
  payState: "idle" | "starting" | "waiting" | "error";
  payError: string | null;
}) {
  const remaining = phase === "settlement"
    ? Math.max(0, VISIBLE_COUNTDOWN - elapsed)
    : Math.max(0, GRACE_TOTAL - elapsed);

  return (
    <motion.section
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 32 }}
      className="relative flex h-full w-full flex-col safe-top"
    >
      <TopBar />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Complete Coverage
        </div>

        <div className="mt-3 text-[13px] text-muted-foreground">Total Settlement</div>
        <div className="mt-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums">
          {fmtNaira(amount)}
        </div>




        {/* Account block — operational center of gravity */}
        <div className="mt-6 rounded-2xl bg-surface-elevated p-5 shadow-[0_2px_14px_-8px_rgba(0,0,0,0.18)]">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Transfer To
          </div>
          <div className="mt-2 text-[15px] font-medium">{ACCOUNT.bank}</div>
          <div className="mt-1 text-[30px] font-semibold leading-none tracking-[0.06em] tabular-nums">
            {ACCOUNT.number}
          </div>
          <button
            onClick={onCopy}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-[12.5px] font-medium text-foreground/80 active:opacity-80"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
              <path d="M5 15V6a2 2 0 012-2h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            Copy account number
          </button>
        </div>

        {/* Countdown / grace */}
        <div className="mt-5 flex items-center justify-between rounded-xl px-1 py-1">
          <span className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            {phase === "settlement" ? "Time remaining" : "Grace period"}
          </span>
          <span
            className="text-[15px] font-medium tabular-nums"
            style={{ color: phase === "grace" ? "var(--color-muted-foreground)" : "var(--color-foreground)" }}
          >
            {fmtClock(remaining)}
          </span>
        </div>
        {phase === "grace" && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            Coverage remains active until settlement is confirmed.
          </p>
        )}

        <div className="mt-auto space-y-2 pb-8">
          {onPayWithMonnify ? (
            <>
              <button
                disabled={payState === "starting" || payState === "waiting" || paymentTriggered}
                onClick={onPayWithMonnify}
                className="h-14 w-full rounded-full bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-70 active:opacity-90"
              >
                {payState === "starting"
                  ? "Opening Monnify…"
                  : payState === "waiting"
                    ? "Waiting for payment…"
                    : paymentTriggered
                      ? "Verifying payment…"
                      : `Pay ${fmtNaira(amount)} with Monnify`}
              </button>
              {payError && (
                <p className="text-center text-[12px] text-destructive">{payError}</p>
              )}
              {payState === "waiting" && (
                <p className="text-center text-[11.5px] text-muted-foreground">
                  Complete the transfer in the Monnify tab. This page updates automatically.
                </p>
              )}
            </>
          ) : (
            <button
              disabled={paymentTriggered}
              onClick={onMadePayment}
              className="h-14 w-full rounded-full bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-70 active:opacity-90"
            >
              {paymentTriggered ? "Verifying payment…" : "I've Made Payment"}
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

/* ---------------- Overtime ---------------- */

function OvertimePane({
  shift,
  overtimeSec,
  total,
  extensionMin,
  extensionAmount,
  onCopy,
  onMadePayment,
  paymentTriggered,
  onPayWithMonnify,
  payState,
  payError,
}: {
  shift: ShiftMeta;
  overtimeSec: number;
  total: number;
  extensionMin: number;
  extensionAmount: number;
  onCopy: () => void;
  onMadePayment: () => void;
  paymentTriggered: boolean;
  onPayWithMonnify?: () => void;
  payState: "idle" | "starting" | "waiting" | "error";
  payError: string | null;
}) {
  void shift;
  const billedMin = extensionMin;
  const extra = extensionAmount;


  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex h-full w-full flex-col safe-top"
    >
      <TopBar />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Coverage Extended
        </div>
        <div className="mt-3 text-[13px] text-muted-foreground">Total Settlement</div>
        <div className="mt-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums">
          {fmtNaira(total)}
        </div>
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Settlement grace period elapsed. Coverage automatically resumed billing.
        </p>

        <div className="mt-5 rounded-2xl bg-surface-elevated p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Transfer To
          </div>
          <div className="mt-2 text-[15px] font-medium">{ACCOUNT.bank}</div>
          <div className="mt-1 text-[30px] font-semibold leading-none tracking-[0.06em] tabular-nums">
            {ACCOUNT.number}
          </div>
          <button
            onClick={onCopy}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-[12.5px] font-medium text-foreground/80"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
              <path d="M5 15V6a2 2 0 012-2h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            Copy account number
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
            Extension
          </span>
          <span className="text-[14px] font-medium tabular-nums">
            +{billedMin}min · +{fmtNaira(extra)}
          </span>
        </div>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          Billed in 15-min half-blocks · {fmtClock(overtimeSec)} elapsed
        </p>

        <div className="mt-auto pb-8">
          <button
            disabled={paymentTriggered}
            onClick={onMadePayment}
            className="h-14 w-full rounded-full bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-70 active:opacity-90"
          >
            {paymentTriggered ? "Verifying payment…" : "I've Made Payment"}
          </button>
        </div>
      </div>
    </motion.section>
  );
}

/* ---------------- Confirmed ---------------- */

function ConfirmedPane({
  shift,
  total,
  billedMin,
  onClose,
}: {
  shift: ShiftMeta;
  total: number;
  billedMin: number;
  onClose: () => void;
}) {
  void billedMin;
  const [ratingOpen, setRatingOpen] = useState(true);
  const [rated, setRated] = useState(false);


  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex h-full w-full flex-col safe-top"
    >
      <TopBar onClose={onClose} />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-2">
        <div className="mt-2 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "color-mix(in oklab, var(--color-presence) 18%, transparent)" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5 12.5l4 4 10-10" stroke="var(--color-presence)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mt-4 text-[24px] font-semibold tracking-tight">Settlement confirmed</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
          Coverage with {shift.doctor} closed.
        </p>

        <div className="mt-6 rounded-2xl bg-surface-elevated p-5">
          <Row label="Facility" value={shift.facility} />
          <Row label="Coverage" value={shift.role} />
          <Row label="Settled" value={fmtNaira(total)} strong />
        </div>


        {rated && (
          <p className="mt-2 text-[12px] text-muted-foreground">Thanks for the feedback.</p>
        )}

        <div className="mt-auto space-y-2 pb-8">
          <button
            onClick={onClose}
            className="h-13 w-full rounded-full bg-primary py-4 text-[14.5px] font-semibold text-primary-foreground active:opacity-90"
          >
            Done
          </button>
        </div>
      </div>


      <RatingOverlay
        open={ratingOpen}
        doctor={shift.doctor}
        onDismiss={() => setRatingOpen(false)}
        onSubmit={() => {
          setRated(true);
          setRatingOpen(false);
        }}
      />
    </motion.section>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-2 last:border-0">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className={strong ? "text-[15px] font-semibold tabular-nums" : "text-[13.5px] font-medium"}>
        {value}
      </span>
    </div>
  );
}

/* ---------------- TopBar ---------------- */

function TopBar({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-12 w-full items-center justify-between px-4">
      {onClose ? (
        <button
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-elevated"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <span className="h-9 w-9" />
      )}
      <span className="text-[12px] uppercase tracking-[0.16em] text-muted-foreground">FlashLocum</span>
      <span className="h-9 w-9" />
    </div>
  );
}
