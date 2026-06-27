// Universal "watchful reconcile" hook for lifecycle screens.
//
// Realtime stays the primary update mechanism. This hook is the safety net
// every screen mounts while it is staring at a single in-flight coverage
// request, so that a missed realtime event (channel down, reconnect race,
// broadcast dropped, app backgrounded) cannot trap the user in stale state.
//
// While mounted, it:
//   - calls reconcileRequest(id) immediately on mount,
//   - re-runs reconcileRequest(id) every `intervalMs` (default 4 s),
//   - re-runs on visibilitychange→visible, window.focus, and online,
//   - stops cleanly on unmount or when `enabled` flips false.
//
// Cost: one cheap single-row read per interval, only while the screen is
// actively engaged with an in-flight row. Coalesced inside coverage-remote
// so overlapping triggers collapse to one fetch. With realtime healthy and
// no row change, downstream listeners are no-ops (data hash unchanged).

import { useEffect, useRef } from "react";
import { reconcileRequest } from "@/lib/coverage-remote";
import type { NetRequest } from "@/lib/network";

export interface UseLifecycleReconcileOptions {
  /** Polling cadence while mounted. Defaults to 4000 ms. */
  intervalMs?: number;
  /**
   * When false, the hook is dormant — no timer, no listeners. Lets callers
   * turn the watchful window on/off based on stage without unmounting.
   */
  enabled?: boolean;
  /**
   * Optional callback fired with the authoritative row (or null) after every
   * reconcile. Lets a lifecycle screen advance its local UI directly from
   * the row it just read, even if the broader network fan-out is delayed.
   */
  onRow?: (row: NetRequest | null) => void;
}

export function useLifecycleReconcile(
  id: string | null | undefined,
  opts: UseLifecycleReconcileOptions = {},
): void {
  const { intervalMs = 4000, enabled = true, onRow } = opts;
  const onRowRef = useRef(onRow);
  onRowRef.current = onRow;

  useEffect(() => {
    if (!enabled || !id) return;

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      void reconcileRequest(id).then((row) => {
        if (cancelled) return;
        onRowRef.current?.(row);
      });
    };

    // Immediate reconcile on mount so the screen never renders an out-of-date
    // row even for one tick.
    run();

    const timer = window.setInterval(run, intervalMs);

    const onVisibility = () => {
      if (document.visibilityState === "visible") run();
    };
    const onFocusOrOnline = () => run();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocusOrOnline);
    window.addEventListener("online", onFocusOrOnline);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocusOrOnline);
      window.removeEventListener("online", onFocusOrOnline);
    };
  }, [id, enabled, intervalMs]);
}

