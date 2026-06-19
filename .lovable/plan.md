## Confirm: Home Care 30-min grace applies universally

You've confirmed the universal 30-minute grace rule for Home Care. The current implementation already matches this behavior — no code changes are required.

### What this means
- Any Home Care shift (regardless of booked duration) gets a 30-minute grace window before surcharge blocks begin.
- After grace, surcharges accrue in 60-minute blocks at ₦3,000/block.
- Spec audit Test 7 (1h booked / 1h12m actual = ₦12,000) is therefore the correct expected output. The spec line suggesting ₦24,000 was the inconsistency, and we're resolving it in favor of the universal rule.

### Action
- Update the internal audit doc / test harness so Test 7's expected value is **₦12,000** (not ₦24,000), marking the previous spec line as superseded by your clarification.
- No changes to `compute_quote`, `end_shift`, `src/lib/pricing.ts`, or any migration.
- Re-run the 14-case regression: expected result is **14/14 pass**.

### Files touched
None (documentation/test-expectation update only).

Approve and I'll record the clarification and re-run the regression harness to confirm 14/14.