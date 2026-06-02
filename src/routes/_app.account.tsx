import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { clearRole, getRole, setRole, type Role } from "@/lib/role";
import {
  getProfile,
  saveProfile,
  type DoctorProfile,
  type RequesterProfile,
} from "@/lib/onboarding";
import { hasCompletedOnboarding } from "@/lib/profile-remote";
import { useVerificationStatus } from "@/lib/verification";
import { supabase } from "@/integrations/supabase/client";

function verificationLabel(s: string): string {
  if (s === "approved") return "Verified";
  if (s === "rejected") return "Rejected";
  if (s === "suspended") return "Suspended";
  return "Pending Approval";
}

export const Route = createFileRoute("/_app/account")({
  component: AccountScreen,
});

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

function AccountScreen() {
  const navigate = useNavigate();
  const [role, setLocalRole] = useState<Role>("request");
  const [switching, setSwitching] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [requester, setRequester] = useState<RequesterProfile>({});
  const [doctor, setDoctor] = useState<DoctorProfile>({});
  const [authIdentity, setAuthIdentity] = useState<{ name: string; email: string }>({
    name: "",
    email: "",
  });

  useEffect(() => {
    const r = getRole();
    setLocalRole(r);
    setRequester(getProfile<RequesterProfile>("request"));
    setDoctor(getProfile<DoctorProfile>("cover"));
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) return;
      const meta = (u.user_metadata ?? {}) as { full_name?: string; name?: string };
      setAuthIdentity({ name: meta.full_name || meta.name || "", email: u.email ?? "" });
    });
  }, []);

  const isDoctor = role === "cover";
  const identity = useMemo<Identity>(() => {
    const rawName = authIdentity.name || (isDoctor ? "Doctor" : "Requester");
    const name = isDoctor && rawName && !/^dr\.?\s/i.test(rawName) ? `Dr. ${rawName}` : rawName;
    const email = authIdentity.email || "—";
    return { name, email, initials: deriveInitials(name, email) };
  }, [authIdentity, isDoctor]);

  const switchRole = async () => {
    if (switching) return;
    const next: Role = isDoctor ? "request" : "cover";
    setSwitching(true);
    try {
      const done = await hasCompletedOnboarding(next);
      setRole(next);
      setLocalRole(next);
      if (!done) {
        navigate({ to: "/onboarding/$role", params: { role: next } });
      } else {
        navigate({ to: "/home" });
      }
    } finally {
      setSwitching(false);
    }
  };

  const personalRows = useMemo(() => {
    if (isDoctor) {
      return [
        { label: "Phone Number", value: doctor.phone || "—" },
        { label: "MDCN Number", value: doctor.mdcn || "—" },
        { label: "Verification Status", value: doctor.selfie && doctor.mdcn ? "Verified" : "Pending" },
      ];
    }
    return [
      { label: "Phone Number", value: requester.phone || "—" },
      { label: "Gender", value: requester.gender || "—" },
    ];
  }, [isDoctor, doctor, requester]);

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="safe-top px-5 pt-4">
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
            {isDoctor && doctor.selfie ? (
              <img src={doctor.selfie} alt="" className="h-full w-full object-cover" />
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
        </Section>

        {isDoctor && (
          <Section title="Payouts">
            <ListGroup>
              <DetailRow label="Bank Name" value={doctor.bankName || "—"} />
              <DetailRow label="Account Number" value={doctor.bankAccount || "—"} />
              <DetailRow label="Account Name" value={doctor.bankName ? identity.name : "—"} last />
            </ListGroup>
          </Section>
        )}

        <Section title="Support">
          <ListGroup>
            <NavRow title="Help Center" onClick={() => {}} />
            <NavRow title="Contact Support" onClick={() => {}} last />
          </ListGroup>
        </Section>

        <Section title="Account">
          <ListGroup>
            <NavRow
              title={isDoctor ? "Switch to Request Coverage" : "Switch to Cover & Earn"}
              onClick={switchRole}
            />
            <NavRow
              title="Sign Out"
              onClick={async () => {
                await supabase.auth.signOut();
                clearRole();
                navigate({ to: "/role" });
              }}
              tone="muted"
              last
            />
          </ListGroup>
        </Section>
      </div>

      {profileOpen && (
        <ProfileSheet
          isDoctor={isDoctor}
          identity={identity}
          requester={requester}
          doctor={doctor}
          onClose={() => setProfileOpen(false)}
          onSave={(next) => {
            if (isDoctor) {
              setDoctor(next as DoctorProfile);
              saveProfile("cover", next);
            } else {
              setRequester(next as RequesterProfile);
              saveProfile("request", next);
            }
            setProfileOpen(false);
          }}
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
  tone?: "muted";
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
        style={{ color: tone === "muted" ? "var(--color-muted-foreground)" : undefined }}
      >
        {title}
      </span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function DetailRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3.5"
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--color-foreground) 5%, transparent)",
        borderTopWidth: undefined,
      }}
    >
      <span className="text-[14.5px]">{label}</span>
      <span className="ml-3 truncate text-[13px] text-muted-foreground">{value}</span>
      {last ? null : null}
    </div>
  );
}

function ProfileSheet({
  isDoctor,
  identity,
  requester,
  doctor,
  onClose,
  onSave,
}: {
  isDoctor: boolean;
  identity: { name: string; email: string };
  requester: RequesterProfile;
  doctor: DoctorProfile;
  onClose: () => void;
  onSave: (data: RequesterProfile | DoctorProfile) => void;
}) {
  const [r, setR] = useState<RequesterProfile>(requester);
  const [d, setD] = useState<DoctorProfile>(doctor);

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
                value={r.phone ?? ""}
                onChange={(v) => setR((p) => ({ ...p, phone: v }))}
                placeholder="+234 800 000 0000"
                type="tel"
              />
              <SelectField
                label="Gender"
                value={r.gender ?? ""}
                onChange={(v) => setR((p) => ({ ...p, gender: v }))}
                options={["Female", "Male", "Prefer not to say"]}
              />
            </>
          ) : (
            <>
              <EditField
                label="Phone Number"
                value={d.phone ?? ""}
                onChange={(v) => setD((p) => ({ ...p, phone: v }))}
                placeholder="+234 800 000 0000"
                type="tel"
              />
              <ReadField label="MDCN Number" value={d.mdcn || "—"} />

              <EditField
                label="Bank Name"
                value={d.bankName ?? ""}
                onChange={(v) => setD((p) => ({ ...p, bankName: v }))}
                placeholder="GTBank"
              />
              <EditField
                label="Account Number"
                value={d.bankAccount ?? ""}
                onChange={(v) => setD((p) => ({ ...p, bankAccount: v }))}
                placeholder="0123456789"
              />
              <ReadField
                label="Verification Status"
                value={d.selfie && d.mdcn ? "Verified" : "Pending"}
              />
            </>
          )}
          <ReadField label="Email Address" value={identity.email} />
        </div>

        <p className="mt-4 text-[12px] text-muted-foreground">
          To update your legal name or email address, contact support.
        </p>

        <div className="mt-5 flex gap-2.5">
          <button
            onClick={onClose}
            className="h-11 flex-1 rounded-2xl bg-secondary text-[14px] font-medium active:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(isDoctor ? d : r)}
            className="h-11 flex-1 rounded-2xl bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90"
          >
            Save
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
