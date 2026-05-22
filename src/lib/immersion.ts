import { useEffect, useState } from "react";

// Tiny module-level subscription store used to hide bottom tabs
// while the requester is inside the immersive Request Coverage flow.
type Listener = (v: boolean) => void;
let immersed = false;
const listeners = new Set<Listener>();

export function setImmersive(v: boolean) {
  if (immersed === v) return;
  immersed = v;
  listeners.forEach((l) => l(v));
}

export function useImmersive() {
  const [v, setV] = useState(immersed);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
