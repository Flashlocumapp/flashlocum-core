// Signed-URL cache for selfies stored in the private "doctors" bucket.
//
// Persisted to localStorage so cold starts (refresh, tab restore, native app
// resume) can re-hydrate the URL synchronously instead of waiting for the
// signed-URL round-trip — which is what caused profile photos to flash a
// loading state on every cold render.
//
// Stale-while-revalidate: if the cached URL is still valid we return it
// immediately and only re-sign in the background when it is within 5 min of
// expiry (or we could not read an expiry from the URL).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Entry = { url: string | null; ts: number; expAt: number };

const TTL_MS = 60 * 60 * 1000; // 1h server-side signature TTL
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const LS_KEY = "fl:selfie-url:v1";

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Map<string, Set<(v: string | null) => void>>();

// ----- localStorage persistence -----

type Persisted = Record<string, { url: string; expAt: number }>;

function loadPersisted(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Persisted;
    const now = Date.now();
    for (const [path, v] of Object.entries(parsed ?? {})) {
      if (!v || typeof v.url !== "string" || typeof v.expAt !== "number") continue;
      if (v.expAt <= now) continue;
      cache.set(path, { url: v.url, ts: now, expAt: v.expAt });
    }
  } catch {
    /* ignore */
  }
}

let persistScheduled = false;
function schedulePersist() {
  if (persistScheduled || typeof window === "undefined") return;
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    try {
      const out: Persisted = {};
      const now = Date.now();
      for (const [path, e] of cache.entries()) {
        if (!e.url || e.expAt <= now) continue;
        out[path] = { url: e.url, expAt: e.expAt };
      }
      window.localStorage.setItem(LS_KEY, JSON.stringify(out));
    } catch {
      /* quota / privacy mode — ignore */
    }
  }, 250);
}

loadPersisted();

// ----- signing -----

/** Best-effort parse of the `exp` claim from a Supabase signed URL token. */
function parseExpFromUrl(url: string): number {
  try {
    const u = new URL(url);
    const token = u.searchParams.get("token");
    if (!token) return Date.now() + TTL_MS;
    const payload = token.split(".")[1];
    if (!payload) return Date.now() + TTL_MS;
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const json = JSON.parse(decoded) as { exp?: number };
    if (typeof json.exp === "number") return json.exp * 1000;
  } catch {
    /* fall through */
  }
  return Date.now() + TTL_MS;
}

function notify(path: string, url: string | null) {
  listeners.get(path)?.forEach((l) => {
    try {
      l(url);
    } catch {
      /* noop */
    }
  });
}

async function sign(path: string): Promise<string | null> {
  if (inflight.has(path)) return inflight.get(path)!;
  const p = (async () => {
    const { data, error } = await supabase.storage
      .from("doctors")
      .createSignedUrl(path, 60 * 60);
    const url = error || !data?.signedUrl ? null : data.signedUrl;
    const expAt = url ? parseExpFromUrl(url) : Date.now() + 60_000;
    cache.set(path, { url, ts: Date.now(), expAt });
    if (url) schedulePersist();
    notify(path, url);
    return url;
  })().finally(() => {
    inflight.delete(path);
  });
  inflight.set(path, p);
  return p;
}

function shouldRefresh(entry: Entry): boolean {
  return entry.expAt - Date.now() < REFRESH_WINDOW_MS;
}

/** Returns a signed URL synchronously when cached; otherwise null until ready. */
export function getSelfieUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) return pathOrUrl;
  const hit = cache.get(pathOrUrl);
  if (hit && hit.url && hit.expAt > Date.now()) {
    if (shouldRefresh(hit)) void sign(pathOrUrl); // SWR refresh
    return hit.url;
  }
  void sign(pathOrUrl);
  return null;
}

export function useSelfieUrl(pathOrUrl: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => getSelfieUrl(pathOrUrl ?? null));
  useEffect(() => {
    if (!pathOrUrl) {
      setUrl(null);
      return;
    }
    if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
      setUrl(pathOrUrl);
      return;
    }
    const hit = cache.get(pathOrUrl);
    if (hit && hit.url && hit.expAt > Date.now()) {
      setUrl(hit.url);
      if (shouldRefresh(hit)) void sign(pathOrUrl);
    } else {
      setUrl(null);
      void sign(pathOrUrl);
    }
    let set = listeners.get(pathOrUrl);
    if (!set) {
      set = new Set();
      listeners.set(pathOrUrl, set);
    }
    set.add(setUrl);
    return () => {
      set!.delete(setUrl);
      if (set!.size === 0) listeners.delete(pathOrUrl);
    };
  }, [pathOrUrl]);
  return url;
}
