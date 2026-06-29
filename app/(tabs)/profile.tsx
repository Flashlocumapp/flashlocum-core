import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  ScrollView,
  TextInput,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/utils/supabase";
import { clearRole } from "@/utils/role";
import { User, Edit2, LogOut, Check, X } from "lucide-react-native";

const BG = "#0A0A0A";
const CARD = "#1C1C1E";
const PRIMARY = "#193CB8";
const TEXT = "#FFFFFF";
const SECONDARY = "#98989D";
const DANGER = "#DC2626";

type Profile = {
  id: string;
  full_name: string | null;
  specialty: string | null;
  gmc_number: string | null;
  phone: string | null;
  hospital_name: string | null;
  city: string | null;
  onboarded_cover_at: string | null;
  onboarded_request_at: string | null;
};

export default function ProfileScreen() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSpecialty, setEditSpecialty] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    console.log("[FlashLocum] Profile: fetching profile");
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        console.log("[FlashLocum] Profile: no user");
        router.replace("/role");
        return;
      }
      setEmail(userData.user.email ?? null);
      const { data, error: err } = await supabase
        .from("profiles")
        .select("id, full_name, specialty, gmc_number, phone, hospital_name, city, onboarded_cover_at, onboarded_request_at")
        .eq("id", userData.user.id)
        .maybeSingle();
      if (err) {
        console.warn("[FlashLocum] Profile: fetch error:", err.message);
        return;
      }
      console.log("[FlashLocum] Profile: loaded profile");
      setProfile(data as Profile | null);
    } catch (e) {
      console.warn("[FlashLocum] Profile: error:", (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleEditStart = () => {
    console.log("[FlashLocum] Profile: edit mode started");
    setEditName(profile?.full_name ?? "");
    setEditSpecialty(profile?.specialty ?? "");
    setEditing(true);
    setError(null);
  };

  const handleEditCancel = () => {
    console.log("[FlashLocum] Profile: edit cancelled");
    setEditing(false);
    setError(null);
  };

  const handleEditSave = async () => {
    console.log("[FlashLocum] Profile: saving profile changes");
    setSaving(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;
      const { error: err } = await supabase
        .from("profiles")
        .update({ full_name: editName || null, specialty: editSpecialty || null })
        .eq("id", userData.user.id);
      if (err) {
        console.warn("[FlashLocum] Profile: save error:", err.message);
        setError(err.message);
        return;
      }
      console.log("[FlashLocum] Profile: saved successfully");
      setProfile((prev) =>
        prev ? { ...prev, full_name: editName || null, specialty: editSpecialty || null } : prev,
      );
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = () => {
    console.log("[FlashLocum] Profile: sign out pressed");
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          console.log("[FlashLocum] Profile: signing out");
          await supabase.auth.signOut();
          await clearRole();
          router.replace("/role");
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    );
  }

  const isRequester = !!profile?.onboarded_request_at;
  const isCover = !!profile?.onboarded_cover_at;
  const roleLabel = isRequester ? "Requester" : isCover ? "Cover Doctor" : "User";
  const roleBadgeColor = isRequester ? PRIMARY : "#16A34A";

  const displayName = profile?.full_name || "No name set";
  const displayEmail = email || "—";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        {!editing ? (
          <TouchableOpacity style={styles.editButton} onPress={handleEditStart} activeOpacity={0.7}>
            <Edit2 size={16} color={TEXT} />
          </TouchableOpacity>
        ) : (
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleEditCancel} activeOpacity={0.7}>
              <X size={16} color={SECONDARY} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveButton, saving && styles.buttonDisabled]}
              onPress={handleEditSave}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator color={TEXT} size="small" />
              ) : (
                <Check size={16} color={TEXT} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Avatar + name */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <User size={36} color={SECONDARY} />
          </View>
          {editing ? (
            <TextInput
              style={styles.nameInput}
              value={editName}
              onChangeText={setEditName}
              placeholder="Full name"
              placeholderTextColor={SECONDARY}
            />
          ) : (
            <Text style={styles.name}>{displayName}</Text>
          )}
          <View style={[styles.roleBadge, { backgroundColor: roleBadgeColor + "33" }]}>
            <Text style={[styles.roleBadgeText, { color: roleBadgeColor }]}>{roleLabel}</Text>
          </View>
        </View>

        {/* Info card */}
        <View style={styles.infoCard}>
          <InfoRow label="Email" value={displayEmail} />
          {isCover ? (
            <>
              <InfoRow
                label="Specialty"
                value={editing ? undefined : (profile?.specialty || "Not set")}
                editNode={
                  editing ? (
                    <TextInput
                      style={styles.inlineInput}
                      value={editSpecialty}
                      onChangeText={setEditSpecialty}
                      placeholder="e.g. General Practice"
                      placeholderTextColor={SECONDARY}
                    />
                  ) : undefined
                }
              />
              <InfoRow label="MDCN/GMC Number" value={profile?.gmc_number || "Not set"} />
            </>
          ) : null}
          {isRequester ? (
            <>
              <InfoRow label="Hospital / Clinic" value={profile?.hospital_name || "Not set"} />
              <InfoRow label="City" value={profile?.city || "Not set"} />
            </>
          ) : null}
          {profile?.phone ? (
            <InfoRow label="Phone" value={profile.phone} />
          ) : null}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} activeOpacity={0.8}>
          <LogOut size={18} color={DANGER} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  editNode,
}: {
  label: string;
  value?: string;
  editNode?: React.ReactNode;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      {editNode ?? <Text style={styles.infoValue}>{value}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    flex: 1,
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: TEXT,
    letterSpacing: -0.5,
  },
  editButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  editActions: {
    flexDirection: "row",
    gap: 8,
  },
  cancelButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 20,
  },
  avatarSection: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    color: TEXT,
    textAlign: "center",
  },
  nameInput: {
    fontSize: 20,
    fontWeight: "600",
    color: TEXT,
    backgroundColor: CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    textAlign: "center",
    minWidth: 200,
  },
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  roleBadgeText: {
    fontSize: 13,
    fontWeight: "600",
  },
  infoCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#2C2C2E",
  },
  infoLabel: {
    fontSize: 14,
    color: SECONDARY,
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    color: TEXT,
    fontWeight: "500",
    flex: 2,
    textAlign: "right",
  },
  inlineInput: {
    flex: 2,
    fontSize: 14,
    color: TEXT,
    backgroundColor: "#2C2C2E",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: "right",
  },
  errorBox: {
    backgroundColor: "rgba(220,38,38,0.15)",
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    color: "#EF4444",
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(220,38,38,0.1)",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 8,
  },
  signOutText: {
    fontSize: 15,
    fontWeight: "600",
    color: DANGER,
  },
});
