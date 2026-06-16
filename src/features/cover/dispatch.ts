// Doctor-side dispatch store, backed by the shared FlashLocum network.
// Public API kept stable for CoverHome, CoverDispatchPortal, and coverage tab.

import { useEffect, useState } from "react";
import { hasLiveSnapshot, onLiveSnapshotChange } from "@/lib/coverage-remote";
import {
  acceptRequest,
  type AcceptBlockReason,
  broadcastingRequests,
  cancelRequest,
  completeRequest,
  getNetworkSnapshot,
  getSessionId,
  markDeclined,
  registerDoctor,
  setDoctorAcceptedCount,
  setDoctorOnline,
  startHeartbeat,
  type NetRequest,
  type NetState,
  subscribeNetwork,
  useNetwork,
} from "@/lib/network";
import { pushToast } from "@/lib/notifications";
import { shiftCue } from "@/lib/feedback";

export type Coverage = {
  id: string;
  hospital: string;
  area: string;
  coverage: string;
  day: string;
  start: string;
  end: string;
  durationHrs: number;
  amount: number;
  feePct: number;
  phone: string;
  note?: string;
  active?: boolean;
  startedAt?: number;
  accumulatedMs: number;
  days: number;
  dayIndex: number;
  settledAmount?: number;
  /** Captured at booking; surfaced in every doctor-facing view. */
  environment?: "normal" | "busy";
};


// Full monetary formatting everywhere (₦36,500). No K abbreviation.
export const nairaK = (n: number) => "₦" + n.toLocaleString("en-NG");

export function feeOf(c: Pick<Coverage, "amount" | "feePct">) {
  return Math.round((c.amount * c.feePct) / 100);
}
export function netOf(c: Pick<Coverage, "amount" | "feePct">) {
  return c.amount - feeOf(c);
}

function toCoverage(r: NetRequest): Coverage {
  return {
    id: r.id,
    hospital: r.hospital,
    area: r.area,
    coverage: r.coverage,
    day: r.day,
    start: r.start,
    end: r.end,
    durationHrs: r.durationHrs,
    amount: r.amount,
    feePct: r.feePct,
    phone: r.phone,
    note: r.note,
    active: r.status === "active",
    startedAt: r.startedAt,
    accumulatedMs: r.accumulatedMs ?? 0,
    days: Math.max(1, r.days ?? 1),
    dayIndex: Math.max(1, r.dayIndex ?? 1),
    settledAmount: r.settledAmount,
    environment: r.environment ?? "normal",
  };
}


function conflictMessage(reason: AcceptBlockReason): string {
  if (reason === "max") return "You already have the maximum number of confirmed shifts.";
  if (reason === "buffer") return "This request does not provide enough transition time before your next confirmed shift.";
  if (reason === "overlap") return "This request conflicts with an existing confirmed shift.";
  if (reason === "claimed") return "This request has already been accepted by another doctor.";
  return "This request is no longer available.";
}

/* ---------- History ---------- */

export type HistoryItem = Coverage & {
  outcome: "completed" | "cancelled";
  cancelledBy?: "requester" | "doctor";
  completedOn: string;
  updatedAt: number;
  rating?: number;
  settlementStatus: "Remitted" | "Pending" | "Voided";
  paymentStatus?: string;
  paymentReference?: string;
  paidAt?: number;
  remittedAt?: number;
};

let history: HistoryItem[] = [];
let historyRatings: Record<string, number> = {};
let acceptedSheet: Coverage | null = null;
// Hospital pending rating after End Shift (entityId derived from hospital name).
export type PendingRating = {
  requestId: string;
  hospitalId: string;
  hospital: string;
  coverage: string;
  total: number;
  feePct: number;
};



// Per-event timestamp map. We dedup by (actor, shift, action) with a short
// TTL so the postgres_changes path and the snapshot-diff fallback can't
// both fire the same logical transition, while legitimate later events
// for the same shift+action (e.g. a second pause after resume) still pass.
const processedEvents = new Map<string, number>();
const DEDUP_TTL_MS = 5000;

