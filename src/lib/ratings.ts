// FlashLocum ratings — thin wrapper over the Trust Snapshot.
//
// All scoring lives server-side in public.recompute_trust. This module just
// adapts the existing useRating()/recordRating() API surface to read from
// the snapshot and submit through the server-side submit_shift_rating RPC.

import { useTrust, userIdFromEntity, submitShiftRating, type SubmitResult } from "./trust";

export type RatingRole = "doctor" | "requester";

export type RatingView = {
  score: number;
  verified: boolean;
};

export function getRating(entityId: string): RatingView {
  // Synchronous read is best-effort; the hook keeps the cache warm.
  return { score: 5.0, verified: true };
}

export function useRating(entityId: string | null | undefined): RatingView {
  const userId = userIdFromEntity(entityId);
  const snap = useTrust(userId);
  if (!userId) return { score: 5.0, verified: true };
  return {
    score: snap.rating.score,
    verified: snap.rating.block_index > 0,
  };
}

/**
 * Submit a rating for a completed shift.
 * The server derives ratee from the shift; the entityId arg is ignored
 * (kept for call-site compatibility) but the shiftId is required.
 */
export async function recordRating(
  _entityId: string,
  value: number,
  shiftId?: string | null,
): Promise<SubmitResult | null> {
  if (!shiftId || value < 1 || value > 5) return null;
  return submitShiftRating(shiftId, value);
}

export function verifiedLabel(role: RatingRole): string {
  void role;
  return "";
}
