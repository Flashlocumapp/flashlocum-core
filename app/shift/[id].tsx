import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/utils/supabase";
import { ArrowLeft, User, Calendar, Clock, MapPin, CheckCircle, XCircle } from "lucide-react-native";

const BG = "#0A0A0A";
const CARD = "#1C1C1E";
const PRIMARY = "#193CB8";
const TEXT = "#FFFFFF";
const SECONDARY = "#98989D";
const SUCCESS = "#16A34A";
const DANGER = "#DC2626";

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

type Applicant = {
  id: string;
  doctor_id: string;
  status: string;
  created_at: string;
  profiles: {
    full_name: string | null;
    specialty: string | null;
    gmc_number: string | null;
  } | null;
};

export default function ShiftDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shift, setShift] = useState<Shift | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    console.log("[FlashLocum] ShiftDetail: fetching shift:", id);
    setError(null);
    try {
      const [shiftRes, appsRes] = await Promise.all([
        supabase.from("shifts").select("*").eq("id", id).single(),
        supabase
          .from("applications")
          .select("id, doctor_id, status, created_at, profiles(full_name, specialty, gmc_number)")
          .eq("shift_id", id)
          .order("created_at", { ascending: true }),
      ]);
      if (shiftRes.error) {
        console.warn("[FlashLocum] ShiftDetail: shift fetch error:", shiftRes.error.message);
        setError(shiftRes.error.message);
        return;
      }
      setShift(shiftRes.data as Shift);
      console.log("[FlashLocum] ShiftDetail: loaded", appsRes.data?.length ?? 0, "applicants");
      setApplicants((appsRes.data as unknown as Applicant[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAccept = async (applicant: Applicant) => {
    console.log("[FlashLocum] ShiftDetail: accept applicant:", applicant.id);
    Alert.alert(
      "Accept Applicant",
      `Accept ${applicant.profiles?.full_name || "this doctor"} for this shift?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Accept",
          onPress: async () => {
            setActionBusy(applicant.id);
            try {
              const [appUpdate, shiftUpdate] = await Promise.all([
                supabase
                  .from("applications")
                  .update({ status: "accepted" })
                  .eq("id", applicant.id),
                supabase
                  .from("shifts")
                  .update({ status: "filled" })
                  .eq("id", id),
              ]);
              if (appUpdate.error) throw appUpdate.error;
              if (shiftUpdate.error) throw shiftUpdate.error;
              console.log("[FlashLocum] ShiftDetail: applicant accepted, shift filled");
              await fetchData();
            } catch (e) {
              Alert.alert("Error", (e as Error).message);
            } finally {
              setActionBusy(null);
            }
          },
        },
      ],
    );
  };

  const handleDecline = async (applicant: Applicant) => {
    console.log("[FlashLocum] ShiftDetail: decline applicant:", applicant.id);
    Alert.alert(
      "Decline Applicant",
      `Decline ${applicant.profiles?.full_name || "this doctor"}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            setActionBusy(applicant.id);
            try {
              const { error: err } = await supabase
                .from("applications")
                .update({ status: "declined" })
                .eq("id", applicant.id);
              if (err) throw err;
              console.log("[FlashLocum] ShiftDetail: applicant declined");
              await fetchData();
            } catch (e) {
              Alert.alert("Error", (e as Error).message);
            } finally {
              setActionBusy(null);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    );
  }

  if (error || !shift) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <TouchableOpacity style={styles.backButton} onPress={() => {
          console.log("[FlashLocum] ShiftDetail: back pressed");
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

  const dateDisplay = new Date(shift.shift_date).toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeDisplay = `${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)}`;
  const rateDisplay = `₦${Number(shift.hourly_rate).toLocaleString()}/hr`;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.navHeader}>
        <TouchableOpacity style={styles.backButton} onPress={() => {
          console.log("[FlashLocum] ShiftDetail: back pressed");
          router.back();
        }} activeOpacity={0.7}>
          <ArrowLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Shift Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Shift info card */}
        <View style={styles.shiftCard}>
          <Text style={styles.specialty}>{shift.specialty}</Text>
          <View style={[styles.statusBadge, { backgroundColor: shift.status === "open" ? "#193CB833" : shift.status === "filled" ? "#16A34A33" : "#63636633" }]}>
            <Text style={[styles.statusText, { color: shift.status === "open" ? PRIMARY : shift.status === "filled" ? SUCCESS : SECONDARY }]}>
              {shift.status.charAt(0).toUpperCase() + shift.status.slice(1)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Calendar size={15} color={SECONDARY} />
            <Text style={styles.infoText}>{dateDisplay}</Text>
          </View>
          <View style={styles.infoRow}>
            <Clock size={15} color={SECONDARY} />
            <Text style={styles.infoText}>{timeDisplay}</Text>
          </View>
          <View style={styles.infoRow}>
            <MapPin size={15} color={SECONDARY} />
            <Text style={styles.infoText}>{shift.location}</Text>
            <Text style={styles.infoText}>, {shift.city}</Text>
          </View>
          <Text style={styles.rate}>{rateDisplay}</Text>
          {shift.notes ? (
            <Text style={styles.notes}>{shift.notes}</Text>
          ) : null}
        </View>

        {/* Applicants */}
        <Text style={styles.sectionTitle}>
          Applicants ({applicants.length})
        </Text>

        {applicants.length === 0 ? (
          <View style={styles.emptyApplicants}>
            <Text style={styles.emptyText}>No applications yet.</Text>
            <Text style={styles.emptySubText}>Doctors will appear here when they apply.</Text>
          </View>
        ) : (
          applicants.map((applicant) => {
            const name = applicant.profiles?.full_name || "Unknown Doctor";
            const specialty = applicant.profiles?.specialty || "—";
            const gmc = applicant.profiles?.gmc_number || "—";
            const isBusy = actionBusy === applicant.id;
            const isPending = applicant.status === "pending";

            return (
              <View key={applicant.id} style={styles.applicantCard}>
                <View style={styles.applicantHeader}>
                  <View style={styles.avatarCircle}>
                    <User size={18} color={SECONDARY} />
                  </View>
                  <View style={styles.applicantInfo}>
                    <Text style={styles.applicantName}>{name}</Text>
                    <Text style={styles.applicantMeta}>{specialty}</Text>
                    <Text style={styles.applicantMeta}>MDCN/GMC: {gmc}</Text>
                  </View>
                  <View style={[styles.appStatusBadge, {
                    backgroundColor:
                      applicant.status === "accepted" ? "#16A34A33" :
                      applicant.status === "declined" ? "#DC262633" : "#63636633",
                  }]}>
                    <Text style={[styles.appStatusText, {
                      color:
                        applicant.status === "accepted" ? SUCCESS :
                        applicant.status === "declined" ? DANGER : SECONDARY,
                    }]}>
                      {applicant.status.charAt(0).toUpperCase() + applicant.status.slice(1)}
                    </Text>
                  </View>
                </View>

                {isPending && shift.status === "open" ? (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={[styles.acceptButton, isBusy && styles.buttonDisabled]}
                      onPress={() => handleAccept(applicant)}
                      disabled={isBusy}
                      activeOpacity={0.8}
                    >
                      {isBusy ? (
                        <ActivityIndicator color={TEXT} size="small" />
                      ) : (
                        <>
                          <CheckCircle size={15} color={TEXT} />
                          <Text style={styles.actionButtonText}>Accept</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.declineButton, isBusy && styles.buttonDisabled]}
                      onPress={() => handleDecline(applicant)}
                      disabled={isBusy}
                      activeOpacity={0.8}
                    >
                      <XCircle size={15} color={DANGER} />
                      <Text style={[styles.actionButtonText, { color: DANGER }]}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })
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
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 16,
  },
  shiftCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  specialty: {
    fontSize: 20,
    fontWeight: "700",
    color: TEXT,
  },
  statusBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoText: {
    fontSize: 14,
    color: SECONDARY,
  },
  rate: {
    fontSize: 18,
    fontWeight: "700",
    color: TEXT,
    marginTop: 4,
  },
  notes: {
    fontSize: 13,
    color: SECONDARY,
    lineHeight: 18,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: TEXT,
    marginTop: 8,
  },
  emptyApplicants: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
  },
  emptySubText: {
    fontSize: 13,
    color: SECONDARY,
    textAlign: "center",
  },
  applicantCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  applicantHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  applicantInfo: {
    flex: 1,
    gap: 2,
  },
  applicantName: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
  },
  applicantMeta: {
    fontSize: 12,
    color: SECONDARY,
  },
  appStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  appStatusText: {
    fontSize: 11,
    fontWeight: "600",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  acceptButton: {
    flex: 1,
    height: 40,
    backgroundColor: SUCCESS,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  declineButton: {
    flex: 1,
    height: 40,
    backgroundColor: "rgba(220,38,38,0.15)",
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: TEXT,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  errorText: {
    fontSize: 15,
    color: "#EF4444",
    textAlign: "center",
    paddingHorizontal: 24,
  },
});
