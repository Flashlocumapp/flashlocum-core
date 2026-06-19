// FlashLocum Trust Snapshot client.
//
// Single source of truth for rating, reliability, eligibility, and admin
// restriction state. All scoring is server-computed; this module only
// caches and fans out snapshots to React consumers.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeNetwork, type NetState } from "./network";

export type TrustSnapshot = {
  version: number;
  computed_at: string;
  user_id: string;
  role: "doctor" | "requester";
  rating: {
    score: number;
    block_index: number;
    block_size: number;
    in_progress_count: number;
    last_block: { from: string; to: string; avg: number; samples: number } | null;
  };
  reliability: {
    score: number;
    block_index: number;
    block_size: number;
    in_progress_count: number;
    last_block: {
      from: string;
      to: string;
      completed: number;
      cancelled: number;
      no_show: number;
      total: number;
    } | null;
  };
  eligibility: {
    rating_below_threshold: boolean;
    reliability_below_threshold: boolean;
    any: boolean;
    reasons: string[];
  };
  restriction: {
    restricted: boolean;
    restricted_at: string | null;
    restricted_by: string | null;
    reason: string | null;
    source: string | null;
  };
};

export type ShiftRatingSide = {
  submitted: boolean;
  score: number | null;
  at: string | null;
};
export type ShiftRatingState = {
  shift_id: string;
  doctor_rating: ShiftRatingSide;
  requester_rating: ShiftRatingSide;
};

const TTL_MS = 30_000;
const trustCache = new Map<string, { snap: TrustSnapshot | null; ts: number }>();
const trustInflight = new Map<string, Promise<TrustSnapshot | null>>();
const trustListeners = new Map<string, Set<() => void>>();

const shiftCache = new Map<string, { state: ShiftRatingState | null; ts: number }>();
const shiftInflight = new Map<string, Promise<ShiftRatingState | null>>();
const shiftListeners = new Map<string, Set<() => void>>();

function notify(map: Map<string, Set<() => void>>, key: string) {
  map.get(key)?.forEach((l) => l());
}

const DEFAULT_SNAPSHOT = (userId: string): TrustSnapshot => ({
  version: 1,
  computed_at: new Date().toISOString(),
  user_id: userId,
  role: "doctor",
  rating: { score: 5.0, block_index: 0, block_size: 20, in_progress_count: 0, last_block: null },
  reliability: { score: 100, block_index: 0, block_size: 20, in_progress_count: 0, last_block: null },
  eligibility: { rating_below_threshold: false, reliability_below_threshold: false, any: false, reasons: [] },
  restriction: { restricted: false, restricted_at: null, restricted_by: null, reason: null, source: null },
});

export async function loadTrust(userId: string): Promise<TrustSnapshot | null> {
  if (!userId) return null;
  const existing = trustInflight.get(userId);
  if (existing) return existing;
  const p = (async () => {
    const { data, error } = await supabase.rpc("get_trust", { _user_id: userId });
    if (error || !data) return null;
    return data as TrustSnapshot;
  })().then((snap) => {
    trustCache.set(userId, { snap, ts: Date.now() });
    trustInflight.delete(userId);
    notify(trustListeners, userId);
    return snap;
  });
  trustInflight.set(userId, p);
  return p;
}

export function getTrust(userId: string | null | undefined): TrustSnapshot {
  if (!userId) return DEFAULT_SNAPSHOT("");
  const c = trustCache.get(userId);
  return c?.snap ?? DEFAULT_SNAPSHOT(userId);
}

export function useTrust(userId: string | null | undefined): TrustSnapshot {
  const [, force] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let set = trustListeners.get(userId);
    if (!set) {
      set = new Set();
      trustListeners.set(userId, set);
    }
    const l = () => force((x) => x + 1);
    set.add(l);
    const c = trustCache.get(userId);
    if (!c || Date.now() - c.ts > TTL_MS) {
      void loadTrust(userId);
    }
    return () => {
      set!.delete(l);
    };
  }, [userId]);
  return getTrust(userId);
}

