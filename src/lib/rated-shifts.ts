// Tiny shared "shifts I have already rated" store.
//
// The requester's history detail re-shows the rating form when the local
// CoverageScreen state has no entry for a shift, even though the user may
// have rated via the post-End-Shift RatingOverlay (or in a previous
// session). This store unifies that signal across the app and survives
// refreshes within a tab.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "flashlocum.ratedShifts.v1";

const rated = new Set<string>(loadFromStorage());
const listeners = new Set<() => void>();
let hydrated = false;

function loadFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(rated)));
  } catch {
    /* ignore */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function markRated(shiftId: string | null | undefined) {
  if (!shiftId) return;
  if (rated.has(shiftId)) return;
  rated.add(shiftId);
  persist();
  emit();
}

export function isRated(shiftId: string | null | undefined): boolean {
  if (!shiftId) return false;
  return rated.has(shiftId);
}

export function subscribeRatedShifts(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** One-shot hydration from the `ratings` table for the current user. */
export async function hydrateRatedShifts(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData.user?.id;
    if (!uid) {
      hydrated = false; // allow retry once signed in
      return;
    }
    const { data, error } = await supabase
      .from("ratings")
      .select("shift_id")
      .eq("rater_user_id", uid)
      .not("shift_id", "is", null);
    if (error || !data) return;
    let changed = false;
    for (const row of data) {
      const sid = (row as { shift_id: string | null }).shift_id;
      if (sid && !rated.has(sid)) {
        rated.add(sid);
        changed = true;
      }
    }
    if (changed) {
      persist();
      emit();
    }
  } catch {
    /* ignore — best-effort hydration */
  }
}

/** Hook that returns a version counter — re-renders on any change. */
export function useRatedShiftsVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    void hydrateRatedShifts();
    return subscribeRatedShifts(() => setV((x) => x + 1));
  }, []);
  return v;
}
