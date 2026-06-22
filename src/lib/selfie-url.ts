// Module-level signed-URL cache for selfies stored in the private "doctors"
// bucket. Shared by every surface that renders a self-uploaded photo
// (Account, Coverage cards, History, RequesterHome doctor cards, etc.).
//
// Why this exists: a per-component useEffect signer re-signed on every fresh
// mount and started at null, producing a brief initials flash on cold start.
// This cache stores the signed URL in memory for the rest of the session
// keyed by storage path, so the second (and every subsequent) consumer gets
// the URL synchronously.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Entry = { url: string | null; ts: number };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Map<string, Set<(v: string | null) => void>>();

// Signed URLs expire after 1h; refresh proactively at 50 min.
const TTL_MS = 50 * 60 * 1000;

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
    cache.set(path, { url, ts: Date.now() });
    notify(path, url);
    return url;
  })().finally(() => {
    inflight.delete(path);
  });
  inflight.set(path, p);
  return p;
}

/** Returns a signed URL synchronously when cached; otherwise null until ready. */
export function getSelfieUrl(pathOrUrl: string | null | undefined): string | null {
  if (!pathOrUrl) return null;
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) return pathOrUrl;
  const hit = cache.get(pathOrUrl);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.url;
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
    if (hit && Date.now() - hit.ts < TTL_MS) {
      setUrl(hit.url);
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