// We only store the requestId here. The hospital / coverage / total / feePct
// shown in the PaymentSummary are derived LIVE from the request row inside
// useDispatch(), so the card always reflects the exact transaction that
// just completed — including any settled_amount the Monnify webhook writes
// after the fact.
let pendingRatingRequestId: string | null = null;

const localListeners = new Set<() => void>();
function bump() {
  localListeners.forEach((l) => l());
}

export function hospitalEntityId(hospital: string): string {
  return "hosp:" + hospital.toLowerCase().replace(/\s+/g, "_");
}
export function doctorEntityId(sessionId: string): string {
  return "doc:" + sessionId;
}

/* ---------- Hook ---------- */

type View = {
  online: boolean;
  upcoming: Coverage[];
  incoming: Coverage | null;
  accepted: Coverage | null;
  history: HistoryItem[];
  pendingRating: PendingRating | null;
};



export function useDispatch(): View {
  const net = useNetwork();
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    localListeners.add(l);
    const offLive = onLiveSnapshotChange(l);
    return () => {
      localListeners.delete(l);
      offLive();
    };
  }, []);

  const sid = getSessionId();
  const me = net.doctors[sid];
  const online = !!me?.online;

  const upcoming: Coverage[] = Object.values(net.requests)
    .filter((r) => r.acceptedBy === sid && (r.status === "accepted" || r.status === "active"))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toCoverage);
  const liveRequests = broadcastingRequests(net);
  const derivedHistory: HistoryItem[] = Object.values(net.requests)
    .filter((r) => r.acceptedBy === sid && (r.status === "completed" || r.status === "cancelled"))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => {
      const base = toCoverage(r);
      const isCompleted = r.status === "completed";
      // History reflects FINAL settled operational reality.
      const settledHrs = isCompleted
        ? Math.max(0.25, Math.round((r.accumulatedMs ?? 0) / 900_000) / 4)
        : base.durationHrs;
      const settledDays = isCompleted ? Math.max(1, r.dayIndex ?? r.days ?? 1) : base.days;
      const settledAmount = isCompleted ? (r.settledAmount ?? r.amount) : r.amount;
      return {
        ...base,
        durationHrs: settledHrs,
        days: settledDays,
        amount: settledAmount,
        outcome: isCompleted ? "completed" : "cancelled",
        cancelledBy: r.cancelledBy,
        completedOn: new Date(r.updatedAt).toLocaleDateString("en-NG", {
          weekday: "short",
          day: "2-digit",
          month: "short",
        }),
        updatedAt: r.updatedAt,
        rating: historyRatings[r.id],
        settlementStatus: isCompleted
          ? (r.remittedAt ? "Remitted" : "Pending")
          : "Voided",
        paymentStatus: r.paymentStatus,
        paymentReference: r.paymentReference,
        paidAt: r.paidAt,
        remittedAt: r.remittedAt,
      } as HistoryItem;
    });


  let incoming: Coverage | null = null;
  if (online && upcoming.length < 3) {
    const declined = new Set<string>(me?.declined ?? []);
    const r = liveRequests.find(
      (x) =>
        x.status === "broadcasting" &&
        x.requesterSessionId !== sid &&
        !declined.has(x.id),
    );
    if (r) incoming = toCoverage(r);
  }

  useEffect(() => {
    if (!me || upcoming.length < 3 || liveRequests.length === 0) return;
    liveRequests.forEach((r) => markDeclined(r.id));
  }, [me, upcoming.length, liveRequests.map((r) => r.id).join("|")]);

  useEffect(() => {
    if (me && me.acceptedCount !== upcoming.length) {
      setDoctorAcceptedCount(upcoming.length);
    }
  }, [me, upcoming.length]);

  let pendingRating: PendingRating | null = null;
  if (pendingRatingRequestId) {
    const r = net.requests[pendingRatingRequestId];
    if (r && r.status === "completed" && r.acceptedBy === sid) {
      pendingRating = {
        requestId: r.id,
        hospitalId: hospitalEntityId(r.hospital),
        hospital: r.hospital,
        coverage: r.coverage,
        total: r.settledAmount ?? r.amount,
        feePct: r.feePct,
      };
    }
  }

  return {
    online,
    upcoming,
    incoming,
    accepted: acceptedSheet,
    history: derivedHistory,
    pendingRating,
  };
}

