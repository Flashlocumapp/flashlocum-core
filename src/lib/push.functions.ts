// Client-callable server functions for push-notification device tokens.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Platform = "ios" | "android" | "web";
const PLATFORMS: Platform[] = ["ios", "android", "web"];

export const registerDeviceTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string; platform: Platform; appVersion?: string }) => {
    if (!input?.token || typeof input.token !== "string" || input.token.length < 10) {
      throw new Error("Invalid push token");
    }
    if (!PLATFORMS.includes(input.platform)) throw new Error("Invalid platform");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("device_tokens")
      .upsert(
        {
          user_id: userId,
          token: data.token,
          platform: data.platform,
          app_version: data.appVersion ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "token" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unregisterDeviceTokenFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string }) => {
    if (!input?.token) throw new Error("Missing token");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("device_tokens")
      .delete()
      .eq("user_id", userId)
      .eq("token", data.token);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
