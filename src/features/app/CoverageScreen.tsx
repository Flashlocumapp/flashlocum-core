import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getRole, subscribeRoleChange, type Role } from "@/lib/role";
import { ShiftSettlement } from "@/features/request/ShiftSettlement";
import { fmtNairaK, fmtElapsed, fmtHistoryMeta, fmtOpMeta } from "@/lib/format";
import { CancelFlow } from "@/components/CancelFlow";
import { HistoryDetailSheet, type HistoryDetail } from "@/components/HistoryDetailSheet";
import { EditShiftSheet, type EditableShift } from "@/components/EditShiftSheet";
import { DismissSheet } from "@/components/DismissSheet";
import { ConfirmDialog } from "@/components/ConfirmDialog";


import { RatingPill } from "@/components/RatingPill";
import { ReliabilityPill } from "@/components/ReliabilityPill";
import {
  cancelUpcoming,
  doctorEntityId,
  hospitalEntityId,
  nairaK,
  recordHistoryRating,
  useDispatch,
  type Coverage as CoverItem,
  type HistoryItem,
} from "@/features/cover/dispatch";
import { recordRating } from "@/lib/ratings";
import { submitShiftRating } from "@/lib/trust";
import { computeCoveragePricing, coverageKindFromLabel } from "@/lib/pricing";
import { getDoctorIdentity, useDoctorIdentity } from "@/lib/doctor-identity";


import {
  cancelRequest as netCancelRequest,
  pauseShift as netPauseShift,
  getSessionId,
  startRequest as netStartRequest,
  updateRequest as netUpdateRequest,
  useLifecyclePending,
  useNetwork,
  
  type NetRequest,
} from "@/lib/network";


import { pushToast } from "@/lib/notifications";
import { shiftCue } from "@/lib/feedback";
import { useSimClock } from "@/lib/clock";
import { subscribeRealtimeHealth, isAnyReconnecting } from "@/lib/realtime-health";
import { isRated, markRated, useRatedShiftsVersion } from "@/lib/rated-shifts";




// ----- Requester-side dispatch entries (derived from shared network) -----
type Coverage = "Standard" | "24-Hour" | "Weekend Call" | "Home Care";
type ReqStatus = "upcoming" | "active" | "payment_pending" | "completed";
type RequestItem = {
  id: string;
  doctorSid: string | undefined;
  doctorRatingId: string | null;
  coverage: Coverage;
  day: string;
  start: string;
  end: string;
  durationHrs: number;
  schedule: string;
  completedOn?: string;
  amount: number;
  status: ReqStatus;
  phone: string;
  note?: string;
  outcome?: "completed" | "cancelled";
  cancelledBy?: "requester" | "doctor";
  startedAt?: number;
  accumulatedMs: number;
  days: number;
  dayIndex: number;
  environment?: "normal" | "busy";
  /** Monotonic flag — true once the shift has ever entered Active. */
  everStarted: boolean;
  /** Server-owned ISO deadline for the 15-minute settlement window.
   *  Only meaningful when status === "payment_pending". */
  paymentDueAt?: string;
};



/** Parse "8:00AM" / "10:30PM" → "HH:MM" 24h. */
function ampmTo24h(s: string): string {
  if (!s) return "08:00";
  const m = s.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return "08:00";
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${min}`;
}

/** Format "HH:MM" 24h → "8:00AM". */
function amPmFromHHMM(s: string): string {
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h)) return s;
  const period = h >= 12 ? "PM" : "AM";
  const hr = ((h + 11) % 12) + 1;
  return `${String(hr).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

function toRequestItem(r: NetRequest): RequestItem {
  // `awaiting_payment` is its own first-class client status now. It is NOT
  // mapped back to "active" — the row is past End Shift, the bill is locked
  // server-side, and the only valid action is "Continue payment". The card
  // still lives under the Active tab (so the user finds it where they left
  // it) but the CTA / visuals are different. See PAYMENT_SESSION_STABILITY
  // audit: client must never flip a row out of awaiting_payment — only the
  // Monnify webhook (→ "completed") does.
  const status: ReqStatus =
    r.status === "active"
      ? "active"
      : r.status === "accepted"
        ? "upcoming"
        : r.status === "paused"
          ? "upcoming"
          : r.status === "awaiting_payment"
            ? "payment_pending"
            : "completed";
  const outcome =
    r.status === "completed"
      ? "completed"
      : r.status === "cancelled"
        ? "cancelled"
        : undefined;
  // History reflects FINAL settled operational reality, not booking estimate.
  const isCompleted = outcome === "completed";
  const isAwaitingPayment = r.status === "awaiting_payment";
  const settledHrs = isCompleted
    ? Math.max(0.25, Math.round((r.accumulatedMs ?? 0) / 900_000) / 4)
    : r.durationHrs;
  const settledDays = isCompleted ? Math.max(1, r.dayIndex ?? r.days ?? 1) : Math.max(1, r.days ?? 1);
  // Prefer server-frozen totals (settled_amount → total_billed_amount) over
  // the original booked estimate for any row past End Shift. This keeps the
  // coverage card in lockstep with what Monnify is actually charging.
  const settledAmount =
    (isCompleted || isAwaitingPayment)
      ? (r.settledAmount ?? r.totalBilledAmount ?? r.amount)
      : r.amount;
  return {
    id: r.id,
    doctorSid: r.acceptedBy,
    doctorRatingId: r.acceptedBy ? doctorEntityId(r.acceptedBy) : null,
    coverage: r.coverage as Coverage,
    day: r.day,
    start: r.start,
    end: r.end,
    durationHrs: settledHrs,
    schedule: `${r.day} · ${r.start}`,
    completedOn: outcome
      ? new Date(r.updatedAt).toLocaleDateString("en-NG", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        })
      : undefined,
    amount: settledAmount,
    status,
    phone: r.phone,
    note: r.note,
    outcome,
    cancelledBy: r.cancelledBy,
    startedAt: r.startedAt,
    accumulatedMs: r.accumulatedMs ?? 0,
    days: settledDays,
    dayIndex: Math.max(1, r.dayIndex ?? 1),
    environment: r.environment ?? "normal",
    everStarted: !!r.everStarted || (r.accumulatedMs ?? 0) > 0 || (r.dayIndex ?? 1) > 1,
    paymentDueAt: r.paymentDueAt,
  };
}





const TABS = [
  { id: "active", label: "Active" },
  { id: "upcoming", label: "Upcoming" },
  { id: "completed", label: "History" },
] as const;
type TabId = typeof TABS[number]["id"];


export function CoverageScreen() {
  const [tab, setTab] = useState<TabId>("active");
  const [role, setLocalRole] = useState<Role | null>(() => getRole());
  useEffect(() => subscribeRoleChange(() => setLocalRole(getRole())), []);
  if (!role) return null;

  return (
    <>
      <ReconnectingPill />
      {role === "cover" ? (
        <DoctorCoverage tab={tab} setTab={setTab} />
      ) : (
        <RequesterCoverage tab={tab} setTab={setTab} />
      )}
    </>
  );
}

function ReconnectingPill() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Debounce: only show the pill if a channel has been unhealthy for
    // >= 800ms. Supabase realtime briefly reports "reconnecting" during
    // the cold-start handshake; the debounce eliminates that sub-second
    // flash without hiding real connectivity issues.
    let pendingTimer: number | null = null;
    const unsub = subscribeRealtimeHealth((h) => {
      const bad = isAnyReconnecting(h);
      if (bad) {
        if (pendingTimer == null) {
          pendingTimer = window.setTimeout(() => {
            setShow(true);
            pendingTimer = null;
          }, 800);
        }
      } else {
        if (pendingTimer != null) {
          window.clearTimeout(pendingTimer);
          pendingTimer = null;
        }
        setShow(false);
      }
    });
    return () => {
      if (pendingTimer != null) window.clearTimeout(pendingTimer);
      unsub();
    };
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="pointer-events-none fixed inset-x-0 top-2 z-50 mx-auto flex max-w-md justify-center px-5"
        >
          <span
            className="flex items-center gap-2 rounded-full px-3 py-1 text-[11.5px] font-medium shadow-[0_4px_18px_rgba(0,0,0,0.10)]"
            style={{
              background: "var(--color-surface-elevated)",
              color: "var(--color-foreground)",
            }}
          >
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full"
              style={{ background: "var(--color-warning, #f5a524)" }}
            />
            Reconnecting…
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}


