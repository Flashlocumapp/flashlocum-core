// Server-only: initiates a Monnify transaction with split config and resolves
// a one-time virtual account so we can render a custom in-app transfer UI.

import { getMonnifyContractCode, monnifyFetch } from "./client.server";

export const DOCTOR_SPLIT_PERCENTAGE = 85; // 15% retained by FlashLocum main wallet

export type InitTxInput = {
  amount: number; // NGN
  paymentReference: string;
  paymentDescription: string;
  customerEmail: string;
  customerName: string;
  doctorSubAccountCode: string;
};

type InitTxResp = {
  paymentReference: string;
  transactionReference: string;
};

export type VirtualAccountDetails = {
  accountNumber: string;
  accountName: string;
  bankName: string;
  amount: number;
  expiresOn?: string;
  transactionReference: string;
  paymentReference: string;
};

export async function initiateSplitTransaction(input: InitTxInput): Promise<InitTxResp> {
  const body = {
    amount: input.amount,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    paymentReference: input.paymentReference,
    paymentDescription: input.paymentDescription,
    currencyCode: "NGN",
    contractCode: getMonnifyContractCode(),
    paymentMethods: ["ACCOUNT_TRANSFER"],
    incomeSplitConfig: [
      {
        subAccountCode: input.doctorSubAccountCode,
        splitPercentage: DOCTOR_SPLIT_PERCENTAGE,
        feeBearer: true,
      },
    ],
  };
  return monnifyFetch<InitTxResp>("/api/v1/merchant/transactions/init-transaction", {
    method: "POST",
    body,
  });
}

/**
 * Resolve a one-time virtual bank account for an initiated transaction.
 * Bank is chosen by Monnify when bankCode is omitted.
 */
export async function initBankTransferAccount(
  transactionReference: string,
): Promise<VirtualAccountDetails> {
  return monnifyFetch<VirtualAccountDetails>("/api/v1/merchant/bank-transfer/init-payment", {
    method: "POST",
    body: { transactionReference },
  });
}

export type TxStatus = {
  paymentStatus?: string;
  amountPaid?: number | string;
  totalPayable?: number | string;
  paymentReference?: string;
  transactionReference?: string;
};

/** Query Monnify for the latest status of a transaction by our paymentReference. */
export async function queryTransactionStatus(paymentReference: string): Promise<TxStatus> {
  const ref = encodeURIComponent(paymentReference);
  return monnifyFetch<TxStatus>(`/api/v2/merchant/transactions/query?paymentReference=${ref}`, {
    method: "GET",
  });
}
