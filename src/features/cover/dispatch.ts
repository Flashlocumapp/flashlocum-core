// Cover-side dispatch store: shared between Home tile + global request overlay.
import { useEffect, useState } from "react";

export type Coverage = {
  id: string;
  hospital: string;
  area: string;
  coverage: string; // e.g. "Weekend Call"
  day: string; // e.g. "Sat & Sun"
  start: string; // e.g. "8:00AM"
  end: string;   // e.g. "8:00PM"
  durationHrs: number;
  amount: number; // gross
  feePct: number; // platform fee %
  phone: string;
  note?: string;
  active?: boolean; // currently in-progress
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

// Seed upcoming list
const seed: Coverage[] = [
  {
    id: "c-seed-1",
    hospital: "Lagoon Hospital",
    area: "Lekki",
    coverage: "Weekend Call",
    day: "Sat & Sun",
    start: "8:00AM",
    end: "8:00PM",
    durationHrs: 12,
    amount: 72000,
    feePct: 10,
    phone: "+2348012345678",
    note: "Call room available",
    active: false,
  },
];

const pool: Coverage[] = [
  {
    id: "p1",
    hospital: "Evercare Hospital",
    area: "Lekki Phase 1",
    coverage: "Standard",
    day: "Tue",
    start: "8:00AM",
    end: "6:00PM",
    durationHrs: 10,
    amount: 36000,
    feePct: 10,
    phone: "+2348023456789",
    note: "Light patient load",
  },
  {
    id: "p2",
    hospital: "Reddington Hospital",
    area: "Victoria Island",
    coverage: "24-Hour",
    day: "Fri",
    start: "8:00AM",
    end: "8:00AM",
    durationHrs: 24,
    amount: 80000,
    feePct: 10,
    phone: "+2348034567890",
    note: "Shared accommodation",
  },
  {
    id: "p3",
    hospital: "St Nicholas Hospital",
    area: "Lagos Island",
    coverage: "Home Care",
    day: "Wed",
    start: "10:00PM",
    end: "6:00AM",
    durationHrs: 8,
    amount: 28000,
    feePct: 10,
    phone: "+2348045678901",
  },
];

type State = {
  online: boolean;
  upcoming: Coverage[];   // accepted (max 3)
  incoming: Coverage | null; // current overlay
  accepted: Coverage | null; // accepted detail sheet open
  nextPoolIdx: number;
};

let state: State = {
  online: true,
  upcoming: seed,
  incoming: null,
  accepted: null,
  nextPoolIdx: 0,
};

const listeners = new Set<(s: State) => void>();
function emit() {
  const snap = state;
  listeners.forEach((l) => l(snap));
}
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

export function useDispatch() {
  const [s, setS] = useState<State>(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export function setOnline(v: boolean) {
  set({ online: v, incoming: v ? state.incoming : null });
}

export function acceptIncoming() {
  if (!state.incoming) return;
  if (state.upcoming.length >= 3) {
    set({ incoming: null });
    return;
  }
  const next = state.incoming;
  set({
    incoming: null,
    accepted: next,
    upcoming: [...state.upcoming, next],
  });
}

export function declineIncoming() {
  set({ incoming: null });
}

export function dismissAccepted() {
  set({ accepted: null });
}

export function cancelUpcoming(id: string) {
  set({
    upcoming: state.upcoming.filter((c) => c.id !== id),
    accepted: state.accepted?.id === id ? null : state.accepted,
  });
}

// Background loop: when online, no incoming, no accepted sheet, and < 3 upcoming,
// surface a new request after a delay. Also auto-dismiss after a while
// (simulating another doctor accepting).
let timers: number[] = [];
function clearTimers() {
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
}

function scheduleSurface() {
  clearTimers();
  if (typeof window === "undefined") return;
  if (!state.online) return;
  if (state.incoming || state.accepted) return;
  if (state.upcoming.length >= 3) return;

  const delay = 8000 + Math.floor(Math.random() * 6000);
  const t = window.setTimeout(() => {
    if (!state.online || state.incoming || state.accepted) return;
    if (state.upcoming.length >= 3) return;
    const item = { ...pool[state.nextPoolIdx % pool.length] };
    item.id = item.id + "-" + Date.now();
    set({
      incoming: item,
      nextPoolIdx: state.nextPoolIdx + 1,
    });
    // auto-rescind after a while
    const t2 = window.setTimeout(() => {
      if (state.incoming?.id === item.id) set({ incoming: null });
    }, 18000);
    timers.push(t2);
  }, delay);
  timers.push(t);
}

listeners.add(() => scheduleSurface());

if (typeof window !== "undefined") {
  // kick off once on module load
  scheduleSurface();
}
