import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AuthIdentity = { name: string; email: string };

// Module-level cache so tab switches do not flicker the user's name/email
// while supabase.auth.getUser() resolves again.
let cached: AuthIdentity | null = null;
const listeners = new Set<(v: AuthIdentity) => void>();
function setCached(next: AuthIdentity) {
  cached = next;
  listeners.forEach((l) => l(next));
}

async function refresh() {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  if (!u) return;
  const meta = (u.user_metadata ?? {}) as { full_name?: string; name?: string };
  setCached({ name: meta.full_name || meta.name || "", email: u.email ?? "" });
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_e, session) => {
    if (!session) {
      cached = null;
      return;
    }
    refresh();
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
