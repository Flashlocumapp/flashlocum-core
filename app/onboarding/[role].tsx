import { View, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";

export default function OnboardingScreen() {
  const { role } = useLocalSearchParams<{ role: string }>();
  return (
    <View
      style={{ flex: 1, backgroundColor: "#000", alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: "#fff", fontSize: 18 }}>Onboarding</Text>
      <Text style={{ color: "#98989D", marginTop: 8 }}>{role}</Text>
      <Text style={{ color: "#98989D", marginTop: 4 }}>Coming soon</Text>
    </View>
  );
}
