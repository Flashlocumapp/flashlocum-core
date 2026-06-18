import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { setRole, type Role } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { fetchMyProfile } from "@/lib/profile-remote";
import { adoptVerifiedSession, ensureAuthReady, subscribeAuthState } from "@/lib/auth-ready";

export const Route = createFileRoute("/auth/$role")({
  component: AuthScreen,
});

type View = "form" | "verify" | "forgot" | "forgot-sent";

const AUTH_DEBUG_PREFIX = "[FlashLocum auth debug]";

function maskEmail(value: string) {
  const [namePart, domainPart] = value.trim().toLowerCase().split("@");
  if (!namePart || !domainPart) return "unknown";
  return `${namePart.slice(0, 2)}***@${domainPart}`;
}

function logAuthDebug(event: string, details: Record<string, unknown> = {}) {
  console.info(AUTH_DEBUG_PREFIX, event, {
    at: new Date().toISOString(),
    ...details,
  });
}

function AuthScreen() {
  const { role } = Route.useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [view, setView] = useState<View>("form");
  const [showPw, setShowPw] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedRole: Role = role === "cover" ? "cover" : "request";
  const roleLabel = normalizedRole === "cover" ? "Cover & Earn" : "Request Coverage";

  const proceed = useCallback(async () => {
    // Read backend truth, with a brief retry so the very first request
    // after sign-in isn't lost to an unattached auth header.
    let profile = await fetchMyProfile();
    if (!profile) {
      await new Promise((r) => setTimeout(r, 250));
      profile = await fetchMyProfile();
    }
    // STRICT SURFACE SEPARATION:
    // Request Coverage and Cover & Earn behave as independent auth
    // environments. An account that has only onboarded the OTHER role
    // cannot sign in on this surface — they must create a new account
    // (or unlock the role via the in-app role-switch flow once signed
    // into their original surface).
    const onboardedThis =
      normalizedRole === "cover" ? !!profile?.onboarded_cover_at : !!profile?.onboarded_request_at;
    const onboardedOther =
      normalizedRole === "cover" ? !!profile?.onboarded_request_at : !!profile?.onboarded_cover_at;

    if (onboardedThis) {
      setRole(normalizedRole);
      navigate({ to: "/home" });
      return;
    }
    if (onboardedOther) {
      await supabase.auth.signOut();
      const otherLabel = normalizedRole === "cover" ? "Request Coverage" : "Cover & Earn";
      setError(
        `This account is not registered under ${roleLabel}. It belongs to ${otherLabel}. Please create an account.`,
      );
      setMode("signup");
      setView("form");
      setPassword("");
      return;
    }
    // No onboarding for either role yet → continue into onboarding for
    // the surface the user selected.
    setRole(normalizedRole);
    navigate({
      to: "/onboarding/$role",
      params: { role: normalizedRole },
      search: { from: "auth" },
    });
  }, [navigate, normalizedRole, roleLabel]);

  useEffect(() => {
    let cancelled = false;
    const offAuth = subscribeAuthState(({ event, session }) => {
      logAuthDebug("auth-state-change", {
        event,
        hasSession: Boolean(session),
        emailVerified: Boolean(session?.user.email_confirmed_at),
      });
    });

    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const search = typeof window !== "undefined" ? window.location.search : "";
    const arrivedFromAuthRedirect =
      /access_token=|refresh_token=|type=(signup|recovery|magiclink|invite)/.test(hash) ||
      /[?&]code=/.test(search);
    (async () => {
      const { session } = await ensureAuthReady();
      if (!session?.user.email_confirmed_at) return;
      if (cancelled) return;
      if (arrivedFromAuthRedirect) {
        await proceed();
        return;
      }
      // Returning user with active session: auto-advance ONLY if they've
      // onboarded for THIS surface. Never silently cross into the other
      // surface — they'd have to explicitly sign in here to trigger the
      // strict-separation check.
      const profile = await fetchMyProfile();
      if (cancelled) return;
      const onboardedThis =
        normalizedRole === "cover"
          ? !!profile?.onboarded_cover_at
          : !!profile?.onboarded_request_at;
      if (onboardedThis) {
        await proceed();
      }
    })();
    return () => {
      cancelled = true;
      offAuth();
    };
  }, [proceed, normalizedRole]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);

    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        logAuthDebug("signup:otp-generation-requested", {
          email: maskEmail(email),
          role: normalizedRole,
          flow: "verifyOtp:type=signup",
          emailRedirectTo: `${window.location.origin}/auth/${normalizedRole}`,
        });
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/${normalizedRole}`,
            data: { full_name: name || undefined, role: normalizedRole },
          },
        });
        if (err) {
          logAuthDebug("signup:email-send-failed", {
            email: maskEmail(email),
            message: err.message,
            status: err.status,
          });
          throw err;
        }
        logAuthDebug("signup:email-send-accepted", {
          email: maskEmail(email),
          userId: data.user?.id,
          hasSession: Boolean(data.session),
          emailVerified: Boolean(data.user?.email_confirmed_at),
          identities: data.user?.identities?.length ?? 0,
          otpGeneration: data.session?.user.email_confirmed_at
            ? "not-required"
            : "requested-by-auth-service",
          deliveryResponse: "auth-api-accepted-request",
        });
        if (!data.session && data.user && (data.user.identities?.length ?? 0) === 0) {
          logAuthDebug("signup:existing-account-no-otp-sent", {
            email: maskEmail(email),
            reason: "auth-service-returned-existing-user-without-new-identity",
          });
          setMode("login");
          setError(
            "This email is already registered. Sign in instead, or use Forgot password if needed.",
          );
          return;
        }
        if (data.session?.user.email_confirmed_at) {
          adoptVerifiedSession(data.session);
          await proceed();
          return;
        }
        setCode("");
        setView("verify");
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) {
          if (/confirm/i.test(err.message)) {
            setCode("");
            setView("verify");
            return;
          }
          throw err;
        }
        if (!data.session?.user.email_confirmed_at) {
          setCode("");
          setView("verify");
          return;
        }
        adoptVerifiedSession(data.session);
        await proceed();
      }
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setInfo(null);
    const token = code.trim();
    if (token.length < 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.auth.verifyOtp({
        email,
        token,
        type: "signup",
      });
      if (err) {
        logAuthDebug("verify-otp:failed", {
          email: maskEmail(email),
          tokenLength: token.length,
          message: err.message,
          status: err.status,
        });
        throw err;
      }
      logAuthDebug("verify-otp:succeeded", {
        email: maskEmail(email),
        hasSession: Boolean(data.session),
        emailVerified: Boolean(data.user?.email_confirmed_at),
      });
      if (data.session) {
        adoptVerifiedSession(data.session);
        await proceed();
      } else {
        setError("Verification failed. Please try again.");
      }
    } catch (err) {
      setError((err as Error).message || "Invalid or expired code.");
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      const auth = await ensureAuthReady();
      adoptVerifiedSession(auth.session, "SIGNED_IN");
      await proceed();
    } catch (err) {
      setError((err as Error).message || "Google sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      logAuthDebug("resend:otp-generation-requested", {
        email: maskEmail(email),
        role: normalizedRole,
        flow: "resend:type=signup",
      });
      const { error: err } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/${normalizedRole}` },
      });
      if (err) {
        logAuthDebug("resend:email-send-failed", {
          email: maskEmail(email),
          message: err.message,
          status: err.status,
        });
        throw err;
      }
      logAuthDebug("resend:email-send-accepted", {
        email: maskEmail(email),
        deliveryResponse: "auth-api-accepted-request",
      });
      setInfo("New code sent. Check your email.");
    } catch (err) {
      setError((err as Error).message || "Could not resend email.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!email) {
      setError("Enter your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (err) throw err;
      setView("forgot-sent");
    } catch (err) {
      setError((err as Error).message || "Could not send reset email.");
    } finally {
      setBusy(false);
    }
  };

  // ----- Sub-views -----
  if (view === "verify") {
    return (
      <Shell
        roleLabel={roleLabel}
        title="Enter verification code"
        subtitle={`We’ve sent a 6-digit code to ${email || "your email"}. Enter it below to verify your account.`}
      >
        <form onSubmit={handleVerify} className="mt-6 space-y-3">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            className="h-14 w-full rounded-2xl bg-secondary px-4 text-center text-[22px] font-semibold tracking-[0.5em] outline-none placeholder:text-muted-foreground/40"
          />
          {info && <p className="text-[13px] text-muted-foreground">{info}</p>}
          {error && <ErrorBox>{error}</ErrorBox>}
          <button
            type="submit"
            disabled={busy || code.length < 6}
            className="mt-2 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Verify & continue"}
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={busy}
            className="mt-1 h-12 w-full rounded-2xl bg-secondary text-[14px] font-medium disabled:opacity-60"
          >
            Resend code
          </button>
          <button
            type="button"
            onClick={() => {
              setView("form");
              setMode("login");
              setInfo(null);
              setError(null);
            }}
            className="mt-1 h-11 w-full text-[13px] font-medium text-muted-foreground underline underline-offset-4"
          >
            Back to sign in
          </button>
        </form>
      </Shell>
    );
  }

  if (view === "forgot-sent") {
    return (
      <Shell
        roleLabel={roleLabel}
        title="Check your email"
        subtitle="We’ve sent a password reset link. Open it on this device to set a new password."
      >
        <button
          type="button"
          onClick={() => {
            setView("form");
            setMode("login");
          }}
          className="mt-4 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90"
        >
          Back to sign in
        </button>
      </Shell>
    );
  }

  if (view === "forgot") {
    return (
      <Shell
        roleLabel={roleLabel}
        title="Reset your password"
        subtitle="Enter your email and we’ll send you a reset link."
      >
        <form onSubmit={handleForgot} className="mt-7 space-y-3">
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
          />
          {error && <ErrorBox>{error}</ErrorBox>}
          <button
            type="submit"
            disabled={busy}
            className="mt-4 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <button
            type="button"
            onClick={() => {
              setView("form");
              setError(null);
            }}
            className="mt-2 h-12 w-full rounded-2xl bg-secondary text-[14px] font-medium"
          >
            Cancel
          </button>
        </form>
      </Shell>
    );
  }

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <Link
            to="/role"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {roleLabel}
          </div>
          <div className="h-9 w-9" />
        </div>

        <div className="mt-10">
          <h1 className="text-[26px] font-semibold tracking-tight">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {mode === "signup" ? "Join the FlashLocum coverage network." : "Sign in to continue."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-3" key={mode}>
          {mode === "signup" && (
            <Field
              label="Full name"
              type="text"
              name="name"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder={normalizedRole === "cover" ? "Dr. Ada Okafor" : "Ada Okafor"}
            />
          )}
          <Field
            label="Email"
            type="email"
            name={mode === "signup" ? "email" : "username"}
            id={mode === "signup" ? "signup-email" : "login-email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete={mode === "signup" ? "email" : "username"}
            inputMode="email"
            placeholder="you@example.com"
          />

          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Password</label>
            <div className="mt-1.5 flex items-center rounded-2xl bg-secondary px-4">
              <input
                type={showPw ? "text" : "password"}
                name="password"
                id={mode === "signup" ? "signup-password" : "login-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder="••••••••"
                className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
              >
                {showPw ? <EyeOff /> : <Eye />}
              </button>
            </div>
            {mode === "login" && (
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => {
                    setView("forgot");
                    setError(null);
                  }}
                  className="text-[13px] font-medium text-muted-foreground underline underline-offset-4 active:text-foreground"
                >
                  Forgot password?
                </button>
              </div>
            )}
          </div>

          {error && <ErrorBox>{error}</ErrorBox>}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
          {mode === "signup" && (
            <p className="text-center text-[11px] text-muted-foreground">
              By creating an account, you agree to our{" "}
              <Link to="/terms-of-service" className="underline underline-offset-4 hover:text-foreground">{"\n"}</Link>{" "}
              and{" "}
              <Link to="/privacy-policy" className="underline underline-offset-4 hover:text-foreground">{"\n"}</Link>.
            </p>
          )}
        </form>

        <div className="mt-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-secondary" />
          <span className="text-[12px] text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-secondary" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          className="mt-4 flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl border border-secondary bg-background py-3.5 text-[15px] font-medium text-foreground active:bg-secondary disabled:opacity-60"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="mt-auto pt-8 text-center text-[13px] text-muted-foreground">
          {mode === "signup" ? "Already have an account?" : "New to FlashLocum?"}{" "}
          <button
            onClick={() => {
              setError(null);
              setMode(mode === "signup" ? "login" : "signup");
            }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </div>

        <div className="mt-4 flex items-center justify-center gap-3 text-[12px] text-muted-foreground">
          <Link to="/terms-of-service" className="underline underline-offset-4 hover:text-foreground">{"\n"}</Link>
          <span className="text-hairline">{"\n"}</span>
          <Link to="/privacy-policy" className="underline underline-offset-4 hover:text-foreground">{"\n"}</Link>
        </div>
      </div>
    </main>
  );
}

function Shell({
  roleLabel,
  title,
  subtitle,
  children,
}: {
  roleLabel: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <Link
            to="/role"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {roleLabel}
          </div>
          <div className="h-9 w-9" />
        </div>
        <div className="mt-10">
          <h1 className="text-[26px] font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">{subtitle}</p>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </main>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl px-3 py-2 text-[13px]"
      style={{
        background: "color-mix(in oklab, var(--color-destructive, #d24) 14%, transparent)",
        color: "var(--color-destructive, #d24)",
      }}
    >
      {children}
    </div>
  );
}

function Field({
  label,
  ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="text-[12px] font-medium text-muted-foreground">{label}</label>
      <input
        {...rest}
        className="mt-1.5 h-12 w-full rounded-2xl bg-secondary px-4 text-[15px] outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  );
}

const Eye = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const EyeOff = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path
      d="M3 3l18 18M10.6 6.1A9 9 0 0122 12s-1.2 2.4-3.6 4.3M6.2 7.7C3.5 9.6 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.5 5-1.3"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);
