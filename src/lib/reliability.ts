// FlashLocum reliability — dependability trust signal.
//
// Rules:
// - Every newly verified user starts at 100%.
// - Reliability only becomes real after 10 accepted shifts.
// - Formula: completed accepted shifts ÷ total accepted shifts × 100.
// - Cancellations after an accept count against reliability equally.
// - Same system for doctors and hospitals.

import { useEffect, useState } from "react";
import { subscribeNetwork, type NetState } from "./network";

const STORAGE = "flashlocum.reliability.v1";
const VERIFY_THRESHOLD = 10;

type Outcome = "accepted" | "completed" | "cancelled";
type EntityMap = Record<string, Outcome>; // requestId -> latest outcome
type Store = { entities: Record<string, EntityMap> };

type Listener = (s: Store) => void;
const listeners = new Set<Listener>();
let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  if (typeof window === "undefined") return { entities: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE);
    cache = raw ? (JSON.parse(raw) as Store) : { entities: {} };
  } catch {
    cache = { entities: {} };
  }
  return cache;
}

function save(next: Store) {
  cache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE, JSON.stringify(next));
    } catch {
      /* noop */
    }
  }
  listeners.forEach((l) => l(next));
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE) return;
    cache = null;
    const next = load();
    listeners.forEach((l) => l(next));
  });
}

export type ReliabilityView = {
  score: number; // 0–100
  display: string; // "100%" / "97%"
  provisional: boolean; // true while < 10 accepted shifts
};

export function getReliability(entityId: string): ReliabilityView {
  const m = load().entities[entityId];
  if (!m) return { score: 100, display: "100%", provisional: true };
  const outcomes = Object.values(m);
  const total = outcomes.length;
  if (total < VERIFY_THRESHOLD) return { score: 100, display: "100%", provisional: true };
  const completed = outcomes.filter((o) => o === "completed").length;
  const pct = Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
  return { score: pct, display: `${pct}%`, provisional: false };
}

function recordOutcome(entityId: string, requestId: string, outcome: Outcome) {
  if (!entityId || !requestId) return;
  const s = load();
  const cur = s.entities[entityId] ?? {};
  const prev = cur[requestId];
  // Idempotent: terminal outcomes win, accepted only sets if not already terminal.
  if (prev === "completed" || prev === "cancelled") {
    if (outcome === "accepted") return;
    if (outcome === prev) return;
  }
  if (prev === outcome) return;
  save({
    entities: {
      ...s.entities,
      [entityId]: { ...cur, [requestId]: outcome },
    },
  });
}

export function useReliability(entityId: string | null | undefined): ReliabilityView {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!entityId) return { score: 100, display: "100%", provisional: true };
  return getReliability(entityId);
}

function hospitalId(hospital: string): string {
  return "hosp:" + hospital.toLowerCase().replace(/\s+/g, "_");
}
function doctorId(sid: string): string {
  return "doc:" + sid;
}

// Auto-subscribe to operational events. Every device that loads this module
// keeps its own reliability ledger in sync with the shared network feed.
let bootstrapped = false;
function bootstrap() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;
  subscribeNetwork((s: NetState) => {
    const ev = s.lastEvent;
    if (!ev || !ev.shiftId) return;
    const r = s.requests[ev.shiftId];
    if (!r) return;
    const doctorEntity = r.acceptedBy ? doctorId(r.acceptedBy) : null;
    const hospEntity = r.hospital ? hospitalId(r.hospital) : null;

    if (ev.action === "accept") {
      if (doctorEntity) recordOutcome(doctorEntity, r.id, "accepted");
      if (hospEntity) recordOutcome(hospEntity, r.id, "accepted");
    } else if (ev.action === "complete") {
      if (doctorEntity) recordOutcome(doctorEntity, r.id, "completed");
      if (hospEntity) recordOutcome(hospEntity, r.id, "completed");
    } else if (ev.action === "cancel") {
      // Only counts if request had been accepted (acceptedBy set).
      if (!r.acceptedBy) return;
      if (doctorEntity) recordOutcome(doctorEntity, r.id, "cancelled");
      if (hospEntity) recordOutcome(hospEntity, r.id, "cancelled");
    }
  });
}
bootstrap();
