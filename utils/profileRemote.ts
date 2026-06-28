import { supabase } from "./supabase";
import { ensureAuthReady } from "./authReady";

export type ProfileRow = {
  id: string;
  full_name: string | null;
  onboarded_cover_at: string | null;
  onboarded_request_at: string | null;
  verification_status: string | null;
};

export async function fetchMyProfile(): Promise<ProfileRow | null> {
  console.log("[FlashLocum] fetchMyProfile: fetching profile");
  const auth = await ensureAuthReady();
  if (!auth.user) {
    console.log("[FlashLocum] fetchMyProfile: no authenticated user");
    return null;
  }
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, onboarded_cover_at, onboarded_request_at, verification_status")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error) {
    console.warn("[FlashLocum] fetchMyProfile error:", error.message);
    return null;
  }
  console.log("[FlashLocum] fetchMyProfile: success", { userId: auth.user.id });
  return data as ProfileRow | null;
}
