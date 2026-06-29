import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ActivityIndicator,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { supabase } from "@/utils/supabase";
import { ChevronDown } from "lucide-react-native";

const BG = "#0A0A0A";
const CARD = "#1C1C1E";
const PRIMARY = "#193CB8";
const TEXT = "#FFFFFF";
const SECONDARY = "#98989D";
const BORDER = "#2C2C2E";

const SPECIALTIES = [
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

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {label}
      {required ? <Text style={{ color: "#EF4444" }}> *</Text> : null}
    </Text>
  );
}

export default function PostShiftScreen() {
  const [specialty, setSpecialty] = useState("");
  const [shiftDate, setShiftDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [city, setCity] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpecialtyPicker, setShowSpecialtyPicker] = useState(false);

  const validate = (): string | null => {
    if (!specialty) return "Please select a specialty.";
    if (!shiftDate) return "Please enter the shift date (YYYY-MM-DD).";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) return "Date must be in YYYY-MM-DD format.";
    if (!startTime) return "Please enter a start time (HH:MM).";
    if (!/^\d{2}:\d{2}$/.test(startTime)) return "Start time must be in HH:MM format.";
    if (!endTime) return "Please enter an end time (HH:MM).";
    if (!/^\d{2}:\d{2}$/.test(endTime)) return "End time must be in HH:MM format.";
    if (!location) return "Please enter the hospital/clinic name.";
    if (!city) return "Please enter the city.";
    if (!hourlyRate) return "Please enter the hourly rate.";
    if (isNaN(Number(hourlyRate)) || Number(hourlyRate) <= 0) return "Please enter a valid hourly rate.";
    return null;
  };

  const handlePost = async () => {
    console.log("[FlashLocum] PostShift: post button pressed");
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        console.log("[FlashLocum] PostShift: no user");
        router.replace("/role");
        return;
      }
      console.log("[FlashLocum] PostShift: inserting shift for user:", userData.user.id);
      const { error: err } = await supabase.from("shifts").insert({
        requester_id: userData.user.id,
        specialty,
        shift_date: shiftDate,
        start_time: startTime,
        end_time: endTime,
        location,
        city,
        hourly_rate: Number(hourlyRate),
        notes: notes || null,
        status: "open",
      });
      if (err) {
        console.warn("[FlashLocum] PostShift: insert error:", err.message);
        setError(err.message);
        return;
      }
      console.log("[FlashLocum] PostShift: shift posted successfully");
      router.replace("/(tabs)/my-shifts");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Post a Shift</Text>
          <Text style={styles.subtitle}>Fill in the details to find a locum doctor.</Text>

          <View style={styles.form}>
            {/* Specialty */}
            <View style={styles.fieldContainer}>
              <FieldLabel label="Specialty" required />
              <TouchableOpacity
                style={styles.picker}
                onPress={() => {
                  console.log("[FlashLocum] PostShift: open specialty picker");
                  setShowSpecialtyPicker(true);
                }}
                activeOpacity={0.8}
              >
                <Text style={[styles.pickerText, !specialty && styles.placeholder]}>
                  {specialty || "Select specialty"}
                </Text>
                <ChevronDown size={16} color={SECONDARY} />
              </TouchableOpacity>
            </View>

            {/* Date */}
            <View style={styles.fieldContainer}>
              <FieldLabel label="Shift Date" required />
              <TextInput
                style={styles.input}
                value={shiftDate}
                onChangeText={setShiftDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={SECONDARY}
                keyboardType="numbers-and-punctuation"
              />
            </View>

            {/* Times */}
            <View style={styles.row}>
              <View style={[styles.fieldContainer, styles.flex]}>
                <FieldLabel label="Start Time" required />
                <TextInput
                  style={styles.input}
                  value={startTime}
                  onChangeText={setStartTime}
                  placeholder="08:00"
                  placeholderTextColor={SECONDARY}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={[styles.fieldContainer, styles.flex]}>
                <FieldLabel label="End Time" required />
                <TextInput
                  style={styles.input}
                  value={endTime}
                  onChangeText={setEndTime}
                  placeholder="16:00"
                  placeholderTextColor={SECONDARY}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>

            {/* Location */}
            <View style={styles.fieldContainer}>
              <FieldLabel label="Hospital / Clinic Name" required />
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="e.g. Lagos Island General Hospital"
                placeholderTextColor={SECONDARY}
              />
            </View>

            {/* City */}
            <View style={styles.fieldContainer}>
              <FieldLabel label="City" required />
              <TextInput
                style={styles.input}
                value={city}
                onChangeText={setCity}
                placeholder="e.g. Lagos"
                placeholderTextColor={SECONDARY}
              />
            </View>

            {/* Rate */}
            <View style={styles.fieldContainer}>
              <FieldLabel label="Hourly Rate (₦)" required />
              <TextInput
                style={styles.input}
                value={hourlyRate}
                onChangeText={setHourlyRate}
                placeholder="e.g. 20000"
                placeholderTextColor={SECONDARY}
                keyboardType="numeric"
              />
            </View>

            {/* Notes */}
            <View style={styles.fieldContainer}>
              <FieldLabel label="Notes (optional)" />
              <TextInput
                style={[styles.input, styles.textArea]}
                value={notes}
                onChangeText={setNotes}
                placeholder="Any additional requirements or information..."
                placeholderTextColor={SECONDARY}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.submitButton, busy && styles.buttonDisabled]}
              onPress={handlePost}
              disabled={busy}
              activeOpacity={0.85}
            >
              {busy ? (
                <ActivityIndicator color={TEXT} />
              ) : (
                <Text style={styles.submitButtonText}>Post Shift</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Specialty Picker Modal */}
      <Modal
        visible={showSpecialtyPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSpecialtyPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSpecialtyPicker(false)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Select Specialty</Text>
            <ScrollView>
              {SPECIALTIES.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.modalOption, specialty === s && styles.modalOptionSelected]}
                  onPress={() => {
                    console.log("[FlashLocum] PostShift: specialty selected:", s);
                    setSpecialty(s);
                    setShowSpecialtyPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.modalOptionText,
                      specialty === s && styles.modalOptionTextSelected,
                    ]}
                  >
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: BG,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 120,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: TEXT,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: SECONDARY,
    marginBottom: 24,
  },
  form: {
    gap: 16,
  },
  fieldContainer: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: SECONDARY,
  },
  input: {
    height: 52,
    backgroundColor: CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: TEXT,
  },
  textArea: {
    height: 100,
    paddingTop: 14,
  },
  picker: {
    height: 52,
    backgroundColor: CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerText: {
    fontSize: 15,
    color: TEXT,
  },
  placeholder: {
    color: SECONDARY,
  },
  row: {
    flexDirection: "row",
    gap: 12,
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
  submitButton: {
    height: 52,
    backgroundColor: PRIMARY,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: TEXT,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: "70%",
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: BORDER,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: TEXT,
    textAlign: "center",
    marginBottom: 12,
  },
  modalOption: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  modalOptionSelected: {
    backgroundColor: "rgba(25,60,184,0.15)",
  },
  modalOptionText: {
    fontSize: 15,
    color: TEXT,
  },
  modalOptionTextSelected: {
    color: PRIMARY,
    fontWeight: "600",
  },
});
