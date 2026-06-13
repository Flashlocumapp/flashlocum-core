import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type VerificationStatus = "pending" | "approved" | "suspended" | "rejected";
const ALLOWED: VerificationStatus[] = ["pending", "approved", "suspended", "rejected"];

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** Server-authoritative admin gate. Returns true only if the calling user has the 'admin' role. */
export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (error) throw new Error(error.message);
    return { isAdmin: !!data };
  });

/** Update a doctor's verification status. Server-side admin check; runs as the signed-in admin so DB triggers allow the change. */
export const updateDoctorVerificationFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { doctorId: string; status: VerificationStatus }) => {
    if (!isUuid(input?.doctorId)) throw new Error("Invalid doctor id");
    if (!ALLOWED.includes(input?.status)) throw new Error("Invalid status");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const { error } = await context.supabase
      .from("profiles")
      .update({ verification_status: data.status })
      .eq("id", data.doctorId)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    // Notify the doctor of the verification decision.
    try {
      const { sendPushToUser } = await import("@/lib/push.server");
      const titleByStatus: Record<VerificationStatus, string> = {
        approved: "You're approved",
        rejected: "Verification update",
        suspended: "Account suspended",
        pending: "Verification pending",
      };
      const bodyByStatus: Record<VerificationStatus, string> = {
        approved: "You can now accept shifts on FlashLocum.",
        rejected: "Your verification was not approved. Open the app for details.",
        suspended: "Your account has been suspended. Contact support.",
        pending: "Your account is back under review.",
      };
      await sendPushToUser(data.doctorId, {
        title: titleByStatus[data.status],
        body: bodyByStatus[data.status],
        data: { type: "verification_status", status: data.status },
      });
    } catch (e) {
      console.warn("[verify-notify] push failed:", (e as Error).message);
    }

    return { ok: true };
  });
