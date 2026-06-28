// Server functions: Monnify bank list + account-name resolution.
// Used by onboarding and the Account tab so doctors can pick their bank
// and see the verified account holder name before saving.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MonnifyBank = { name: string; code: string };

export const listMonnifyBanks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<MonnifyBank[]> => {
    const { monnifyFetch } = await import("./client.server");
    const banks = await monnifyFetch<MonnifyBank[]>("/api/v1/banks");
    // Sort alphabetically for a stable dropdown.
    return [...banks].sort((a, b) => a.name.localeCompare(b.name));
  });

const ResolveSchema = z.object({
  bankCode: z.string().min(2).max(10),
  accountNumber: z.string().regex(/^\d{10}$/u, "Account number must be 10 digits"),
});

export type ResolveBankAccountResult =
  { ok: true; accountName: string } | { ok: false; error: string };

export const resolveBankAccountName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ResolveSchema.parse(data))
  .handler(async ({ data }): Promise<ResolveBankAccountResult> => {
    const { monnifyFetch } = await import("./client.server");
    const params = new URLSearchParams({
      accountNumber: data.accountNumber,
      bankCode: data.bankCode,
    });
    try {
      const res = await monnifyFetch<{
        accountName: string;
        accountNumber: string;
        bankCode: string;
      }>(`/api/v1/disbursements/account/validate?${params.toString()}`);
      return { ok: true, accountName: res.accountName };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/invalid account details|not found|404/i.test(msg)) {
        return { ok: false, error: "Account not found. Check the number and selected bank." };
      }
      console.error("Monnify account validation error:", e);
      return { ok: false, error: "Couldn't verify account right now. Please try again." };
    }
  });
