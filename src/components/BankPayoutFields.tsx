// Reusable bank payout selector: bank dropdown (Monnify list) +
// 10-digit account number + auto-resolved account name.
//
// Used by onboarding and the Account tab so doctors confirm the
// verified name on file before saving.

import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listMonnifyBanks,
  resolveBankAccountName,
  type MonnifyBank,
} from "@/lib/monnify/banks.functions";
import { isReasonableNameMatch } from "@/lib/name-match";

export type BankPayoutPatch = {
  bankName?: string;
  bankCode?: string;
  bankAccount?: string;
  bankAccountName?: string;
};

export function BankPayoutFields({
  bankName,
  bankCode,
  bankAccount,
  bankAccountName,
  expectedName,
  onChange,
}: {
  bankName?: string | null;
  bankCode?: string | null;
  bankAccount?: string | null;
  bankAccountName?: string | null;
  /** Doctor's profile name. When provided, the resolved bank account
   *  name must reasonably match before the parent should let the form
   *  submit (parent can read `bankAccountName` and rerun the matcher). */
  expectedName?: string | null;
  onChange: (patch: BankPayoutPatch) => void;
}) {
  const mismatched =
    !!expectedName &&
    !!bankAccountName &&
    !isReasonableNameMatch(expectedName, bankAccountName);
  const [banks, setBanks] = useState<MonnifyBank[]>([]);
  const [banksLoading, setBanksLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchBanks = useServerFn(listMonnifyBanks);
  const resolveName = useServerFn(resolveBankAccountName);
  const lastResolvedKeyRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchBanks();
        if (!cancelled) setBanks(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load banks");
      } finally {
        if (!cancelled) setBanksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchBanks]);

  // Auto-resolve account name whenever both bankCode and a 10-digit account are present.
  useEffect(() => {
    const acct = (bankAccount ?? "").trim();
    const code = (bankCode ?? "").trim();
    if (!code || acct.length !== 10) return;
    const key = `${code}:${acct}`;
    if (key === lastResolvedKeyRef.current) return;
    lastResolvedKeyRef.current = key;
    setResolving(true);
    setError(null);
    onChange({ bankAccountName: "" });
    let cancelled = false;
    (async () => {
      try {
        const result = await resolveName({
          data: { bankCode: code, accountNumber: acct },
        });
        if (cancelled) return;
        if (result.ok) {
          onChange({ bankAccountName: result.accountName });
        } else {
          setError(result.error);
          onChange({ bankAccountName: "" });
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not verify account");
        onChange({ bankAccountName: "" });
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally exclude onChange / resolveName so the effect only re-runs on data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCode, bankAccount]);

  return (
    <>
      <div>
        <label className="text-[12px] font-medium text-muted-foreground">Bank name</label>
        <select
          value={bankCode ?? ""}
          disabled={banksLoading}
          onChange={(e) => {
            const code = e.target.value;
            const match = banks.find((b) => b.code === code);
            lastResolvedKeyRef.current = "";
            onChange({
              bankCode: code || undefined,
              bankName: match?.name ?? "",
              bankAccountName: "",
            });
          }}
          className="mt-1.5 h-12 w-full appearance-none rounded-2xl bg-secondary px-4 text-[15px] outline-none disabled:opacity-60"
        >
          <option value="">{banksLoading ? "Loading banks…" : "Select bank…"}</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-[12px] font-medium text-muted-foreground">Account number</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="0123456789"
          value={bankAccount ?? ""}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 10);
            if (v !== (bankAccount ?? "")) lastResolvedKeyRef.current = "";
            onChange({ bankAccount: v, bankAccountName: "" });
          }}
          className="mt-1.5 h-12 w-full rounded-2xl bg-secondary px-4 text-[15px] outline-none placeholder:text-muted-foreground/70"
        />
      </div>

      <div>
        <label className="text-[12px] font-medium text-muted-foreground">Account name</label>
        <div
          className="mt-1.5 flex h-12 w-full items-center rounded-2xl px-4 text-[15px]"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          {resolving ? (
            <span className="text-muted-foreground">Verifying…</span>
          ) : bankAccountName ? (
            <span className="font-medium">{bankAccountName}</span>
          ) : error ? (
            <span className="text-[13px] text-destructive">{error}</span>
          ) : (
            <span className="text-muted-foreground">
              Pick a bank and enter your 10-digit account
            </span>
          )}
        </div>
        {mismatched && (
          <p className="mt-1.5 text-[12.5px] text-destructive">
            Account name does not match the name on your profile. Please check your details.
          </p>
        )}
      </div>
    </>
  );
}