/* ---------- Lifecycle ---------- */

let bootstrapped = false;

export function ensureDoctorSession(initialOnline = true) {
  if (bootstrapped) return;
  if (typeof window === "undefined") return;
  bootstrapped = true;
  registerDoctor(initialOnline);
  startHeartbeat();

  // Watch network → react ONLY to events caused by the requester
  // on shifts assigned to THIS doctor session. No status diff inference.
  subscribeNetwork((s: NetState) => {
    const sid = getSessionId();
    const ev = s.lastEvent;
    if (!ev || !ev.shiftId) return;
    // Dedup by (actor, shift, action) WITHOUT the timestamp so the
    // postgres_changes path and the snapshot-diff fallback can't both
    // fire the same logical transition (toast + pendingRating).
    const eventKey = `${ev.actor}:${ev.actorId}:${ev.shiftId}:${ev.action}`;
    const _last = processedEvents.get(eventKey);
    if (_last && Date.now() - _last < DEDUP_TTL_MS) return;
    const r = s.requests[ev.shiftId];
    if (!r) return;

    // New request reached this doctor → calm notification cue.
    // Only fire when the doctor is online and has capacity to accept.
    if (ev.action === "publish" && ev.actor === "requester") {
      const me = s.doctors[sid];
      if (!me?.online) return;
      const mine = Object.values(s.requests).filter(
        (x) => x.acceptedBy === sid && (x.status === "accepted" || x.status === "active"),
      );
      if (mine.length >= 3) return;
      if ((me.declined ?? []).includes(r.id)) return;
      processedEvents.set(eventKey, Date.now());
      shiftCue("request");
      pushToast({
        tone: "presence",
        title: `New coverage request · ${r.hospital}`,
        body: `${r.coverage} · ${r.day} · ${r.start}`,
      });
      return;
    }

    if (r.acceptedBy !== sid) return;
    if (ev.actor !== "requester") return;
    processedEvents.set(eventKey, Date.now());

    if (ev.action === "start") {
      shiftCue("start");
      pushToast({
        tone: "presence",
        title: `Your shift with ${r.hospital} has started.`,
        body: "Tap the active card for shift details.",
      });
    } else if (ev.action === "resume") {
      shiftCue("resume");
      pushToast({
        tone: "presence",
        title: `Your shift with ${r.hospital} has resumed.`,
        body: "Coverage timer continues from where it paused.",
      });
    } else if (ev.action === "pause") {
      shiftCue("pause");
      pushToast({
        tone: "presence",
        title: `Your shift with ${r.hospital} has been paused.`,
        body: "Coverage timer is preserved and will resume when restarted.",
        ttl: 5200,
      });
      if (acceptedSheet?.id === r.id) acceptedSheet = null;
      bump();
    } else if (ev.action === "complete") {
      shiftCue("end");
      pushToast({
        tone: "presence",
        title: `Your shift with ${r.hospital} has ended.`,
        body: "Payment will be remitted to your account by 10PM today.",
        ttl: 5200,
      });
      // Tie the PaymentSummary to the EXACT transaction that just completed.
      // Live details (hospital/coverage/total/feePct) are derived in
      // useDispatch() from the current request row so post-webhook
      // settled_amount updates flow into the card automatically.
      pendingRatingRequestId = r.id;


      if (acceptedSheet?.id === r.id) acceptedSheet = null;
      bump();
    } else if (ev.action === "cancel") {
      pushToast({
        tone: "warn",
        title: `${r.hospital} cancelled this shift.`,
      });
      if (acceptedSheet?.id === r.id) acceptedSheet = null;
      bump();
    } else if (ev.action === "update") {
      if (acceptedSheet?.id === r.id) {
        acceptedSheet = toCoverage(r);
        bump();
      }
      pushToast({
        tone: "presence",
        title: `${r.hospital} updated this shift.`,
        body: `${r.coverage} · ${r.day} · ${r.start} - ${r.end} · ${r.durationHrs}hr · ₦${r.amount.toLocaleString("en-NG")}`,
      });
    }
  });
}

/* ---------- Actions ---------- */

