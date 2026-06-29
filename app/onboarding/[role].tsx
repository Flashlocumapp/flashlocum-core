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
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "@/utils/supabase";
import { setRole } from "@/utils/role";
import { ChevronDown, ArrowLeft, Check } from "lucide-react-native";

const BG = "#000000";
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

const AVAILABILITY_OPTIONS = [
  { value: "weekdays", label: "Weekdays only" },
  { value: "weekends", label: "Weekends only" },
  { value: "both", label: "Weekdays & Weekends" },
];

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <Text style={styles.fieldLabel}>
      {label}
      {required ? <Text style={{ color: "#EF4444" }}> *</Text> : null}
    </Text>
  );
}

// ============================================================
// REQUESTER ONBOARDING
// ============================================================
function RequesterOnboarding() {
  const [step, setStep] = useState(1);
  const [hospitalName, setHospitalName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleNext = () => {
    console.log("[FlashLocum] RequesterOnboarding: step 1 next pressed");
    if (!hospitalName.trim()) {
      setError("Please enter your hospital or clinic name.");
      return;
    }
    if (!city.trim()) {
      setError("Please enter your city.");
      return;
    }
    setError(null);
    setStep(2);
  };

  const handleComplete = async () => {
    console.log("[FlashLocum] RequesterOnboarding: completing onboarding");
    setBusy(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/role");
        return;
      }
      const { error: err } = await supabase
        .from("profiles")
        .upsert({
          id: userData.user.id,
          hospital_name: hospitalName.trim(),
          city: city.trim(),
          phone: phone.trim() || null,
          onboarded_request_at: new Date().toISOString(),
        });
      if (err) {
        console.warn("[FlashLocum] RequesterOnboarding: upsert error:", err.message);
        setError(err.message);
        return;
      }
      console.log("[FlashLocum] RequesterOnboarding: onboarding complete");
      await setRole("request");
      router.replace("/(tabs)/my-shifts");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 2) {
    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              console.log("[FlashLocum] RequesterOnboarding: back to step 1");
              setStep(1);
            }}
            activeOpacity={0.7}
          >
            <ArrowLeft size={20} color={TEXT} />
          </TouchableOpacity>
          <StepIndicator current={2} total={2} />
        </View>
        <Text style={styles.stepTitle}>Confirm your details</Text>
        <Text style={styles.stepSubtitle}>Review your information before completing setup.</Text>

        <View style={styles.confirmCard}>
          <ConfirmRow label="Hospital / Clinic" value={hospitalName} />
          <ConfirmRow label="City" value={city} />
          {phone ? <ConfirmRow label="Phone" value={phone} /> : null}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={handleComplete}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={TEXT} />
          ) : (
            <>
              <Check size={18} color={TEXT} />
              <Text style={styles.primaryButtonText}>Complete Setup</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.stepContainer}>
      <View style={styles.stepHeader}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            console.log("[FlashLocum] RequesterOnboarding: back to role selection");
            router.replace("/role");
          }}
          activeOpacity={0.7}
        >
          <ArrowLeft size={20} color={TEXT} />
        </TouchableOpacity>
        <StepIndicator current={1} total={2} />
      </View>
      <Text style={styles.stepTitle}>Set up your account</Text>
      <Text style={styles.stepSubtitle}>Tell us about your hospital or clinic.</Text>

      <View style={styles.form}>
        <View style={styles.fieldContainer}>
          <FieldLabel label="Hospital / Clinic Name" required />
          <TextInput
            style={styles.input}
            value={hospitalName}
            onChangeText={setHospitalName}
            placeholder="e.g. Lagos Island General Hospital"
            placeholderTextColor={SECONDARY}
          />
        </View>
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
        <View style={styles.fieldContainer}>
          <FieldLabel label="Contact Phone (optional)" />
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+234 800 000 0000"
            placeholderTextColor={SECONDARY}
            keyboardType="phone-pad"
          />
        </View>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <TouchableOpacity style={styles.primaryButton} onPress={handleNext} activeOpacity={0.85}>
        <Text style={styles.primaryButtonText}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

