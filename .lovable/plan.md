## Targeted post-Phase-1 fixes

Three small, presentation-layer changes. No schema, no server functions, no architectural shift.

### 1. Selfie cache reuse (Account + every doctor card)

**New file:** `src/lib/selfie-url.ts` — module-level cache for signed URLs of files in the private `doctors` storage bucket. Same shape as `doctor-identity`'s cache but generic to any storage path. Exposes `getSelfieUrl(path)` (sync, returns null until signed) and `useSelfieUrl(path)` (subscribes to updates).

- Signed once per session per path, reused thereafter.
- Auto re-signs after 50 min (URLs expire at 60 min).
- Idempotent inflight de-dup, so 5 cards mounting at once trigger one network call.

**Edit:** `src/features/app/AccountScreen.tsx` — delete the local `useSelfieUrl` (lines 45–73) and import from `@/lib/selfie-url`. No call-site change.

**Confirmed coverage for the requester-side surfaces you asked about:**

| Surface | Avatar source | Already cached? |
|---|---|---|
| Doctor cards on RequesterHome | `useDoctorIdentity(id).selfieUrl` | ✅ via `doctor-identity` module cache |
| Coverage cards (requester) | same | ✅ |
| History cards / HistoryDetailSheet (requester) | same | ✅ |
| Earnings cards (doctor side only — no requester earnings) | `useDispatch()` history | n/a (no avatar) |
| Account selfie (requester or doctor) | local one-shot signer | ❌ → fixed by this change |

The shared `<img>` decoding hints (#3) apply to **every** one of these surfaces because they all render through the same code paths.

### 2. Reconnecting banner debounce

**Edit:** `src/features/app/CoverageScreen.tsx` `ReconnectingPill` (lines 210–214). Only show the pill once a channel has been unhealthy for **≥ 800 ms**. Clears the timer immediately if health recovers. Eliminates the cold-start handshake flash; still surfaces real disconnects.

### 3. Avatar `<img>` decode / loading hints

**Edit:** `src/components/ui/avatar.tsx` — on `AvatarImage` add `decoding="async"`, `loading="eager"`, `fetchpriority="high"`, `draggable={false}`. These avoid main-thread decode jank and let the browser prioritise the avatar fetch.

**Edit (same hints) on raw `<img src={selfieUrl}>` usages** that bypass the Avatar primitive:
- `src/features/app/CoverageScreen.tsx` lines 761, 1182 (doctor cards)
- `src/features/app/AccountScreen.tsx` line 162 (own selfie)
- `src/features/request/RequesterHome.tsx` line 1569 (accepted doctor)
- `src/components/HistoryDetailSheet.tsx` line 100 (history detail)

This is the same image-loading optimization across **all** doctor cards (Requester home), coverage cards, history cards, history detail sheet, and Account — as requested.

### Files touched

- `src/lib/selfie-url.ts` (new, ~90 lines)
- `src/features/app/AccountScreen.tsx` (−29 lines, +4 lines)
- `src/features/app/CoverageScreen.tsx` (~25 lines in `ReconnectingPill` + 2 `<img>` attr additions)
- `src/components/ui/avatar.tsx` (4 attr additions)
- `src/features/request/RequesterHome.tsx` (1 `<img>` attr addition)
- `src/components/HistoryDetailSheet.tsx` (1 `<img>` attr addition)

Risk: very low. No behavioural change beyond eliminating the cold-start flashes.