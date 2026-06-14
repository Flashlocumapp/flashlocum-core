## Monnify Split Payment Integration

### How it will work (end-to-end)

1. Doctor ends a shift → Settlement screen shows the amount.
2. Requester taps **Pay with Monnify** → app calls a server function that:
   - Looks up the assigned doctor's bank details (`bank_name`, `bank_account`).
   - If the doctor doesn't yet have a Monnify sub-account, creates one via Monnify's `/api/v1/sub-accounts` and stores its `subAccountCode` on the doctor's profile.
   - Initializes a Monnify transaction with an `incomeSplitConfig` → **85% to the doctor's sub-account, 15% (remainder) stays with FlashLocum's main wallet**.
   - Returns the Monnify hosted-checkout URL.
3. Requester is redirected to Monnify, pays, and is returned to the app.
4. Monnify hits our webhook (`/api/public/monnify-webhook`) with the result; webhook verifies the HMAC signature, marks the `coverage_request` as paid, and triggers the existing "Settlement confirmed" UI on the next poll.

### Database changes (one migration)

- **profiles**: add `monnify_sub_account_code TEXT` (nullable).
- **coverage_requests**: add
  - `payment_provider TEXT` (default `null`)
  - `payment_reference TEXT` (Monnify `paymentReference`)
  - `payment_status TEXT` (`pending` | `paid` | `failed`)
  - `payment_url TEXT` (last-issued checkout link, for resume)
  - `paid_at TIMESTAMPTZ`
- New SECURITY DEFINER RPC `mark_settlement_paid(_payment_reference, _amount)` — called by the webhook (which runs as service role anyway, but the RPC keeps the update atomic and idempotent).

### Server code (TanStack `createServerFn` + one server route)

```
src/lib/monnify/
├── client.server.ts        # auth (Basic → access_token, cached), low-level fetch helpers
├── sub-accounts.server.ts  # ensureSubAccountForDoctor()
├── checkout.server.ts      # initiateSettlementCheckout()
└── webhook.server.ts       # verifyMonnifySignature(), handleEvent()

src/lib/settlement.functions.ts
└── beginSettlementCheckout  # createServerFn, requireSupabaseAuth
                              # input: { requestId }
                              # returns: { checkoutUrl, paymentReference }

src/routes/api/public/monnify-webhook.ts
└── POST handler             # verifies monnify-signature header (HMAC-SHA512 of raw body
                              # using MONNIFY_SECRET_KEY), then calls mark_settlement_paid
                              # via supabaseAdmin RPC.
```

Secrets used (all already saved): `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_BASE_URL`.

### Frontend changes

- `src/features/request/ShiftSettlement.tsx` — replace the static "Providus Bank / 0123456789 + I've Made Payment" block with a single **Pay with Monnify** button. On click:
  - call `beginSettlementCheckout({ requestId })`,
  - open the returned `checkoutUrl` in a new tab,
  - poll `coverage_requests.payment_status` every 3 s (or use the existing realtime subscription) → when `paid`, transition to the existing `confirmed` pane.
- Keep the manual "I've Made Payment" fallback hidden behind a small "Paid offline?" link for now (admin-only marking later).

### Doctor onboarding note

The doctor must have `bank_name` + `bank_account` on their profile before a requester can pay them — those are already collected during cover onboarding. If missing at checkout time, `beginSettlementCheckout` throws a friendly error: *"This doctor hasn't completed payout setup yet."*

### What I will NOT touch

- Pricing logic, timers, overtime math — untouched.
- `RatingOverlay`, confirmation pane — untouched (just reached via the new webhook trigger instead of the simulated timer).
- Existing simulated "I've Made Payment" demo flow stays as an admin/test fallback.

### Test plan

1. Run a sandbox shift end-to-end with a test doctor whose bank fields are set; confirm a sub-account is created (logged), checkout URL returned, and after sandbox payment the webhook flips `payment_status = paid`.
2. Replay the webhook with a tampered body → must return 401.
3. Replay the same valid webhook twice → second call is a no-op (idempotent on `payment_reference`).

Approve and I'll ship it.