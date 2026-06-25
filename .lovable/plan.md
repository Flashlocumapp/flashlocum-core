## Root Causes (re-audit)

### 1. History Coverage temporarily empties

`onUserIdChange` in `src/lib/coverage-remote.ts` (lines 915-926) fires on **every** auth event — `INITIAL_SESSION`, `TOKEN_REFRESHED`, tab focus, etc. — because `subscribeAuthState` (lines 297-302) unconditionally writes `cachedUserId` and notifies all listeners, even when the user id hasn't changed.

The listener then:
1. Resets `cachedSnapshot = []`
2. Immediately fires `snapshotListeners.forEach(fn => fn([]))` → `network.ts` rebuilds `state.requests` as `{}` → `CoverageScreen` filter returns 0 items → "Your past coverage will appear here"
3. Kicks off `refreshSnapshot()`, which repopulates 0.5-2 s later

The previous "skip eviction" guard in `fetchAndIngestRow` does not help here — the snapshot is blanked **before** the refresh runs, not by the row-level path.

DB confirms John has 8 completed + 6 cancelled rows for his requester_id, so the data exists and RLS allows reading them.

### 2. Monnify countdown restarts on refresh

`BankTransferPanel` (`src/features/request/ShiftSettlement.tsx` line 1570) anchors the 15-minute timer exclusively to `account.expiresOn`. When Monnify returns `expiresOn = null` (which it does in many cases), the code falls back to `PRICE_HOLD_SEC` (15:00) on **every** render. That's what the user perceives as "the countdown restarts after refresh".

The authoritative anchor `coverage_requests.payment_due_at` is already persisted server-side and exposed on the NetRequest row (`paymentDueAt`). The settlement sheet's outer `useEffect` (lines 242-310) already treats `paymentDueAt` as the only valid anchor for phase/end-shift refs, but the BankTransferPanel sub-component was not wired to it.

---

## Remediation

### Fix A — Stop blanking the snapshot on identity-no-op auth events
File: `src/lib/coverage-remote.ts`

1. In `subscribeAuthState` (line 297) compare `userId` against the previous `cachedUserId` and **only** notify `userListeners` when the id actually changes. `SIGNED_OUT` clearing remains as-is.
2. In `onUserIdChange` callback at lines 915-926, additionally guard against same-user re-entry: if the incoming id equals `cachedSnapshotUserId` and we already have rows, do **not** zero the cache or emit `[]`. Just trigger a background `refreshSnapshot()` so any drift reconciles silently.

Result: the only paths that emit an empty array are real sign-out and a real account switch — never token refresh, tab focus, or `INITIAL_SESSION` replays.

### Fix B — Anchor Monnify countdown to `payment_due_at`
Files: `src/features/request/ShiftSettlement.tsx`

1. Thread the existing `serverPaymentDueAt` value (already in scope at the parent — line 250) down into `BankTransferPanel` as a new prop `paymentDueAt: string | null`.
2. In `BankTransferPanel` (line 1568-1574) compute the deadline in this priority order:
   - `paymentDueAt` (server-anchored, persisted in DB) — **primary**
   - `account.expiresOn` (Monnify-returned) — fallback only when DB value absent
   - `PRICE_HOLD_SEC` constant — last-resort fallback for the brief window before the row hydrates
3. Remove the silent "always shows 15:00" behaviour: when neither anchor is available, render the timer as `—:—` instead of resetting to 15:00 (prevents the visual "restart" the user reported).

Result: refresh, app reopen, and re-mount all continue the countdown from the original server deadline.

---

## Verification

- **History**: instrument a temporary `console.log` around the `onUserIdChange` early-exit to confirm it short-circuits on `TOKEN_REFRESHED` / focus events. Sign in as `john@gmail.com`, switch tabs and wait for a token refresh — History tab must never blank.
- **Countdown**: open the settlement sheet, note remaining time, hard-refresh the page; remaining must continue (±1 s) from the same deadline, not reset to 15:00.

No DB migrations required.
