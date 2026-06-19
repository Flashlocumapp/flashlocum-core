Root cause found: the request card is not reaching online doctors because the new request is failing to save to the backend.

Evidence:
- The latest request insert returned `400` with: `invalid input syntax for type integer: "00 AM"`.
- The attempted request sent `start_time: "08:00 AM"` and `end_time: "06:00 PM"`.
- `coverage_requests` currently has no recent rows, so there is nothing for online doctors to receive or render.
- Realtime publication is enabled for `coverage_requests`; this is not the current blocking point.

Plan:
1. Update the backend time parser used by pricing/locking functions so it accepts both:
   - `HH:MM` 24-hour values, e.g. `08:00`, `18:00`
   - `HH:MM AM/PM` values, e.g. `08:00 AM`, `06:00 PM`
2. Keep realtime publication as-is because it is already configured for `coverage_requests`, `shift_segments`, and `doctor_presence`.
3. Verify the fix by checking that a request insert no longer fails and that `list_open_coverage_requests()` can return newly saved searching requests for eligible online doctors.
4. No rollback is required; this is a narrow compatibility fix for request creation, not a rollback of the realtime publication changes.