// Server-only: ensures a doctor has a Monnify sub-account so split payouts
// can be routed to their bank account.

import { monnifyFetch } from "./client.server";

type Bank = { name: string; code: string };
type SubAccountResp = {
  subAccountCode: string;
  bankCode: string;
  accountNumber: string;
  accountName?: string;
};

let bankCache: { fetchedAt: number; banks: Bank[] } | null = null;

async function listBanks(): Promise<Bank[]> {
  if (bankCache && Date.now() - bankCache.fetchedAt < 24 * 60 * 60 * 1000) {
    return bankCache.banks;
  }
  const body = await monnifyFetch<Bank[]>("/api/v1/banks");
  bankCache = { fetchedAt: Date.now(), banks: body };
  return body;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\b(bank|plc|limited|ltd|nigeria)\b/g, "").replace(/[^a-z0-9]/g, "");
}

export async function resolveBankCode(bankName: string): Promise<string> {
  const banks = await listBanks();
  const target = normalize(bankName);
  // exact normalized match first
  const exact = banks.find((b) => normalize(b.name) === target);
  if (exact) return exact.code;
  // unique substring match
  const partial = banks.filter(
    (b) => normalize(b.name).includes(target) || target.includes(normalize(b.name)),
  );
  if (partial.length === 1) return partial[0].code;
  throw new Error(
    `Could not resolve "${bankName}" to a Monnify bank code. Please update the doctor's bank name to match an official bank name.`,
  );
}

export type EnsureSubAccountInput = {
  bankName: string;
  bankAccount: string;
  email: string;
  splitPercentageToDoctor: number; // 0–100
};

export async function createSubAccount(input: EnsureSubAccountInput): Promise<SubAccountResp> {
  const bankCode = await resolveBankCode(input.bankName);
  const body = [
    {
      currencyCode: "NGN",
      bankCode,
      accountNumber: input.bankAccount,
      email: input.email,
      defaultSplitPercentage: input.splitPercentageToDoctor,
    },
  ];
  const res = await monnifyFetch<SubAccountResp[]>("/api/v1/sub-accounts", {
    method: "POST",
    body,
  });
  if (!res?.[0]?.subAccountCode) {
    throw new Error("Monnify did not return a sub-account code");
  }
  return res[0];
}
