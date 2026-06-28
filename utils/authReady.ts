import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type AuthReadySnapshot = {
  ready: boolean;
  session: Session | null;
  user: User | null;
  userId: string | null;
};

export async function ensureAuthReady(): Promise<AuthReadySnapshot> {
  const { data } = await supabase.auth.getSession();
  const session = data.session ?? null;
  if (!session) return { ready: true, session: null, user: null, userId: null };
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user ?? null;
  return { ready: true, session, user, userId: user?.id ?? null };
}

// No-op on mobile — supabase client handles session storage automatically
export function adoptVerifiedSession(_session: Session | null) {
  // intentional no-op
}

export function subscribeAuthState(
  listener: (snap: { event: string; session: Session | null }) => void,
): () => void {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    listener({ event, session });
  });
  return () => data.subscription.unsubscribe();
}
