import { useEffect, useState } from "react";
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
  last_seen_at: string | null;
  location: string | null;
  verification_receipt_url: string | null;
  created_at?: string | null;
};

export type AdminOverviewStats = {
  total_users: number;
  request_users: number;
  cover_users: number;
  verified_doctors: number;
  pending_doctors: number;
  rejected_doctors: number;
  suspended_doctors: number;
  online_doctors: number;
  coverage_in_progress: number;
  coverage_upcoming: number;
  coverage_completed: number;
  coverage_cancelled: number;
  active_today: number;
  active_week: number;
};

export type AdminUserRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  location: string | null;
  verification_status: VerificationStatus;
  created_at: string | null;
  last_seen_at: string | null;
  onboarded_request_at: string | null;
  onboarded_cover_at: string | null;
};

let cachedProfile: ProfileRow | null | undefined;
const cachedOnboarding: Partial<Record<Role, boolean>> = {};

export function getCachedOnboardingStatus(role: Role): boolean | null {
  return typeof cachedOnboarding[role] === "boolean" ? cachedOnboarding[role]! : null;
}

function rememberProfile(profile: ProfileRow | null) {
  cachedProfile = profile;
  if (profile) {
    cachedOnboarding.cover = !!profile.onboarded_cover_at;
    cachedOnboarding.request = !!profile.onboarded_request_at;
  }
}

if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session || (cachedProfile && cachedProfile.id !== session.user.id)) {
      cachedProfile = undefined;
      cachedOnboarding.cover = undefined;
      cachedOnboarding.request = undefined;
      if (profileChannel) {
        supabase.removeChannel(profileChannel);
        profileChannel = null;
        profileChannelUserId = null;
      }
      // Notify subscribers so the UI clears stale data on sign out.
      profileListeners.forEach((l) => l(null));
    }
  });
}

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
    if (cachedProfile !== undefined) return cachedProfile;
    return null;
  }
  const profile = (data as ProfileRow | null) ?? null;
  rememberProfile(profile);
  return profile;
}

/** True if user has completed onboarding for the given capability. */
export async function hasCompletedOnboarding(role: Role): Promise<boolean> {
  const p = await fetchMyProfile();
  if (!p) return false;
  return role === "cover" ? !!p.onboarded_cover_at : !!p.onboarded_request_at;
}

/** True if the user has finished onboarding for AT LEAST one capability.
 *  Account-wide onboarding is considered complete as soon as either role
 *  has been onboarded — switching to a new role for the first time is the
 *  separate "role-switch onboarding" flow. */
export function isAccountOnboardedProfile(p: ProfileRow | null): boolean {
  return !!p && (!!p.onboarded_cover_at || !!p.onboarded_request_at);
}

/** Returns a role the user has completed onboarding for, preferring the
 *  requested role when valid. Returns null if no role is onboarded. */
export function effectiveOnboardedRole(p: ProfileRow | null, requested: Role): Role | null {
  if (!p) return null;
  if (requested === "cover" && p.onboarded_cover_at) return "cover";
  if (requested === "request" && p.onboarded_request_at) return "request";
  if (p.onboarded_request_at) return "request";
  if (p.onboarded_cover_at) return "cover";
  return null;
}

export function getCachedProfile(): ProfileRow | null | undefined {
  return cachedProfile;
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
  // Update cache + notify subscribers immediately so the UI reflects the
  // new source of truth without waiting for the network round-trip.
  if (cachedProfile && cachedProfile.id === user.id) {
    rememberProfile({ ...cachedProfile, ...(fields as Partial<ProfileRow>) });
    notifyProfile();
  } else {
    // Force next subscriber read to refetch.
    void fetchMyProfile().then(notifyProfile);
  }
}

/* ---------- Live profile subscription ---------- */

const profileListeners = new Set<(p: ProfileRow | null) => void>();
function notifyProfile() {
  profileListeners.forEach((l) => l(cachedProfile ?? null));
}

let profileChannelUserId: string | null = null;
let profileChannel: ReturnType<typeof supabase.channel> | null = null;

function ensureProfileChannel(userId: string) {
  if (profileChannelUserId === userId && profileChannel) return;
  if (profileChannel) {
    supabase.removeChannel(profileChannel);
    profileChannel = null;
  }
  profileChannelUserId = userId;
  profileChannel = supabase
    .channel(`profile-${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      (payload) => {
        const next = (payload.new as ProfileRow | null) ?? null;
        rememberProfile(next);
        notifyProfile();
      },
    )
    .subscribe();
}

/** React hook returning the current user's backend profile, with realtime
 *  updates. Returns the cached value synchronously to avoid flicker. */
export function useMyProfile(): {
  profile: ProfileRow | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [profile, setProfile] = useState<ProfileRow | null>(cachedProfile ?? null);
  const [loading, setLoading] = useState(cachedProfile === undefined);

  useEffect(() => {
    let cancelled = false;
    profileListeners.add(setProfile);
    (async () => {
      if (cachedProfile === undefined) {
        const p = await fetchMyProfile();
        if (cancelled) return;
        setProfile(p);
        setLoading(false);
      } else {
        setLoading(false);
      }
      const { data } = await supabase.auth.getUser();
      if (!cancelled && data.user) ensureProfileChannel(data.user.id);
    })();
    return () => {
      cancelled = true;
      profileListeners.delete(setProfile);
    };
  }, []);

  return {
    profile,
    loading,
    refresh: async () => {
      const p = await fetchMyProfile();
      notifyProfile();
      setProfile(p);
    },
  };
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
  cachedOnboarding[role] = true;
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
