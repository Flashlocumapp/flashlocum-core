import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/role";

export type VerificationStatus = "pending" | "approved" | "suspended" | "rejected";

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
  onboarded_cover_at: string | null;
  onboarded_request_at: string | null;
  verification_status: VerificationStatus;
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

/** True if user has completed onboarding for the given capability. */
export async function hasCompletedOnboarding(role: Role): Promise<boolean> {
  const p = await fetchMyProfile();
  if (!p) return false;
  return role === "cover" ? !!p.onboarded_cover_at : !!p.onboarded_request_at;
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

/** Mark the current user as onboarded for the given capability.
 *  Capabilities track independently — completing one does NOT auto-complete the other. */
export async function markOnboardedRemote(
  role: Role,
  fields: Partial<Omit<ProfileRow, "id">> = {},
) {
  const stamp = new Date().toISOString();
  const capabilityStamp =
    role === "cover" ? { onboarded_cover_at: stamp } : { onboarded_request_at: stamp };
  const verificationReset = role === "cover" ? { verification_status: "pending" as VerificationStatus } : {};
  await upsertMyProfile({
    ...fields,
    role,
    ...verificationReset,
    ...capabilityStamp,
    onboarded_at: stamp,
  });
}

/* ---------- Verification ---------- */

export async function fetchVerificationStatus(): Promise<VerificationStatus> {
  const p = await fetchMyProfile();
  return p?.verification_status ?? "pending";
}

/** Fetch a specific doctor's profile by user id. RLS must allow the caller
 *  (admin, the doctor themself, or a requester whose request they accepted). */
export async function fetchDoctorProfile(id: string): Promise<ProfileRow | null> {
  if (!id) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("fetchDoctorProfile error", error);
    return null;
  }
  return (data as ProfileRow | null) ?? null;
}

/* ---------- Admin ---------- */

export async function isCurrentUserAdmin(): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return false;
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (error) return false;
  return !!data;
}

export async function claimFirstAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_first_admin");
  if (error) throw error;
  return !!data;
}

export async function listDoctors(): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .not("onboarded_cover_at", "is", null)
    .order("onboarded_cover_at", { ascending: false });
  if (error) throw error;
  return (data as ProfileRow[]) ?? [];
}

export async function updateDoctorVerification(
  doctorId: string,
  status: VerificationStatus,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ verification_status: status })
    .eq("id", doctorId)
    .select("id")
    .single();
  if (error) throw error;
}
