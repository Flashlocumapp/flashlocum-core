import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RatingOverlay } from "@/components/RatingOverlay";
import { simNow, useSimClock } from "@/lib/clock";
import {
  computeWorkedPricing,
  roundedOverrunMinutes,
  type CoverageKind,
} from "@/lib/pricing";


type Phase = "active" | "settlement" | "grace" | "overtime" | "confirmed";

type ShiftMeta = {
  facility: string;
  doctor: string;
  role: string;
  /** Realtime billing inputs — derived from LIVE Active Coverage timer. */
  startedAt: number;
  startHHMM: string;
  coverageKind: CoverageKind;
};

const SAMPLE: ShiftMeta = {
  facility: "Evercare Hospital",
  doctor: "Dr. Adaobi Okeke",
  role: "Standard · Active",
  startedAt: Date.now() - 60 * 60 * 1000,
  startHHMM: "08:00",
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
}: {
  open: boolean;
  onClose: () => void;
  shift?: ShiftMeta;
  initialPhase?: Phase;
  onConfirmed?: () => void;
  onRebook?: () => void;
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
  const workedMin = Math.max(0, (effectiveNow - shift.startedAt) / 60000);
  const billedMin = roundedOverrunMinutes(workedMin);
  const totalAmount = useMemo(
    () => computeWorkedPricing(shift.coverageKind, shift.startHHMM, billedMin).amount,
    [shift.coverageKind, shift.startHHMM, billedMin],
  );
  // Snapshot of the bill at the moment End Shift was pressed.
  const frozenBilledMinRef = useRef<number>(0);
  const frozenAmountRef = useRef<number>(0);
  const frozenBilledMin = frozenBilledMinRef.current;
  const frozenAmount = frozenAmountRef.current;
  const extensionMin = Math.max(0, billedMin - frozenBilledMin);
  const extensionAmount = Math.max(0, totalAmount - frozenAmount);

  // Reset whenever opened fresh
  useEffect(() => {
    if (open) {
      setPhase(initialPhase);
      phaseStartedAtRef.current =
        initialPhase === "active" || initialPhase === "confirmed" ? null : simNow();
      overtimeStartedAtRef.current = initialPhase === "overtime" ? simNow() : null;
      endedAtRef.current = null;
      confirmedAtRef.current = null;
      autoConfirmAt.current = null;
      frozenBilledMinRef.current = 0;
      frozenAmountRef.current = 0;
    }
  }, [open, initialPhase]);

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
    const w = Math.max(0, (now - shift.startedAt) / 60000);
    const bm = roundedOverrunMinutes(w);
    frozenBilledMinRef.current = bm;
    frozenAmountRef.current = computeWorkedPricing(
      shift.coverageKind,
      shift.startHHMM,
      bm,
    ).amount;
    setPhase("settlement");
    if (Math.random() < 0.35) {
      autoConfirmAt.current = simNow() + (8 + Math.random() * 6) * 1000;
    }
  };

  const handleMadePayment = () => {
    autoConfirmAt.current = simNow() + 2500;
  };



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
}: {
  shift: ShiftMeta;
  phase: "settlement" | "grace";
  elapsed: number;
  billedMin: number;
  amount: number;
  onCopy: () => void;
  onMadePayment: () => void;
  paymentTriggered: boolean;
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
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          Worked {fmtHrMin(billedMin)} · billed in 15-min half-blocks
        </p>


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

        <div className="mt-auto pb-8">
          <button
            disabled={paymentTriggered}
            onClick={onMadePayment}
            className="h-14 w-full rounded-full bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-70 active:opacity-90"
          >
            {paymentTriggered ? "Verifying payment…" : "I've Made Payment"}
          </button>
          <p className="mt-3 text-center text-[11.5px] text-muted-foreground">
            Payment is detected automatically. This is just a heads-up.
          </p>
        </div>
      </div>
    </motion.section>
  );
}

/* ---------------- Overtime ---------------- */

function OvertimePane({
  shift,
  overtimeSec,
  onCopy,
  onMadePayment,
  paymentTriggered,
}: {
  shift: ShiftMeta;
  overtimeSec: number;
  onCopy: () => void;
  onMadePayment: () => void;
  paymentTriggered: boolean;
}) {
  const billedMin = useMemo(
    () => roundedOverrunMinutes(overtimeSec / 60),
    [overtimeSec],
  );
  const extra = billedMin * OVERTIME_RATE_PER_MIN;
  const total = shift.amount + extra;

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
  overtimeSec,
  onClose,
}: {
  shift: ShiftMeta;
  overtimeSec: number;
  onClose: () => void;
}) {
  const extra = roundedOverrunMinutes(overtimeSec / 60) * OVERTIME_RATE_PER_MIN;
  const total = shift.amount + extra;
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
