## Goal
Admin Shift Monitoring currently shows `coverage_requests.amount` (the original booking estimate) in the Amount column for every row, regardless of billing/payment state. Switch it to surface the *actual* number that matters at each stage.

## Display rules (per row)

| Stage | Trigger | Show | Label |
|---|---|---|---|
| Before billing locked | `billing_locked_at IS NULL` AND `total_billed_amount IS NULL` | `amount` | "Est." |
| Billed, unpaid | `total_billed_amount` present AND `paid_at IS NULL` | `total_billed_amount` | "Due" |
| Paid | `paid_at IS NOT NULL` | `settled_amount ?? total_billed_amount` | "Paid" |

The `payment_status` column stays as-is in its own column.

## Changes

### 1. `src/lib/admin.functions.ts`
- Extend `AdminShiftRow` with `total_billed_amount: number | null`, `settled_amount: number | null`, `paid_at: string | null`, `billing_locked_at: string | null`.
- Add those four columns to the `select(...)` string in `adminListShifts`.
- Spread them into the returned row (already covered by `...r`).

### 2. `src/routes/_admin.admin.shifts.tsx`
Replace the single-line Amount cell:
```tsx
<td className="px-4 py-2.5">{fmtNaira(r.amount)}</td>
```
with a small helper that picks the value + label per the table above, rendered as:
```
₦ 42,000
Due
```
(amount on top, small muted label below — matches the existing two-line cell style used for Hospital/Schedule/Requester columns).

No other columns change. Payment column already reads `payment_status`.

## Verification (post-edit)
1. Read 3 rows from `coverage_requests` covering each stage and confirm the rendered cell matches:
   - searching/accepted row → "Est." + `amount`
   - completed-but-unpaid row → "Due" + `total_billed_amount`
   - paid row → "Paid" + `settled_amount` (fallback to `total_billed_amount` if `settled_amount` is null)
2. Visit `/admin/shifts` in preview, screenshot, confirm the three states render correctly.
3. Provide a short audit report listing what changed and the verified states.

## Out of scope
- `AdminUnpaidShiftRow` / unpaid-shifts table — already uses `total_billed_amount`.
- Any change to how billing/settlement is calculated. This is display-only.