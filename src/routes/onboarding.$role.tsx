import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/role";
import { setRole } from "@/lib/role";
import {
  getProfile,
  markOnboarded,
  saveProfile,
  type DoctorProfile,
  type RequesterProfile,
} from "@/lib/onboarding";

export const Route = createFileRoute("/onboarding/$role")({
  component: OnboardingScreen,
});

function OnboardingScreen() {
  const { role } = Route.useParams();
  const navigate = useNavigate();
  const normalizedRole: Role = role === "cover" ? "cover" : "request";
  const isDoctor = normalizedRole === "cover";

  // Ensure session role matches what we're onboarding (e.g. first-time switch).
  useEffect(() => {
    setRole(normalizedRole);
  }, [normalizedRole]);

  const [requester, setRequester] = useState<RequesterProfile>({});
  const [doctor, setDoctor] = useState<DoctorProfile>({});

  useEffect(() => {
    if (isDoctor) setDoctor(getProfile<DoctorProfile>("cover"));
    else setRequester(getProfile<RequesterProfile>("request"));
  }, [isDoctor]);

  const licenseRef = useRef<HTMLInputElement>(null);


  const persist = () => {
    if (isDoctor) saveProfile("cover", doctor);
    else saveProfile("request", requester);
  };

  const onSave = () => {
    persist();
    markOnboarded(normalizedRole);
  };

  const onContinue = () => {
    persist();
    markOnboarded(normalizedRole);
    navigate({ to: "/home" });
  };

  const onSkip = () => {
    // Allow leaving without completion — testing mode.
    markOnboarded(normalizedRole);
    navigate({ to: "/home" });
  };

  const title = isDoctor ? "Doctor verification profile" : "Basic profile";
  const subtitle = isDoctor
    ? "Complete to accept coverage requests. You can save and return later."
    : "Tell us a little about you. You can edit this anytime.";

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate({ to: "/home" })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {isDoctor ? "Cover & Earn" : "Request Coverage"}
          </div>
          <div className="h-9 w-9" />
        </div>

        <div className="mt-8">
          <h1 className="text-[24px] font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-[13.5px] text-muted-foreground">{subtitle}</p>
        </div>

        <div className="mt-6 space-y-3">
          {!isDoctor ? (
            <>
              <Field
                label="Phone number"
                type="tel"
                placeholder="+234 800 000 0000"
                value={requester.phone ?? ""}
                onChange={(v) => setRequester((p) => ({ ...p, phone: v }))}
              />
              <SelectField
                label="Gender"
                value={requester.gender ?? ""}
                onChange={(v) => setRequester((p) => ({ ...p, gender: v }))}
                options={["Female", "Male", "Prefer not to say"]}
              />
            </>
          ) : (
            <>
              <Field
                label="Phone number"
                type="tel"
                placeholder="+234 800 000 0000"
                value={doctor.phone ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, phone: v }))}
              />

              <SelfieCapture
                value={doctor.selfie}
                onCapture={(dataUrl) => setDoctor((p) => ({ ...p, selfie: dataUrl }))}
                onClear={() => setDoctor((p) => ({ ...p, selfie: undefined }))}
              />


              <Field
                label="MDCN number"
                type="text"
                placeholder="MDCN/12345"
                value={doctor.mdcn ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, mdcn: v }))}
              />

              <UploadField
                label="License upload"
                hint={doctor.license ? doctor.license : "Tap to upload PDF or image"}
                onPick={() => licenseRef.current?.click()}
              />
              <input
                ref={licenseRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setDoctor((p) => ({ ...p, license: f.name }));
                }}
              />

              <SelectField
                label="Years of experience"
                value={doctor.years ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, years: v }))}
                options={["< 1", "1–3", "3–5", "5–10", "10+"]}
              />

              <Field
                label="Bank name"
                type="text"
                placeholder="GTBank"
                value={doctor.bankName ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, bankName: v }))}
              />
              <Field
                label="Account number"
                type="text"
                placeholder="0123456789"
                value={doctor.bankAccount ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, bankAccount: v }))}
              />
            </>
          )}
        </div>

        <div className="mt-8 space-y-2.5">
          <button
            onClick={onContinue}
            className="h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90"
          >
            Continue
          </button>
          <div className="flex gap-2.5">
            <button
              onClick={onSave}
              className="h-11 flex-1 rounded-2xl bg-secondary text-[14px] font-medium active:bg-accent"
            >
              Save
            </button>
            <button
              onClick={onSkip}
              className="h-11 flex-1 rounded-2xl text-[14px] font-medium text-muted-foreground active:bg-accent"
            >
              Skip for now
            </button>
          </div>
          <p className="pt-2 text-center text-[11.5px] text-muted-foreground">
            You can return later to complete or edit any field.
          </p>
        </div>
      </div>
    </main>
  );
}

function Field({
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

function UploadField({
  label,
  hint,
  onPick,
}: {
  label: string;
  hint: string;
  onPick: () => void;
}) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground">{label}</label>
      <button
        type="button"
        onClick={onPick}
        className="mt-1.5 flex h-12 w-full items-center justify-between rounded-2xl bg-secondary px-4 text-left text-[14.5px] active:bg-accent"
      >
        <span className="text-muted-foreground">{hint}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
          <path d="M12 16V4M6 10l6-6 6 6M4 20h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
