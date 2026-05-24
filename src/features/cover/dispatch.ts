// Doctor-side dispatch store, now backed by the shared FlashLocum network.
// Public API kept stable for CoverHome, CoverDispatchPortal, and coverage tab.

import { useEffect, useState } from "react";
import {
  acceptRequest,
  broadcastingRequests,
  cancelRequest,
  completeRequest,
  getSessionId,
  markDeclined,
  registerDoctor,
  setDoctorAcceptedCount,
  setDoctorOnline,
  startHeartbeat,
  type NetRequest,
  useNetwork,
} from "@/lib/network";

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
};

const naira = (n: number) => "₦" + n.toLocaleString("en-NG");
export const nairaK = (n: number) =>
  n >= 1000 ? "₦" + Math.round(n / 1000) + "K" : naira(n);

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
  };
}

/* ---------- History (local, calm seed) ---------- */

export type HistoryItem = Coverage & {
  outcome: "completed" | "cancelled";
  completedOn: string;
  rating?: number;
  settlementStatus: "Remitted" | "Pending" | "Voided";
};

const seedHistory: HistoryItem[] = [
  {
    id: "h1",
    hospital: "St Nicholas Hospital",
    area: "Lagos Island",
    coverage: "Standard",
    day: "Mon",
    start: "8:00AM",
    end: "6:00PM",
    durationHrs: 10,
    amount: 36000,
    feePct: 10,
    phone: "+2348011223344",
    outcome: "completed",
    completedOn: "Mon 17 Nov",
    rating: 5,
    settlementStatus: "Remitted",
    note: "Light patient load",
  },
  {
    id: "h2",
    hospital: "First Cardiology",
    area: "Ikoyi",
    coverage: "24-Hour",
    day: "Fri",
    start: "8:00AM",
    end: "8:00AM",
    durationHrs: 24,
    amount: 80000,
    feePct: 10,
    phone: "+2348011223344",
    outcome: "completed",
    completedOn: "Fri 7 Nov",
    rating: 4,
    settlementStatus: "Remitted",
  },
];

let history: HistoryItem[] = seedHistory;
let acceptedSheet: Coverage | null = null;
const localListeners = new Set<() => void>();
function bump() {
  localListeners.forEach((l) => l());
}

/* ---------- Hook ---------- */

type View = {
  online: boolean;
  upcoming: Coverage[];
  incoming: Coverage | null;
  accepted: Coverage | null;
  history: HistoryItem[];
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

  // Upcoming = requests accepted by me, not yet completed/cancelled.
  const upcoming: Coverage[] = Object.values(net.requests)
    .filter(
      (r) =>
        r.acceptedBy === sid &&
        (r.status === "accepted" || r.status === "active"),
    )
    .sort((a, b) => a.createdAt - b.createdAt)
    .map(toCoverage);

  // Incoming = first broadcasting request I haven't declined,
  // if I'm online and have < 3 upcoming and no accepted sheet open.
  let incoming: Coverage | null = null;
  if (online && upcoming.length < 3 && !acceptedSheet) {
    const declined = new Set(me?.declined ?? []);
    const r = broadcastingRequests(net).find((x) => !declined.has(x.id));
    if (r) incoming = toCoverage(r);
  }

  // Reflect my accepted count back to presence map.
  useEffect(() => {
    if (me && me.acceptedCount !== upcoming.length) {
      setDoctorAcceptedCount(upcoming.length);
    }
  }, [me, upcoming.length]);

  return { online, upcoming, incoming, accepted: acceptedSheet, history };
}

/* ---------- Lifecycle ---------- */

let bootstrapped = false;
export function ensureDoctorSession(initialOnline = true) {
  if (bootstrapped) return;
  if (typeof window === "undefined") return;
  bootstrapped = true;
  registerDoctor(initialOnline);
  startHeartbeat();
}

/* ---------- Actions ---------- */

export function setOnline(v: boolean) {
  setDoctorOnline(v);
}

export function acceptIncoming() {
  // Find current incoming via network snapshot.
  const sid = getSessionId();
  // Read latest from network module via window.
  // We re-evaluate inside acceptRequest atomically (status check).
  // Get any broadcasting request not declined by me.
  // We must rely on the hook view callers — use a stored ref.
  const idToAccept = pendingIncomingId();
  if (!idToAccept) return;
  const ok = acceptRequest(idToAccept);
  if (!ok) return;
  // Open accepted sheet for the doctor.
  // Pull the now-accepted request from network.
  const req = currentRequest(idToAccept);
  if (req && req.acceptedBy === sid) {
    acceptedSheet = toCoverage(req);
    bump();
  }
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

export function cancelUpcoming(id: string, reason?: string) {
  const r = currentRequest(id);
  if (!r) return;
  cancelRequest(id);
  history = [
    {
      ...toCoverage(r),
      outcome: "cancelled",
      completedOn: new Date().toLocaleDateString("en-NG", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      }),
      settlementStatus: "Voided",
      note: reason ? `Cancelled · ${reason}` : r.note,
    },
    ...history,
  ];
  if (acceptedSheet?.id === id) acceptedSheet = null;
  bump();
}

export function completeUpcoming(id: string) {
  const r = currentRequest(id);
  if (!r) return;
  completeRequest(id);
  history = [
    {
      ...toCoverage(r),
      outcome: "completed",
      completedOn: new Date().toLocaleDateString("en-NG", {
        weekday: "short",
        day: "2-digit",
        month: "short",
      }),
      settlementStatus: "Remitted",
    },
    ...history,
  ];
  if (acceptedSheet?.id === id) acceptedSheet = null;
  bump();
}

/* ---------- helpers reading network module ---------- */

type RawState = {
  doctors: Record<string, { declined?: string[] } | undefined>;
  requests: Record<string, NetRequest>;
};

function readState(): RawState {
  try {
    const raw = window.localStorage.getItem("flashlocum.net.v1");
    if (!raw) return { doctors: {}, requests: {} };
    return JSON.parse(raw) as RawState;
  } catch {
    return { doctors: {}, requests: {} };
  }
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
