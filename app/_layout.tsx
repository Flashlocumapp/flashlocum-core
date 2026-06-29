import "react-native-reanimated";
import React, { useEffect } from "react";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { SystemBars } from "react-native-edge-to-edge";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme, Alert } from "react-native";
import { useNetworkState } from "expo-network";
import { DarkTheme, DefaultTheme, Theme, ThemeProvider } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

// Only wrap with ErrorBoundary in dev — production apps should not include it
const DevErrorBoundary = __DEV__
  ? ErrorBoundary
  : ({ children }: { children: React.ReactNode }) => <>{children}</>;

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: "index",
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const networkState = useNetworkState();
  const [loaded] = useFonts({ SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf") });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  React.useEffect(() => {
    if (!networkState.isConnected && networkState.isInternetReachable === false) {
      Alert.alert(
        "🔌 You are offline",
        "You can keep using the app! Your changes will be saved locally and synced when you are back online.",
      );
    }
  }, [networkState.isConnected, networkState.isInternetReachable]);

  const CustomDefaultTheme: Theme = {
    ...DefaultTheme,
    dark: false,
    colors: {
      primary: "rgb(0, 122, 255)",
      background: "rgb(242, 242, 247)",
      card: "rgb(255, 255, 255)",
      text: "rgb(0, 0, 0)",
      border: "rgb(216, 216, 220)",
      notification: "rgb(255, 59, 48)",
    },
  };

  const CustomDarkTheme: Theme = {
    ...DarkTheme,
    colors: {
      primary: "rgb(10, 132, 255)",
      background: "rgb(1, 1, 1)",
      card: "rgb(28, 28, 30)",
      text: "rgb(255, 255, 255)",
      border: "rgb(44, 44, 46)",
      notification: "rgb(255, 69, 58)",
    },
  };

  return (
    <DevErrorBoundary>
      <StatusBar style="auto" animated />
      <ThemeProvider value={colorScheme === "dark" ? CustomDarkTheme : CustomDefaultTheme}>
        <SafeAreaProvider>
          <GestureHandlerRootView>
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="role" options={{ headerShown: false }} />
              <Stack.Screen name="auth/[role]" options={{ headerShown: false }} />
              <Stack.Screen name="onboarding/[role]" options={{ headerShown: false }} />
              {/* Main app with tabs */}
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              {/* Detail screens */}
              <Stack.Screen name="shift/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="apply/[id]" options={{ headerShown: false }} />
            </Stack>
            <SystemBars style={"auto"} />
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </ThemeProvider>
    </DevErrorBoundary>
  );
}
