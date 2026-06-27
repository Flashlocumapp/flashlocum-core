// Shared source of truth for displaying an assigned doctor's identity
// across every coverage surface (accepted card, upcoming, active, history,
// detail sheets). Everything reads the doctor's profile row by id and
// derives display values from it — no fake initials, no synthesized MDCN.

import { useEffect, useState } from "react";
import { getSelfieUrl } from "@/lib/selfie-url";
import { fetchDoctorProfile, type ProfileRow } from "@/lib/profile-remote";


export type DoctorIdentity = {
  id: string | null;
  fullName: string;       // e.g. "Dr. Emmanuel Adeleke"
  shortName: string;      // e.g. "Dr. Emmanuel A."
  initials: string;       // e.g. "EA"
  mdcn: string;           // exactly as stored, e.g. "MDCN/R/34729" — no prefix
  selfieUrl: string | null;  // resolved (signed) URL ready for <img src>
  selfiePath: string | null; // raw storage path persisted across reloads
  ratingId: string | null; // matches doctorEntityId(id)
  loaded: boolean;
};

const LS_KEY = "fl:doctor-identity-cache:v1";

function readIdentityCache(): Map<string, DoctorIdentity> {
  const out = new Map<string, DoctorIdentity>();
  if (typeof window === "undefined") return out;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return out;
    const rows = JSON.parse(raw) as DoctorIdentity[];
    if (!Array.isArray(rows)) return out;
    for (const row of rows) {
      if (!row?.id || !row.loaded) continue;
      // Backfill selfiePath for entries persisted before the signed-URL split.
      const path = row.selfiePath ?? row.selfieUrl ?? null;
      const isAbsolute = !!path && /^(https?:|data:|blob:)/i.test(path);
      // Synchronously hydrate selfieUrl from the shared selfie-url cache so
      // the very first paint of every coverage card / detail sheet / history
      // row already has the photo — no flash from initials → image. If the
      // shared cache is cold, getSelfieUrl kicks off signing in the background
      // and resolveSelfie() will patch the entry when ready.
      const cachedSigned = path && !isAbsolute ? getSelfieUrl(path) : null;
      out.set(row.id, {
        ...row,
        selfiePath: path,
        selfieUrl: isAbsolute ? path : cachedSigned,
      });
    }
  } catch {
    /* ignore malformed / privacy-mode storage */
  }
  return out;
}


function writeIdentityCache() {
  if (typeof window === "undefined") return;
  try {
    // Persist storage paths only — signed URLs expire (~1h) and would be
    // stale on the next reload. Live entries strip the signed URL before
    // serialisation; resolveSelfie() re-signs on hydrate.
    const rows = Array.from(cache.values())
      .filter((row) => row.loaded)
      .slice(-60)
      .map((row) => ({
        ...row,
        selfieUrl: row.selfiePath ?? null,
      }));
    window.localStorage.setItem(LS_KEY, JSON.stringify(rows));
  } catch {
    /* ignore quota / privacy-mode storage */
  }
}

const cache = readIdentityCache();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

function ensureDr(name: string): string {
  const t = name.trim();
  if (!t) return "";
  return /^dr\.?\s/i.test(t) ? t : `Dr. ${t}`;
}

function stripDr(name: string): string {
  return name.replace(/^dr\.?\s*/i, "").trim();
}

function makeInitials(name: string, sessionId: string | null): string {
  const stripped = stripDr(name);
  if (stripped) {
    const ini = stripped
      .split(/\s+/)
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    if (ini) return ini;
  }
  if (sessionId) {
    const tail = sessionId.replace(/[^a-z0-9]/gi, "").slice(-2).toUpperCase();
    if (tail.length === 2) return tail;
  }
  return "DR";
}

function makeShort(full: string): string {
  const t = full.trim();
  if (!t) return "";
  const parts = stripDr(t).split(/\s+/);
  if (parts.length < 2) return ensureDr(t);
  const last = parts[parts.length - 1];
  return `Dr. ${parts.slice(0, -1).join(" ")} ${last[0]}.`;
}

