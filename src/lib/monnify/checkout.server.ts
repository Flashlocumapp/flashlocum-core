// Server-only: initiates a Monnify hosted-checkout transaction with split config.

import { getMonnifyContractCode, monnifyFetch } from "./client.server";

export const DOCTOR_SPLIT_PERCENTAGE = 85; // 15% retained by FlashLocum main wallet

export type InitTxInput = {
  amount: number; // NGN
  paymentReference: string;
  paymentDescription: string;
  customerEmail: string;
  customerName: string;
  redirectUrl: string;
  doctorSubAccountCode: string;
};

type InitTxResp = {
  checkoutUrl: string;
  paymentReference: string;
  transactionReference: string;
};

export async function initiateSplitCheckout(input: InitTxInput): Promise<InitTxResp> {
  const body = {
    amount: input.amount,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    paymentReference: input.paymentReference,
    paymentDescription: input.paymentDescription,
    currencyCode: "NGN",
    contractCode: getMonnifyContractCode(),
    redirectUrl: input.redirectUrl,
    paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD"],
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
