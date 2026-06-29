import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/utils/supabase";
import { ArrowLeft, Calendar, Clock, MapPin, CheckCircle } from "lucide-react-native";

const BG = "#0A0A0A";
const CARD = "#1C1C1E";
const PRIMARY = "#193CB8";
const TEXT = "#FFFFFF";
const SECONDARY = "#98989D";
const SUCCESS = "#16A34A";

type Shift = {
  id: string;
  specialty: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  location: string;
  city: string;
  hourly_rate: number;
  notes: string | null;
  status: string;
};

type Application = {
  id: string;
  status: string;
};

export default function ApplyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shift, setShift] = useState<Shift | null>(null);
  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    console.log("[FlashLocum] Apply: fetching shift:", id);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id ?? null;
      setUserId(uid);

      const shiftRes = await supabase.from("shifts").select("*").eq("id", id).single();
      if (shiftRes.error) {
        console.warn("[FlashLocum] Apply: shift fetch error:", shiftRes.error.message);
        setError(shiftRes.error.message);
        return;
      }
      setShift(shiftRes.data as Shift);

      if (uid) {
        const appRes = await supabase
          .from("applications")
          .select("id, status")
          .eq("shift_id", id)
          .eq("doctor_id", uid)
          .maybeSingle();
        if (appRes.data) {
          console.log("[FlashLocum] Apply: existing application found:", appRes.data.status);
          setApplication(appRes.data as Application);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleApply = async () => {
    console.log("[FlashLocum] Apply: apply button pressed for shift:", id);
    if (!userId) {
      router.replace("/role");
      return;
    }
    setApplying(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("applications")
        .insert({ shift_id: id, doctor_id: userId, status: "pending" })
        .select("id, status")
        .single();
      if (err) {
        console.warn("[FlashLocum] Apply: insert error:", err.message);
        setError(err.message);
        return;
      }
      console.log("[FlashLocum] Apply: application submitted:", data.id);
      setApplication(data as Application);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    );
  }

  if (error && !shift) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <TouchableOpacity style={styles.backButton} onPress={() => {
          console.log("[FlashLocum] Apply: back pressed");
          router.back();
        }}>
          <ArrowLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error || "Shift not found"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!shift) return null;

  const dateDisplay = new Date(shift.shift_date).toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeDisplay = `${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)}`;
  const rateDisplay = `₦${Number(shift.hourly_rate).toLocaleString()}/hr`;
  const isFilled = shift.status === "filled" || shift.status === "completed";
  const hasApplied = application !== null;

  const appStatusColor =
    application?.status === "accepted" ? SUCCESS :
    application?.status === "declined" ? "#DC2626" : SECONDARY;
  const appStatusLabel =
    application?.status === "accepted" ? "Accepted" :
    application?.status === "declined" ? "Declined" : "Pending review";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.backButton} onPress={() => {
          console.log("[FlashLocum] Apply: back pressed");
          router.back();
        }} activeOpacity={0.7}>
          <ArrowLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Shift Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Specialty badge */}
        <View style={styles.specialtyBadge}>
          <Text style={styles.specialtyBadgeText}>{shift.specialty}</Text>
        </View>

        {/* Hospital */}
        <Text style={styles.hospital}>{shift.location}</Text>

        {/* Details card */}
        <View style={styles.detailCard}>
          <View style={styles.detailRow}>
            <MapPin size={16} color={SECONDARY} />
            <Text style={styles.detailText}>{shift.city}</Text>
          </View>
          <View style={styles.detailRow}>
            <Calendar size={16} color={SECONDARY} />
            <Text style={styles.detailText}>{dateDisplay}</Text>
          </View>
          <View style={styles.detailRow}>
            <Clock size={16} color={SECONDARY} />
            <Text style={styles.detailText}>{timeDisplay}</Text>
          </View>
          <View style={styles.rateRow}>
            <Text style={styles.rateLabel}>Hourly Rate</Text>
            <Text style={styles.rate}>{rateDisplay}</Text>
          </View>
        </View>

        {/* Notes */}
        {shift.notes ? (
          <View style={styles.notesCard}>
            <Text style={styles.notesLabel}>Notes from requester</Text>
            <Text style={styles.notesText}>{shift.notes}</Text>
          </View>
        ) : null}

        {/* Error */}
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Application status or apply button */}
        {hasApplied ? (
          <View style={styles.appliedCard}>
            <CheckCircle size={24} color={appStatusColor} />
            <View style={styles.appliedInfo}>
              <Text style={styles.appliedTitle}>Application submitted</Text>
              <Text style={[styles.appliedStatus, { color: appStatusColor }]}>
                {appStatusLabel}
              </Text>
            </View>
          </View>
        ) : isFilled ? (
          <View style={styles.filledCard}>
            <Text style={styles.filledText}>This shift has been filled.</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.applyButton, applying && styles.buttonDisabled]}
            onPress={handleApply}
            disabled={applying}
            activeOpacity={0.85}
          >
            {applying ? (
              <ActivityIndicator color={TEXT} />
            ) : (
              <Text style={styles.applyButtonText}>Apply for this shift</Text>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BG,
  },
  navHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  navTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: TEXT,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  specialtyBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(25,60,184,0.2)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  specialtyBadgeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B8EF5",
  },
  hospital: {
    fontSize: 22,
    fontWeight: "700",
    color: TEXT,
    letterSpacing: -0.3,
  },
  detailCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  detailText: {
    fontSize: 14,
    color: SECONDARY,
  },
  rateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2C2C2E",
  },
  rateLabel: {
    fontSize: 13,
    color: SECONDARY,
  },
  rate: {
    fontSize: 20,
    fontWeight: "700",
    color: TEXT,
  },
  notesCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  notesLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: SECONDARY,
  },
  notesText: {
    fontSize: 14,
    color: TEXT,
    lineHeight: 20,
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
  applyButton: {
    height: 56,
    backgroundColor: PRIMARY,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  applyButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: TEXT,
  },
  appliedCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 8,
  },
  appliedInfo: {
    gap: 4,
  },
  appliedTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
  },
  appliedStatus: {
    fontSize: 13,
    fontWeight: "500",
  },
  filledCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    marginTop: 8,
  },
  filledText: {
    fontSize: 15,
    color: SECONDARY,
  },
});