export async function loadShiftRatingState(requestId: string): Promise<ShiftRatingState | null> {
  if (!requestId) return null;
  const existing = shiftInflight.get(requestId);
  if (existing) return existing;
  const p = (async () => {
    const { data, error } = await supabase.rpc("get_shift_rating_state", { _request_id: requestId });
    if (error || !data) return null;
    return data as ShiftRatingState;
  })().then((state) => {
    shiftCache.set(requestId, { state, ts: Date.now() });
    shiftInflight.delete(requestId);
    notify(shiftListeners, requestId);
    return state;
  });
  shiftInflight.set(requestId, p);
  return p;
}

export function useShiftRatingState(requestId: string | null | undefined): ShiftRatingState | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!requestId) return;
    let set = shiftListeners.get(requestId);
    if (!set) {
      set = new Set();
      shiftListeners.set(requestId, set);
    }
    const l = () => force((x) => x + 1);
    set.add(l);
    const c = shiftCache.get(requestId);
    if (!c || Date.now() - c.ts > TTL_MS) {
      void loadShiftRatingState(requestId);
    }
    return () => {
      set!.delete(l);
    };
  }, [requestId]);
  if (!requestId) return null;
  return shiftCache.get(requestId)?.state ?? null;
}

export type SubmitResult =
  | { ok: true; state: ShiftRatingState }
  | { ok: false; error: "already_rated" | "not_authorized" | "not_terminal" | "unknown"; message: string };

export async function submitShiftRating(
  requestId: string,
  score: number,
  feedback?: string | null,
): Promise<SubmitResult> {
  if (!requestId) {
    console.error("[submitShiftRating] missing requestId");
    return { ok: false, error: "unknown", message: "Missing shift" };
  }
  const args = {
    _request_id: requestId,
    _score: Math.round(score),
    _feedback: feedback ?? null,
  };
  console.info("[submitShiftRating] calling RPC", { requestId, score: args._score, hasFeedback: !!feedback });
  const { data, error } = await supabase.rpc("submit_shift_rating", args as never);
  if (error) {
    console.error("[submitShiftRating] RPC error", { code: error.code, message: error.message, details: error.details });
    const msg = error.message || "";
    let code: "already_rated" | "not_authorized" | "not_terminal" | "unknown" = "unknown";
    if (/already rated|unique/i.test(msg)) code = "already_rated";
    else if (/not authorized/i.test(msg)) code = "not_authorized";
    else if (/not yet terminal/i.test(msg)) code = "not_terminal";
    return { ok: false, error: code, message: msg };
  }
  console.info("[submitShiftRating] RPC success", { requestId });
  const state = data as ShiftRatingState;
  shiftCache.set(requestId, { state, ts: Date.now() });
  notify(shiftListeners, requestId);
  return { ok: true, state };
}

// Invalidate caches when shift lifecycle events fire so trust + per-shift
// state reflect the latest server view without manual refresh.
let bootstrapped = false;
function bootstrap() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;
  subscribeNetwork((s: NetState) => {
    const ev = s.lastEvent;
    if (!ev) return;
    if (ev.action === "accept" || ev.action === "complete" || ev.action === "cancel") {
      for (const key of Array.from(trustCache.keys())) {
        trustCache.delete(key);
        void loadTrust(key);
      }
      for (const key of Array.from(shiftCache.keys())) {
        shiftCache.delete(key);
        void loadShiftRatingState(key);
      }
    }
  });
}
bootstrap();

// ---------- Entity ID adapters (legacy → user_id) ----------
// Existing call sites pass strings like "doc:<uuid>" or "req:<uuid>".
// We parse them so the surrounding code can keep working unchanged.
export function userIdFromEntity(entityId: string | null | undefined): string | null {
  if (!entityId) return null;
  const idx = entityId.indexOf(":");
  if (idx < 0) return null;
  const tail = entityId.slice(idx + 1);
  // Reject legacy hosp:<slug> — those are not user ids.
  if (!/^[0-9a-f-]{36}$/i.test(tail)) return null;
  return tail;
}
