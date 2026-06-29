import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/utils/supabase";
import { Calendar, Clock, MapPin, ChevronRight } from "lucide-react-native";

const BG = "#0A0A0A";
const CARD = "#1C1C1E";
const PRIMARY = "#193CB8";
const TEXT = "#FFFFFF";
const SECONDARY = "#98989D";
const SUCCESS = "#16A34A";
const DANGER = "#DC2626";
const WARNING = "#D97706";

type ApplicationWithShift = {
  id: string;
  status: string;
  created_at: string;
  shifts: {
    id: string;
    specialty: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    location: string;
    city: string;
    hourly_rate: number;
    status: string;
  } | null;
};

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "accepted" ? SUCCESS :
    status === "declined" ? DANGER : WARNING;
  const label =
    status === "accepted" ? "Accepted" :
    status === "declined" ? "Declined" : "Pending";
  return (
    <View style={[styles.badge, { backgroundColor: color + "22" }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function ApplicationCard({
  item,
  onPress,
}: {
  item: ApplicationWithShift;
  onPress: () => void;
}) {
  const shift = item.shifts;
  if (!shift) return null;

  const dateDisplay = new Date(shift.shift_date).toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeDisplay = `${shift.start_time.slice(0, 5)} – ${shift.end_time.slice(0, 5)}`;
  const rateDisplay = `₦${Number(shift.hourly_rate).toLocaleString()}/hr`;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.cardHeader}>
        <Text style={styles.specialty}>{shift.specialty}</Text>
        <StatusBadge status={item.status} />
      </View>
      <Text style={styles.hospital}>{shift.location}</Text>
      <View style={styles.cardRow}>
        <MapPin size={13} color={SECONDARY} />
        <Text style={styles.cardMeta}>{shift.city}</Text>
      </View>
      <View style={styles.cardRow}>
        <Calendar size={13} color={SECONDARY} />
        <Text style={styles.cardMeta}>{dateDisplay}</Text>
        <View style={styles.dot} />
        <Clock size={13} color={SECONDARY} />
        <Text style={styles.cardMeta}>{timeDisplay}</Text>
      </View>
      <View style={styles.cardFooter}>
        <Text style={styles.rate}>{rateDisplay}</Text>
        <ChevronRight size={16} color={SECONDARY} />
      </View>
    </TouchableOpacity>
  );
}

export default function MyApplicationsScreen() {
  const [applications, setApplications] = useState<ApplicationWithShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApplications = useCallback(async () => {
    console.log("[FlashLocum] MyApplications: fetching applications");
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        console.log("[FlashLocum] MyApplications: no user, redirecting");
        router.replace("/role");
        return;
      }
      const { data, error: err } = await supabase
        .from("applications")
        .select("id, status, created_at, shifts(id, specialty, shift_date, start_time, end_time, location, city, hourly_rate, status)")
        .eq("doctor_id", userData.user.id)
        .order("created_at", { ascending: false });
      if (err) {
        console.warn("[FlashLocum] MyApplications: fetch error:", err.message);
        setError(err.message);
        return;
      }
      console.log("[FlashLocum] MyApplications: loaded", data?.length ?? 0, "applications");
      setApplications((data as unknown as ApplicationWithShift[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  const onRefresh = () => {
    console.log("[FlashLocum] MyApplications: pull to refresh");
    setRefreshing(true);
    fetchApplications();
  };

  const handleCardPress = (item: ApplicationWithShift) => {
    console.log("[FlashLocum] MyApplications: tapped application:", item.id, "shift:", item.shifts?.id);
    if (item.shifts?.id) {
      router.push(`/apply/${item.shifts.id}`);
    }
  };

  const handleBrowse = () => {
    console.log("[FlashLocum] MyApplications: browse shifts pressed");
    router.push("/(tabs)/browse-shifts");
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={PRIMARY} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.header}>
        <Text style={styles.title}>My Applications</Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={applications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PRIMARY}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No applications yet</Text>
            <Text style={styles.emptySubtitle}>
              Browse available shifts and apply to get started.
            </Text>
            <TouchableOpacity style={styles.emptyButton} onPress={handleBrowse} activeOpacity={0.85}>
              <Text style={styles.emptyButtonText}>Browse shifts</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <ApplicationCard item={item} onPress={() => handleCardPress(item)} />
        )}
      />
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
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
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
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
    gap: 12,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  specialty: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  hospital: {
    fontSize: 14,
    color: SECONDARY,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  cardMeta: {
    fontSize: 13,
    color: SECONDARY,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: SECONDARY,
    marginHorizontal: 2,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  rate: {
    fontSize: 15,
    fontWeight: "700",
    color: TEXT,
  },
  errorBox: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "rgba(220,38,38,0.15)",
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    color: "#EF4444",
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: TEXT,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: SECONDARY,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyButton: {
    marginTop: 8,
    backgroundColor: PRIMARY,
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  emptyButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
  },
});
