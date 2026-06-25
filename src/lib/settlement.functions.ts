// Server function: starts a Monnify split checkout for a coverage request.
// Called by the requester from ShiftSettlement.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Server is the SOLE source of truth for the payment amount. Clients
// no longer submit an amount — we read `total_billed_amount`, written by
// end_shift, directly from the row.
const InputSchema = z.object({
  requestId: z.string().uuid(),
});

export const beginSettlementCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // 1. Load the coverage request. `payment_account` (cached virtual bank-
    //    account JSON) is restricted from the regular authenticated role at
    //    the column-grant level — only service_role can read it. We use the
    //    admin client here and re-assert authorization explicitly: the caller
    //    MUST be the requester on this row.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reqRow, error: reqErr } = await supabaseAdmin
      .from("coverage_requests")
      .select("id, requester_id, accepted_by, hospital, status, payment_reference, payment_status, payment_url, payment_account, total_billed_amount, billing_locked_at")
      .eq("id", data.requestId)
      .maybeSingle();
    if (reqErr || !reqRow) throw new Error("Coverage request not found");
    if (reqRow.requester_id !== userId) throw new Error("Only the requester can pay this settlement");
    if (!reqRow.accepted_by) throw new Error("No assigned doctor yet");
    if (reqRow.payment_status === "paid") {
      return {
        alreadyPaid: true as const,
        paymentReference: reqRow.payment_reference ?? null,
        checkoutUrl: reqRow.payment_url ?? null,
      };
    }

    // SERVER-AUTHORITATIVE AMOUNT. end_shift must have run; no client input.
    const serverAmount = Math.max(0, Math.round(Number(reqRow.total_billed_amount ?? 0)));
    if (!reqRow.billing_locked_at) {
      throw new Error("Shift is not ready for payment — end the shift first.");
    }
    // Zero-billed shift (e.g. paused/ended within seconds): nothing to charge.
    // Finalize as paid for ₦0 instead of throwing, so the UI can close cleanly.
    if (serverAmount <= 0) {
      const { error: rpcErr } = await supabaseAdmin.rpc("mark_settlement_paid", {
        _payment_reference: reqRow.payment_reference ?? `flsh_zero_${reqRow.id.replace(/-/g, "").slice(0, 16)}`,
        _amount: 0,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      return { alreadyPaid: true as const, paymentReference: reqRow.payment_reference ?? null, checkoutUrl: null };
    }

    // 1b. RESUME-IF-PENDING. If a pending reference + cached virtual-account
    // is already attached to this row, return it verbatim instead of minting
    // a new reference. Without this, every retry (sheet re-mount, double-tap,
    // realtime-driven re-render) overwrote `payment_reference`, orphaning any
    // Monnify webhook for the previous reference — the row stayed "pending"
    // forever and the screen spun until timeout.
    if (
      reqRow.payment_status === "pending" &&
      reqRow.payment_reference &&
      reqRow.payment_account &&
      typeof reqRow.payment_account === "object"
    ) {
      const acc = reqRow.payment_account as {
        amount?: number;
        accountNumber?: string;
        accountName?: string;
        bankName?: string;
        expiresOn?: string | null;
      };
      const cachedAmount = Math.round(Number(acc.amount ?? 0));
      const amountMatches = cachedAmount === serverAmount;
      const notExpired = !acc.expiresOn || Date.parse(acc.expiresOn) > Date.now();
      if (acc.accountNumber && acc.bankName && amountMatches && notExpired) {
        return {
          amount: serverAmount,
          accountNumber: acc.accountNumber,
          accountName: acc.accountName ?? "FlashLocum",
          bankName: acc.bankName,
          expiresOn: acc.expiresOn ?? null,
          paymentReference: reqRow.payment_reference,
        };
      }
      // Cache stale (amount changed or expired) — fall through and mint a fresh
      // reference + virtual account against the current server amount.
      if (!amountMatches) {
        console.info("[settlement] cached payment_account amount mismatch — minting fresh", {
          cachedAmount,
          serverAmount,
        });
      }
    }




    // 2. Load the doctor's profile (admin client; we already authorised via explicit requester check above).
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
        throw new Error(`Couldn't set up the payout split: ${msg}`);
      }
      await supabaseAdmin
        .from("profiles")
        .update({ monnify_sub_account_code: subAccountCode })
        .eq("id", doctor.id);
    }

    // 6. Initiate transaction + resolve one-time virtual account for in-app UI.
    // Always mint a fresh reference — Monnify rejects duplicates (422).
    // Format: flsh_<requestId16>_<ms>_<rand8>. The random suffix prevents
    // collisions on rapid retries within the same millisecond (double-tap,
    // concurrent retries) where Date.now() alone is not unique.
    const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const paymentReference = `flsh_${reqRow.id.replace(/-/g, "").slice(0, 16)}_${Date.now()}_${rand}`;


    const { initiateSplitTransaction, initBankTransferAccount } = await import(
      "./monnify/checkout.server"
    );

    let txRef: string;
    try {
      const tx = await initiateSplitTransaction({
        amount: serverAmount,
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
      if (/invalid merchant to contract code/i.test(msg)) {
        throw new Error(
          "Payments aren't configured correctly: the Monnify contract code doesn't match the API key (likely a sandbox/live or wrong-account mismatch). Please update MONNIFY_CONTRACT_CODE / MONNIFY_API_KEY / MONNIFY_SECRET_KEY so all three are from the same Monnify account and environment.",
        );
      }
      throw new Error(`Couldn't start the payment: ${msg}`);
    }

    // Monnify's bank-transfer/init-payment occasionally returns a transient
    // 5xx ("There was an error processing the request"). Retry with backoff
    // before surfacing a user-facing error.
    let account;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        account = await initBankTransferAccount(txRef);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const transient = /\(5\d\d\)/.test(msg) || /processing the request/i.test(msg);
        console.error(`[settlement] initBankTransferAccount attempt ${attempt} failed:`, msg);
        if (!transient || attempt === 3) break;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    if (!account) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      const transient = /\(5\d\d\)/.test(msg) || /processing the request/i.test(msg);
      throw new Error(
        transient
          ? "Our payment provider is having a temporary issue generating a transfer account. Please try again in a moment."
          : "Couldn't generate a transfer account. Please try again.",
      );
    }

    // 7. Persist reference + cached virtual-account so a retry returns the
    // SAME reference (see "RESUME-IF-PENDING" above) — protects against
    // sheet re-mounts / double-taps overwriting an in-flight payment ref.
    await supabaseAdmin
      .from("coverage_requests")
      .update({
        payment_provider: "monnify",
        payment_reference: paymentReference,
        payment_status: "pending",
        payment_url: null,
        payment_account: {
          amount: account.amount,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
          bankName: account.bankName,
          expiresOn: account.expiresOn ?? null,
        },
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



// --- Dev-only: simulate Monnify webhook for sandbox testing ---
const SimInput = z.object({ requestId: z.string().uuid() });


// --- Reconcile: poll Monnify directly when the webhook hasn't landed yet ---
// Useful in sandbox (webhook can't reach localhost) and as a production
// safety net for delayed/missed webhooks.
const VerifyInput = z.object({ requestId: z.string().uuid() });

export const verifySettlementPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => VerifyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Authorization via RLS: the user-scoped client only returns rows the
    // caller is the requester or assigned doctor on. Matches the
    // authorization model used by beginSettlementCheckout.
    const { data: row, error } = await supabase
      .from("coverage_requests")
      .select("id, requester_id, accepted_by, payment_reference, payment_status, settled_amount")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Not authorized");
    // Defense-in-depth: even if RLS were misconfigured, only the requester
    // or assigned doctor may verify payment.
    if (row.requester_id !== userId && row.accepted_by !== userId) {
      throw new Error("Not authorized");
    }
    if (row.payment_status === "paid") return { paid: true, alreadyPaid: true };
    if (!row.payment_reference) return { paid: false, reason: "no_reference" as const };

    const { queryTransactionStatus } = await import("./monnify/checkout.server");
    let status;
    try {
      status = await queryTransactionStatus(row.payment_reference);
    } catch (e) {
      console.warn("[verifySettlementPayment] query failed:", e);
      return { paid: false, reason: "query_failed" as const };
    }
    const s = (status.paymentStatus ?? "").toUpperCase();
    const isPaid = s === "PAID" || s === "OVERPAID" || s === "SUCCESS" || s === "SUCCESSFUL_TRANSACTION";
    if (!isPaid) return { paid: false, status: s };

    const amount = Math.max(
      0,
      Math.round(Number(status.amountPaid ?? status.totalPayable ?? row.settled_amount ?? 0)),
    );

    // SINGLE COMPLETION PATH: only the Monnify webhook is allowed to flip a
    // production shift to paid. In production we return the Monnify status
    // for UI display but never call mark_settlement_paid — the webhook is
    // the authoritative trigger. The dev/sandbox triple guard mirrors the
    // one in simulateSettlementPayment.
    const base = (process.env.MONNIFY_BASE_URL ?? "").toLowerCase();
    const nodeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
    const verifyEnabled = (process.env.ALLOW_PAYMENT_SIMULATION ?? "").toLowerCase() === "true";
    const isSandboxHost = /(^|[./-])sandbox\.monnify\.com/i.test(base) || /sandbox-api\.monnify/i.test(base);
    const isProdEnv = nodeEnv === "production";
    if (isProdEnv || !isSandboxHost || !verifyEnabled) {
      return { paid: false, reason: "webhook_only" as const, status: s };
    }

    // Admin client only for the privileged RPC that flips payment_status.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: rpcErr } = await supabaseAdmin.rpc("mark_settlement_paid", {
      _payment_reference: row.payment_reference,
      _amount: amount,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    return { paid: true, alreadyPaid: false };
  });

export const simulateSettlementPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SimInput.parse(d))
  .handler(async ({ data, context }) => {
    // Production guard: simulation is only allowed when ALL of these hold:
    //   1. NODE_ENV is not "production"
    //   2. MONNIFY_BASE_URL points at the Monnify sandbox host
    //   3. ALLOW_PAYMENT_SIMULATION env flag is explicitly "true"
    // This server fn marks a settlement as paid without real money moving and
    // must never be reachable against the live Monnify environment, even if
    // a single guard is misconfigured.
    const base = (process.env.MONNIFY_BASE_URL ?? "").toLowerCase();
    const nodeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
    const simEnabled = (process.env.ALLOW_PAYMENT_SIMULATION ?? "").toLowerCase() === "true";
    const isSandboxHost = /(^|[./-])sandbox\.monnify\.com/i.test(base) || /sandbox-api\.monnify/i.test(base);
    const isProdEnv = nodeEnv === "production";
    if (isProdEnv || !isSandboxHost || !simEnabled) {
      throw new Error("Payment simulation is disabled in production");
    }
    const { supabase, userId } = context;
    // Authorization via RLS — same model as beginSettlementCheckout.
    const { data: row, error } = await supabase
      .from("coverage_requests")
      .select("id, requester_id, payment_reference, payment_status, settled_amount")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Not authorized");
    if (row.requester_id !== userId) throw new Error("Not authorized");
    if (!row.payment_reference) throw new Error("No active payment to simulate. Start checkout first.");
    if (row.payment_status === "paid") return { ok: true, alreadyPaid: true };
    // Admin client only for the privileged RPC.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: rpcErr } = await supabaseAdmin.rpc("mark_settlement_paid", {
      _payment_reference: row.payment_reference,
      _amount: row.settled_amount ?? 0,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    return { ok: true, alreadyPaid: false };
  });



