import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/role";
import { ensureAuthReady, subscribeAuthState } from "@/lib/auth-ready";

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
  bank_account_name: string | null;
  selfie_url: string | null;
  onboarded_at: string | null;
  onboarded_cover_at: string | null;
  onboarded_request_at: string | null;
  verification_status: VerificationStatus;
  last_seen_at: string | null;
  location: string | null;
  verification_receipt_url: string | null;
  created_at?: string;
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
let cachedProfileIsPersistedSeed = false;
const cachedOnboarding: Partial<Record<Role, boolean>> = {};

// ---- localStorage persistence ----
// Onboarding + verification status are hydrated synchronously on module
// load so AppShell does not blank the screen while waiting for the
// network round-trip after a fresh login or long offline period.
const LS_KEY = "fl:profile-cache:v1";
type PersistedShape = {
  uid: string;
  cover: boolean;
  request: boolean;
  verification?: VerificationStatus | null;
  profile?: ProfileRow | null;
};

function readPersisted(): PersistedShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PersistedShape;
    if (!v || typeof v.uid !== "string") return null;
    if (v.profile && v.profile.id !== v.uid) v.profile = null;
    return v;
  } catch {
    return null;
  }
}

function writePersisted(p: ProfileRow | null) {
  if (typeof window === "undefined") return;
  try {
    if (!p) {
      persistedCache = null;
      window.localStorage.removeItem(LS_KEY);
      return;
    }
    const payload: PersistedShape = {
      uid: p.id,
      cover: !!p.onboarded_cover_at,
      request: !!p.onboarded_request_at,
      verification: p.verification_status ?? null,
      profile: {
        id: p.id,
        role: p.role,
        full_name: p.full_name,
        phone: p.phone,
        gender: p.gender,
        mdcn: null,
        license_name: null,
        years_experience: null,
        bank_name: null,
        bank_account: null,
        bank_account_name: null,
        selfie_url: null,
        onboarded_at: p.onboarded_at,
        onboarded_cover_at: p.onboarded_cover_at,
        onboarded_request_at: p.onboarded_request_at,
        verification_status: p.verification_status,
        last_seen_at: p.last_seen_at,
        location: null,
        verification_receipt_url: null,
        created_at: p.created_at,
      },
    };
    persistedCache = payload;
    window.localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

// Hydrate synchronously so getCachedOnboardingStatus / getCachedVerification
// return the last known value on the very first render after a reload.
let persistedCache = readPersisted();
if (persistedCache) {
  cachedOnboarding.cover = persistedCache.cover;
  cachedOnboarding.request = persistedCache.request;
  if (persistedCache.profile) {
    cachedProfile = persistedCache.profile;
    cachedProfileIsPersistedSeed = true;
  }
}

export function getCachedOnboardingStatus(role: Role): boolean | null {
  return typeof cachedOnboarding[role] === "boolean" ? cachedOnboarding[role]! : null;
}

export function getCachedVerificationStatus(): VerificationStatus | null {
  if (cachedProfile && cachedProfile.verification_status) return cachedProfile.verification_status;
  return persistedCache?.verification ?? null;
}

export function getCachedProfileUserId(): string | null {
  return cachedProfile?.id ?? persistedCache?.uid ?? null;
}

function rememberProfile(profile: ProfileRow | null) {
  cachedProfile = profile;
  cachedProfileIsPersistedSeed = false;
  if (profile) {
    cachedOnboarding.cover = !!profile.onboarded_cover_at;
    cachedOnboarding.request = !!profile.onboarded_request_at;
  }
  writePersisted(profile);
}

if (typeof window !== "undefined") {
  subscribeAuthState(({ event, session }) => {
    if (!session && event === "SIGNED_OUT") {
      cachedProfile = undefined;
      cachedProfileIsPersistedSeed = false;
      cachedOnboarding.cover = undefined;
      cachedOnboarding.request = undefined;
      writePersisted(null);
      if (profileChannel) {
        supabase.removeChannel(profileChannel);
        profileChannel = null;
        profileChannelUserId = null;
      }
      profileListeners.forEach((l) => l(null));
      return;
    }
    if (!session) return;
    if (persistedCache && persistedCache.uid !== session.user.id) {
      cachedProfile = undefined;
      cachedProfileIsPersistedSeed = false;
      cachedOnboarding.cover = undefined;
      cachedOnboarding.request = undefined;
      writePersisted(null);
      profileListeners.forEach((l) => l(null));
      return;
    }
    // Different user signed in → drop in-memory cache but DO NOT blank
    // persisted cache until we know the new profile (avoids a needless
    // white screen during the brief moment between sign-in events).
    if (cachedProfile && cachedProfile.id !== session.user.id) {
      cachedProfile = undefined;
      cachedProfileIsPersistedSeed = false;
      cachedOnboarding.cover = undefined;
      cachedOnboarding.request = undefined;
      if (profileChannel) {
        supabase.removeChannel(profileChannel);
        profileChannel = null;
        profileChannelUserId = null;
      }
      profileListeners.forEach((l) => l(null));
    }
  });
}

/** Fetch the current user's profile row, or null if it doesn't exist. */
export async function fetchMyProfile(): Promise<ProfileRow | null> {
  const auth = await ensureAuthReady();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user ?? auth.user;
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
  if (profile && !profile.full_name) {
    const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string };
    const fullName = meta.full_name || meta.name || null;
    if (fullName) {
      profile.full_name = fullName;
      void supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
    }
  }
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
  fields: Partial<Omit<ProfileRow, "id">> & { role?: Role | string },
): Promise<void> {
  const auth = await ensureAuthReady();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user ?? auth.user;
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
  const [loading, setLoading] = useState(
    cachedProfile === undefined || cachedProfileIsPersistedSeed,
  );

  useEffect(() => {
    let cancelled = false;
    profileListeners.add(setProfile);
    (async () => {
      if (cachedProfile === undefined || cachedProfileIsPersistedSeed) {
        const p = await fetchMyProfile();
        if (cancelled) return;
        setProfile(p);
        setLoading(false);
      } else {
        setLoading(false);
      }
      const auth = await ensureAuthReady();
      if (!cancelled && auth.userId) ensureProfileChannel(auth.userId);
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
  const verificationReset =
    role === "cover" ? { verification_status: "pending" as VerificationStatus } : {};
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

/** Fetch a doctor's profile by user id. Requesters get only safe display
 *  fields via a SECURITY DEFINER RPC scoped to assignments they own; the
 *  doctor themself and admins read full rows directly via RLS. */
export async function fetchDoctorProfile(id: string): Promise<ProfileRow | null> {
  if (!id) return null;
  const { data: direct } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (direct) return direct as ProfileRow;
  // Fall back to the requester-safe RPC (returns only display fields).
  const { data, error } = await supabase.rpc("get_assigned_doctor_profile", { _doctor: id });
  if (error) {
    console.warn("fetchDoctorProfile error", error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ProfileRow | undefined) ?? null;
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

/* ---------- Admin dashboard ---------- */

export async function fetchAdminOverview(): Promise<AdminOverviewStats | null> {
  const { data, error } = await supabase.rpc("admin_overview_stats");
  if (error) {
    console.warn("fetchAdminOverview error", error);
    return null;
  }
  return (data as unknown as AdminOverviewStats) ?? null;
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_list_users");
  if (error) {
    console.warn("fetchAdminUsers error", error);
    return [];
  }
  return (data as unknown as AdminUserRow[]) ?? [];
}

/* ---------- Heartbeat ---------- */

let lastTouchAt = 0;
export async function touchLastSeen(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastTouchAt < 60_000) return;
  lastTouchAt = now;
  const { error } = await supabase.rpc("touch_last_seen");
  if (error) {
    lastTouchAt = 0;
    console.warn("touchLastSeen error", error);
  }
}