function emptyIdentity(sessionId: string | null): DoctorIdentity {
  return {
    id: sessionId,
    fullName: "Loading…",
    shortName: "Loading…",
    initials: makeInitials("", sessionId),
    mdcn: "—",
    selfieUrl: null,
    selfiePath: null,
    ratingId: sessionId ? `doc:${sessionId}` : null,
    loaded: false,
  };
}

function identityFromProfile(p: ProfileRow): DoctorIdentity {
  const full = ensureDr(p.full_name ?? "");
  const path = p.selfie_url ?? null;
  // If selfie_url is already an absolute URL (legacy rows), use it as-is;
  // otherwise it's a storage path that needs signing — resolveSelfie() does
  // that asynchronously and patches the cache entry.
  const isAbsolute = !!path && /^(https?:|data:|blob:)/i.test(path);
  return {
    id: p.id,
    fullName: full || "Doctor",
    shortName: makeShort(full || "Doctor"),
    initials: makeInitials(p.full_name ?? "", p.id),
    mdcn: p.mdcn?.trim() ? p.mdcn.trim() : "—",
    selfieUrl: isAbsolute ? path : null,
    selfiePath: path,
    ratingId: `doc:${p.id}`,
    loaded: true,
  };
}

function notify() {
  listeners.forEach((l) => l());
}

// Sign storage paths via Supabase Storage so requester clients (and the
// doctor on their own device) can render the avatar. The bucket is private;
// RLS on storage.objects gates which selfies a caller can sign.
const signedSelfieInflight = new Map<string, Promise<void>>();
async function resolveSelfie(sessionId: string, path: string) {
  if (signedSelfieInflight.has(sessionId)) return signedSelfieInflight.get(sessionId);
  const p = (async () => {
    const { data, error } = await supabase.storage
      .from("doctors")
      .createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) return;
    const cur = cache.get(sessionId);
    if (!cur) return;
    cache.set(sessionId, { ...cur, selfieUrl: data.signedUrl });
    notify();
  })().finally(() => {
    signedSelfieInflight.delete(sessionId);
  });
  signedSelfieInflight.set(sessionId, p);
  return p;
}

function maybeResolveSelfie(sessionId: string) {
  const cur = cache.get(sessionId);
  if (!cur || !cur.loaded) return;
  if (cur.selfieUrl) return;
  if (!cur.selfiePath) return;
  if (/^(https?:|data:|blob:)/i.test(cur.selfiePath)) return;
  void resolveSelfie(sessionId, cur.selfiePath);
}

function loadInto(sessionId: string) {
  // If a stale cache entry exists with a path but no signed URL, kick off
  // signing on every load so reloads recover from expired URLs.
  maybeResolveSelfie(sessionId);
  if (cache.has(sessionId) && cache.get(sessionId)!.loaded) return;
  if (inflight.has(sessionId)) return;
  const p = fetchDoctorProfile(sessionId)
    .then((row) => {
      if (row) {
        cache.set(sessionId, identityFromProfile(row));
        writeIdentityCache();
        notify();
        maybeResolveSelfie(sessionId);
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight.delete(sessionId);
    });
  inflight.set(sessionId, p);
}

export function getDoctorIdentity(sessionId: string | null | undefined): DoctorIdentity {
  if (!sessionId) return emptyIdentity(null);
  const hit = cache.get(sessionId);
  if (hit) return hit;
  const placeholder = emptyIdentity(sessionId);
  cache.set(sessionId, placeholder);
  loadInto(sessionId);
  return placeholder;
}

export function useDoctorIdentity(sessionId: string | null | undefined): DoctorIdentity {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    if (sessionId) loadInto(sessionId);
    return () => {
      listeners.delete(l);
    };
  }, [sessionId]);
  return getDoctorIdentity(sessionId);
}
