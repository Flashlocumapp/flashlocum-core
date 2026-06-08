// Server function: starts a Monnify split checkout for a coverage request.
// Called by the requester from ShiftSettlement.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  requestId: z.string().uuid(),
  amount: z.number().int().positive().max(50_000_000),
});

export const beginSettlementCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Load the coverage request — RLS scopes to requester or assigned doctor.
    const { data: reqRow, error: reqErr } = await supabase
      .from("coverage_requests")
      .select("id, requester_id, accepted_by, hospital, status, payment_reference, payment_status, payment_url")
      .eq("id", data.requestId)
      .maybeSingle();
    if (reqErr || !reqRow) throw new Error("Coverage request not found");
    if (reqRow.requester_id !== userId) throw new Error("Only the requester can pay this settlement");
    if (!reqRow.accepted_by) throw new Error("No assigned doctor yet");
    if (reqRow.payment_status === "paid") {
      throw new Error("This settlement has already been paid");
    }



    // 2. Load the doctor's profile (admin client; we already authorised via RLS above).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: doctor, error: docErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, bank_name, bank_account, bank_account_name, monnify_sub_account_code")
      .eq("id", reqRow.accepted_by)
      .maybeSingle();
    if (docErr || !doctor) throw new Error("Doctor profile unavailable");
    if (!doctor.bank_name || !doctor.bank_account || !doctor.bank_account_name) {
      throw new Error(
        "The assigned doctor hasn't finished setting up a verified payout account yet. Please ask them to complete it before paying.",
      );
    }

    // 3. Requester identity (for the Monnify checkout customer fields).
    const { data: requesterAuth } = await supabaseAdmin.auth.admin.getUserById(userId);
    const customerEmail = requesterAuth?.user?.email ?? `${userId}@flashlocum.app`;
    const { data: requesterProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    const customerName = requesterProfile?.full_name ?? "FlashLocum Requester";

    // 4. Doctor email for sub-account creation.
    const { data: doctorAuth } = await supabaseAdmin.auth.admin.getUserById(reqRow.accepted_by);
    const doctorEmail = doctorAuth?.user?.email ?? `${reqRow.accepted_by}@flashlocum.app`;

    // 5. Ensure the doctor has a Monnify sub-account; persist on first create.
    let subAccountCode = doctor.monnify_sub_account_code;
    if (!subAccountCode) {
      const { createSubAccount } = await import("./monnify/sub-accounts.server");
      const { DOCTOR_SPLIT_PERCENTAGE } = await import("./monnify/checkout.server");
      try {
        const created = await createSubAccount({
          bankName: doctor.bank_name,
          bankAccount: doctor.bank_account,
          email: doctorEmail,
          splitPercentageToDoctor: DOCTOR_SPLIT_PERCENTAGE,
        });
        subAccountCode = created.subAccountCode;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[settlement] createSubAccount failed:", msg);
        if (/invalid account details/i.test(msg)) {
          throw new Error(
            "The doctor's bank account couldn't be verified by our payment provider. Please ask them to re-enter their payout details and try again.",
          );
        }
        if (/could not resolve/i.test(msg)) {
          throw new Error(
            "The doctor's bank name isn't recognised by our payment provider. Please ask them to re-select their bank from the list.",
          );
        }
        throw new Error("Couldn't set up the payout split right now. Please try again in a moment.");
      }
      await supabaseAdmin
        .from("profiles")
        .update({ monnify_sub_account_code: subAccountCode })
        .eq("id", doctor.id);
    }

    // 6. Initiate transaction + resolve one-time virtual account for in-app UI.
    const paymentReference = reqRow.payment_reference && reqRow.payment_status === "pending"
      ? reqRow.payment_reference
      : `flsh_${reqRow.id.replace(/-/g, "").slice(0, 16)}_${Date.now()}`;

    const { initiateSplitTransaction, initBankTransferAccount } = await import(
      "./monnify/checkout.server"
    );

    let txRef: string;
    try {
      const tx = await initiateSplitTransaction({
        amount: data.amount,
        paymentReference,
        paymentDescription: `FlashLocum cover — ${reqRow.hospital}`,
        customerEmail,
        customerName,
        doctorSubAccountCode: subAccountCode!,
      });
      txRef = tx.transactionReference;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[settlement] initiateSplitTransaction failed:", msg);
      throw new Error("Couldn't start the payment. Please try again.");
    }

    let account;
    try {
      account = await initBankTransferAccount(txRef);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[settlement] initBankTransferAccount failed:", msg);
      throw new Error("Couldn't generate a transfer account. Please try again.");
    }

    // 7. Persist reference + pending status.
    await supabaseAdmin
      .from("coverage_requests")
      .update({
        payment_provider: "monnify",
        payment_reference: paymentReference,
        payment_status: "pending",
        payment_url: null,
      })
      .eq("id", reqRow.id);

    return {
      amount: account.amount,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      bankName: account.bankName,
      expiresOn: account.expiresOn ?? null,
      paymentReference: account.paymentReference,
    };
  });