// ============================================================
// COVER DOCTOR ONBOARDING
// ============================================================
function CoverOnboarding() {
  const [step, setStep] = useState(1);
  const [fullName, setFullName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [gmcNumber, setGmcNumber] = useState("");
  const [availability, setAvailability] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSpecialtyPicker, setShowSpecialtyPicker] = useState(false);

  const handleStep1Next = () => {
    console.log("[FlashLocum] CoverOnboarding: step 1 next pressed");
    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!specialty) {
      setError("Please select your specialty.");
      return;
    }
    if (!gmcNumber.trim()) {
      setError("Please enter your MDCN/GMC registration number.");
      return;
    }
    setError(null);
    setStep(2);
  };

  const handleStep2Next = () => {
    console.log("[FlashLocum] CoverOnboarding: step 2 next pressed");
    if (!availability) {
      setError("Please select your availability preference.");
      return;
    }
    setError(null);
    setStep(3);
  };

  const handleComplete = async () => {
    console.log("[FlashLocum] CoverOnboarding: completing onboarding");
    setBusy(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/role");
        return;
      }
      const { error: err } = await supabase
        .from("profiles")
        .upsert({
          id: userData.user.id,
          full_name: fullName.trim(),
          specialty,
          gmc_number: gmcNumber.trim(),
          availability,
          onboarded_cover_at: new Date().toISOString(),
        });
      if (err) {
        console.warn("[FlashLocum] CoverOnboarding: upsert error:", err.message);
        setError(err.message);
        return;
      }
      console.log("[FlashLocum] CoverOnboarding: onboarding complete");
      await setRole("cover");
      router.replace("/(tabs)/browse-shifts");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 3) {
    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              console.log("[FlashLocum] CoverOnboarding: back to step 2");
              setStep(2);
            }}
            activeOpacity={0.7}
          >
            <ArrowLeft size={20} color={TEXT} />
          </TouchableOpacity>
          <StepIndicator current={3} total={3} />
        </View>
        <Text style={styles.stepTitle}>{"You're all set!"}</Text>
        <Text style={styles.stepSubtitle}>Review your details before completing setup.</Text>


        <View style={styles.confirmCard}>
          <ConfirmRow label="Full Name" value={fullName} />
          <ConfirmRow label="Specialty" value={specialty} />
          <ConfirmRow label="MDCN/GMC Number" value={gmcNumber} />
          <ConfirmRow
            label="Availability"
            value={AVAILABILITY_OPTIONS.find((a) => a.value === availability)?.label ?? availability}
          />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.primaryButton, busy && styles.buttonDisabled]}
          onPress={handleComplete}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={TEXT} />
          ) : (
            <>
              <Check size={18} color={TEXT} />
              <Text style={styles.primaryButtonText}>Start Browsing Shifts</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  if (step === 2) {
    return (
      <View style={styles.stepContainer}>
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              console.log("[FlashLocum] CoverOnboarding: back to step 1");
              setStep(1);
            }}
            activeOpacity={0.7}
          >
            <ArrowLeft size={20} color={TEXT} />
          </TouchableOpacity>
          <StepIndicator current={2} total={3} />
        </View>
        <Text style={styles.stepTitle}>Availability</Text>
        <Text style={styles.stepSubtitle}>When are you available to cover shifts?</Text>

        <View style={styles.form}>
          {AVAILABILITY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.availabilityOption,
                availability === opt.value && styles.availabilityOptionSelected,
              ]}
              onPress={() => {
                console.log("[FlashLocum] CoverOnboarding: availability selected:", opt.value);
                setAvailability(opt.value);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.availabilityText,
                  availability === opt.value && styles.availabilityTextSelected,
                ]}
              >
                {opt.label}
              </Text>
              {availability === opt.value ? (
                <Check size={18} color={PRIMARY} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.primaryButton} onPress={handleStep2Next} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Step 1
  return (
    <>
      <View style={styles.stepContainer}>
        <View style={styles.stepHeader}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              console.log("[FlashLocum] CoverOnboarding: back to role selection");
              router.replace("/role");
            }}
            activeOpacity={0.7}
          >
            <ArrowLeft size={20} color={TEXT} />
          </TouchableOpacity>
          <StepIndicator current={1} total={3} />
        </View>
        <Text style={styles.stepTitle}>Your profile</Text>
        <Text style={styles.stepSubtitle}>Help requesters know who you are.</Text>

        <View style={styles.form}>
          <View style={styles.fieldContainer}>
            <FieldLabel label="Full Name" required />
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Dr. Ada Okafor"
              placeholderTextColor={SECONDARY}
              autoComplete="name"
            />
          </View>
          <View style={styles.fieldContainer}>
            <FieldLabel label="Specialty" required />
            <TouchableOpacity
              style={styles.picker}
              onPress={() => {
                console.log("[FlashLocum] CoverOnboarding: open specialty picker");
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
          <View style={styles.fieldContainer}>
            <FieldLabel label="MDCN / GMC Registration Number" required />
            <TextInput
              style={styles.input}
              value={gmcNumber}
              onChangeText={setGmcNumber}
              placeholder="e.g. MDCN/12345"
              placeholderTextColor={SECONDARY}
              autoCapitalize="characters"
            />
          </View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity style={styles.primaryButton} onPress={handleStep1Next} activeOpacity={0.85}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>

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
                    console.log("[FlashLocum] CoverOnboarding: specialty selected:", s);
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
    </>
  );
}

