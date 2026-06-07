import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AuthReadySnapshot = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  userId: string | null;
  event: string | null;
  verifiedAt: number | null;
};

const emptySnapshot: AuthReadySnapshot = {
  ready: typeof window === "undefined",
  session: null,
  user: null,
  userId: null,
  event: null,
  verifiedAt: null,
};

let snapshot: AuthReadySnapshot = emptySnapshot;
let hydration: Promise<AuthReadySnapshot> | null = null;
let subscribed = false;
const listeners = new Set<(snapshot: AuthReadySnapshot) => void>();
const VALIDATION_TTL_MS = 30_000;

function notify() {
  listeners.forEach((listener) => listener(snapshot));
}

function applySession(session: Session | null, event: string, ready = true, verifiedUser?: User | null) {
  const user = verifiedUser ?? session?.user ?? null;
  snapshot = {
    ready,
    session,
    user,
    userId: user?.id ?? null,
    event,
    verifiedAt: session && verifiedUser ? Date.now() : null,
  };
  notify();
}

async function clearInvalidLocalSession() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* local cleanup is best-effort */
  }
}

function ensureSubscribed() {
  if (typeof window === "undefined" || subscribed) return;
  subscribed = true;
  supabase.auth.onAuthStateChange((event, session) => {
    // INITIAL_SESSION can arrive while storage hydration is still in-flight.
    // The explicit getSession() below is the readiness boundary, so don't let
    // a transient null INITIAL_SESSION tell the app to render logged-out state.
    if (!snapshot.ready && event === "INITIAL_SESSION") {
      snapshot = {
        ready: false,
        session,
        user: session?.user ?? null,
        userId: session?.user?.id ?? null,
        event,
        verifiedAt: null,
      };
      return;
    }
    const trusted = event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED";
    applySession(session, event, true, trusted ? (session?.user ?? null) : undefined);
  });
}

export function getAuthSnapshot(): AuthReadySnapshot {
  return snapshot;
}

export function ensureAuthReady(): Promise<AuthReadySnapshot> {
  if (typeof window === "undefined") return Promise.resolve(snapshot);
  ensureSubscribed();
  if (
    snapshot.ready &&
    snapshot.session &&
    snapshot.verifiedAt &&
    Date.now() - snapshot.verifiedAt < VALIDATION_TTL_MS
  ) {
    return Promise.resolve(snapshot);
  }
  if (hydration) return hydration;

  hydration = supabase.auth
    .getSession()
    .then(async ({ data }) => {
      const session = data.session ?? null;
      if (!session) {
        if (snapshot.session) return snapshot;
        applySession(null, "HYDRATED", true, null);
        return snapshot;
      }
      const tokenAtRead = session.access_token;
      const { data: userData, error } = await supabase.auth.getUser();
      if (snapshot.session && snapshot.session.access_token !== tokenAtRead && snapshot.verifiedAt) {
        return snapshot;
      }
      if (error || !userData.user) {
        applySession(null, "HYDRATE_INVALID", true, null);
        void clearInvalidLocalSession();
        return snapshot;
      }
      applySession(session, "HYDRATED", true, userData.user);
      return snapshot;
    })
    .catch(() => {
      applySession(null, "HYDRATE_FAILED", true);
      return snapshot;
    })
    .finally(() => {
      hydration = null;
    });

  return hydration;
}

export function subscribeAuthState(listener: (snapshot: AuthReadySnapshot) => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureSubscribed();
  listeners.add(listener);
  if (snapshot.ready) listener(snapshot);
  else void ensureAuthReady();
  return () => listeners.delete(listener);
}

export function useAuthReady(): AuthReadySnapshot {
  const [state, setState] = useState<AuthReadySnapshot>(() => snapshot);

  useEffect(() => {
    const unsubscribe = subscribeAuthState(setState);
    void ensureAuthReady().then(setState);
    return unsubscribe;
  }, []);

  return state;
}

if (typeof window !== "undefined") void ensureAuthReady();