export function setOnline(v: boolean) {
  setDoctorOnline(v);
}

function currentUpcomingForMe(): NetRequest[] {
  const s = readState();
  const sid = getSessionId();
  return Object.values(s.requests ?? {}).filter(
    (r) => r.acceptedBy === sid && (r.status === "accepted" || r.status === "active"),
  );
}

export function acceptIncoming() {
  const sid = getSessionId();
  const idToAccept = pendingIncomingId();
  if (!idToAccept) return;

  // Read latest request snapshot before mutating anything.
  const incomingReq = currentRequest(idToAccept);
  if (!incomingReq) return;

  // Operational guards — block BEFORE touching any state.
  const mine = currentUpcomingForMe();
  if (mine.length >= 3) {
    markDeclined(idToAccept);
    pushToast({
      tone: "warn",
      title: "You already have the maximum number of confirmed shifts.",
    });
    return;
  }
  const localConflict = conflictReason(mine, incomingReq);
  if (localConflict) {
    markDeclined(idToAccept);
    pushToast({
      tone: "warn",
      title: conflictMessage(localConflict),
    });
    return;
  }

  const result = acceptRequest(idToAccept);
  if (!result.ok) {
    markDeclined(idToAccept);
    pushToast({ tone: "warn", title: conflictMessage(result.reason) });
    return;
  }
  const req = currentRequest(idToAccept);
  if (req && req.acceptedBy === sid) {
    acceptedSheet = toCoverage(req);
    bump();
  }
}

/**
 * Time-based conflict — coverage TYPE is ignored. Two shifts conflict if
 * their absolute [startTs, endTs] windows overlap, or sit within the
 * 1-hour operational buffer. Falls back to no-conflict when timestamps
 * are missing (legacy requests).
 */
const BUFFER_MS = 60 * 60 * 1000;
function conflictReason(mine: NetRequest[], incoming: NetRequest): "overlap" | "buffer" | null {
  if (!incoming.startTs || !incoming.endTs) return null;
  for (const m of mine) {
    if (!m.startTs || !m.endTs) continue;
    if (incoming.startTs < m.endTs && m.startTs < incoming.endTs) return "overlap";
    if (incoming.startTs < m.endTs + BUFFER_MS && m.startTs < incoming.endTs + BUFFER_MS) return "buffer";
  }
  return null;
}

export function declineIncoming() {
  const id = pendingIncomingId();
  if (!id) return;
  markDeclined(id);
}

export function dismissAccepted() {
  acceptedSheet = null;
  bump();
}

export function dismissPendingRating() {
  pendingRatingRequestId = null;
  bump();
}

export function cancelUpcoming(id: string, reason?: string) {
  const r = currentRequest(id);
  if (!r) return;
  cancelRequest(id);
  if (acceptedSheet?.id === id) acceptedSheet = null;
  bump();
}

export function completeUpcoming(id: string) {
  const r = currentRequest(id);
  if (!r) return;
  completeRequest(id);
  if (acceptedSheet?.id === id) acceptedSheet = null;
  bump();
}

export function recordHistoryRating(historyId: string, value: number) {
  historyRatings = { ...historyRatings, [historyId]: value };
  history = history.map((h) => (h.id === historyId ? { ...h, rating: value } : h));
  bump();
}

export function hasHistoryRating(historyId: string): boolean {
  return historyRatings[historyId] !== undefined;
}


/* ---------- helpers reading network module ---------- */

type RawState = {
  doctors: Record<string, { declined?: string[] } | undefined>;
  requests: Record<string, NetRequest>;
};

function readState(): RawState {
  return getNetworkSnapshot();
}

function pendingIncomingId(): string | null {
  const s = readState();
  const sid = getSessionId();
  const me = s.doctors?.[sid];
  const declined = new Set<string>(me?.declined ?? []);
  const first = Object.values(s.requests ?? {})
    .filter(
      (r) =>
        r.status === "broadcasting" &&
        !declined.has(r.id) &&
        r.requesterSessionId !== sid,
    )
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  return first?.id ?? null;
}

function currentRequest(id: string): NetRequest | null {
  return readState().requests?.[id] ?? null;
}
