// Persists the last 3 hospitals a requester booked, surfaced as quick
// pickers in the "Where is coverage needed?" sheet.

import { useEffect, useState } from "react";

const STORAGE = "flashlocum.recent_locations.v1";
const MAX = 3;

export type RecentLocation = {
  placeId?: string;
  name: string;
  area: string;
  lat?: number;
  lng?: number;
};

type Listener = () => void;
const listeners = new Set<Listener>();

function read(): RecentLocation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RecentLocation[]).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

function write(next: RecentLocation[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE, JSON.stringify(next.slice(0, MAX)));
  } catch {
    /* noop */
  }
  listeners.forEach((l) => l());
}

function keyOf(r: RecentLocation): string {
  return r.placeId || r.name.toLowerCase().trim();
}

export function rememberRecentLocation(r: RecentLocation) {
  if (!r?.name) return;
  const k = keyOf(r);
  const next = [r, ...read().filter((x) => keyOf(x) !== k)].slice(0, MAX);
  write(next);
}

export function getRecentLocations(): RecentLocation[] {
  return read();
}

export function useRecentLocations(): RecentLocation[] {
  const [items, setItems] = useState<RecentLocation[]>(() => read());
  useEffect(() => {
    const l = () => setItems(read());
    listeners.add(l);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE) l();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(l);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return items;
}
