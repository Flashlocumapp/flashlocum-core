import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getRole } from "@/utils/role";
import type { Role } from "@/utils/role";
import { Home, Plus, User, Search, List } from "lucide-react-native";

const PRIMARY = "#193CB8";
const INACTIVE = "#636366";
const BG = "#0A0A0A";
const CARD = "#1C1C1E";

type TabBarProps = {
  state: { routes: { key: string; name: string }[]; index: number };
  descriptors: Record<string, { options: { tabBarLabel?: string } }>;
  navigation: { emit: (e: { type: string; target: string; canPreventDefault: boolean }) => { defaultPrevented: boolean }; navigate: (name: string) => void };
};

function FloatingTabBar({ state, descriptors, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.tabBarWrapper, { paddingBottom: insets.bottom + 8 }]}>
      <View style={styles.tabBar}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;

          const onPress = () => {
            console.log("[FlashLocum] Tab pressed:", route.name);
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              style={styles.tabItem}
              activeOpacity={0.7}
            >
              <View style={[styles.tabIconWrap, isFocused && styles.tabIconActive]}>
                {getTabIcon(route.name, isFocused)}
              </View>
              <Text style={[styles.tabLabel, isFocused && styles.tabLabelActive]}>
                {options.tabBarLabel || route.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function getTabIcon(routeName: string, active: boolean) {
  const color = active ? PRIMARY : INACTIVE;
  const size = 22;
  if (routeName === "my-shifts") return <Home size={size} color={color} />;
  if (routeName === "post-shift") return <Plus size={size} color={color} />;
  if (routeName === "browse-shifts") return <Search size={size} color={color} />;
  if (routeName === "my-applications") return <List size={size} color={color} />;
  if (routeName === "profile") return <User size={size} color={color} />;
  return <Home size={size} color={color} />;
}

export default function TabLayout() {
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    console.log("[FlashLocum] TabLayout (iOS): loading role");
    getRole().then((r) => {
      console.log("[FlashLocum] TabLayout (iOS): role loaded:", r);
      setRole(r);
    });
  }, []);

  if (role === null) {
    return <View style={{ flex: 1, backgroundColor: BG }} />;
  }

  if (role === "request") {
    return (
      <Tabs
        tabBar={(props) => <FloatingTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="my-shifts" options={{ tabBarLabel: "My Shifts" }} />
        <Tabs.Screen name="post-shift" options={{ tabBarLabel: "Post Shift" }} />
        <Tabs.Screen name="profile" options={{ tabBarLabel: "Profile" }} />
        <Tabs.Screen name="browse-shifts" options={{ href: null }} />
        <Tabs.Screen name="my-applications" options={{ href: null }} />
      </Tabs>
    );
  }

  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="browse-shifts" options={{ tabBarLabel: "Browse" }} />
      <Tabs.Screen name="my-applications" options={{ tabBarLabel: "Applications" }} />
      <Tabs.Screen name="profile" options={{ tabBarLabel: "Profile" }} />
      <Tabs.Screen name="my-shifts" options={{ href: null }} />
      <Tabs.Screen name="post-shift" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBarWrapper: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: "transparent",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: CARD,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  tabIconWrap: {
    width: 40,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  tabIconActive: {
    backgroundColor: "rgba(25,60,184,0.15)",
  },
  tabLabel: {
    fontSize: 10,
    color: INACTIVE,
    fontWeight: "500",
  },
  tabLabelActive: {
    color: PRIMARY,
    fontWeight: "600",
  },
});
