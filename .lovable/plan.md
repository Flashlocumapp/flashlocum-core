## Findings

The incoming card is blocked before the UI can render it:

- The doctor-side fetch is repeatedly failing with: `structure of query does not match function result type`.
- The failing backend RPC is `list_open_coverage_requests()`.
- `coverage_requests` now has 55 columns, but the RPC still returns the older 51-column shape.
- Because the RPC fails, the frontend logs `[coverage-remote] pool fetch error` and reuses an empty/stale pool, so doctors receive no incoming request card.
- The most recent request exists, but it has already moved to `expired`; the broadcast window is only 180 seconds, so once the doctor feed fails during that window, the card is missed.
- Current database presence shows the approved doctors as `online: false`; the card is also intentionally gated to online approved doctors only.

## Plan

1. **Repair the open-request RPC**
   - Update `list_open_coverage_requests()` so its returned row exactly matches the current `coverage_requests` table shape.
   - Add the missing trailing fields:
     - `reminder_sent_at`
     - `base_amount`
     - `surcharge_amount`
     - `surcharge_capped_at`
   - Keep sensitive/payment values hidden for open requests by returning safe `NULL` placeholders where appropriate.

2. **Keep existing eligibility rules intact**
   - Only approved, unrestricted doctors can receive open requests.
   - Only doctors marked online in `doctor_presence` can receive open requests.
   - Only `searching` requests with no accepted doctor appear.
   - The 180-second broadcast freshness filter remains unchanged unless you later ask to change the request lifetime.

3. **Validate the request pipeline after the migration**
   - Confirm the RPC definition compiles against all 55 columns.
   - Confirm recent `coverage_requests` rows insert successfully with AM/PM times.
   - Confirm the doctor pool fetch no longer logs `structure of query does not match function result type`.
   - Confirm a fresh request can be visible during the live broadcast window when an approved doctor is online.

4. **If the card still does not show after this RPC fix**
   - Check whether the doctor is actually online in `doctor_presence` at request time.
   - Check whether the request is still within the 180-second broadcast window.
   - Check whether the doctor has 3 accepted/upcoming shifts, which suppresses new incoming cards.
   - Check whether the doctor previously declined the same request revision.

## Technical change

Create one database migration replacing `public.list_open_coverage_requests()` with a corrected `RETURN QUERY` whose selected columns match `public.coverage_requests` exactly, while preserving column redaction for open requests.