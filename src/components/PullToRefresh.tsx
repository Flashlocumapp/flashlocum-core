// Native-style pull-to-refresh. Pointer-event based, no library.
//
// Engages only when the host scroll container is at the top (scrollTop === 0)
// AND the gesture starts as a downward drag. Translates the content with a
// soft rubber-band; on release past `threshold` calls `onRefresh()` and
// shows a spinner pill until the promise resolves (with a 1.2s minimum so
// the affordance is always perceptible).
//
// Pull-to-refresh is an EXTRA path to fresh data — realtime subscriptions
// and caches continue to deliver updates automatically. It is never the
// only way the user sees current information.
//
// Honors prefers-reduced-motion: drag still works, but spring/translate is
// skipped (spinner alone communicates the refresh).

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, animate } from "framer-motion";
import { springSoft } from "@/lib/motion";
import { emitHaptic } from "@/lib/feedback";

type Props = {
  /** Async refresh action. If omitted, the spinner shows briefly and resolves
   *  on its own (purely reassuring; realtime keeps data fresh). */
  onRefresh?: () => Promise<unknown> | unknown;
  /** Pixel threshold to trigger refresh. Default 64. */
  threshold?: number;
  /** Minimum visible spinner time in ms once triggered. Default 1200. */
  minSpinnerMs?: number;
  children: React.ReactNode;
  className?: string;
};

function reducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function PullToRefresh({
  onRefresh,
  threshold = 64,
  minSpinnerMs = 1200,
  children,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const armedHapticRef = useRef(false);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = reducedMotion();
  }, []);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      // Only primary touch / mouse.
      if (e.pointerType !== "touch" && e.button !== 0) return;
      if (refreshing) return;
      // Find scroll container (this PTR wraps the scroll viewport's content
      // — we read scrollTop from the nearest scrollable ancestor).
      const scroller = nearestScrollable(el);
      if (!scroller || scroller.scrollTop > 0) return;
      startYRef.current = e.clientY;
      activeRef.current = false;
      armedHapticRef.current = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (startYRef.current === null || refreshing) return;
      const dy = e.clientY - startYRef.current;
      if (dy <= 0) {
        // Cancel — user scrolled up.
        if (activeRef.current) {
          activeRef.current = false;
          y.set(0);
        }
        return;
      }
      // Engage.
      if (!activeRef.current) {
        activeRef.current = true;
      }
      // Rubber-band: f(dy) = threshold * (1 - 1 / (1 + dy / threshold * 1.2))
      // Smoothly approaches ~threshold * 1.2 asymptote.
      const t = threshold;
      const damped = reducedRef.current ? 0 : t * (1 - 1 / (1 + (dy / t) * 1.2)) * 1.6;
      y.set(damped);
      if (!armedHapticRef.current && damped >= threshold) {
        armedHapticRef.current = true;
        emitHaptic("light");
      } else if (armedHapticRef.current && damped < threshold) {
        armedHapticRef.current = false;
      }
    };

    const onPointerUp = () => {
      if (startYRef.current === null) return;
      const current = y.get();
      const shouldTrigger = activeRef.current && current >= threshold && !refreshing;
      startYRef.current = null;
      activeRef.current = false;
      if (shouldTrigger) {
        setRefreshing(true);
        animate(y, threshold, reducedRef.current ? { duration: 0 } : springSoft);
        const startedAt = Date.now();
        const done = () => {
          const elapsed = Date.now() - startedAt;
          const wait = Math.max(0, minSpinnerMs - elapsed);
          window.setTimeout(() => {
            setRefreshing(false);
            animate(y, 0, reducedRef.current ? { duration: 0 } : springSoft);
          }, wait);
        };
        try {
          const p = onRefresh?.();
          if (p && typeof (p as Promise<unknown>).then === "function") {
            (p as Promise<unknown>).then(done, done);
          } else {
            done();
          }
        } catch {
          done();
        }
      } else {
        animate(y, 0, reducedRef.current ? { duration: 0 } : springSoft);
      }
    };

    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerUp, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [onRefresh, refreshing, threshold, minSpinnerMs, y]);

  return (
    <div ref={hostRef} className={className} style={{ position: "relative" }}>
      {/* Spinner pill sits above the content; rides the same y as content. */}
      <motion.div
        aria-hidden={!refreshing}
        style={{ y, position: "absolute", top: -36, left: 0, right: 0 }}
        className="pointer-events-none flex justify-center"
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{
            background: "var(--color-surface-elevated)",
            boxShadow: "0 4px 14px -6px rgba(0,0,0,0.25)",
            opacity: refreshing ? 1 : 0.85,
          }}
        >
          <Spinner spinning={refreshing} />
        </div>
      </motion.div>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}

function Spinner({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      style={{
        animation: spinning ? "ptr-spin 0.85s linear infinite" : undefined,
      }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <style>{`@keyframes ptr-spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

function nearestScrollable(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
