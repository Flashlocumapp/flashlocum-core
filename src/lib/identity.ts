import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ensureAuthReady, subscribeAuthState } from "@/lib/auth-ready";

export type AuthIdentity = { name: string; email: string };

// Module-level cache so tab switches do not flicker the user's name/email
// while supabase.auth.getUser() resolves again.
const LS_KEY = "fl:auth-identity-cache:v1";

function readCached(): AuthIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthIdentity;
    if (typeof parsed?.name !== "string" || typeof parsed?.email !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

let cached: AuthIdentity | null = readCached();
const listeners = new Set<(v: AuthIdentity) => void>();
function setCached(next: AuthIdentity) {
  cached = next;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage errors */
  }
  listeners.forEach((l) => l(next));
}

async function refresh() {
  const auth = await ensureAuthReady();
  if (!auth.user) return;
  const { data } = await supabase.auth.getUser();
  const u = data.user ?? auth.user;
  if (!u) return;
  const meta = (u.user_metadata ?? {}) as { full_name?: string; name?: string };
  setCached({ name: meta.full_name || meta.name || "", email: u.email ?? "" });
}

if (typeof window !== "undefined") {
  subscribeAuthState(({ event, session }) => {
    if (!session && event === "SIGNED_OUT") {
      cached = null;
      window.localStorage.removeItem(LS_KEY);
      return;
    }
    if (session) refresh();
  });
}

export function useAuthIdentity(): AuthIdentity {
  const [id, setId] = useState<AuthIdentity>(cached ?? { name: "", email: "" });
  useEffect(() => {
    listeners.add(setId);
    if (!cached) refresh();
    return () => {
      listeners.delete(setId);
    };
  }, []);
  return id;
}
