import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RatingOverlay } from "@/components/RatingOverlay";

type Phase = "active" | "settlement" | "grace" | "overtime" | "confirmed";

type ShiftMeta = {
  facility: string;
  doctor: string;
  role: string;
  amount: number; // base settlement
};

const SAMPLE: ShiftMeta = {
  facility: "Evercare Hospital",
  doctor: "Dr. Adaobi Okeke",
  role: "Standard · 10 hrs",
  amount: 120000,
};

const ACCOUNT = { bank: "Providus Bank", number: "0123456789" };

const VISIBLE_COUNTDOWN = 5 * 60; // 5 minutes
const GRACE_TOTAL = 15 * 60; // 15 minutes total settlement window
const OVERTIME_RATE_PER_MIN = 600; // ₦600/min illustrative

function fmtNaira(n: number) {
  return "₦" + n.toLocaleString("en-NG");
}
function fmtClock(s: number) {
  const m = Math.max(0, Math.floor(s / 60));
  const sec = Math.max(0, s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function ShiftSettlement({
  open,
  onClose,
  shift = SAMPLE,
  initialPhase = "active",
  onConfirmed,
  onRebook,
}: {
  open: boolean;
  onClose: () => void;
  shift?: ShiftMeta;
  initialPhase?: Phase;
  onConfirmed?: () => void;
  onRebook?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [elapsed, setElapsed] = useState(0); // seconds since End Shift
  const [overtimeSec, setOvertimeSec] = useState(0);
  const autoConfirmAt = useRef<number | null>(null);

  // Reset whenever opened fresh
  useEffect(() => {
    if (open) {
      setPhase(initialPhase);
      setElapsed(0);
      setOvertimeSec(0);
      autoConfirmAt.current = null;
    }
  }, [open, initialPhase]);

  useEffect(() => {
    if (phase === "confirmed") onConfirmed?.();
  }, [phase, onConfirmed]);

  // Master tick after End Shift
  useEffect(() => {
    if (!open) return;
    if (phase === "active" || phase === "confirmed") return;

    const id = setInterval(() => {
      setElapsed((e) => e + 1);
      if (phase === "overtime") setOvertimeSec((s) => s + 1);

      // Independent passive payment detection — random small chance to simulate webhook
      if (
        (phase === "settlement" || phase === "grace") &&
        autoConfirmAt.current &&
        Date.now() >= autoConfirmAt.current
      ) {
        setPhase("confirmed");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [open, phase]);

  // Transition settlement → grace at 5min, grace → overtime at 15min
  useEffect(() => {
    if (phase === "settlement" && elapsed >= VISIBLE_COUNTDOWN) setPhase("grace");
    if (phase === "grace" && elapsed >= GRACE_TOTAL) setPhase("overtime");
  }, [elapsed, phase]);

  const handleEndShift = () => {
    setElapsed(0);
    setPhase("settlement");
    // Simulate independent verification arriving 8–14s after End Shift in some sessions
    if (Math.random() < 0.35) {
      autoConfirmAt.current = Date.now() + (8 + Math.random() * 6) * 1000;
    }
  };

  const handleMadePayment = () => {
    // Reassurance action — kicks verification immediately, but still verifies
    autoConfirmAt.current = Date.now() + 2500;
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
          <ActivePane key="active" shift={shift} onClose={onClose} onEnd={handleEndShift} />
        )}
        {(phase === "settlement" || phase === "grace") && (
          <SettlementPane
            key="settle"
            shift={shift}
            phase={phase}
            elapsed={elapsed}
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
            onCopy={handleCopy}
            onMadePayment={handleMadePayment}
            paymentTriggered={autoConfirmAt.current !== null}
          />
        )}
        {phase === "confirmed" && (
          <ConfirmedPane
            key="done"
            shift={shift}
            overtimeSec={overtimeSec}
            onClose={onClose}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ---------------- Active ---------------- */

function ActivePane({
  shift,
  onClose,
  onEnd,
}: {
  shift: ShiftMeta;
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
  onCopy,
  onMadePayment,
  paymentTriggered,
}: {
  shift: ShiftMeta;
  phase: "settlement" | "grace";
  elapsed: number;
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
          {fmtNaira(shift.amount)}
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
  const extra = useMemo(
    () => Math.ceil(overtimeSec / 60) * OVERTIME_RATE_PER_MIN,
    [overtimeSec],
  );
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
            +{fmtClock(overtimeSec)} · +{fmtNaira(extra)}
          </span>
        </div>

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
  const extra = Math.ceil(overtimeSec / 60) * OVERTIME_RATE_PER_MIN;
  const total = shift.amount + extra;
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

        <p className="mt-4 text-[12.5px] text-muted-foreground">
          Settlement will be processed to the doctor by 10:00 PM.
        </p>

        <div className="mt-auto space-y-2 pb-8">
          <button
            onClick={onClose}
            className="h-13 w-full rounded-full bg-primary py-4 text-[14.5px] font-semibold text-primary-foreground active:opacity-90"
          >
            Request again
          </button>
          <button
            onClick={onClose}
            className="h-12 w-full rounded-full text-[13.5px] font-medium text-muted-foreground"
          >
            Done
          </button>
        </div>
      </div>
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
