# Doctor Verification & Validation

Four changes scoped to the doctor onboarding flow. No other system behaviour changes.

## 1. Private storage for doctor documents

Create a private `doctors` storage bucket with this layout per doctor:

```text
doctors/{user_id}/profile/selfie.jpg
doctors/{user_id}/verification/license.<ext>
doctors/{user_id}/verification/nysc.<ext>
```

Access rules (RLS on `storage.objects`):
- The doctor (`auth.uid()` = first path segment) can read/write their own files.
- Admins (via `has_role(auth.uid(), 'admin')`) can read all files in the bucket.
- No public read.

Today the onboarding screen stores only the file name on the profile row — no upload happens. After this change:
- Selfie → uploaded to `profile/selfie.jpg`; signed URL stored on `profiles.selfie_url`.
- License → uploaded to `verification/license.<ext>`; path stored on `profiles.license_name`.
- NYSC → uploaded to `verification/nysc.<ext>`; path stored on `profiles.nysc_name`.

## 2. MDCN number validation

Regex enforced in the onboarding form: `^MDCN/R/\d{5,6}$`.

- Inline error: "Please enter the correct format" when text is non-empty and fails the regex.
- Submit button stays disabled until the value matches.

## 3. Account name validation

When the bank-resolved account name comes back, compare it to the doctor's `full_name` (from their profile / signup):

- Normalize both: uppercase, strip punctuation, collapse spaces, split into tokens, drop single-letter initials.
- Accept if at least two name tokens from the profile appear in the resolved name in any order (covers `ADELEKE ISAIAH`, `ISAIAH A ADELEKE`).
- If profile has only two tokens and resolved name has both plus an initial (`ADELEKE I`), accept.
- Otherwise reject with: "Account name does not match the name on your profile. Please check your details."

The doctor cannot submit until the resolved name passes the check.

## 4. Source of truth

`verification_status` stays `'pending'` until an admin approves. No change to that flow — only ensure the client cannot submit onboarding unless: MDCN passes, all three documents uploaded successfully, bank account name matches. Final `'approved'` flip remains admin-driven (existing `_admin.admin.verification.tsx`).

## Files

- New migration: create `doctors` bucket + 4 RLS policies on `storage.objects`.
- New `src/lib/doctor-uploads.ts`: `uploadDoctorSelfie`, `uploadDoctorDocument` helpers using the browser supabase client.
- New `src/lib/name-match.ts`: `isReasonableNameMatch(profileName, resolvedName)`.
- Edit `src/routes/onboarding.$role.tsx`: MDCN regex + inline error, upload selfie/license/nysc on file pick (show progress), pass profile name into `BankPayoutFields`, gate Submit on name-match.
- Edit `src/components/BankPayoutFields.tsx`: accept optional `expectedName` prop; after resolve, run the matcher and surface the mismatch error.

Build verification at the end.
