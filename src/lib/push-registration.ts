// Client-side push registration. Runs only inside the Capacitor native shell;
// in the browser this is a no-op so the deployed web app is unaffected.

import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { subscribeAuthState, type AuthReadySnapshot } from "@/lib/auth-ready";
import { registerDeviceTokenFn, unregisterDeviceTokenFn } from "@/lib/push.functions";
import { fromPush, ingest, type EventAudience, type EventKind } from "@/lib/feedback";
import { pushEnabled } from "@/lib/feedback-prefs";

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

  // G10 — foreground push routing. When the app is visible, OS pushes are
  // funnelled through the canonical-event engine so they dedupe against any
  // realtime/local arrival within the 6 s window. iOS shows no banner in
  // foreground by default; on Android the OS may briefly show one — that's
  // fine since the engine also produces the in-app toast/haptic deterministically.
  PushNotifications.addListener("pushNotificationReceived", (n) => {
    try {
      if (!pushEnabled()) return;
      const raw = (n.data ?? {}) as Record<string, unknown>;
      const kind = typeof raw.kind === "string" ? (raw.kind as EventKind) : null;
      const entityId = typeof raw.entityId === "string" ? raw.entityId : null;
      const audience: EventAudience =
        raw.audience === "requester" ? "requester" : "doctor";
      const version = Number(raw.version);
      const occurredAt = Number(raw.occurredAt);
      if (!kind || !entityId || !Number.isFinite(version)) return;
      ingest(
        fromPush({
          kind,
          entityId,
          audience,
          version,
          occurredAt: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
          ctx: {
            title: typeof n.title === "string" ? n.title : undefined,
            body: typeof n.body === "string" ? n.body : undefined,
          },
        }),
      );
    } catch (e) {
      console.warn("[push] foreground ingest failed:", (e as Error).message);
    }
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
