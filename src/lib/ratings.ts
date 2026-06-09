// FlashLocum ratings — server-backed trust signal.
//
// Source of truth: public.ratings table in Supabase.
// Rules:
// - Every newly seen participant displays 5.0 until they accumulate ratings.
// - After VERIFY_THRESHOLD ratings, the real average replaces the default.
// - We never expose counts to the UI.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const VERIFY_THRESHOLD = 10;

export type RatingRole = "doctor" | "requester";

export type RatingView = {
  score: number;
  verified: boolean;
};

type CacheEntry = { score: number; count: number; ts: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
const listeners = new Map<string, Set<() => void>>();
const TTL_MS = 30_000;

function notify(entityId: string) {
  listeners.get(entityId)?.forEach((l) => l());
}

async function fetchRating(entityId: string): Promise<CacheEntry> {
  const existing = inflight.get(entityId);
  if (existing) return existing;
  const p = (async () => {
    const { data, error } = await supabase.rpc("get_rating", { _entity_id: entityId });
    if (error || !data || (Array.isArray(data) && data.length === 0)) {
      return { score: 0, count: 0, ts: Date.now() };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      score: Number(row.score) || 0,
      count: Number(row.count) || 0,
      ts: Date.now(),
    };
  })().then((entry) => {
    cache.set(entityId, entry);
    inflight.delete(entityId);
    notify(entityId);
    return entry;
  });
  inflight.set(entityId, p);
  return p;
}

export function getRating(entityId: string): RatingView {
  const c = cache.get(entityId);
  if (!c || c.count < VERIFY_THRESHOLD) return { score: 5.0, verified: true };
  return { score: round1(c.score), verified: false };
}

export async function recordRating(
  entityId: string,
  value: number,
  shiftId?: string | null,
) {
  if (!entityId || value < 1 || value > 5) return;
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return;
  const { error } = await supabase.from("ratings").insert({
    ratee_entity_id: entityId,
    rater_user_id: uid,
    shift_id: shiftId ?? null,
    score: Math.round(value),
  });
  if (error) {
    console.warn("[ratings] insert failed", error);
    return;
  }
  cache.delete(entityId);
  await fetchRating(entityId);
}

export function useRating(entityId: string | null | undefined): RatingView {
  const [, force] = useState(0);
  useEffect(() => {
    if (!entityId) return;
    let set = listeners.get(entityId);
    if (!set) {
      set = new Set();
      listeners.set(entityId, set);
    }
    const l = () => force((x) => x + 1);
    set.add(l);
    const c = cache.get(entityId);
    if (!c || Date.now() - c.ts > TTL_MS) {
      fetchRating(entityId);
    }
    return () => {
      set!.delete(l);
    };
  }, [entityId]);
  if (!entityId) return { score: 5.0, verified: true };
  return getRating(entityId);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function verifiedLabel(role: RatingRole): string {
  void role;
  return "";
}