// ============================================================
// HELPERS
// ============================================================
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.stepIndicator}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.stepDot, i + 1 === current && styles.stepDotActive, i + 1 < current && styles.stepDotDone]}
        />
      ))}
    </View>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.confirmRow}>
      <Text style={styles.confirmLabel}>{label}</Text>
      <Text style={styles.confirmValue}>{value}</Text>
    </View>
  );
}

// ============================================================
// ROOT
// ============================================================
export default function OnboardingScreen() {
  const { role } = useLocalSearchParams<{ role: string }>();
  const normalizedRole = role === "cover" ? "cover" : "request";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
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
          {normalizedRole === "cover" ? <CoverOnboarding /> : <RequesterOnboarding />}
        </ScrollView>
      </KeyboardAvoidingView>
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
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 40,
  },
  stepContainer: {
    flex: 1,
    gap: 16,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  stepIndicator: {
    flexDirection: "row",
    gap: 6,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2C2C2E",
  },
  stepDotActive: {
    backgroundColor: PRIMARY,
    width: 20,
  },
  stepDotDone: {
    backgroundColor: "#16A34A",
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: TEXT,
    letterSpacing: -0.3,
  },
  stepSubtitle: {
    fontSize: 14,
    color: SECONDARY,
    lineHeight: 20,
  },
  form: {
    gap: 14,
    marginTop: 8,
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
  availabilityOption: {
    height: 56,
    backgroundColor: CARD,
    borderRadius: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  availabilityOptionSelected: {
    backgroundColor: "rgba(25,60,184,0.2)",
    borderWidth: 1.5,
    borderColor: PRIMARY,
  },
  availabilityText: {
    fontSize: 15,
    color: TEXT,
  },
  availabilityTextSelected: {
    color: PRIMARY,
    fontWeight: "600",
  },
  confirmCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 8,
  },
  confirmRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  confirmLabel: {
    fontSize: 13,
    color: SECONDARY,
  },
  confirmValue: {
    fontSize: 14,
    color: TEXT,
    fontWeight: "500",
    flex: 1,
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
    lineHeight: 18,
  },
  primaryButton: {
    height: 52,
    backgroundColor: PRIMARY,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
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
