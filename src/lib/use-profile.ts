import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/use-auth";

export type VerificationStatus = "pending" | "approved" | "suspended" | "rejected";

export type Profile = {
  id: string;
  role: string | null;
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  mdcn: string | null;
  license_name: string | null;
  bank_name: string | null;
  bank_account: string | null;
  selfie_url: string | null;
  verification_status: VerificationStatus;
  onboarded_at: string | null;
  onboarded_request_at: string | null;
  onboarded_cover_at: string | null;
};

export type RoleId = "request" | "cover";

/** Backend-driven gate: true iff onboarding for the given role is fully
 *  complete. This is the single source of truth for the app shell. */
export function isRoleOnboarded(role: RoleId, profile: Profile | null): boolean {
  if (!profile) return false;
  if (role === "request") {
    return !!profile.onboarded_request_at && !!profile.phone && !!profile.gender;
  }
  return (
    !!profile.onboarded_cover_at &&
    !!profile.phone &&
    !!profile.gender &&
    !!profile.mdcn &&
    !!profile.license_name &&
    !!profile.bank_name &&
    !!profile.bank_account
  );
}

export type ProfileState = {
  profile: Profile | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useProfile(): ProfileState {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    setProfile((data as Profile | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    load();
    if (!user) return;
    // Realtime: admin approve/suspend/reject reflects immediately.
    const channel = supabase
      .channel(`profile:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        (payload) => {
          if (payload.new) setProfile(payload.new as Profile);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { profile, loading, refresh: load };
}

export async function upsertProfileFields(
  userId: string,
  fields: Partial<Omit<Profile, "id" | "verification_status">>,
) {
  // Upsert so users created before the auto-profile trigger existed
  // still get a row, while existing rows are simply updated.
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, ...fields }, { onConflict: "id" });
  if (error) throw error;
}

export async function useHasAdminRole(): Promise<boolean> {
  // Simple async check (not a hook) — kept here for proximity.
  const { data } = await supabase.auth.getUser();
  if (!data.user) return false;
  const { data: rows } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .limit(1);
  return !!rows && rows.length > 0;
}
