// Lightweight operational notifications — calm, ambient, mobile-native.
// Listeners receive every push; consumer renders a single toast at a time.
//
// Dedup contract
// --------------
// pushToast() accepts an optional `key`. The most recent toast for each
// key is remembered for `DEDUP_WINDOW_MS`; repeats inside that window are
// silently dropped. Engine-routed toasts (feedback.ts) pass a stable
// event key so realtime + local emissions of the same event collapse to a
// single visible toast across the whole app.

import { useEffect, useState } from "react";

export type ToastTone = "info" | "presence" | "warn";

export type Toast = {
  id: string;
  title: string;
  body?: string;
  tone?: ToastTone;
  ttl?: number; // ms
  key?: string;
};

const listeners = new Set<(t: Toast) => void>();
const DEDUP_WINDOW_MS = 4000;
const recentKeys = new Map<string, number>();

function isDuplicate(key: string | undefined): boolean {
  if (!key) return false;
  const now = Date.now();
  // Cheap GC: prune anything outside the window.
  if (recentKeys.size > 64) {
    for (const [k, t] of recentKeys) {
      if (now - t > DEDUP_WINDOW_MS) recentKeys.delete(k);
    }
  }
  const last = recentKeys.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentKeys.set(key, now);
  return false;
}

export function pushToast(t: Omit<Toast, "id"> & { id?: string }) {
  if (isDuplicate(t.key)) return;
  const toast: Toast = {
    id: t.id ?? "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
    title: t.title,
    body: t.body,
    tone: t.tone ?? "info",
    ttl: t.ttl ?? 3400,
    key: t.key,
  };
  listeners.forEach((l) => l(toast));
}

export function useLatestToast(): Toast | null {
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    const l = (t: Toast) => {
      setToast(t);
      if (t.ttl && t.ttl > 0) {
        window.setTimeout(() => {
          setToast((cur) => (cur?.id === t.id ? null : cur));
        }, t.ttl);
      }
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return toast;
}
