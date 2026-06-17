import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { RatingOverlay } from "@/components/RatingOverlay";
import { simNow, useSimClock } from "@/lib/clock";
import {
  computeWorkedPricing,
  billableMinutes,
  bookedMinutesFromWindow,
  type CoverageKind,
  type Environment,
} from "@/lib/pricing";
import { beginSettlementCheckout, verifySettlementPayment } from "@/lib/settlement.functions";
import { getRequestBillingState, extendPaymentWindow } from "@/lib/shift.functions";
import { supabase } from "@/integrations/supabase/client";


type TransferAccount = {
  amount: number;
  accountNumber: string;
  accountName: string;
  bankName: string;
  expiresOn: string | null;
  paymentReference: string;
};



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
  /** Environment captured at booking; multiplies pricing ×1.25 when 'busy'. */
  environment?: Environment;
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
  intent = "end",
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
  /** "end" = final assignment close. "pause" = close today's segment and
   *  proceed to payment; on payment confirmation the requester returns to
   *  Upcoming Coverage and can resume the shift later. */
  intent?: "end" | "pause";
}) {

  const [phase, setPhase] = useState<Phase>(initialPhase);
  // Anchor timestamps drive every elapsed/overtime computation so that a
  // simulation fast-forward instantly advances the visible state.
  const phaseStartedAtRef = useRef<number | null>(null);
  const overtimeStartedAtRef = useRef<number | null>(null);
  const endedAtRef = useRef<number | null>(null);
  const confirmedAtRef = useRef<number | null>(null);
  const autoConfirmAt = useRef<number | null>(null);

  // Backend-authoritative segment list (one entry per pause/resume cycle).
  // Surfaced in ConfirmedPane so multi-day shifts show a breakdown.
  type SegmentRow = {
    id: string;
    segment_index: number;
    started_at: string;
    ended_at: string | null;
    billed_minutes: number | null;
    billed_amount: number | null;
  };
  const [segments, setSegments] = useState<SegmentRow[]>([]);
  const [extensionCount, setExtensionCount] = useState(0);

  // Authoritative transaction record loaded from the backend the moment
  // payment is confirmed. ConfirmedPane renders from this — never from
  // local/frontend state — so the Settlement Confirmed page is always
  // tied to the exact completed transaction.
  type TxRecord = {
    id: string;
    hospital: string | null;
    coverage_type: string | null;
    day: string | null;
    start_time: string | null;
    end_time: string | null;
    settled_amount: number | null;
    payment_reference: string | null;
    paid_at: string | null;
    accepted_by: string | null;
    doctorName: string | null;
  };
  const [tx, setTx] = useState<TxRecord | null>(null);


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
        workedMin,
        shift.endHHMM,
        shift.days,
        shift.environment ?? "normal",
        bookedMinutesFromWindow(shift.startHHMM, shift.endHHMM ?? shift.startHHMM),
      ).amount,
    [shift.coverageKind, shift.startHHMM, shift.endHHMM, shift.days, shift.environment, workedMin],
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
        const priced = computeWorkedPricing(
          shift.coverageKind,
          shift.startHHMM,
          w,
          shift.endHHMM,
          shift.days,
          shift.environment ?? "normal",
          bookedMinutesFromWindow(shift.startHHMM, shift.endHHMM ?? shift.startHHMM),
        );
        frozenBilledMinRef.current = priced.billableMinutes;
        frozenAmountRef.current = priced.amount;
      } else {
        frozenBilledMinRef.current = 0;
        frozenAmountRef.current = 0;
      }
    }
  }, [open, initialPhase, shift.startedAt, shift.accumulatedMs, shift.coverageKind, shift.startHHMM, shift.endHHMM, shift.days]);

  const finalize = () => {
    onClose();
  };

  // Fire onConfirmed exactly once the moment payment lands. This triggers the
  // requester→network "complete" event immediately, so the doctor's rating
  // card for the hospital appears as soon as payment is confirmed —
  // independent of whether the requester has tapped Done or rated yet.
  const confirmedFiredRef = useRef(false);
  useEffect(() => {
    if (!open) {
      confirmedFiredRef.current = false;
      return;
    }
    if (phase === "confirmed" && !confirmedFiredRef.current) {
      confirmedFiredRef.current = true;
      onConfirmed?.();
    }
  }, [phase, open, onConfirmed]);

  // Pause+Pay: after webhook confirms payment, auto-close settlement so the
  // shift moves to Upcoming Coverage with the timer reset for the next day.
  // End Shift keeps the ConfirmedPane (rating overlay + payment summary).
  useEffect(() => {
    if (!open) return;
    if (phase !== "confirmed") return;
    if (intent !== "pause") return;
    const t = setTimeout(() => onClose(), 700);
    return () => clearTimeout(t);
  }, [phase, intent, open, onClose]);

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
      shift.environment ?? "normal",
    ).amount;
    setPhase("settlement");
    if (requestId) {
      // Auto-open Monnify checkout immediately after End Shift.
      setTimeout(() => { void startMonnifyCheckout(); }, 50);
    } else if (Math.random() < 0.35) {
      autoConfirmAt.current = simNow() + (8 + Math.random() * 6) * 1000;
    }

  };

  const handleMadePayment = () => {
    autoConfirmAt.current = simNow() + 2500;
  };

  const confirmPaymentNow = useCallback(() => {
    const now = simNow();
    autoConfirmAt.current = now;
    confirmedAtRef.current = now;
    setPhase("confirmed");
  }, []);

  // ---------------- Monnify custom transfer ----------------
  const beginCheckout = useServerFn(beginSettlementCheckout);
  const verifyPay = useServerFn(verifySettlementPayment);
  

  const [payState, setPayState] = useState<"idle" | "starting" | "waiting" | "error">("idle");
  const [payError, setPayError] = useState<string | null>(null);
  const [account, setAccount] = useState<TransferAccount | null>(null);
  const [payCheckState, setPayCheckState] = useState<"idle" | "checking" | "not_found" | "error">("idle");
  const [payCheckError, setPayCheckError] = useState<string | null>(null);

  const startMonnifyCheckout = async () => {
    if (!requestId) return;
    setPayError(null);
    setPayState("starting");
    try {
      // Server is the sole source of truth for the payment amount — it
      // reads `total_billed_amount` set by end_shift. The client no longer
      // submits an amount.
      const result = await beginCheckout({
        data: { requestId },
      });
      if ("alreadyPaid" in result && result.alreadyPaid) {
        confirmPaymentNow();
        return;
      }
      setAccount(result as TransferAccount);
      setPayState("waiting");
      setPayCheckState("idle");
      setPayCheckError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not start checkout";
      setPayError(msg);
      setPayState("error");
    }
  };

  const checkMonnifyPaymentNow = async () => {
    if (!requestId || payCheckState === "checking") return;
    setPayCheckState("checking");
    setPayCheckError(null);
    try {
      const res = await verifyPay({ data: { requestId } });
      if (res?.paid) {
        confirmPaymentNow();
      } else {
        setPayCheckState("not_found");
      }
    } catch (e) {
      setPayCheckState("error");
      setPayCheckError(e instanceof Error ? e.message : "Could not confirm payment yet");
    }
  };


  // Auto-start the moment we land in settlement. For pause-intent the
  // backend pause_shift RPC has already been awaited upstream
  // (CoverageScreen.beginPause) so today's segment is billed before checkout
  // opens — we just kick off Monnify here.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!open || !requestId) return;
    if (phase !== "settlement") return;
    if (autoOpenedRef.current) return;
    if (payState !== "idle") return;
    autoOpenedRef.current = true;
    void startMonnifyCheckout();
  }, [open, requestId, phase, payState]);

  useEffect(() => {
    if (!open) {
      autoOpenedRef.current = false;
      setAccount(null);
      setPayState("idle");
      setPayError(null);
      setPayCheckState("idle");
      setPayCheckError(null);
      setTx(null);
    }
  }, [open]);

  // Load the authoritative transaction record from the backend whenever
  // payment is confirmed. Polls briefly to absorb the gap between webhook
  // marking paid and the row reflecting settled_amount / paid_at.
  useEffect(() => {
    if (!open || !requestId) return;
    if (phase !== "confirmed") return;
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 12;
    const run = async () => {
      while (!cancelled && attempts < MAX_ATTEMPTS) {
        attempts++;
        try {
          const { data: row } = await supabase
            .from("coverage_requests")
            .select(
              "id, hospital, coverage_type, day, start_time, end_time, settled_amount, payment_reference, paid_at, accepted_by, payment_status",
            )
            .eq("id", requestId)
            .maybeSingle();
          if (cancelled) return;
          if (row && row.payment_status === "paid") {
            let doctorName: string | null = null;
            if (row.accepted_by) {
              const { data: doc } = await supabase
                .rpc("get_assigned_doctor_profile", { _doctor: row.accepted_by })
                .maybeSingle();
              doctorName = (doc as { full_name?: string } | null)?.full_name ?? null;
            }
            if (!cancelled) {
              setTx({
                id: row.id,
                hospital: row.hospital,
                coverage_type: row.coverage_type,
                day: row.day,
                start_time: row.start_time,
                end_time: row.end_time,
                settled_amount: row.settled_amount,
                payment_reference: row.payment_reference,
                paid_at: row.paid_at,
                accepted_by: row.accepted_by,
                doctorName,
              });
            }
            return;
          }
        } catch (err) {
          console.warn("[settlement] load tx record failed:", err);
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, requestId, phase]);





  // Detect paid status primarily via a per-row Realtime subscription
  // (filter id=eq.${requestId}) — eliminates the per-user firehose poll.
  // Adaptive polling kicks in only as a fallback: starts at 6s, backs off
  // to 30s, pauses when the tab is hidden, and hard-stops after 20 min.
  // Monnify reconcile runs at most every 60s and stops after 20 min.
  useEffect(() => {
    if (!open || !requestId) return;
    if (phase === "confirmed") return;

    let cancelled = false;
    const startedAt = Date.now();
    const HARD_STOP_MS = 20 * 60 * 1000; // 20 minutes
    const MIN_DELAY_MS = 1_500;
    const MAX_DELAY_MS = 8_000;
    const RECONCILE_EVERY_MS = 2_000;
    let delay = MIN_DELAY_MS;
    let lastReconcileAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const markPaid = () => {
      confirmPaymentNow();
    };

    const checkOnce = async () => {
      const { data } = await supabase
        .from("coverage_requests")
        .select("payment_status")
        .eq("id", requestId)
        .maybeSingle();
      if (cancelled) return true;
      if (data?.payment_status === "paid") {
        markPaid();
        return true;
      }
      const now = Date.now();
      if (now - lastReconcileAt >= RECONCILE_EVERY_MS) {
        lastReconcileAt = now;
        try {
          const res = await verifyPay({ data: { requestId } });
          if (!cancelled && res?.paid) {
            markPaid();
            return true;
          }
        } catch {
          /* swallow — next tick will retry */
        }
      }
      return false;
    };

    const schedule = () => {
      if (cancelled) return;
      if (Date.now() - startedAt >= HARD_STOP_MS) return;
      const wait = document.visibilityState === "hidden" ? MAX_DELAY_MS : delay;
      timer = setTimeout(async () => {
        const done = await checkOnce();
        if (done || cancelled) return;
        delay = Math.min(MAX_DELAY_MS, Math.round(delay * 1.5));
        schedule();
      }, wait);
    };

    // Realtime: fires the instant the webhook updates payment_status.
    const channel = supabase
      .channel(`settlement:${requestId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "coverage_requests", filter: `id=eq.${requestId}` },
        (payload) => {
          const row = payload.new as { payment_status?: string } | null;
          if (row?.payment_status === "paid") markPaid();
        },
      )
      .subscribe();

    // Fallback: coverage_requests is excluded from supabase_realtime, so the
    // postgres_changes binding above never fires in production. The webhook
    // broadcasts on the `coverage_invalidations` channel — subscribe to the
    // SAME channel name so we receive the signal and recheck instantly.
    const invalidate = supabase
      .channel("coverage_invalidations", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "invalidate" }, () => {
        void checkOnce();
      })
      .subscribe();

    // Kick off one immediate check, then enter adaptive backoff.
    void (async () => {
      const done = await checkOnce();
      if (!done) schedule();
    })();

    const onVisibility = () => {
      // When the tab returns to foreground, reset delay and check now.
      if (document.visibilityState === "visible" && !cancelled) {
        delay = MIN_DELAY_MS;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        void (async () => {
          const done = await checkOnce();
          if (!done) schedule();
        })();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(invalidate);
    };
  }, [open, requestId, phase, verifyPay, confirmPaymentNow]);

  // ------ Backend-authoritative billing state + auto-extension ------
  // The backend owns the payment window. We poll get_request_billing_state
  // while waiting for payment, override the displayed amount with the
  // server's total_billed_amount, and call extend_payment_window the
  // moment payment_due_at passes (the RPC handles the 15-min block +
  // restriction-after-2 logic). Stops on confirmed / unmount.
  const fetchBilling = useServerFn(getRequestBillingState);
  const extendWindow = useServerFn(extendPaymentWindow);
  useEffect(() => {
    if (!open || !requestId) return;
    if (phase === "active" || phase === "confirmed") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let extending = false;

    const tickServer = async () => {
      try {
        const s = await fetchBilling({ data: { requestId } });
        if (cancelled || !s) return;
        if (typeof s.total_billed_amount === "number" && s.total_billed_amount > 0) {
          // Server total is authoritative — surface it in the UI.
          frozenAmountRef.current = Math.max(
            frozenAmountRef.current,
            s.total_billed_amount,
          );
        }
        if (Array.isArray(s.segments)) setSegments(s.segments as SegmentRow[]);
        if (typeof s.payment_extension_count === "number") {
          setExtensionCount(s.payment_extension_count);
        }

        if (s.payment_status !== "paid" && s.payment_due_at && s.server_now) {
          const due = Date.parse(s.payment_due_at);
          const now = Date.parse(s.server_now);
          if (!Number.isNaN(due) && !Number.isNaN(now) && now >= due && !extending) {
            extending = true;
            try {
              await extendWindow({ data: { requestId } });
            } catch (err) {
              console.warn("[settlement] extend_payment_window failed:", err);
            } finally {
              extending = false;
            }
          }
        }
      } catch (err) {
        console.warn("[settlement] billing poll failed:", err);
      }
      if (!cancelled) timer = setTimeout(tickServer, 30_000);
    };
    void tickServer();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, requestId, phase, fetchBilling, extendWindow]);



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
            liveAmount={totalAmount}
            onCopy={handleCopy}
            onMadePayment={handleMadePayment}
            paymentTriggered={autoConfirmAt.current !== null}
            onPayWithMonnify={requestId ? startMonnifyCheckout : undefined}
            payState={payState}
            payError={payError}
            account={account}
            payCheckState={payCheckState}
            payCheckError={payCheckError}
            onCheckPayment={checkMonnifyPaymentNow}
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
            account={account}
            payCheckState={payCheckState}
            payCheckError={payCheckError}
            onCheckPayment={checkMonnifyPaymentNow}
          />
        )}
        {phase === "confirmed" && (
          <ConfirmedPane
            key="done"
            shift={shift}
            total={totalAmount}
            billedMin={billedMin}
            segments={segments}
            extensionCount={extensionCount}
            tx={tx}
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
      className="relative flex h-full w-full flex-col"
    >
      <TopBar onClose={onClose} />
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-y-auto px-6 pt-2">
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
  liveAmount,
  onCopy,
  onMadePayment,
  paymentTriggered,
  onPayWithMonnify,
  payState,
  payError,
  account,
  payCheckState,
  payCheckError,
  onCheckPayment,
}: {
  shift: ShiftMeta;
  phase: "settlement" | "grace";
  elapsed: number;
  billedMin: number;
  amount: number;
  liveAmount?: number;
  onCopy: () => void;
  onMadePayment: () => void;
  paymentTriggered: boolean;
  onPayWithMonnify?: () => void;
  payState: "idle" | "starting" | "waiting" | "error";
  payError: string | null;
  account: TransferAccount | null;
  payCheckState: "idle" | "checking" | "not_found" | "error";
  payCheckError: string | null;
  onCheckPayment: () => void;
}) {
  // Monnify custom-transfer flow.
  if (onPayWithMonnify) {
    return (
      <CustomTransferPane
        amount={liveAmount ?? amount}
        account={account}
        payState={payState}
        payError={payError}
        paymentTriggered={paymentTriggered}
        onRetry={onPayWithMonnify}
        payCheckState={payCheckState}
        payCheckError={payCheckError}
        onCheckPayment={onCheckPayment}
      />
    );
  }



  const remaining = phase === "settlement"
    ? Math.max(0, VISIBLE_COUNTDOWN - elapsed)
    : Math.max(0, GRACE_TOTAL - elapsed);

  return (
    <motion.section
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 32 }}
      className="relative flex h-full w-full flex-col"
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
  account,
  payCheckState,
  payCheckError,
  onCheckPayment,
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
  account: TransferAccount | null;
  payCheckState: "idle" | "checking" | "not_found" | "error";
  payCheckError: string | null;
  onCheckPayment: () => void;
}) {
  if (onPayWithMonnify) {
    return (
      <CustomTransferPane
        amount={total}
        account={account}
        payState={payState}
        payError={payError}
        paymentTriggered={paymentTriggered}
        onRetry={onPayWithMonnify}
        payCheckState={payCheckState}
        payCheckError={payCheckError}
        onCheckPayment={onCheckPayment}
      />
    );
  }
  void shift;
  const billedMin = extensionMin;
  const extra = extensionAmount;


  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex h-full w-full flex-col"
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
                      : `Pay ${fmtNaira(total)} with Monnify`}
              </button>
              {payError && (
                <p className="text-center text-[12px] text-destructive">{payError}</p>
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

/* ---------------- Confirmed ---------------- */

function ConfirmedPane({
  shift,
  total,
  billedMin,
  segments = [],
  extensionCount = 0,
  tx = null,
  onClose,
}: {
  shift: ShiftMeta;
  total: number;
  billedMin: number;
  segments?: Array<{
    id: string;
    segment_index: number;
    started_at: string;
    ended_at: string | null;
    billed_minutes: number | null;
    billed_amount: number | null;
  }>;
  extensionCount?: number;
  tx?: {
    id: string;
    hospital: string | null;
    coverage_type: string | null;
    day: string | null;
    start_time: string | null;
    end_time: string | null;
    settled_amount: number | null;
    payment_reference: string | null;
    paid_at: string | null;
    accepted_by: string | null;
    doctorName: string | null;
  } | null;
  onClose: () => void;
}) {
  void billedMin;
  const [ratingOpen, setRatingOpen] = useState(true);
  const [rated, setRated] = useState(false);

  const fmtSegTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-NG", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Authoritative values from the backend transaction record. We render
  // these instead of frontend state once `tx` lands so the page is always
  // tied to the actual completed transaction.
  const loading = !tx;
  const facility = tx?.hospital ?? shift.facility;
  const doctor = tx?.doctorName ?? shift.doctor;
  const coverageLabel = tx?.coverage_type ?? shift.role;
  const settled = tx?.settled_amount ?? total;
  const paidAtLabel = tx?.paid_at ? fmtSegTime(tx.paid_at) : null;
  const scheduleLabel =
    tx?.day && tx?.start_time && tx?.end_time
      ? `${tx.day} · ${tx.start_time} – ${tx.end_time}`
      : null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative flex h-full w-full flex-col"
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
          {loading ? "Loading transaction details…" : `Coverage with ${doctor} closed.`}
        </p>

        <div className="mt-6 rounded-2xl bg-surface-elevated p-5">
          <Row label="Facility" value={facility} />
          <Row label="Coverage" value={coverageLabel} />
          {scheduleLabel && <Row label="Shift" value={scheduleLabel} />}
          <Row label="Doctor" value={doctor} />
          <Row label="Settled" value={fmtNaira(settled)} strong />
          {paidAtLabel && <Row label="Paid at" value={paidAtLabel} />}
          {tx?.payment_reference && (
            <Row label="Reference" value={tx.payment_reference} />
          )}
          {extensionCount > 0 && (
            <Row
              label="Payment extensions"
              value={`${extensionCount} × 15min`}
            />
          )}
        </div>


        {segments.length > 1 && (
          <div className="mt-4 rounded-2xl bg-surface-elevated p-5">
            <div className="mb-2 text-[11.5px] uppercase tracking-[0.14em] text-muted-foreground">
              Session breakdown
            </div>
            <ul className="space-y-2">
              {segments.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 border-b border-border/40 pb-2 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium">
                      Session {s.segment_index}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {fmtSegTime(s.started_at)} → {fmtSegTime(s.ended_at)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12.5px] font-semibold tabular-nums">
                      {fmtNaira(s.billed_amount ?? 0)}
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {fmtHrMin(s.billed_minutes ?? 0)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

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
        doctor={doctor}
        onDismiss={() => setRatingOpen(false)}
        onSubmit={() => {
          setRated(true);
          setRatingOpen(false);
        }}
      />
    </motion.section>
  );
}

const Row = memo(function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border/50 py-2 last:border-0">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className={strong ? "text-[15px] font-semibold tabular-nums" : "text-[13.5px] font-medium"}>
        {value}
      </span>
    </div>
  );
});

/* ---------------- TopBar ---------------- */

const TopBar = memo(function TopBar({ onClose }: { onClose?: () => void }) {
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
});

/* ---------------- Custom Transfer (Monnify-backed, in-app UI) ---------------- */

function CustomTransferPane({
  amount,
  account,
  payState,
  payError,
  paymentTriggered,
  onRetry,
  payCheckState,
  payCheckError,
  onCheckPayment,
}: {
  amount: number;
  account: TransferAccount | null;
  payState: "idle" | "starting" | "waiting" | "error";
  payError: string | null;
  paymentTriggered: boolean;
  onRetry: () => void;
  payCheckState: "idle" | "checking" | "not_found" | "error";
  payCheckError: string | null;
  onCheckPayment: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // 15-minute price-hold countdown. Anchored to when the account first
  // appears so the timer stays in sync with the locked transfer amount.
  const PRICE_HOLD_SEC = 15 * 60;
  const tick = useSimClock(1000);
  const startedAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (account && startedAtRef.current == null) startedAtRef.current = simNow();
    if (!account) startedAtRef.current = null;
  }, [account]);
  const remaining = startedAtRef.current
    ? Math.max(0, PRICE_HOLD_SEC - Math.floor((tick - startedAtRef.current) / 1000))
    : PRICE_HOLD_SEC;
  const expired = startedAtRef.current != null && remaining === 0;

  // When the price hold expires AND the live recomputed amount differs from
  // the locked transfer amount, automatically re-issue the transfer account
  // so the Payment page always reflects the current source-of-truth amount
  // (matching Settlement, Coverage History, etc.). Reset anchor so the new
  // 15-min hold restarts.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!expired) {
      refreshedRef.current = false;
      return;
    }
    if (refreshedRef.current) return;
    if (account && amount > account.amount && !paymentTriggered) {
      refreshedRef.current = true;
      startedAtRef.current = null;
      onRetry();
    }
  }, [expired, amount, account, paymentTriggered, onRetry]);

  // Display always prefers the higher of locked vs live amount so the user
  // never sees a stale value if recompute has happened.
  const displayAmount = account
    ? Math.max(account.amount, amount)
    : amount;

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex h-full w-full flex-col"
    >
      <TopBar />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Complete Coverage
        </div>
        <div className="mt-3 text-[13px] text-muted-foreground">Transfer Exactly</div>
        <div className="mt-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums">
          {fmtNaira(displayAmount)}
        </div>


        {payState === "starting" || (!account && !payError) ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-muted-foreground">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span className="text-[12.5px]">Generating secure account…</span>
          </div>
        ) : payError ? (
          <div className="mt-8 rounded-2xl bg-surface-elevated p-5 text-center">
            <p className="text-[13px] text-destructive">{payError}</p>
            <button
              onClick={onRetry}
              className="mt-4 h-11 rounded-full bg-primary px-6 text-[13.5px] font-semibold text-primary-foreground"
            >
              Try again
            </button>
          </div>
        ) : account ? (
          <>
            <div className="mt-6 rounded-2xl bg-surface-elevated p-5 shadow-[0_2px_14px_-8px_rgba(0,0,0,0.18)]">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Bank
              </div>
              <div className="mt-1 text-[15px] font-medium">{account.bankName}</div>

              <div className="mt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Account Number
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <div className="text-[26px] font-semibold leading-none tracking-[0.06em] tabular-nums">
                  {account.accountNumber}
                </div>
                <button
                  onClick={() => copy(account.accountNumber)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground/80 active:opacity-80"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M5 15V6a2 2 0 012-2h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <div className="mt-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Account Name
              </div>
              <div className="mt-1 text-[14px] font-medium">{account.accountName}</div>
            </div>

            <div className="mt-5 flex items-center justify-between rounded-2xl bg-secondary/40 px-4 py-3">
              <div className="flex flex-col">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {expired ? "Price hold expired" : "Price held for"}
                </span>
                <span className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {expired
                    ? "Amount may increase if payment isn't made soon."
                    : "Amount may increase if payment isn't made in time."}
                </span>
              </div>
              <span
                className="text-[18px] font-semibold tabular-nums"
                style={{ color: remaining <= 60 ? "var(--color-destructive)" : "var(--color-foreground)" }}
              >
                {fmtClock(remaining)}
              </span>
            </div>

            <p className="mt-4 text-[12px] text-muted-foreground">
              Send the exact amount above from any Nigerian bank app. This page
              updates automatically once payment is received.
            </p>
          </>
        ) : null}

        <div className="mt-auto space-y-3 pb-8">
          {account && (
            <button
              type="button"
              disabled={paymentTriggered || payCheckState === "checking"}
              onClick={onCheckPayment}
              className="h-14 w-full rounded-full bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-70 active:opacity-90"
            >
              {paymentTriggered || payCheckState === "checking" ? "Confirming payment…" : "I have made payment"}
            </button>
          )}
          {payCheckState === "not_found" && !paymentTriggered && (
            <p className="text-center text-[12px] text-muted-foreground">
              Payment is not confirmed yet. Tap again after your bank marks the transfer successful.
            </p>
          )}
          {payCheckState === "error" && payCheckError && !paymentTriggered && (
            <p className="text-center text-[12px] text-destructive">{payCheckError}</p>
          )}
          <div className="flex items-center justify-center gap-2 text-[12.5px] text-muted-foreground">
            {paymentTriggered ? (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />
                Verifying payment…
              </>
            ) : payState === "waiting" ? (
              <>
                <span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />
                Waiting for transfer…
              </>
            ) : null}
          </div>
        </div>
      </div>

    </motion.section>
  );
}
