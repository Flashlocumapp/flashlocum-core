// FlashLocum reliability — thin wrapper over the Trust Snapshot.
//
// All scoring lives server-side in public.recompute_trust. This module just
// adapts the existing useReliability() API surface to read from the snapshot.

import { useTrust, userIdFromEntity } from "./trust";

export type ReliabilityView = {
  score: number;
  display: string;
  provisional: boolean;
};

export function getReliability(entityId: string): ReliabilityView {
  void entityId;
  return { score: 100, display: "100%", provisional: true };
}

export function useReliability(entityId: string | null | undefined): ReliabilityView {
  const userId = userIdFromEntity(entityId);
  const snap = useTrust(userId);
  if (!userId) return { score: 100, display: "100%", provisional: true };
  const pct = Math.max(0, Math.min(100, Math.round(snap.reliability.score)));
  return {
    score: pct,
    display: `${pct}%`,
    provisional: snap.reliability.block_index === 0,
  };
}
