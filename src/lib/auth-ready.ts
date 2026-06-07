import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AuthReadySnapshot = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  userId: string | null;
  event: string | null;
};

const emptySnapshot: AuthReadySnapshot = {
  ready: typeof window === "undefined",
  session: null,
  user: null,
  userId: null,
  event: null,
};

let snapshot: AuthReadySnapshot = emptySnapshot;
let hydration: Promise<AuthReadySnapshot> | null = null;
let subscribed = false;
const listeners = new Set<(snapshot: AuthReadySnapshot) => void>();

function notify() {
  listeners.forEach((listener) => listener(snapshot));
}

function applySession(session: Session | null, event: string, ready = true) {
  snapshot = {
    ready,
    session,
    user: session?.user ?? null,
    userId: session?.user?.id ?? null,
    event,
  };
  notify();
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
      };
      return;
    }
    applySession(session, event, true);
  });
}

export function getAuthSnapshot(): AuthReadySnapshot {
  return snapshot;
}

export function ensureAuthReady(): Promise<AuthReadySnapshot> {
  if (typeof window === "undefined") return Promise.resolve(snapshot);
  ensureSubscribed();
  if (snapshot.ready && snapshot.session) return Promise.resolve(snapshot);
  if (hydration) return hydration;

  hydration = supabase.auth
    .getSession()
    .then(({ data }) => {
      applySession(data.session ?? null, "HYDRATED", true);
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