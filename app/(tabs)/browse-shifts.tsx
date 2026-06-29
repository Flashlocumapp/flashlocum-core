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
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/utils/supabase";
import { Calendar, MapPin, Clock, ChevronRight } from "lucide-react-native";

const BG = "#0A0A0A";
const CARD = "#1C1C1E";
const PRIMARY = "#193CB8";
const TEXT = "#FFFFFF";
const SECONDARY = "#98989D";

const SPECIALTIES = [
  "All",
  "General Practice",
  "Emergency Medicine",
  "Paediatrics",
  "Surgery",
  "Obstetrics & Gynaecology",
  "Internal Medicine",
  "Anaesthesia",
  "Radiology",
  "Psychiatry",
  "Other",
];

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

function ShiftCard({ shift, onPress }: { shift: Shift; onPress: () => void }) {
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
        <View style={styles.specialtyBadge}>
          <Text style={styles.specialtyBadgeText}>{shift.specialty}</Text>
        </View>
        <Text style={styles.rate}>{rateDisplay}</Text>
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
        <Text style={styles.applyText}>View & Apply</Text>
        <ChevronRight size={16} color={PRIMARY} />
      </View>
    </TouchableOpacity>
  );
}

export default function BrowseShiftsScreen() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSpecialty, setSelectedSpecialty] = useState("All");

  const fetchShifts = useCallback(async () => {
    console.log("[FlashLocum] BrowseShifts: fetching open shifts");
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("shifts")
        .select("*")
        .eq("status", "open")
        .order("shift_date", { ascending: true });
      if (err) {
        console.warn("[FlashLocum] BrowseShifts: fetch error:", err.message);
        setError(err.message);
        return;
      }
      console.log("[FlashLocum] BrowseShifts: loaded", data?.length ?? 0, "shifts");
      setShifts((data as Shift[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  const onRefresh = () => {
    console.log("[FlashLocum] BrowseShifts: pull to refresh");
    setRefreshing(true);
    fetchShifts();
  };

  const handleShiftPress = (shift: Shift) => {
    console.log("[FlashLocum] BrowseShifts: tapped shift:", shift.id);
    router.push(`/apply/${shift.id}`);
  };

  const handleFilterPress = (specialty: string) => {
    console.log("[FlashLocum] BrowseShifts: filter selected:", specialty);
    setSelectedSpecialty(specialty);
  };

  const filteredShifts =
    selectedSpecialty === "All"
      ? shifts
      : shifts.filter((s) => s.specialty === selectedSpecialty);

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
        <Text style={styles.title}>Available Shifts</Text>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {SPECIALTIES.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.filterChip, selectedSpecialty === s && styles.filterChipActive]}
            onPress={() => handleFilterPress(s)}
            activeOpacity={0.7}
          >
            <Text
              style={[styles.filterChipText, selectedSpecialty === s && styles.filterChipTextActive]}
            >
              {s}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <FlatList
        data={filteredShifts}
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
            <Text style={styles.emptyTitle}>No shifts available</Text>
            <Text style={styles.emptySubtitle}>
              {selectedSpecialty !== "All"
                ? `No open ${selectedSpecialty} shifts right now. Try a different specialty.`
                : "Check back soon for new shifts."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ShiftCard shift={item} onPress={() => handleShiftPress(item)} />
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
    paddingBottom: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: TEXT,
    letterSpacing: -0.5,
  },
  filterScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  filterRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: CARD,
  },
  filterChipActive: {
    backgroundColor: PRIMARY,
  },
  filterChipText: {
    fontSize: 13,
    color: SECONDARY,
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: TEXT,
    fontWeight: "600",
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
  specialtyBadge: {
    backgroundColor: "rgba(25,60,184,0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  specialtyBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#6B8EF5",
  },
  rate: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT,
  },
  hospital: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
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
    justifyContent: "flex-end",
    gap: 4,
    marginTop: 4,
  },
  applyText: {
    fontSize: 13,
    fontWeight: "600",
    color: PRIMARY,
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
});
