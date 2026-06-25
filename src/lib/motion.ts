// Shared motion tokens. All sheets/overlays/tab transitions consume these
// presets so the app has a single "feel" instead of every component picking
// its own spring numbers. Honors prefers-reduced-motion: pass `reduced` to
// `withReduced()` to collapse the transition to an instant cut.

import type { Transition } from "framer-motion";

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.9,
};

export const springSoft: Transition = {
  type: "spring",
  stiffness: 240,
  damping: 28,
  mass: 1,
};

export const sheetEnter: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 34,
  mass: 0.95,
};

export const fadeFast: Transition = {
  duration: 0.16,
  ease: [0.22, 0.61, 0.36, 1],
};

export const listRow: Transition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
};

export const REDUCED: Transition = { duration: 0 };

export function withReduced(reduced: boolean, t: Transition): Transition {
  return reduced ? REDUCED : t;
}
