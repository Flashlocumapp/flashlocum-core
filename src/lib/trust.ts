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

const trustCache = new Map<string, { snap: TrustSnapshot | null; ts: number }>();
const trustInflight = new Map<string, Promise<TrustSnapshot | null>>();
const trustListeners = new Map<string, Set<() => void>>();

const shiftCache = new Map<string, { state: ShiftRatingState | null; ts: number }>();
const shiftInflight = new Map<string, Promise<ShiftRatingState | null>>();
const shiftListeners = new Map<string, Set<() => void>>();

const SHIFT_TTL_MS = 30_000;

function notify(map: Map<string, Set<() => void>>, key: string) {
  map.get(key)?.forEach((l) => l());
}

const DEFAULT_SNAPSHOT = (userId: string): TrustSnapshot => ({
  version: 1,
  computed_at: new Date().toISOString(),
  user_id: userId,
  role: "doctor",
  rating: { score: 5.0, block_index: 0, block_size: 20, in_progress_count: 0, last_block: null },
  reliability: {
    score: 100,
    block_index: 0,
    block_size: 20,
    in_progress_count: 0,
    last_block: null,
  },
  eligibility: {
    rating_below_threshold: false,
    reliability_below_threshold: false,
    any: false,
    reasons: [],
  },
  restriction: {
    restricted: false,
    restricted_at: null,
    restricted_by: null,
    reason: null,
    source: null,
  },
});

// Shape the lightweight get_trust_summary payload into a full TrustSnapshot
// using safe defaults for the fields the pills don't read. Eligibility and
// restriction details are owned by the privileged `get_trust` call and are
// intentionally absent from the cross-user summary.
function snapshotFromSummary(userId: string, summary: unknown): TrustSnapshot {
  const base = DEFAULT_SNAPSHOT(userId);
  if (!summary || typeof summary !== "object") return base;
  const s = summary as Record<string, unknown>;
  const role = s.role === "requester" ? "requester" : "doctor";
  const r = (s.rating ?? {}) as Record<string, unknown>;
  const rel = (s.reliability ?? {}) as Record<string, unknown>;
  return {
    ...base,
    user_id: typeof s.user_id === "string" ? s.user_id : userId,
    role,
    rating: {
      ...base.rating,
      score: Number(r.score ?? base.rating.score),
      block_index: Number(r.block_index ?? base.rating.block_index),
      block_size: Number(r.block_size ?? base.rating.block_size),
    },
    reliability: {
      ...base.reliability,
      score: Number(rel.score ?? base.reliability.score),
      block_index: Number(rel.block_index ?? base.reliability.block_index),
      block_size: Number(rel.block_size ?? base.reliability.block_size),
    },
  };
}

export async function loadTrust(userId: string): Promise<TrustSnapshot | null> {
  if (!userId) return null;
  const existing = trustInflight.get(userId);
  if (existing) return existing;
  const p = (async () => {
    const { data, error } = await supabase.rpc("get_trust_summary", { _user_id: userId });
    if (error || !data) return null;
    return snapshotFromSummary(userId, data);
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
    // Load once if we've never resolved this user; subsequent invalidations
    // come via realtime (profiles UPDATE) or explicit dispatch events.
    if (!trustCache.has(userId)) {
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
    const { data, error } = await supabase.rpc("get_shift_rating_state", {
      _request_id: requestId,
    });
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
    if (!c || Date.now() - c.ts > SHIFT_TTL_MS) {
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
  | {
      ok: false;
      error: "already_rated" | "not_authorized" | "not_terminal" | "unknown";
      message: string;
    };

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
  console.info("[submitShiftRating] calling RPC", {
    requestId,
    score: args._score,
    hasFeedback: !!feedback,
  });
  const { data, error } = await supabase.rpc("submit_shift_rating", args as never);
  if (error) {
    console.error("[submitShiftRating] RPC error", {
      code: error.code,
      message: error.message,
      details: error.details,
    });
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

  // Realtime fan-in: any UPDATE on a watched profile (rating insert →
  // recompute_trust → trust_snapshot write, or shift terminal → same) drops
  // the cached snapshot and reloads. Pills then re-render with the live
  // rolling-20 value without any manual refresh.
  try {
    const channel = supabase
      .channel("trust:profiles")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const id = (payload.new as { id?: string } | null)?.id;
          if (!id) return;
          if (!trustCache.has(id) && !trustInflight.has(id)) return;
          trustCache.delete(id);
          void loadTrust(id);
        },
      )
      .subscribe();
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        void supabase.removeChannel(channel);
      });
    }
  } catch (err) {
    console.warn("[trust] realtime subscribe failed", err);
  }
}
bootstrap();

// ---------- Entity ID adapters (legacy → user_id) ----------
// Existing call sites pass strings like "doc:<uuid>", "req:<uuid>" or
// "u:<uuid>". We parse them so the surrounding code can keep working
// unchanged. Legacy "hosp:<slug>" ids are rejected (they aren't user ids).
export function userIdFromEntity(entityId: string | null | undefined): string | null {
  if (!entityId) return null;
  const idx = entityId.indexOf(":");
  if (idx < 0) return null;
  const tail = entityId.slice(idx + 1);
  if (!/^[0-9a-f-]{36}$/i.test(tail)) return null;
  return tail;
}

/** Build a user-scoped entity id from a raw user UUID. Prefer this over the
 *  role-prefixed `doctorEntityId` / `requesterEntityId` helpers in new code. */
export function userEntityId(userId: string | null | undefined): string | null {
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return "u:" + userId;
}
