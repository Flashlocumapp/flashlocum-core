# Why the Coverage tab flashes "Reconnecting…" after payment

The pill at the top of Coverage is `Reconnecting…` (rendered by `ReconnectingPill` in `src/features/app/CoverageScreen.tsx`). It is driven by `isCoverageReconnecting(health)` over the `coverage` and `invalidations` channels. It should only appear during a real disconnect — but a self-inflicted teardown after payment is flipping `invalidations` to `reconnecting` for several seconds.

## Root cause — duplicate `coverage_invalidations` channel from the settlement sheet

`src/features/request/ShiftSettlement.tsx` lines 768-773 (and its cleanup on 802) opens a **second** Supabase channel with the same topic name as the global one owned by `coverage-remote.ts`:

```ts
const invalidate = supabase
  .channel("coverage_invalidations", { config: { broadcast: { self: false } } })
  .on("broadcast", { event: "invalidate" }, () => { void checkOnce(); })
  .subscribe();
…
return () => {
  …
  void supabase.removeChannel(invalidate);   // ← clobbers the global topic
};
```

What happens on the "I paid" flow:
1. Settlement sheet opens → two channel objects exist for topic `coverage_invalidations` (the global one in `coverage-remote.ts` + this local one in the sheet).
2. Webhook fires `payment_status = paid` → broadcast lands → `confirmPaymentNow()` runs → sheet auto-closes and the effect cleanup runs (deps `[open, requestId, phase, …]` also change as phase flips).
3. `supabase.removeChannel(invalidate)` unsubscribes the shared topic on the socket. The global subscriber's `subscribe()` callback then receives `CLOSED`, which calls `scheduleReconnect("invalidations", …)` and `setChannelHealth("invalidations", "reconnecting")` (`coverage-remote.ts` ~line 957).
4. `ReconnectingPill` debounces for 800 ms, then shows. The watchdog reopens the channel with backoff (500 ms → 1 s → 2 s …, plus ±30% jitter) and only clears `reconnecting` after `SUBSCRIBED` arrives — usually 1-3 s of visible "Reconnecting…".

Also, the sibling `settlement:${requestId}` postgres_changes channel on line 752 is dead in production: the comment on line 764 says `coverage_requests` is intentionally excluded from `supabase_realtime`, so that subscription never fires. It does not cause the pill (no health callback), but it is wasted work.

Same pattern exists in any other place that opens its own `coverage_invalidations` channel — confirming this is the only one.

## Why it looks like "after payment"

The cleanup that tears down the duplicate channel runs precisely when the sheet closes on `paid`. Pre-payment the sheet is mounted, so the duplicate stays joined and the global topic is fine; the moment payment succeeds, the global topic gets dropped and the pill appears.

## Remediation (minimal, no business logic change)

### 1. Stop opening a second `coverage_invalidations` channel from `ShiftSettlement`

Replace the per-sheet `supabase.channel("coverage_invalidations")` with a tiny subscriber that hangs off the **existing** global channel in `coverage-remote.ts`. Two equivalent options — pick (a) for the smallest blast radius:

a. **Add a local pub/sub in `coverage-remote.ts`** (no new realtime channels): export `subscribeInvalidationPing(cb): () => void`. The existing `onInvalidate` handler in `coverage-remote.ts` (~line 916) already runs on every broadcast — have it also notify these listeners. The settlement sheet replaces its `.channel("coverage_invalidations")…subscribe()` with `subscribeInvalidationPing(() => void checkOnce())`. Cleanup just removes the listener — never touches the shared topic.

b. **Use a sheet-scoped topic name** like `settlement_pings:${requestId}` so removal cannot affect the global topic. This works but adds one more Realtime channel per active settlement — option (a) avoids that.

### 2. Delete the dead `settlement:${requestId}` postgres_changes channel

Remove the subscription block on lines 752-762 + 801 (`removeChannel(channel)`). `coverage_requests` is not in `supabase_realtime`; this never delivers and just adds JOIN/LEAVE churn that aggravates the reconnect-pill window during payment.

### 3. (Defensive) Make `ReconnectingPill` insensitive to a single sub-second flap

Already debounced 800 ms. Raise to 1500 ms AND require the unhealthy state to still be present when the timer fires. This is a belt-and-braces measure; the real fix is (1). The pill will still appear for genuine multi-second outages — only the self-inflicted flash is silenced.

## Files touched

- `src/lib/coverage-remote.ts` — add `subscribeInvalidationPing` + fan-out from existing `onInvalidate`. No new channels, no schema or RLS changes.
- `src/features/request/ShiftSettlement.tsx` — swap the duplicate `supabase.channel("coverage_invalidations")` for `subscribeInvalidationPing`; delete the dead `settlement:${requestId}` block; tighten cleanup.
- `src/features/app/CoverageScreen.tsx` — bump `ReconnectingPill` debounce 800 → 1500 ms and re-check health at fire time.

## Verification

1. **Repro pre-fix:** open a shift → End Shift → pay via Monnify sandbox → confirm pill appears for ~1-3 s right as the sheet closes.
2. **Post-fix happy path:** same flow, pill never appears; sheet still auto-confirms on `paid`.
3. **Network kill test:** DevTools → offline for 5 s. Pill must still appear (genuine disconnect) and clear on reconnect.
4. **Channel audit:** in DevTools → Network → WS, after payment confirms there is still exactly one JOIN for `coverage_invalidations` (the global one) and no LEAVE during the close.
5. **Build:** `bun run build` clean.

## What we are NOT changing

- No DB / RLS / RPC changes.
- No new realtime channels.
- No change to payment verification cadence, `verifySettlementPayment`, webhook handling, or `coverage_invalidations` broadcast contents.
- No change to the watchdog / reconnect backoff in `coverage-remote.ts`.
