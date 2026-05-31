// FlashLocum now runs on Lovable Cloud. Re-export the managed client so all
// existing imports (@/lib/supabase) keep working unchanged.
export { supabase } from "@/integrations/supabase/client";
