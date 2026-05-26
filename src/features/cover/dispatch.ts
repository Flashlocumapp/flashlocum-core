// Doctor-side dispatch store, backed by the shared FlashLocum network.
// Public API kept stable for CoverHome, CoverDispatchPortal, and coverage tab.

import { useEffect, useState } from "react";
import {
  acceptRequest,
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
  };
}

/* ---------- History ---------- */

export type HistoryItem = Coverage & {
  outcome: "completed" | "cancelled";
  completedOn: string;
  rating?: number;
  settlementStatus: "Remitted" | "Pending" | "Voided";
};

let history: HistoryItem[] = [];
let acceptedSheet: Coverage | null = null;
// Hospital pending rating after End Shift (entityId derived from hospital name).
let pendingRating: { hospitalId: string; hospital: string } | null = null;
const processedEvents = new Set<string>();

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
  pendingRating: { hospitalId: string; hospital: string } | null;
};

export function useDispatch(): View {
  const net = useNetwork();
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    localListeners.add(l);
    return () => {
      localListeners.delete(l);
    };
  }, []);

  const sid = getSessionId();
  const me = net.doctors[sid];
  const online = !!me?.online;

  const upcoming: Coverage[] = Object.values(net.requests)
    .filter(
      (r) =>
        r.acceptedBy === sid &&
        (r.status === "accepted" || r.status === "active"),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toCoverage);

  const derivedHistory: HistoryItem[] = Object.values(net.requests)
    .filter(
      (r) =>
        r.acceptedBy === sid &&
        (r.status === "completed" || r.status === "cancelled"),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((r) => ({
      ...toCoverage(r),
      outcome: r.status === "completed" ? "completed" : "cancelled",
      completedOn: new Date(r.updatedAt).toLocaleDateString("en-NG", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      }),
      settlementStatus: r.status === "completed" ? "Pending" : "Voided",
    }));

  let incoming: Coverage | null = null;
  if (online && upcoming.length < 3 && !acceptedSheet) {
    const declined = new Set(me?.declined ?? []);
    const r = broadcastingRequests(net).find((x) => !declined.has(x.id));
    if (r) incoming = toCoverage(r);
  }

  useEffect(() => {
    if (me && me.acceptedCount !== upcoming.length) {
      setDoctorAcceptedCount(upcoming.length);
    }
  }, [me, upcoming.length]);

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
    const eventKey = `${ev.actor}:${ev.actorId}:${ev.shiftId}:${ev.action}:${ev.at}`;
    if (processedEvents.has(eventKey)) return;
    const r = s.requests[ev.shiftId];
    if (!r || r.acceptedBy !== sid) return;
    if (ev.actor !== "requester") return;
    processedEvents.add(eventKey);

    if (ev.action === "start") {
      pushToast({
        tone: "presence",
        title: `Your shift with ${r.hospital} has started.`,
        body: "Tap the active card for shift details.",
      });
    } else if (ev.action === "complete") {
      pushToast({
        tone: "presence",
        title: `Your shift with ${r.hospital} has ended.`,
        body: "Payment will be remitted to your account by 10PM today.",
        ttl: 5200,
      });
      pendingRating = {
        hospitalId: hospitalEntityId(r.hospital),
        hospital: r.hospital,
      };
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
      pushToast({
        tone: "presence",
        title: `${r.hospital} updated this shift.`,
        body: `${r.coverage} · ${r.day} · ${r.start}–${r.end} · ${r.durationHrs}hr`,
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
    (r) =>
      r.acceptedBy === sid && (r.status === "accepted" || r.status === "active"),
  );
}

export function acceptIncoming() {
  const sid = getSessionId();
  const idToAccept = pendingIncomingId();
  if (!idToAccept) return;

  // Conflict / limit guards — soft, calm.
  const mine = currentUpcomingForMe();
  if (mine.length >= 3) {
    pushToast({
      tone: "warn",
      title: "You already have 3 confirmed shifts.",
    });
    return;
  }
  const incomingReq = currentRequest(idToAccept);
  if (incomingReq && hasConflict(mine, incomingReq)) {
    pushToast({
      tone: "warn",
      title: "This request conflicts with an existing confirmed shift.",
      body: "FlashLocum keeps a 1-hour buffer between shifts.",
    });
    return;
  }

  const ok = acceptRequest(idToAccept);
  if (!ok) return;
  const req = currentRequest(idToAccept);
  if (req && req.acceptedBy === sid) {
    acceptedSheet = toCoverage(req);
    bump();
  }
}

/** Operational overlap + 1-hour buffer rule. */
const BUFFER_MIN = 60;
function shiftWindow(r: NetRequest): { s: number; e: number } | null {
  // Use parsed times; treat day boundary by adding duration if end <= start.
  // Falls back to durationHrs from start when end missing.
  // Imported lazily to avoid cycles.
  const start = parseClockLocal(r.start);
  if (start == null) return null;
  let end = parseClockLocal(r.end);
  if (end == null || end <= start) end = start + r.durationHrs * 60;
  return { s: start, e: end };
}
function parseClockLocal(t: string): number | null {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}
function hasConflict(mine: NetRequest[], incoming: NetRequest): boolean {
  const inc = shiftWindow(incoming);
  if (!inc) return false;
  for (const m of mine) {
    if (m.day !== incoming.day) continue;
    const w = shiftWindow(m);
    if (!w) continue;
    // overlap?
    if (inc.s < w.e && w.s < inc.e) return true;
    // buffer (1 hour)
    if (Math.abs(inc.s - w.e) < BUFFER_MIN) return true;
    if (Math.abs(w.s - inc.e) < BUFFER_MIN) return true;
  }
  return false;
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
  pendingRating = null;
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
  history = history.map((h) => (h.id === historyId ? { ...h, rating: value } : h));
  bump();
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
    .filter((r) => r.status === "broadcasting" && !declined.has(r.id))
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  return first?.id ?? null;
}

function currentRequest(id: string): NetRequest | null {
  return readState().requests?.[id] ?? null;
}
