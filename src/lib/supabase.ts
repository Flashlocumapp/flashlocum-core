import { createClient } from "@supabase/supabase-js";

/**
 * FlashLocum — custom Supabase client for the user's own Supabase project.
 *
 * URL and publishable (anon) key are safe to ship in the browser bundle.
 * Server-only secrets (service role key) are NEVER imported here.
 */
const SUPABASE_URL = "https://uqaggzxzbmjktvhzzcik.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_V-NnqYUzKobVXbyubgXPYA_5Q5yjsnS";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});
