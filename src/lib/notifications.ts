// Lightweight operational notifications — calm, ambient, mobile-native.
// Listeners receive every push; consumer renders a single toast at a time.

import { useEffect, useState } from "react";

export type ToastTone = "info" | "presence" | "warn";

export type Toast = {
  id: string;
  title: string;
  body?: string;
  tone?: ToastTone;
  ttl?: number; // ms
};

const listeners = new Set<(t: Toast) => void>();

export function pushToast(t: Omit<Toast, "id"> & { id?: string }) {
  const toast: Toast = {
    id: t.id ?? "n_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
    title: t.title,
    body: t.body,
    tone: t.tone ?? "info",
    ttl: t.ttl ?? 3400,
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
