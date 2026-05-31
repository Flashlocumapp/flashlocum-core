import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/role";
import { setRole } from "@/lib/role";
import {
  markOnboarded,
  saveProfile,
  type DoctorProfile,
  type RequesterProfile,
} from "@/lib/onboarding";
import { markOnboardedRemote } from "@/lib/profile-remote";

export const Route = createFileRoute("/onboarding/$role")({
  component: OnboardingScreen,
});

function OnboardingScreen() {
  const { role } = Route.useParams();
  const navigate = useNavigate();
  const normalizedRole: Role = role === "cover" ? "cover" : "request";
  const isDoctor = normalizedRole === "cover";

  useEffect(() => {
    setRole(normalizedRole);
  }, [normalizedRole]);

  const [requester, setRequester] = useState<RequesterProfile>({});
  const [doctor, setDoctor] = useState<DoctorProfile>({});
  const [step, setStep] = useState<1 | 2>(1);

  // Per product rule: never autofill/carry-over between flows. Each
  // onboarding session starts from a clean slate and requires explicit input.

  const licenseRef = useRef<HTMLInputElement>(null);

  const persist = () => {
    if (isDoctor) saveProfile("cover", doctor);
    else saveProfile("request", requester);
  };

  const remoteFields = () =>
    isDoctor
      ? {
          phone: doctor.phone ?? null,
          gender: doctor.gender ?? null,
          mdcn: doctor.mdcn ?? null,
          license_name: doctor.license ?? null,
          selfie_url: doctor.selfie ?? null,
          bank_name: doctor.bankName ?? null,
          bank_account: doctor.bankAccount ?? null,
        }
      : {
          phone: requester.phone ?? null,
          gender: requester.gender ?? null,
        };

  const step1Valid = isDoctor
    ? !!(doctor.phone?.trim() && doctor.gender?.trim())
    : !!(requester.phone?.trim() && requester.gender?.trim());

  const step2Valid =
    !!doctor.selfie &&
    !!doctor.mdcn?.trim() &&
    !!doctor.license?.trim() &&
    !!doctor.bankName?.trim() &&
    !!doctor.bankAccount?.trim();

  const canContinue = isDoctor ? (step === 1 ? step1Valid : step2Valid) : step1Valid;

  const finish = async () => {
    persist();
    markOnboarded(normalizedRole);
    try {
      await markOnboardedRemote(normalizedRole, remoteFields());
    } catch (e) {
      console.warn(e);
    }
    navigate({ to: "/home" });
  };

  const onContinue = async () => {
    if (!canContinue) return;
    if (isDoctor && step === 1) {
      persist();
      setStep(2);
      return;
    }
    await finish();
  };


  const title = isDoctor
    ? step === 1
      ? "Personal details"
      : "Verification requirements"
    : "Basic profile";
  const subtitle = isDoctor
    ? step === 1
      ? "We use these to coordinate coverage requests."
      : "Submit these so we can verify your account. Usually reviewed within an hour."
    : "Tell us a little about you. You can edit this anytime.";

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              if (isDoctor && step === 2) setStep(1);
              else navigate({ to: "/home" });
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {isDoctor ? `Cover & Earn · Step ${step} of 2` : "Request Coverage"}
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
          ) : step === 1 ? (
            <>
              <Field
                label="Phone number"
                type="tel"
                placeholder="+234 800 000 0000"
                value={doctor.phone ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, phone: v }))}
              />
              <SelectField
                label="Gender"
                value={doctor.gender ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, gender: v }))}
                options={["Female", "Male", "Prefer not to say"]}
              />
            </>
          ) : (
            <>
              <SelfieCapture
                value={doctor.selfie}
                onCapture={(dataUrl) => setDoctor((p) => ({ ...p, selfie: dataUrl }))}
                onClear={() => setDoctor((p) => ({ ...p, selfie: undefined }))}
              />

              <Field
                label="MDCN number"
                type="text"
                value={doctor.mdcn ?? ""}
                onChange={(v) => setDoctor((p) => ({ ...p, mdcn: v }))}
              />

              <UploadField
                label="License / Payment receipt upload"
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
            </>
          )}
        </div>

        <div className="mt-8 space-y-2.5">
          <button
            onClick={onContinue}
            className="h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90"
          >
            {isDoctor && step === 1 ? "Next" : "Submit"}
          </button>
          <button
            onClick={onSkip}
            className="h-11 w-full rounded-2xl text-[14px] font-medium text-muted-foreground active:bg-accent"
          >
            Skip for now
          </button>
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

function SelfieCapture({
  value,
  onCapture,
  onClear,
}: {
  value?: string;
  onCapture: (dataUrl: string) => void;
  onClear: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setError(null);
    setOpen(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      });
      setStream(s);
    } catch {
      setError("Camera unavailable. Please allow camera access and try again.");
    }
  };

  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setOpen(false);
  };

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  const snap = () => {
    const v = videoRef.current;
    if (!v) return;
    const size = Math.min(v.videoWidth, v.videoHeight) || 480;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const sx = (v.videoWidth - size) / 2;
    const sy = (v.videoHeight - size) / 2;
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, size, size, 0, 0, size, size);
    onCapture(c.toDataURL("image/jpeg", 0.85));
    stop();
  };

  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground">Selfie</label>
      <div className="mt-1.5 flex items-center gap-3 rounded-2xl bg-secondary p-3">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-background"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-hairline)" }}
        >
          {value ? (
            <img src={value} alt="Selfie" className="h-full w-full object-cover" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
              <circle cx="12" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5 20c1.6-3.2 4.2-4.8 7-4.8s5.4 1.6 7 4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium">
            {value ? "Selfie captured" : "Live selfie required"}
          </div>
          <div className="text-[12px] text-muted-foreground">
            {value ? "Retake to update" : "Front camera only"}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {value && (
            <button
              type="button"
              onClick={onClear}
              className="h-9 rounded-xl bg-background px-3 text-[12.5px] font-medium active:bg-accent"
              style={{ boxShadow: "inset 0 0 0 1px var(--color-hairline)" }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={start}
            className="h-9 rounded-xl bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground active:opacity-90"
          >
            {value ? "Retake" : "Capture"}
          </button>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
          onClick={stop}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl bg-card p-4"
          >
            <div className="text-center text-[15px] font-semibold tracking-tight">
              Take a live selfie
            </div>
            <div className="mt-1 text-center text-[12px] text-muted-foreground">
              Center your face inside the frame.
            </div>

            <div
              className="relative mx-auto mt-4 aspect-square w-full overflow-hidden rounded-2xl bg-black"
              style={{ boxShadow: "inset 0 0 0 1px var(--color-hairline)" }}
            >
              {error ? (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[13px] text-white/85">
                  {error}
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                    style={{ transform: "scaleX(-1)" }}
                  />
                  <div
                    className="pointer-events-none absolute inset-6 rounded-full"
                    style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.35)" }}
                  />
                </>
              )}
            </div>

            <div className="mt-4 flex gap-2.5">
              <button
                type="button"
                onClick={stop}
                className="h-11 flex-1 rounded-2xl bg-secondary text-[14px] font-medium active:bg-accent"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={snap}
                disabled={!stream}
                className="h-11 flex-1 rounded-2xl bg-primary text-[14px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50"
              >
                Capture
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
