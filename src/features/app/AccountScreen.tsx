import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getRole, setRole, subscribeRoleChange, type Role } from "@/lib/role";
import {
  getCachedOnboardingStatus,
  hasCompletedOnboarding,
  upsertMyProfile,
  useMyProfile,
  type ProfileRow,
} from "@/lib/profile-remote";
import { useVerificationStatus } from "@/lib/verification";
import { useAuthIdentity } from "@/lib/identity";

import { pushToast } from "@/lib/notifications";
import { unregisterDoctor } from "@/lib/network";
import { BankPayoutFields } from "@/components/BankPayoutFields";
import {
  hapticsEnabled,
  pushEnabled,
  setHapticsEnabled,
  setPushEnabled,
  subscribeFeedbackPrefs,
} from "@/lib/feedback-prefs";

function verificationLabel(s: string): string {
  if (s === "approved") return "Verified";
  if (s === "rejected") return "Rejected";
  if (s === "suspended") return "Suspended";
  return "Pending Approval";
}

type Identity = { name: string; email: string; initials: string };

function deriveInitials(name: string, email: string): string {
  const src = (name || email || "").trim();
  if (!src) return "—";
  const cleaned = name.trim().replace(/^Dr\.?\s+/i, "");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

// Selfie signing goes through the shared module-level cache in
// `@/lib/selfie-url` so the URL is signed once per session and reused
// across Account, Coverage cards, History, and RequesterHome doctor cards.
import { useSelfieUrl } from "@/lib/selfie-url";

export function AccountScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [role, setLocalRole] = useState<Role | null>(() => getRole());
  const [switching, setSwitching] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const authIdentity = useAuthIdentity();
  const verification = useVerificationStatus();
  const { profile, loading: profileLoading } = useMyProfile();
  const selfieSrc = useSelfieUrl(profile?.selfie_url ?? null);

  useEffect(() => subscribeRoleChange(() => setLocalRole(getRole())), []);

  const isDoctor = role === "cover";
  const identity = useMemo<Identity>(() => {
    const baseName = profile?.full_name || authIdentity.name;
    const fallback = profileLoading ? "Loading…" : isDoctor ? "Doctor" : "Requester";
    const rawName = baseName || fallback;
    const name = isDoctor && rawName !== "Loading…" && !/^dr\.?\s/i.test(rawName) ? `Dr. ${rawName}` : rawName;
    const email = authIdentity.email || "—";
    return { name, email, initials: deriveInitials(name, email) };
  }, [authIdentity, isDoctor, profile?.full_name, profileLoading]);

  const switchRole = async () => {
    if (switching || !role) return;
    const next: Role = isDoctor ? "request" : "cover";
    const prev: Role = role;
    setSwitching(true);
    try {
      const cachedDone = getCachedOnboardingStatus(next);
      const done = cachedDone === null ? await hasCompletedOnboarding(next) : cachedDone;
      setRole(next);
      setLocalRole(next);
      if (!done) {
        navigate({
          to: "/onboarding/$role",
          params: { role: next },
          search: { from: "switch", prev },
        });
      } else {
        navigate({ to: "/home" });
      }
    } finally {
      setSwitching(false);
    }
  };

  const personalRows = useMemo(() => {
    if (isDoctor) {
      const rows = [
        { label: "Phone Number", value: profile?.phone || "—" },
        { label: "MDCN Number", value: profile?.mdcn || "—" },
      ];
      // Only render the verification row once we know the real status —
      // avoids a "Pending" flash on first paint for approved/suspended users.
      if (verification) {
        rows.push({ label: "Verification Status", value: verificationLabel(verification) });
      }
      return rows;
    }
    return [
      { label: "Phone Number", value: profile?.phone || "—" },
      { label: "Gender", value: profile?.gender || "—" },
    ];
  }, [isDoctor, profile, verification]);

  if (!role) return null;

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="px-5 pt-4">
        <div className="mx-auto max-w-md">
          <h1 className="text-[26px] font-semibold tracking-tight">Account</h1>
        </div>
      </header>

      <div className="mx-auto mt-5 max-w-md px-5 pb-10">
        {/* Identity block */}
        <div className="flex items-center gap-3.5">
          <span
            className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-[16px] font-semibold"
            style={{
              background: "color-mix(in oklab, var(--color-primary) 12%, transparent)",
              color: "var(--color-primary)",
            }}
          >
            {isDoctor && selfieSrc ? (
              <img src={selfieSrc} alt="" decoding="async" loading="eager" draggable={false} className="h-full w-full object-cover" />
            ) : (
              identity.initials
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[18px] font-semibold tracking-tight">{identity.name}</div>
            <div className="truncate text-[13px] text-muted-foreground">{identity.email}</div>
          </div>
        </div>

        <Section title={isDoctor ? "Professional Information" : "Personal Information"}>
          {isDoctor ? (
            <ListGroup>
              {personalRows.map((r) => (
                <DetailRow key={r.label} label={r.label} value={r.value} />
              ))}
            </ListGroup>
          ) : (
            <button
              onClick={() => setProfileOpen(true)}
              className="w-full overflow-hidden rounded-2xl text-left active:bg-accent"
              style={{ background: "var(--color-surface-elevated)" }}
            >
              {personalRows.map((r, i) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between px-4 py-3.5"
                  style={{
                    borderTop:
                      i === 0
                        ? "none"
                        : "1px solid color-mix(in oklab, var(--color-foreground) 5%, transparent)",
                  }}
                >
                  <span className="text-[14.5px]">{r.label}</span>
                  <span className="ml-3 truncate text-[13px] text-muted-foreground">{r.value}</span>
                </div>
              ))}
            </button>
          )}
          {isDoctor && (
            <p className="mt-2 px-1 text-[12px] text-muted-foreground">
              To update your account information, please{" "}
              <button
                onClick={() => navigate({ to: "/support" })}
                className="underline underline-offset-2 hover:text-foreground"
              >
                contact support
              </button>
              .
            </p>
          )}
        </Section>

        {isDoctor && (
          <Section title="Payouts">
            <ListGroup>
              <DetailRow label="Bank Name" value={profile?.bank_name || "—"} />
              <DetailRow label="Account Number" value={profile?.bank_account || "—"} />
              <DetailRow
                label="Account Name"
                value={profile?.bank_account_name || "—"}
                last
              />
            </ListGroup>
          </Section>
        )}

        <Section title="Support">
          <ListGroup>
            <NavRow title="Help Center" onClick={() => navigate({ to: '/help' })} />
            <NavRow title="Contact Support" onClick={() => navigate({ to: '/support' })} last />
          </ListGroup>
        </Section>

        <FeedbackPrefsSection />

        <Section title="Account">
          <ListGroup>
            <NavRow
              title={isDoctor ? "Switch to Request Coverage" : "Switch to Cover & Earn"}
              onClick={switchRole}
            />
            <NavRow
              title="Sign Out"
              onClick={async () => {
                await queryClient.cancelQueries();
                unregisterDoctor();
                queryClient.clear();
                const { signOutAndClearPresence } = await import("@/lib/sign-out");
                await signOutAndClearPresence();
                navigate({ to: "/role", replace: true });
              }}
              tone="muted"
            />
            <NavRow
              title="Delete Account"
              onClick={() => setDeleteOpen(true)}
              tone="danger"
              last
            />
          </ListGroup>
        </Section>
      </div>

      {deleteOpen && (
        <DeleteAccountSheet
          onClose={() => setDeleteOpen(false)}
          onDeleted={async () => {
            await queryClient.cancelQueries();
            unregisterDoctor();
            queryClient.clear();
            const { signOutAndClearPresence } = await import("@/lib/sign-out");
            await signOutAndClearPresence();
            navigate({ to: "/role", replace: true });
          }}
        />
      )}

      {profileOpen && (
        <ProfileSheet
          isDoctor={isDoctor}
          identity={identity}
          profile={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={() => setProfileOpen(false)}
        />
      )}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <div className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function FeedbackPrefsSection() {
  const [haptics, setHaptics] = useState(() => hapticsEnabled());
  const [push, setPush] = useState(() => pushEnabled());
  useEffect(
    () =>
      subscribeFeedbackPrefs((key, value) => {
        if (key === "haptics") setHaptics(value);
        else setPush(value);
      }),
    [],
  );
  return (
    <Section title="Haptics & notifications">
      <ListGroup>
        <ToggleRow
          title="Haptics"
          subtitle="Subtle vibration on shift start, pause, resume, end."
          value={haptics}
          onChange={(v) => {
            setHaptics(v);
            setHapticsEnabled(v);
          }}
        />
        <ToggleRow
          title="Push notifications"
          subtitle="In-app alerts for new offers, shift updates, and reminders."
          value={push}
          onChange={(v) => {
            setPush(v);
            setPushEnabled(v);
          }}
        />
      </ListGroup>
    </Section>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onChange,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left active:bg-accent"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px]">{title}</span>
        {subtitle && (
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>
      <span
        aria-hidden
        className="relative h-[28px] w-[46px] shrink-0 rounded-full transition-colors"
        style={{
          background: value
            ? "var(--color-primary)"
            : "color-mix(in oklab, var(--color-foreground) 18%, transparent)",
        }}
      >
        <span
          className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-[left]"
          style={{ left: value ? "21px" : "3px" }}
        />
      </span>
    </button>
  );
}

function ListGroup({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-2xl [&>*+*]:border-t [&>*+*]:border-[color:color-mix(in_oklab,var(--color-foreground)_5%,transparent)]"
      style={{ background: "var(--color-surface-elevated)" }}
    >
      {children}
    </div>
  );
}

function NavRow({
  title,
  onClick,
  tone,
  last,
}: {
  title: string;
  onClick: () => void;
  tone?: "muted" | "danger";
  last?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between px-4 py-3.5 text-left active:bg-accent"
      style={{
        borderTop: last || tone ? undefined : undefined,
        borderBottom: undefined,
      }}
    >
      <span
        className="text-[14.5px]"
        style={{
          color:
            tone === "danger"
              ? "var(--color-destructive)"
              : tone === "muted"
                ? "var(--color-muted-foreground)"
                : undefined,
        }}
      >
        {title}
      </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function DetailRow({ label, value, last: _last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3.5">
      <span className="text-[14.5px]">{label}</span>
      <span className="ml-3 truncate text-[13px] text-muted-foreground">{value}</span>
    </div>
  );
}

function ProfileSheet({
  isDoctor,
  identity,
  profile,
  onClose,
  onSaved,
}: {
  isDoctor: boolean;
  identity: { name: string; email: string };
  profile: ProfileRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [gender, setGender] = useState(profile?.gender ?? "");
  const [bankName, setBankName] = useState(profile?.bank_name ?? "");
  const [bankCode, setBankCode] = useState<string | undefined>(undefined);
  const [bankAccount, setBankAccount] = useState(profile?.bank_account ?? "");
  const [bankAccountName, setBankAccountName] = useState(profile?.bank_account_name ?? "");
  const [saving, setSaving] = useState(false);
  const verification = useVerificationStatus();

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const fields = isDoctor
        ? {
            phone: phone || null,
            bank_name: bankName || null,
            bank_account: bankAccount || null,
            bank_account_name: bankAccountName || null,
          }
        : {
            phone: phone || null,
            gender: gender || null,
          };
      await upsertMyProfile(fields);
      pushToast({ tone: "info", title: "Profile updated" });
      onSaved();
    } catch (e) {
      console.warn("profile update failed", e);
      pushToast({
        tone: "warn",
        title: "Could not save profile",
        body: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92%] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-5 pb-8"
        style={{ boxShadow: "0 -20px 60px -20px rgba(0,0,0,0.45)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/20" />
        <div className="text-[18px] font-semibold tracking-tight">
          {isDoctor ? "Doctor Profile" : "Profile"}
        </div>

        <div className="mt-5 space-y-3">
          <ReadField label="Full Name" value={identity.name} />
          {!isDoctor ? (
            <>
              <EditField
                label="Phone Number"
                value={phone}
                onChange={setPhone}
                placeholder="+234 800 000 0000"
                type="tel"
              />
              <SelectField
                label="Gender"
                value={gender}
                onChange={setGender}
                options={["Female", "Male", "Prefer not to say"]}
              />
            </>
          ) : (
            <>
              <EditField
                label="Phone Number"
                value={phone}
                onChange={setPhone}
                placeholder="+234 800 000 0000"
                type="tel"
              />
              <ReadField label="MDCN Number" value={profile?.mdcn || "—"} />
              <BankPayoutFields
                bankName={bankName}
                bankCode={bankCode}
                bankAccount={bankAccount}
                bankAccountName={bankAccountName}
                onChange={(patch) => {
                  if (patch.bankName !== undefined) setBankName(patch.bankName);
                  if (patch.bankCode !== undefined) setBankCode(patch.bankCode);
                  if (patch.bankAccount !== undefined) setBankAccount(patch.bankAccount);
                  if (patch.bankAccountName !== undefined) setBankAccountName(patch.bankAccountName);
                }}
              />
              {verification && (
                <ReadField
                  label="Verification Status"
                  value={verificationLabel(verification)}
                />
              )}
            </>
          )}
          <ReadField label="Email Address" value={identity.email} />
        </div>

        <p className="mt-4 text-[12px] text-muted-foreground">
          To update your legal name, email address, or MDCN, contact support.
        </p>

        <div className="mt-5 flex gap-2.5">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-2xl bg-secondary text-[14px] font-medium active:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="h-11 flex-1 rounded-2xl bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground">{label}</label>
      <div
        className="mt-1.5 flex h-12 w-full items-center rounded-2xl px-4 text-[15px] text-muted-foreground"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        {value}
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground">{label}</label>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-12 w-full rounded-2xl bg-secondary px-4 text-[15px] outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-12 w-full appearance-none rounded-2xl bg-secondary px-4 text-[15px] outline-none"
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function DeleteAccountSheet({
  onClose,
  onDeleted,
}: {
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { checkAccountDeleteEligibility } = await import(
          "@/lib/account-delete.functions"
        );
        const res = await checkAccountDeleteEligibility();
        if (cancelled) return;
        setEligible(res.ok);
        setReason(res.reason);
      } catch (e) {
        if (cancelled) return;
        setReason(
          e instanceof Error
            ? e.message
            : "Could not check account deletion eligibility. Please try again.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const { deleteMyAccount } = await import(
        "@/lib/account-delete.functions"
      );
      await deleteMyAccount();
      pushToast({ tone: "info", title: "Account deleted" });
      await onDeleted();
    } catch (e) {
      pushToast({
        tone: "warn",
        title: "Could not delete account",
        body: e instanceof Error ? e.message : "Please try again.",
      });
      setDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92%] w-full max-w-md overflow-y-auto rounded-3xl bg-card p-5"
        style={{ boxShadow: "0 24px 60px -20px rgba(0,0,0,0.45)" }}
      >
        <div className="text-[18px] font-semibold tracking-tight">
          Delete Account
        </div>

        {loading ? (
          <p className="mt-4 text-[14px] text-muted-foreground">
            Checking your account…
          </p>
        ) : !eligible ? (
          <div className="mt-4 space-y-3">
            <p className="text-[14px] leading-relaxed">{reason}</p>
            <p className="text-[13px] text-muted-foreground">
              Once these are resolved, you'll be able to delete your account
              from this screen.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={onClose}
                className="h-11 flex-1 rounded-2xl bg-secondary text-[14px] font-medium active:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        ) : !confirming ? (
          <div className="mt-4 space-y-3">
            <p className="text-[14px] leading-relaxed">
              Are you sure you want to permanently delete your account? This
              action cannot be undone.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={onClose}
                className="h-11 flex-1 rounded-2xl bg-secondary text-[14px] font-medium active:bg-accent"
              >
                Cancel
              </button>
              <button
                onClick={() => setConfirming(true)}
                className="h-11 flex-1 rounded-2xl bg-destructive text-[14px] font-semibold text-destructive-foreground active:opacity-90"
              >
                Delete Account
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-[14px] leading-relaxed">
              Final confirmation: this will permanently remove your FlashLocum
              account and sign you out.
            </p>
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={() => setConfirming(false)}
                disabled={deleting}
                className="h-11 flex-1 rounded-2xl bg-secondary text-[14px] font-medium active:bg-accent disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={runDelete}
                disabled={deleting}
                className="h-11 flex-1 rounded-2xl bg-destructive text-[14px] font-semibold text-destructive-foreground active:opacity-90 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Yes, delete my account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
