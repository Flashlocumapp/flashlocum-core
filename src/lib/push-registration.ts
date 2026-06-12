// Client-side push registration. Runs only inside the Capacitor native shell;
// in the browser this is a no-op so the deployed web app is unaffected.

import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { subscribeAuthState, type AuthReadySnapshot } from "@/lib/auth-ready";
import { registerDeviceTokenFn, unregisterDeviceTokenFn } from "@/lib/push.functions";

type Platform = "ios" | "android";

let initialized = false;
let currentToken: string | null = null;
let currentUserId: string | null = null;

async function loadPlugin() {
  // Dynamic import so the browser bundle never tries to resolve the native code.
  const mod = await import("@capacitor/push-notifications");
  return mod.PushNotifications;
}

function nativePlatform(): Platform | null {
  if (!Capacitor.isNativePlatform()) return null;
  const p = Capacitor.getPlatform();
  if (p === "ios" || p === "android") return p;
  return null;
}

async function setupListeners(
  register: ReturnType<typeof useServerFn<typeof registerDeviceTokenFn>>,
  platform: Platform,
) {
  const PushNotifications = await loadPlugin();
  PushNotifications.addListener("registration", (token) => {
    currentToken = token.value;
    if (!currentUserId) return;
    register({ data: { token: token.value, platform } }).catch((e: unknown) => {
      console.warn("[push] register failed:", (e as Error).message);
    });
  });
  PushNotifications.addListener("registrationError", (err) => {
    console.warn("[push] registration error:", err);
  });
}

async function requestAndRegister() {
  const platform = nativePlatform();
  if (!platform) return;
  const PushNotifications = await loadPlugin();
  const perm = await PushNotifications.checkPermissions();
  let granted = perm.receive === "granted";
  if (!granted) {
    const req = await PushNotifications.requestPermissions();
    granted = req.receive === "granted";
  }
  if (!granted) return;
  await PushNotifications.register();
}

/**
 * Mount once at the root. Registers for push on sign-in (native shells only)
 * and unregisters the current device's token on sign-out.
 */
export function usePushRegistration() {
  const register = useServerFn(registerDeviceTokenFn);
  const unregister = useServerFn(unregisterDeviceTokenFn);

  useEffect(() => {
    const platform = nativePlatform();
    if (!platform) return; // browser: no-op

    let cancelled = false;
    if (!initialized) {
      initialized = true;
      void setupListeners(register, platform);
    }

    const onChange = (snap: AuthReadySnapshot) => {
      if (cancelled) return;
      const nextUserId = snap.userId;
      if (nextUserId && nextUserId !== currentUserId) {
        currentUserId = nextUserId;
        if (currentToken) {
          register({ data: { token: currentToken, platform } }).catch(() => undefined);
        } else {
          void requestAndRegister();
        }
      } else if (!nextUserId && currentUserId) {
        const prevToken = currentToken;
        currentUserId = null;
        if (prevToken) {
          unregister({ data: { token: prevToken } }).catch(() => undefined);
        }
      }
    };
    const unsub = subscribeAuthState(onChange);
    return () => {
      cancelled = true;
      unsub();
    };
  }, [register, unregister]);
}