// ============ REQUESTER ============

function RequesterCoverage({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const net = useNetwork();
  const sid = getSessionId();

  // Derive my requests from the shared operational network.
  const items = useMemo<RequestItem[]>(() => {
    return Object.values(net.requests)
      .filter(
        (r) =>
          r.requesterSessionId === sid &&
          (r.status === "accepted" ||
            r.status === "active" ||
            r.status === "paused" ||
            r.status === "awaiting_payment" ||
            r.status === "completed" ||
            r.status === "cancelled"),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toRequestItem);
  }, [net, sid]);

  // Cross-flow acceptance / cancellation toasts are emitted by the canonical
  // feedback engine (offer.accepted / shift.cancelled). No local listener
  // here — see src/lib/feedback.ts.




  const [ratings, setRatings] = useState<Record<string, number>>({});
  // Subscribe to the shared "shifts I've already rated" store so a rating
  // submitted via the post-End-Shift overlay (or in a previous session)
  // also collapses the form here.
  useRatedShiftsVersion();
  // Settlement sheet lifecycle: snapshot the shift props the moment the
  // sheet opens, then keep them stable for the entire payment flow. Driving
  // the sheet from `items.find(settlingId)` would unmount it on every
  // realtime row mutation (status flip, billing lock, webhook broadcast),
  // which in turn re-fired `beginSettlementCheckout` and minted a new
  // `payment_reference` — orphaning any webhook Monnify sent for the
  // previous reference. Holding a captured snapshot decouples the sheet's
  // identity from realtime churn on the row.
  type SettlingSnapshot = {
    id: string;
    facility: string;
    doctorSid: string | null;
    coverage: string;
    startedAt?: number;
    accumulatedMs?: number;
    startHHMM: string;
    endHHMM?: string;
    days?: number;
    environment: "normal" | "busy";
  };
  const [settlingSnapshot, setSettlingSnapshot] = useState<SettlingSnapshot | null>(null);
  const settlingId = settlingSnapshot?.id ?? null;
  const [pauseConfirmId, setPauseConfirmId] = useState<string | null>(null);
  const [endConfirmId, setEndConfirmId] = useState<string | null>(null);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editInitial, setEditInitial] = useState<EditableShift>({
    startTime: "08:00", endTime: "18:00", durationHrs: 10, note: "",
  });
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // payment_pending rows live under the Active tab — user finds them where
  // they pressed End Shift — but render with the Continue payment CTA.
  const filtered = useMemo(
    () =>
      items.filter((i) =>
        tab === "active"
          ? i.status === "active" || i.status === "payment_pending"
          : i.status === tab,
      ),
    [items, tab],
  );

  // ---- Settlement sheet auto-restore ----
  // PAYMENT_SESSION_STABILITY: any request whose SERVER status is
  // awaiting_payment must re-open the settlement sheet on mount / refresh /
  // reconnect / app reopen. The sheet is React state only, so without this
  // effect a refresh would leave the user staring at the card with no way
  // back to the payment screen except re-tapping a button.
  //
  // A per-request "user dismissed" ref keeps the sheet from immediately
  // re-popping on the same render when the user explicitly closes it. The
  // user reopens via the Continue payment CTA on the card (which clears
  // the flag).
  const dismissedPendingRef = useRef<Set<string>>(new Set());
  const pendingItem = useMemo(
    () => items.find((i) => i.status === "payment_pending") ?? null,
    [items],
  );

  const historyItem = items.find((i) => i.id === historyId) ?? null;
  const historyRow = historyItem ? net.requests[historyItem.id] : null;
  const historyDetail: HistoryDetail | null = historyItem
    ? {
        id: historyItem.id,
        doctorSid: historyItem.doctorSid ?? null,
        coverage: historyItem.coverage,
        completedOn: historyItem.completedOn,
        amount: historyItem.amount,
        rating: ratings[historyItem.id],
        environment: historyItem.environment,
        startedAtMs: historyRow?.firstStartedAt ?? historyRow?.startedAt ?? null,
        endedAtMs:
          historyRow?.paidAt ??
          (historyRow?.paymentDueAt
            ? Date.parse(historyRow.paymentDueAt) - 15 * 60 * 1000
            : null),
        actualMinutes:
          typeof historyRow?.accumulatedMs === "number"
            ? Math.round(historyRow.accumulatedMs / 60000)
            : null,
        billedMinutes:
          typeof historyRow?.accumulatedMs === "number"
            ? Math.round(historyRow.accumulatedMs / 60000)
            : null,
      }
    : null;

  const moveToActive = async (id: string) => {
    const cur = net.requests[id];
    const isResume = (cur?.accumulatedMs ?? 0) > 0;
    const res = await netStartRequest(id);
    if (!res.ok) return; // pushToast already surfaced the error
    shiftCue(isResume ? "resume" : "start");
    setTab("active");
  };

  // Pause Shift → pause_shift RPC ONLY closes the open segment and flips
  // status to 'paused'. No billing, no Monnify. Multi-day shifts have a
  // single final payment at End Shift. Local state mirrors the server.
  const requestPause = (id: string) => setPauseConfirmId(id);
  const beginPause = async (id: string) => {
    const res = await netPauseShift(id);
    if (!res.ok) return;
    shiftCue("pause");
    setTab("upcoming");
    setNotice("Shift paused");
    window.setTimeout(() => setNotice(null), 2600);
  };

  /**
   * End Shift — the single billing event for the entire assignment. Server
   * sums every segment, sets payment_due_at, and the settlement sheet runs
   * the one Monnify checkout. Webhook confirmation is the only source of
   * truth for payment success.
   */
  // For an ACTIVE row: prompt confirmation, then open the sheet (which
  // runs end_shift). For a PAYMENT_PENDING row: skip the prompt and the
  // end_shift RPC — the server has already locked the bill; just reopen
  // the sheet so the existing Monnify session resumes via RESUME-IF-PENDING.
  const requestEnd = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (item?.status === "payment_pending") {
      dismissedPendingRef.current.delete(id);
      openSettlementFor(id);
      return;
    }
    setEndConfirmId(id);
  };
  const openSettlementFor = (id: string) => {
    const item = items.find((i) => i.id === id);
    const r = net.requests[id];
    if (!item) return;
    setSettlingSnapshot({
      id,
      facility: "Lagoon Health",
      doctorSid: item.doctorSid ?? null,
      coverage: item.coverage,
      startedAt: item.startedAt,
      accumulatedMs: item.accumulatedMs,
      startHHMM: ampmTo24h(item.start),
      endHHMM: ampmTo24h(item.end),
      days: item.days,
      environment: (r?.environment ?? "normal") as "normal" | "busy",
    });
  };
  const beginEndShift = (id: string) => openSettlementFor(id);

  // Auto-restore: when the server says we have a payment_pending row, the
  // sheet must be visible — unless the user has actively dismissed it this
  // session. Survives refresh, reconnect, and app reopen because it keys
  // off server state, not React state.
  useEffect(() => {
    if (!pendingItem) return;
    if (settlingSnapshot) return;
    if (dismissedPendingRef.current.has(pendingItem.id)) return;
    // PAYMENT_SESSION_STABILITY: wait until the server-owned deadline is
    // present before mounting the sheet. Without this guard the sheet
    // opens with a null paymentDueAt and the countdown briefly anchors to
    // simNow() — visible to the user as a reset to 15:00 on refresh.
    if (!pendingItem.paymentDueAt) return;
    openSettlementFor(pendingItem.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItem?.id, pendingItem?.paymentDueAt, settlingSnapshot]);

  const confirmEnd = async () => {
    if (!settlingId) return;
    // Settlement sheet (ShiftSettlement.handleEndShift) is the single owner
    // of the end_shift RPC. Do not call it here, or the second invocation
    // throws "Shift is not in progress" against the already-flipped row.
    shiftCue("end");
  };







  const openEdit = (id: string) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    setEditInitial({
      startTime: ampmTo24h(item.start),
      endTime: ampmTo24h(item.end),
      durationHrs: item.durationHrs,
      note: item.note ?? "",
    });
    setEditTargetId(id);
  };

  const handleEditSave = (next: EditableShift, changed: keyof EditableShift | "multiple") => {
    const id = editTargetId;
    setEditTargetId(null);
    if (id) {
      const cur = net.requests[id];
      const fallbackItem = items.find((i) => i.id === id);
      // Coverage Length (days) is NEVER lost during edits. Per-day duration
      // comes from the sheet (derived from start/end); total = perDay × days.
      const days = Math.max(1, cur?.days ?? fallbackItem?.days ?? 1);
      const perDay = Math.max(1, next.durationHrs);
      const totalDur = perDay * days;
      const baseDate = cur?.startTs ? new Date(cur.startTs) : new Date();
      const [nh, nm] = next.startTime.split(":").map(Number);
      const newStart = new Date(baseDate);
      newStart.setHours(nh, nm, 0, 0);
      const newStartTs = newStart.getTime();
      const newEndTs = newStartTs + totalDur * 3_600_000;
      const kind = coverageKindFromLabel(cur?.coverage ?? fallbackItem?.coverage ?? "Standard");
      const env = (cur?.environment ?? "normal") as "normal" | "busy";
      // Re-price across ALL booked days so multi-day totals stay correct.
      const repriced = computeCoveragePricing(kind, next.startTime, next.endTime, days, env);
      const newAmount = repriced.amount;

      netUpdateRequest(id, {
        note: next.note?.trim() || undefined,
        start: amPmFromHHMM(next.startTime),
        end: amPmFromHHMM(next.endTime),
        durationHrs: totalDur,
        amount: newAmount,
        startTs: newStartTs,
        endTs: newEndTs,
        days,
      });
    }
    const label: Record<keyof EditableShift | "multiple", string> = {
      startTime: "Coverage start time updated",
      endTime: "Coverage end time updated",
      durationHrs: "Coverage length updated",
      note: "Coverage notes updated",
      multiple: "Coverage details updated",
    };
    setNotice(`${label[changed]} · Doctor notified`);
    window.setTimeout(() => setNotice(null), 2600);
  };



  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <CoverageHeader subtitle="Your coverage continuity" tab={tab} setTab={setTab} />

      <div
        className="mx-auto mt-3 max-w-md overflow-y-auto px-5 pb-6"
        style={{ height: "calc(100% - 140px)" }}
      >
        {filtered.length === 0 ? (
          <EmptyState tab={tab} role="request" />
        ) : (
          <ul className="space-y-2.5">
            <AnimatePresence initial={false} mode="popLayout">
              {filtered.map((item) => (
                <motion.li
                  key={item.id}
                  layout
                  initial={false}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <RequestCard
                    item={item}
                    onStart={() => moveToActive(item.id)}
                    onPause={() => requestPause(item.id)}
                    onEnd={() => requestEnd(item.id)}

                    onCancel={() => setCancelTargetId(item.id)}
                    onEdit={() => openEdit(item.id)}
                    onOpenHistory={() => setHistoryId(item.id)}
                    onOpenDetail={() => setDetailId(item.id)}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 bottom-24 z-30 mx-auto flex max-w-md justify-center px-5"
          >
            <span
              className="flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px] font-medium shadow-[0_4px_18px_rgba(0,0,0,0.10)]"
              style={{
                background: "var(--color-surface-elevated)",
                color: "var(--color-foreground)",
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--color-presence)" }}
              />
              {notice}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <ShiftSettlement
        open={!!settlingSnapshot}
        onClose={() => {
          // Mark as "user-dismissed" so the auto-restore effect does not
          // immediately reopen the sheet on the same render. The dismissed
          // flag is cleared when the user taps the "Continue payment" CTA
          // on the card, or on next session.
          if (settlingSnapshot) dismissedPendingRef.current.add(settlingSnapshot.id);
          setSettlingSnapshot(null);
        }}
        initialPhase="settlement"
        intent="end"
        onConfirmed={confirmEnd}
        onRebook={() => setSettlingSnapshot(null)}
        requestId={settlingSnapshot?.id}
        // When the row is already past End Shift, hand the server-owned
        // deadline + frozen total down so the sheet derives countdown from
        // payment_due_at (not a fresh local 15:00) and skips the end_shift
        // RPC. This is what makes refresh / kill-tab / reconnect resume the
        // exact same payment session.
        serverPaymentDueAt={
          settlingSnapshot
            ? net.requests[settlingSnapshot.id]?.paymentDueAt ?? null
            : null
        }
        serverTotalBilledAmount={
          settlingSnapshot
            ? net.requests[settlingSnapshot.id]?.totalBilledAmount ?? null
            : null
        }
        alreadyAwaitingPayment={
          settlingSnapshot
            ? net.requests[settlingSnapshot.id]?.status === "awaiting_payment"
            : false
        }
        shift={
          settlingSnapshot
            ? {
                facility: settlingSnapshot.facility,
                doctor: getDoctorIdentity(settlingSnapshot.doctorSid).fullName,
                role: `${settlingSnapshot.coverage} · Active`,
                startedAt: settlingSnapshot.startedAt,
                accumulatedMs: settlingSnapshot.accumulatedMs,
                startHHMM: settlingSnapshot.startHHMM,
                endHHMM: settlingSnapshot.endHHMM,
                days: settlingSnapshot.days,
                coverageKind: coverageKindFromLabel(settlingSnapshot.coverage),
                environment: settlingSnapshot.environment,
              }
            : undefined
        }
      />


      <ConfirmDialog
        open={!!pauseConfirmId}
        title="Pause this shift?"
        body={
          "Pausing stops time accumulation and moves this shift to Upcoming Coverage. You can resume any time. No payment is taken — billing only happens when you End Shift."
        }
        confirmLabel="Pause Shift"
        cancelLabel="Keep Working"
        onOpenChange={(next) => { if (!next) setPauseConfirmId(null); }}
        onConfirm={() => {
          const id = pauseConfirmId;
          setPauseConfirmId(null);
          if (id) beginPause(id);
        }}
      />

      <ConfirmDialog
        open={!!endConfirmId}
        title="End this shift?"
        body={
          "Ending this shift means you are closing the entire assignment and proceeding to final payment for completed work."
        }
        confirmLabel="End & Pay"
        cancelLabel="Keep Working"
        destructive
        onOpenChange={(next) => { if (!next) setEndConfirmId(null); }}
        onConfirm={() => {
          const id = endConfirmId;
          setEndConfirmId(null);
          if (id) beginEndShift(id);
        }}
      />


      <CancelFlow
        open={!!cancelTargetId}
        onDismiss={() => setCancelTargetId(null)}
        confirmTitle="Cancel this shift?"
        confirmBody="The assigned doctor will be notified. Keeping it preserves continuity."
        primaryLabel="Keep Shift"
        secondaryLabel="Cancel Shift"
        onCancelled={() => {
          const id = cancelTargetId;
          setCancelTargetId(null);
          if (id) netCancelRequest(id);
        }}
      />

      <EditShiftSheet
        open={!!editTargetId}
        initial={editInitial}
        onDismiss={() => setEditTargetId(null)}
        onSave={handleEditSave}
      />

      <HistoryDetailSheet
        open={!!historyDetail}
        item={historyDetail}
        alreadyRated={historyItem ? isRated(historyItem.id) : false}
        onDismiss={() => setHistoryId(null)}
        onRate={async (id, rating, feedback) => {
          // Persist to the backend so trust + admin dashboard reflect it.
          // The sheet itself optimistically collapses the form on submit;
          // we still surface an error toast if the RPC truly fails.
          const res = await submitShiftRating(id, rating, feedback || null);
          if (!res.ok && res.error !== "already_rated") {
            pushToast({ tone: "warn", title: res.message || "Couldn't save rating." });
            return;
          }
          setRatings((prev) => ({ ...prev, [id]: rating }));
          markRated(id);
          setHistoryId(null);
        }}
      />


      <RequesterDetailSheet
        item={items.find((i) => i.id === detailId && i.status !== "completed") ?? null}
        onDismiss={() => setDetailId(null)}
        onStart={(id) => { setDetailId(null); moveToActive(id); }}
        onPause={(id) => { setDetailId(null); requestPause(id); }}
        onEnd={(id) => { setDetailId(null); requestEnd(id); }}

        onEdit={(id) => { setDetailId(null); openEdit(id); }}
        onCancel={(id) => { setDetailId(null); setCancelTargetId(id); }}
      />
    </section>
  );
}

function RequesterDetailSheet({
  item,
  onDismiss,
  onStart,
  onPause,
  onEnd,
  onEdit,
  onCancel,
}: {
  item: RequestItem | null;
  onDismiss: () => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onEnd: (id: string) => void;
  onEdit: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const identity = useDoctorIdentity(item?.doctorSid ?? null);
  const pending = useLifecyclePending(item?.id ?? null);
  const startLabel = pending === "starting" ? "Starting…" : pending === "resuming" ? "Resuming…" : null;
  const pauseLabel = pending === "pausing" ? "Pausing…" : null;
  const endLabel = pending === "ending" ? "Ending…" : null;
  return (
    <AnimatePresence>
      {item && (
        <DismissSheet open onDismiss={onDismiss}>
          <div className="flex items-center gap-3">
            <span
              className="relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-[15px] font-semibold"
              style={{ background: "var(--color-secondary)" }}
            >
              {identity.selfieUrl ? (
                <img src={identity.selfieUrl} alt="" decoding="async" loading="eager" draggable={false} className="h-full w-full object-cover" />
              ) : (
                identity.initials
              )}
              {item.status === "active" && (
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full"
                  style={{
                    background: "var(--color-presence)",
                    boxShadow: "0 0 0 2px var(--color-surface-elevated)",
                  }}
                />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[16px] font-medium">{identity.fullName}</div>
              <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <span>{identity.mdcn}</span>
                <span>·</span>
                <RatingPill entityId={item.doctorRatingId} role="doctor" inline />
                <span>·</span>
                <ReliabilityPill entityId={item.doctorRatingId} inline />
              </div>
            </div>
          </div>


          <div className="mt-4 rounded-2xl bg-secondary/60 px-4 py-3 text-[13px] leading-relaxed text-foreground/85">
            {fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount)}
            {item.days > 1 && (
              <span className="ml-2 inline-flex h-4 items-center rounded-full bg-secondary/80 px-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-foreground/75">
                Day {Math.min(item.dayIndex, item.days)} of {item.days}
              </span>
            )}
          </div>

          {item.note && (
            <div className="mt-2 rounded-2xl bg-secondary/40 px-4 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Note</div>
              <div className="mt-1 text-[12.5px] text-foreground/80">{item.note}</div>
            </div>
          )}

          {item.status === "active" && (
            <div className="mt-3 flex justify-center">
              <LiveTimer from={item.startedAt} baseMs={item.accumulatedMs} live />
            </div>
          )}
          {item.status === "upcoming" && item.accumulatedMs > 0 && (
            <div className="mt-3 flex justify-center">
              <LiveTimer baseMs={item.accumulatedMs} />
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-2">
            <a
              href={`tel:${item.phone}`}
              className="flex h-11 items-center justify-center rounded-full bg-secondary/70 text-[13px] font-medium text-foreground/85 active:opacity-90"
            >
              Call
            </a>
            {item.status === "upcoming" && (
              <button
                onClick={() => { if (!pending) onStart(item.id); }}
                disabled={!!pending}
                className="h-11 rounded-full bg-primary text-[13px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
              >
                {startLabel ?? (item.everStarted ? "Resume Shift" : "Start Shift")}
              </button>
            )}
            {item.status === "active" && item.days > 1 && item.dayIndex < item.days && (
              <button
                onClick={() => { if (!pending) onPause(item.id); }}
                disabled={!!pending}
                className="h-11 rounded-full bg-secondary/70 text-[13px] font-semibold text-foreground/85 active:opacity-90 disabled:opacity-60"
              >
                {pauseLabel ?? "Pause Shift"}
              </button>
            )}
          </div>

          {(item.status === "active" ||
            (item.status === "upcoming" && item.everStarted)) && (
            <div className="mt-2">
              <button
                onClick={() => { if (!pending) onEnd(item.id); }}
                disabled={!!pending}
                className="h-11 w-full rounded-full bg-primary text-[13px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
              >
                {endLabel ?? "End Shift"}
              </button>
            </div>
          )}

          {item.status === "upcoming" && !item.everStarted && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                onClick={() => onEdit(item.id)}
                className="h-11 rounded-full bg-secondary/60 text-[13px] font-medium text-foreground/80 active:opacity-90"
              >
                Edit Shift
              </button>
              <button
                onClick={() => onCancel(item.id)}
                className="h-11 rounded-full bg-secondary/40 text-[13px] font-medium text-foreground/75 active:opacity-90"
              >
                Cancel Shift
              </button>
            </div>
          )}
        </DismissSheet>
      )}
    </AnimatePresence>
  );
}


function RequestCard({
  item,
  onStart,
  onPause,
  onEnd,
  onCancel,
  onEdit,
  onOpenHistory,
  onOpenDetail,
}: {
  item: RequestItem;
  onStart: () => void;
  onPause: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onOpenHistory: () => void;
  onOpenDetail: () => void;
}) {
  const isActive = item.status === "active";
  const isPaymentPending = item.status === "payment_pending";
  const isUpcoming = item.status === "upcoming";
  const isHistory = item.status === "completed";
  const identity = useDoctorIdentity(item.doctorSid ?? null);
  const pending = useLifecyclePending(item.id);
  const startLabel = pending === "starting" ? "Starting…" : pending === "resuming" ? "Resuming…" : null;
  const pauseLabel = pending === "pausing" ? "Pausing…" : null;
  const endLabel = pending === "ending" ? "Ending…" : null;

  const baseMeta = fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount);
  const meta = isHistory
    ? fmtHistoryMeta(item.coverage, item.completedOn ?? "", item.start, item.durationHrs, item.amount)
    : baseMeta;

  // payment_pending: tapping anywhere on the card resumes the payment
  // session — never the active-shift detail sheet.
  const onCardClick = isHistory
    ? onOpenHistory
    : isPaymentPending
      ? onEnd
      : onOpenDetail;
  const wrapperProps = {
    onClick: onCardClick,
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") onCardClick?.();
    },
  };

  return (
    <div
      {...wrapperProps}
      className="block w-full rounded-2xl px-3.5 py-3 text-left transition-colors active:bg-secondary/40"
      style={{
        background: isHistory
          ? "color-mix(in oklab, var(--color-surface-elevated) 60%, transparent)"
          : "var(--color-surface-elevated)",
      }}
    >
      <div className="flex items-start gap-3">
        <Avatar initials={identity.initials} selfieUrl={identity.selfieUrl} dim={isHistory} live={isActive} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-[15px] font-medium"
              style={{
                color: isHistory
                  ? "color-mix(in oklab, var(--color-foreground) 78%, transparent)"
                  : "var(--color-foreground)",
              }}
            >
              {identity.shortName}
            </span>
            {isHistory && item.outcome === "cancelled" && (
              <span
                className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10.5px] font-medium uppercase tracking-[0.08em]"
                style={{
                  background: "color-mix(in oklab, var(--color-foreground) 7%, transparent)",
                  color: "color-mix(in oklab, var(--color-foreground) 60%, transparent)",
                }}
              >
                {item.cancelledBy === "requester" ? "You Cancelled" : "Cancelled"}
              </span>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
            <span className="truncate">{identity.mdcn}</span>
            <span className="shrink-0">·</span>
            <RatingPill entityId={item.doctorRatingId} role="doctor" inline />
            <span className="shrink-0">·</span>
            <ReliabilityPill entityId={item.doctorRatingId} inline />
          </div>

          {!isHistory && item.days > 1 && (
            <div className="mt-1">
              <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-secondary/70 px-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-foreground/75">
                Day {Math.min(item.dayIndex, item.days)} of {item.days}
              </span>
            </div>
          )}
          <div
            className="mt-0.5 truncate text-[12.5px]"
            style={{
              color: isHistory
                ? "color-mix(in oklab, var(--color-foreground) 55%, transparent)"
                : "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
            }}
          >
            {meta}
          </div>
          {isActive && (
            <div className="mt-0.5">
              <LiveTimer from={item.startedAt} baseMs={item.accumulatedMs} live />
            </div>
          )}
          {isUpcoming && (item.accumulatedMs > 0 || item.dayIndex > 1) && (
            <div className="mt-0.5">
              <LiveTimer baseMs={item.accumulatedMs} />
            </div>
          )}
        </div>
      </div>

      {(isUpcoming || isActive || isPaymentPending) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 pl-[56px]">
          {isPaymentPending && (
            <>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.06em]"
                style={{
                  background: "color-mix(in oklab, var(--color-warning, #b45309) 14%, transparent)",
                  color: "var(--color-warning, #b45309)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                Payment pending
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onEnd(); }}
                className="rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-transform active:scale-[0.97]"
                style={{
                  background: "var(--color-foreground)",
                  color: "var(--color-background)",
                }}
              >
                Continue payment
              </button>
            </>
          )}
          {isUpcoming && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!pending) onStart(); }}
              disabled={!!pending}
              className="rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-transform active:scale-[0.97] disabled:opacity-60"
              style={{
                background: "var(--color-foreground)",
                color: "var(--color-background)",
              }}
            >
              {startLabel ?? ((item.everStarted || item.dayIndex > 1) ? "Resume Shift" : "Start Shift")}
            </button>
          )}
          {isActive && item.days > 1 && item.dayIndex < item.days && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!pending) onPause(); }}
              disabled={!!pending}
              className="rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-transform active:scale-[0.97] disabled:opacity-60"
              style={{
                background: "color-mix(in oklab, var(--color-foreground) 8%, transparent)",
                color: "var(--color-foreground)",
              }}
            >
              {pauseLabel ?? "Pause Shift"}
            </button>
          )}
          {isActive && (
            <button
              onClick={(e) => { e.stopPropagation(); if (!pending) onEnd(); }}
              disabled={!!pending}
              className="rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-transform active:scale-[0.97] disabled:opacity-60"
              style={{
                background: "var(--color-foreground)",
                color: "var(--color-background)",
              }}
            >
              {endLabel ?? "End Shift"}
            </button>
          )}
          {isUpcoming && !item.everStarted && item.dayIndex <= 1 && (
            <>
              <SecondaryAction onClick={(e) => { e.stopPropagation(); onEdit(); }} label="Edit" />
              <SecondaryAction onClick={(e) => { e.stopPropagation(); onCancel(); }} label="Cancel" />
              <a
                href={`tel:${item.phone}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium transition-colors active:opacity-80"
                style={{
                  background: "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
                  color: "color-mix(in oklab, var(--color-foreground) 80%, transparent)",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 4h3l2 5-2.5 1.5a11 11 0 005 5L14 13l5 2v3a2 2 0 01-2 2A14 14 0 013 6a2 2 0 012-2z"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Call
              </a>
            </>
          )}
          {isUpcoming && (item.everStarted || item.dayIndex > 1) && !isActive && (
            <SecondaryAction onClick={(e) => { e.stopPropagation(); onEnd(); }} label="End Shift" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Continuous worked-time pill. `baseMs` is prior accumulated worked
 * milliseconds (carried across pause/resume). When `from` is set, the
 * current live segment ticks forward; otherwise only the accumulated total
 * is shown (used when paused / in Upcoming). `live` styles the dot for the
 * active state — calm grey otherwise.
 */
function LiveTimer({
  from,
  baseMs = 0,
  live = true,
}: {
  from?: number;
  baseMs?: number;
  live?: boolean;
}) {
  const now = useSimClock(1000);
  const segment = from ? Math.max(0, now - from) : 0;
  const total = baseMs + segment;
  const anchor = now - total;
  const tone = live ? "var(--color-presence)" : "color-mix(in oklab, var(--color-foreground) 55%, transparent)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={{
        background: live
          ? "color-mix(in oklab, var(--color-presence) 14%, transparent)"
          : "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
        color: tone,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
      {fmtElapsed(anchor, now)}
    </span>
  );
}


function SecondaryAction({ onClick, label }: { onClick: (e: React.MouseEvent) => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="h-7 rounded-full px-3 text-[12px] font-medium transition-colors active:opacity-80"
      style={{
        background: "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
        color: "color-mix(in oklab, var(--color-foreground) 80%, transparent)",
      }}
    >
      {label}
    </button>
  );
}




function Avatar({
  initials,
  dim,
  live,
  selfieUrl,
}: {
  initials: string;
  dim?: boolean;
  live?: boolean;
  selfieUrl?: string | null;
}) {
  return (
    <span className="relative shrink-0">
      <span
        className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-[13px] font-semibold"
        style={{
          background: "var(--color-secondary)",
          color: dim
            ? "color-mix(in oklab, var(--color-foreground) 55%, transparent)"
            : "var(--color-foreground)",
        }}
      >
        {selfieUrl ? (
          <img src={selfieUrl} alt="" decoding="async" loading="eager" draggable={false} className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </span>
      {live && (
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2"
          style={{
            background: "var(--color-presence)",
            // @ts-expect-error css var
            "--tw-ring-color": "var(--color-background)",
            boxShadow: "0 0 0 2px var(--color-background)",
          }}
        />
      )}
    </span>
  );
}

// ============ DOCTOR (unchanged behavior) ============

// ============ DOCTOR (Cover & Earn) ============

function DoctorCoverage({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const { upcoming, history } = useDispatch();
  const net = useNetwork();

  const active = upcoming.find((c) => c.active) ?? null;
  const upcomingOnly = upcoming.filter((c) => !c.active);

  const [cancelId, setCancelId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Detail can be either a live coverage (active/upcoming) or a history entry.
  const detail: CoverItem | HistoryItem | null =
    upcoming.find((c) => c.id === detailId) ??
    history.find((h) => h.id === detailId) ??
    null;

  return (
    <section className="relative h-full w-full overflow-hidden bg-background">
      <CoverageHeader subtitle="Your operational coverage" tab={tab} setTab={setTab} />
      <div
        className="mx-auto mt-3 max-w-md overflow-y-auto px-5 pb-6"
        style={{ height: "calc(100% - 140px)" }}
      >
        {(tab === "active" ? (active ? 1 : 0) : tab === "upcoming" ? upcomingOnly.length : history.length) === 0 ? (
          <EmptyState tab={tab} role="cover" />
        ) : (
          <ul className="space-y-2.5">
            {tab === "active" && active && (
              <li key={active.id}>
                <CoverCard
                  item={active}
                  variant="active"
                  onCancel={() => setCancelId(active.id)}
                  onOpenDetail={() => setDetailId(active.id)}
                />
              </li>
            )}
            {tab === "upcoming" &&
              upcomingOnly.map((c) => (
                <li key={c.id}>
                  <CoverCard
                    item={c}
                    variant="upcoming"
                    onCancel={() => setCancelId(c.id)}
                    onOpenDetail={() => setDetailId(c.id)}
                  />
                </li>
              ))}
            {tab === "completed" &&
              history.map((h) => (
                <li key={h.id}>
                  <CoverCard
                    item={h}
                    variant="history"
                    onOpenDetail={() => setDetailId(h.id)}
                  />
                </li>
              ))}
          </ul>
        )}
      </div>

      <CancelFlow
        open={!!cancelId}
        onDismiss={() => setCancelId(null)}
        confirmTitle="Cancel this shift?"
        confirmBody="Frequent cancellations affect your reliability score. The requester will be notified immediately."
        primaryLabel="Keep Shift"
        secondaryLabel="Cancel Shift"
        reasonTitle="Reason for cancellation"
        reasons={DOCTOR_REASONS}
        onCancelled={(result) => {
          const id = cancelId;
          setCancelId(null);
          if (id && result) cancelUpcoming(id, { code: result.code, text: result.text });
        }}
      />


      <DoctorCoverageDetail
        item={detail}
        netRows={net.requests}
        onDismiss={() => setDetailId(null)}
      />
    </section>
  );
}

function CoverCard({
  item,
  variant,
  onCancel,
  onOpenDetail,
}: {
  item: CoverItem | HistoryItem;
  variant: "active" | "upcoming" | "history";
  onCancel?: () => void;
  onOpenDetail?: () => void;
}) {
  const isHistory = variant === "history";
  const isActive = variant === "active";
  const isUpcoming = variant === "upcoming";

  const meta = `${fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount)}`;

  // All cards tappable — open detail. Inner buttons stopPropagation.
  const Wrapper: React.ElementType = "div";
  const wrapperProps = {
    onClick: onOpenDetail,
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") onOpenDetail?.();
    },
  };

  const outcomeChip =
    isHistory && (item as HistoryItem).outcome === "cancelled" ? (
      <span
        className="ml-2 inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{
          background: "color-mix(in oklab, var(--color-foreground) 7%, transparent)",
          color: "color-mix(in oklab, var(--color-foreground) 60%, transparent)",
        }}
      >
        {(item as HistoryItem).cancelledBy === "doctor" ? "You Cancelled" : "Cancelled"}
      </span>
    ) : null;

  return (
    <Wrapper
      {...wrapperProps}
      className="block w-full rounded-2xl px-4 py-3.5 text-left transition-colors active:bg-secondary/30"
      style={{
        background: isHistory
          ? "color-mix(in oklab, var(--color-surface-elevated) 65%, transparent)"
          : "var(--color-surface-elevated)",
        boxShadow: isHistory ? "none" : "0 4px 16px -10px rgba(0,0,0,0.12)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center">
            <span
              className="truncate text-[15.5px] font-semibold tracking-tight"
              style={{
                color: isHistory
                  ? "color-mix(in oklab, var(--color-foreground) 80%, transparent)"
                  : "var(--color-foreground)",
              }}
            >
              {item.hospital}
            </span>
            {outcomeChip}
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="truncate">{item.area}</span>
            <span>·</span>
            <RatingPill entityId={hospitalEntityId(item.hospital)} role="requester" inline />
            <span>·</span>
            <ReliabilityPill entityId={hospitalEntityId(item.hospital)} inline />
          </div>

        </div>
        {isActive && (
          <span
            className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em]"
            style={{ color: "var(--color-presence)" }}
          >
            <span
              className="relative h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--color-presence)" }}
            >
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background: "var(--color-presence)",
                  opacity: 0.5,
                  animation: "presence-pulse 1.6s ease-out infinite",
                }}
              />
            </span>
            Live
          </span>
        )}
      </div>

      {!isHistory && (item as CoverItem).days > 1 && (
        <div className="mt-1.5">
          <span className="inline-flex h-4 shrink-0 items-center rounded-full bg-secondary/70 px-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-foreground/75">
            Day {Math.min((item as CoverItem).dayIndex ?? 1, (item as CoverItem).days)} of {(item as CoverItem).days}
          </span>
        </div>
      )}
      <div
        className="mt-1.5 text-[12.5px] leading-snug"
        style={{
          color: isHistory
            ? "color-mix(in oklab, var(--color-foreground) 60%, transparent)"
            : "color-mix(in oklab, var(--color-foreground) 75%, transparent)",
        }}
      >
        {meta}
      </div>

      {item.note && (
        <div className="mt-1 text-[11.5px] leading-snug text-foreground/65">
          {item.note}
        </div>
      )}

      {isActive && (item as CoverItem & { startedAt?: number }).startedAt && (
        <div className="mt-2">
          <LiveTimer
            from={(item as CoverItem & { startedAt: number }).startedAt}
            baseMs={(item as CoverItem).accumulatedMs ?? 0}
            live
          />
        </div>
      )}
      {isUpcoming && ((item as CoverItem).accumulatedMs ?? 0) > 0 && (
        <div className="mt-2">
          <LiveTimer baseMs={(item as CoverItem).accumulatedMs ?? 0} live={false} />
        </div>
      )}


      {(isActive || isUpcoming) && (
        <div className="mt-3 flex items-center gap-2">
          {isUpcoming && ((item as CoverItem).accumulatedMs ?? 0) === 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel?.();
              }}
              className="h-8 rounded-full px-3.5 text-[12.5px] font-medium transition-colors active:opacity-80"
              style={{
                background: "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
                color: "color-mix(in oklab, var(--color-foreground) 80%, transparent)",
              }}
            >
              Cancel Shift
            </button>
          )}
          <a
            href={`tel:${item.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors active:opacity-80"
            style={{
              background: isActive ? "var(--color-foreground)" : "color-mix(in oklab, var(--color-foreground) 6%, transparent)",
              color: isActive ? "var(--color-background)" : "color-mix(in oklab, var(--color-foreground) 85%, transparent)",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 4h3l2 5-2.5 1.5a11 11 0 005 5L14 13l5 2v3a2 2 0 01-2 2A14 14 0 013 6a2 2 0 012-2z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Call
          </a>
        </div>
      )}
    </Wrapper>
  );
}

function DoctorCoverageDetail({
  item,
  netRows,
  onDismiss,
}: {
  item: CoverItem | HistoryItem | null;
  netRows: Record<string, NetRequest>;
  onDismiss: () => void;
}) {
  const isHist = (i: CoverItem | HistoryItem): i is HistoryItem =>
    "outcome" in i;

  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  // Reset rating draft whenever the open item changes
  useEffect(() => {
    setRating(0);
    setFeedback("");
  }, [item?.id]);

  const showRating =
    !!item &&
    isHist(item) &&
    item.outcome === "completed" &&
    item.rating === undefined;

  return (
    <AnimatePresence>
      {item && (
        <DismissSheet open onDismiss={onDismiss}>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {isHist(item)
              ? item.outcome === "cancelled"
                ? item.cancelledBy === "doctor"
                  ? "You cancelled"
                  : "Cancelled shift"
                : "Completed shift"
              : item.active
                ? "Active shift"
                : "Upcoming shift"}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="text-[20px] font-semibold tracking-tight">{item.hospital}</div>
            <div className="inline-flex items-center gap-2">
              <RatingPill entityId={hospitalEntityId(item.hospital)} role="requester" inline />
              <ReliabilityPill entityId={hospitalEntityId(item.hospital)} inline />
            </div>
          </div>
          <div className="text-[13px] text-muted-foreground">{item.area}</div>

          <div className="mt-4 text-[13px] leading-relaxed text-foreground/80">
            {fmtOpMeta(item.coverage, item.day, item.start, item.end, item.durationHrs, item.amount)}
          </div>

          <div className="mt-4 space-y-2 rounded-2xl bg-secondary/60 px-4 py-3">
            <DetailRow label="Amount" value={nairaK(item.amount)} />
            <DetailRow
              label="Settlement"
              value={isHist(item) ? item.settlementStatus : "Pending"}
            />
            {isHist(item) && (() => {
              const row = netRows[item.id];
              const startedMs = row?.firstStartedAt ?? row?.startedAt ?? null;
              const endedMs = row?.paidAt ?? row?.updatedAt ?? null;
              const mins = typeof row?.accumulatedMs === "number" ? Math.round(row.accumulatedMs / 60000) : 0;
              const fmt = (ms: number) => {
                const d = new Date(ms);
                return Number.isNaN(d.getTime()) ? null : d.toLocaleString("en-NG", {
                  weekday: "short", day: "2-digit", month: "short",
                  hour: "2-digit", minute: "2-digit", hour12: true,
                });
              };
              const hrMin = (m: number) => {
                const h = Math.floor(m / 60); const r = m % 60;
                if (h === 0) return `${r}min`;
                if (r === 0) return `${h}hr`;
                return `${h}hr ${r}min`;
              };
              const startedLabel = startedMs ? fmt(startedMs) : null;
              const endedLabel = endedMs ? fmt(endedMs) : null;
              return (
                <>
                  {startedLabel && <DetailRow label="Started" value={startedLabel} />}
                  {endedLabel && <DetailRow label="Ended" value={endedLabel} />}
                  {mins > 0 && <DetailRow label="Hours worked" value={hrMin(mins)} />}
                  {mins > 0 && <DetailRow label="Hours billed" value={hrMin(mins)} />}
                </>
              );
            })()}
            {isHist(item) && (
              <DetailRow label="Completed" value={item.completedOn} />
            )}
            {isHist(item) && item.rating !== undefined && (
              <DetailRow
                label="Rating"
                value={"★".repeat(item.rating) + "☆".repeat(5 - item.rating)}
              />
            )}
          </div>

          {item.note && (
            <div className="mt-3 rounded-2xl bg-secondary/40 px-4 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                Notes
              </div>
              <div className="mt-1 text-[12.5px] text-foreground/80">{item.note}</div>
            </div>
          )}

          {showRating && (
            <div className="mt-4 rounded-2xl bg-secondary/40 px-3.5 py-3">
              <div className="text-[13px] font-medium">
                How was the experience with {item.hospital}?
              </div>
              <div className="mt-1 text-[11.5px] text-muted-foreground">
                Share your feedback and help us improve.
              </div>
              <div className="mt-3 flex items-center justify-between px-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const active = n <= rating;
                  return (
                    <button
                      key={n}
                      onClick={() => setRating(n)}
                      className="p-1 transition-transform active:scale-90"
                      aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    >
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"
                          fill={active ? "var(--color-presence)" : "transparent"}
                          stroke={active ? "var(--color-presence)" : "color-mix(in oklab, var(--color-foreground) 35%, transparent)"}
                          strokeWidth="1.6"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  );
                })}
              </div>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={2}
                placeholder="Optional feedback"
                className="mt-3 w-full resize-none rounded-xl bg-background/60 px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground/55"
              />
              <button
                disabled={!rating}
                onClick={() => {
                  void recordRating(hospitalEntityId(item.hospital), rating, item.id, feedback);
                  recordHistoryRating(item.id, rating);
                  onDismiss();
                }}
                className="mt-3 h-10 w-full rounded-full bg-primary text-[13px] font-semibold text-primary-foreground disabled:opacity-40 active:opacity-90"
              >
                Submit rating
              </button>
            </div>
          )}
        </DismissSheet>
      )}
    </AnimatePresence>
  );
}
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[13.5px] font-medium tabular-nums">{value}</span>
    </div>
  );
}


