// FlashLocum reliability — server-backed dependability signal.
//
// Source of truth: public.coverage_requests (via get_reliability RPC).
// Rules:
// - Defaults to 100% until VERIFY_THRESHOLD accepted shifts.
// - Formula: completed ÷ total accepted shifts × 100.
// - Only cancellations AFTER acceptance count against (enforced by RPC).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { subscribeNetwork, type NetState } from "./network";

const VERIFY_THRESHOLD = 10;
const TTL_MS = 30_000;

export type ReliabilityView = {
  score: number;
  display: string;
  provisional: boolean;
};

type CacheEntry = { completed: number; total: number; ts: number };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();
const listeners = new Map<string, Set<() => void>>();

function notify(entityId: string) {
  listeners.get(entityId)?.forEach((l) => l());
}

async function fetchReliability(entityId: string): Promise<CacheEntry> {
  const existing = inflight.get(entityId);
  if (existing) return existing;
  const p = (async () => {
    const { data, error } = await supabase.rpc("get_reliability", { _entity_id: entityId });
    if (error || !data || (Array.isArray(data) && data.length === 0)) {
      return { completed: 0, total: 0, ts: Date.now() };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return {
      completed: Number(row.completed) || 0,
      total: Number(row.total) || 0,
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

export function getReliability(entityId: string): ReliabilityView {
  const c = cache.get(entityId);
  if (!c || c.total < VERIFY_THRESHOLD) {
    return { score: 100, display: "100%", provisional: true };
  }
  const pct = Math.max(0, Math.min(100, Math.round((c.completed / c.total) * 100)));
  return { score: pct, display: `${pct}%`, provisional: false };
}

export function useReliability(entityId: string | null | undefined): ReliabilityView {
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
      fetchReliability(entityId);
    }
    return () => {
      set!.delete(l);
    };
  }, [entityId]);
  if (!entityId) return { score: 100, display: "100%", provisional: true };
  return getReliability(entityId);
}

// Invalidate caches whenever a relevant shift event occurs, so reliability
// reflects the latest server state without manual refresh.
let bootstrapped = false;
function bootstrap() {
  if (bootstrapped || typeof window === "undefined") return;
  bootstrapped = true;
  subscribeNetwork((s: NetState) => {
    const ev = s.lastEvent;
    if (!ev || (ev.action !== "accept" && ev.action !== "complete" && ev.action !== "cancel")) return;
    // Refresh all cached entries — keeps the impl simple and entries are tiny.
    for (const key of Array.from(cache.keys())) {
      cache.delete(key);
      fetchReliability(key);
    }
  });
}
bootstrap();
