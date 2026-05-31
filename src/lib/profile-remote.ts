import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/role";

export type ProfileRow = {
  id: string;
  role: string | null;
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  mdcn: string | null;
  license_name: string | null;
  years_experience: string | null;
  bank_name: string | null;
  bank_account: string | null;
  selfie_url: string | null;
  onboarded_at: string | null;
};

/** Fetch the current user's profile row, or null if it doesn't exist. */
export async function fetchMyProfile(): Promise<ProfileRow | null> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    console.warn("fetchMyProfile error", error);
    return null;
  }
  return (data as ProfileRow | null) ?? null;
}

/** True if user has a profile row that has been marked onboarded. */
export async function hasCompletedOnboarding(): Promise<boolean> {
  const p = await fetchMyProfile();
  return !!p && !!p.onboarded_at;
}

/** Upsert profile fields for the current user. */
export async function upsertMyProfile(
  fields: Partial<Omit<ProfileRow, "id">> & { role?: Role | string }
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, ...fields }, { onConflict: "id" });
  if (error) throw error;
}

/** Mark the current user as onboarded for the given role. */
export async function markOnboardedRemote(role: Role, fields: Partial<Omit<ProfileRow, "id">> = {}) {
  await upsertMyProfile({ ...fields, role, onboarded_at: new Date().toISOString() });
}
