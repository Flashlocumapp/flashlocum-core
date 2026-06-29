import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://htscseakhgwskubrvrgs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0c2NzZWFraGd3c2t1YnJ2cmdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwOTU2NzgsImV4cCI6MjA5NTY3MTY3OH0.1qIOzQ_dVcGkJUduLoxYxxtiUELxwqtOVRGTwppwQ60";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
