## Goal
Close the three restriction-enforcement gaps surfaced by Priority 2 verification:
1. Restricted doctors can still go online (`doctor_presence`).
2. Restricted requesters can still call `start_shift`.
3. Restricted requesters can still call `resume_shift`.

Scope is database-only. No client changes — existing call sites already surface thrown RPC errors via toasts, and the banner already renders admin-applied restrictions.

## Changes (single migration)

### 1. Block "Go Online" for restricted doctors
Extend the existing helper `public.current_user_is_approved_doctor()` to also require `account_restricted_at IS NULL`:

```sql
CREATE OR REPLACE FUNCTION public.current_user_is_approved_doctor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = auth.uid()
       AND verification_status = 'approved'
       AND account_restricted_at IS NULL
  )
$$;
```

Effect: the existing `doctor_presence` INSERT/UPDATE policies that gate on this helper start rejecting writes from restricted doctors, so the presence upsert fails and `[presence-remote] upsert error` is logged. The existing online/offline toggle handler already treats upsert failure as "stay offline".

### 2. Block `start_shift` for restricted requesters
Add an early guard mirroring `claim_coverage_request`:

```sql
-- inside start_shift, after the requester_id check
IF EXISTS (
  SELECT 1 FROM public.profiles
   WHERE id = auth.uid() AND account_restricted_at IS NOT NULL
) THEN
  RAISE EXCEPTION 'Account restricted';
END IF;
```

### 3. Block `resume_shift` for restricted requesters
Same guard, inserted after the requester_id check in `resume_shift`. `end_shift` and `pause_shift` are intentionally left alone so active shifts can be safely closed.

## Verification after migration
- Apply restriction to a test doctor → toggle Go Online → expect failure (presence row does not flip to `online=true`) and no opportunities pushed.
- Apply restriction to a test doctor with a pending assignment → call `claim_coverage_request` → expect `Account restricted` (already verified).
- Apply restriction to a test requester → tap Start Shift on an accepted shift → expect toast with `Account restricted`.
- Pause an active shift, then apply restriction, then tap Resume → expect `Account restricted` toast; shift stays paused.
- Confirm End Shift / payment / rating still work on a shift that was already active when restriction was applied.
- Confirm banner renders with admin reason (already verified).

## Out of scope
- Forcing already-online doctors offline at restriction time (next presence heartbeat naturally fails to upsert; the row stays at its last value until the existing cleanup sweeps it). If a hard kick is needed, that's a follow-up.
- Cancelling shifts that were created before the restriction.
