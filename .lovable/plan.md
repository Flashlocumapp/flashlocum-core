## What's broken

When the 15-min Monnify payment window elapses, the screen freezes at 00:00 with the stale ₦2,500 account. No surcharge appears, no new account number/reference, no new countdown — even though the server-side surcharge cron is running.

## Root causes (verified in code + DB)

1. **Surcharge cron updates the row silently.** `drain_surcharge_due()` (migration `20260623033342…`) bumps `payment_due_at`, `total_billed_amount`, `surcharge_amount`, `payment_extension_count` every minute. The cron job is active (`surcharge-drain-every-minute`, every `* * * * *`).

2. **No invalidation broadcast for surcharge.** The `coverage_requests_emit_invalidate` trigger (migration `20260625073003…`) only fires `realtime.send('invalidate', 'coverage_invalidations')` when `status`, `accepted_by`, `broadcast_started_at`, or `rev` change. The surcharge cron changes *none* of those, so subscribed clients are never told to refetch. `net.requests[id].paymentDueAt` / `totalBilledAmount` stay stale forever, so `ShiftSettlement`'s seed effect (which is keyed on `serverPaymentDueAt`) never re-runs.

3. **The cached virtual account is never invalidated.** `coverage_requests.payment_account` (the cached Monnify JSON with the ₦2,500 account number/reference) is left intact by the surcharge cron. Even if the client manually re-invoked `beginSettlementCheckout`, the RESUME-IF-PENDING branch in `settlement.functions.ts` would only refresh when `cachedAmount !== serverAmount` — and it does — but the client never calls it again after the timer hits 00:00 because there is no signal that the row moved on.

4. **Client has no "expired → re-mint" path.** `ShiftSettlement.account` is set once by `startMonnifyCheckout` and never recomputed when `serverPaymentDueAt` / `serverTotalBilledAmount` props change post-expiry.

5. **Misleading UI copy.** The block under PRICE HOLD EXPIRED tells the user to "always use the latest account number and payment reference displayed on this page" — which is currently a lie because the page is *not* refreshing them. Per request, that sentence must go.

## Proper fix (no workarounds)

### A. Database migration — make surcharge a first-class lifecycle event

Update both `extend_payment_window(_request_id)` and `drain_surcharge_due()` in `public`:

1. After applying a surcharge block to a row, also set:
   - `payment_account = NULL`
   - `payment_reference = NULL`
   - `payment_url = NULL`
   This guarantees the next `beginSettlementCheckout` call goes through the fresh-mint branch (the RESUME-IF-PENDING guard requires all three to be present), so the new virtual account is generated against the new `total_billed_amount`.

2. Immediately after each per-row update, call:
   ```sql
   PERFORM realtime.send(
     jsonb_build_object('id', rec.id, 'reason', 'surcharge',
                        'at', (extract(epoch from now())*1000)::bigint),
     'invalidate', 'coverage_invalidations', false);
   ```
   This is the same channel/event the client (`coverage-remote.ts`) already subscribes to, so it will refetch the row and propagate the new `payment_due_at` + `total_billed_amount` into `net.requests[id]` with no extra wiring.

3. Keep the `payment_surcharge_log` insert exactly as it is — auditing is unchanged.

### B. Client — `src/features/request/ShiftSettlement.tsx`

1. Add an effect that watches `serverPaymentDueAt` while `phase` is in `settlement | grace | overtime`. When it changes (i.e. the surcharge cron just bumped the row), do, in order:
   - `setAccount(null)`
   - `setPayState("idle")`
   - `setPayError(null)`
   - `autoOpenedRef.current = false`
   - call `startMonnifyCheckout()`
   The existing seed effect (deps include `serverPaymentDueAt` and `serverTotalBilledAmount`) already re-anchors `phaseStartedAtRef` / `endedAtRef` / `frozenAmountRef` to the new server values, so the visible countdown jumps back to ~15:00 and the headline amount jumps to the new total. No further timer math changes needed.

2. In `CustomTransferPane`:
   - Replace the long sentence under PRICE HOLD EXPIRED with: *"Amount and payment details may change if payment is not completed in time."* (drop the "Always use the latest…" sentence per request).
   - No other copy changes.

### C. No new migrations beyond (A); no schema additions; no `payment_account` column changes.

## Why this is the right fix

- The database remains the single source of truth for amount + deadline (the broadcast model the project mandates).
- The fix closes the loop the surcharge feature was always missing: server state moves → realtime tells clients → client re-mints the Monnify account at the new total.
- It piggybacks on the existing `coverage_invalidations` channel and the existing RESUME-IF-PENDING gate in `settlement.functions.ts` — no new endpoints, no new client polling, no client-side timers that drift from the server.

## Files touched

- `supabase/migrations/<new>.sql` — replace `extend_payment_window` and `drain_surcharge_due` with the two additions above.
- `src/features/request/ShiftSettlement.tsx` — new effect (~10 lines) and the one-line copy edit in `CustomTransferPane`.
