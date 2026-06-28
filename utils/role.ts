import AsyncStorage from "@react-native-async-storage/async-storage";

export type Role = "request" | "cover";
const KEY = "flashlocum.role";

export async function setRole(role: Role): Promise<void> {
  console.log("[FlashLocum] setRole:", role);
  await AsyncStorage.setItem(KEY, role);
}

export async function getRole(): Promise<Role | null> {
  const v = await AsyncStorage.getItem(KEY);
  if (v === "cover" || v === "request") return v;
  return null;
}

export async function clearRole(): Promise<void> {
  console.log("[FlashLocum] clearRole");
  await AsyncStorage.removeItem(KEY);
}
