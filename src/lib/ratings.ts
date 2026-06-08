// FlashLocum ratings — calm ambient trust signals.
//
// Rules:
// - Every newly seen participant begins at 5.0.
// - After 10 completed ratings, the real average replaces the default.
// - We never expose counts to the UI ("128 ratings" is banned).

import { useEffect, useState } from "react";

const STORAGE = "flashlocum.ratings.v1";
const VERIFY_THRESHOLD = 10;

export type RatingRole = "doctor" | "requester";

type Bucket = { sum: number; count: number };
type Store = { entities: Record<string, Bucket> };

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

export type RatingView = {
  score: number; // displayed value, e.g. 4.8 or 5.0
  verified: boolean; // retained for compatibility; never rendered as text
  provisional: boolean; // true when fewer than 10 ratings exist
};

export function getRating(entityId: string): RatingView {
  const b = load().entities[entityId];
  if (!b || b.count < VERIFY_THRESHOLD) return { score: 5.0, verified: true, provisional: true };
  return { score: round1(b.sum / b.count), verified: false, provisional: false };
}

export function recordRating(entityId: string, value: number) {
  if (!entityId || value < 1 || value > 5) return;
  const s = load();
  const cur = s.entities[entityId] ?? { sum: 0, count: 0 };
  save({
    entities: {
      ...s.entities,
      [entityId]: { sum: cur.sum + value, count: cur.count + 1 },
    },
  });
}

export function useRating(entityId: string | null | undefined): RatingView {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (!entityId) return { score: 5.0, verified: true, provisional: true };
  return getRating(entityId);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function verifiedLabel(role: RatingRole): string {
  void role;
  return "";
}