// ============ Shared shell ============

function CoverageHeader({
  subtitle,
  tab,
  setTab,
}: {
  subtitle: string;
  tab: TabId;
  setTab: (t: TabId) => void;
}) {
  return (
    <header className="px-5 pt-4">
      <div className="mx-auto max-w-md">
        <h1 className="text-[26px] font-semibold tracking-tight">Coverage</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>

        <div
          className="mt-4 flex gap-1 rounded-full p-1"
          style={{ background: "var(--color-secondary)" }}
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex-1 rounded-full py-2 text-[13px] font-medium transition-colors"
                style={{
                  background: active ? "var(--color-surface-elevated)" : "transparent",
                  color: active
                    ? "var(--color-foreground)"
                    : "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
                  boxShadow: active ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}

function EmptyState({ tab, role }: { tab: TabId; role: Role }) {
  const copy = (
    role === "cover"
      ? {
          active: "No live coverage right now.",
          upcoming: "Nothing scheduled.",
          completed: "Your history will appear here.",
        }
      : {
          active: "No active coverage right now.",
          upcoming: "No upcoming coverage scheduled.",
          completed: "Your past coverage will appear here.",
        }
  )[tab];
  return (
    <div className="flex h-64 flex-col items-center justify-center text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: "var(--color-secondary)" }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </div>
      <p className="mt-3 text-[13.5px] text-muted-foreground">{copy}</p>
    </div>
  );
}
