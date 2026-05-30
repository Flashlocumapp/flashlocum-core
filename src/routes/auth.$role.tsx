import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { setRole, type Role } from "@/lib/role";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { hasCompletedOnboarding } from "@/lib/profile-remote";

export const Route = createFileRoute("/auth/$role")({
  component: AuthScreen,
});

function AuthScreen() {
  const { role } = Route.useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [showPw, setShowPw] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const normalizedRole: Role = role === "cover" ? "cover" : "request";
  const roleLabel = normalizedRole === "cover" ? "Cover & Earn" : "Request Coverage";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data.session) proceed();
    })();
    return () => { cancelled = true; };
  }, []);

  const proceed = () => {
    setRole(normalizedRole);
    navigate({ to: "/onboarding/$role", params: { role: normalizedRole } });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);

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
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: name || undefined, role: normalizedRole },
          },
        });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      }
      proceed();
    } catch (err) {
      setError((err as Error).message || "Something went wrong. Try again.");
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
      proceed();
    } catch (err) {
      setError((err as Error).message || "Google sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <Link to="/role" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{roleLabel}</div>
          <div className="h-9 w-9" />
        </div>

        <div className="mt-10">
          <h1 className="text-[26px] font-semibold tracking-tight">
            {mode === "signup" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {mode === "signup"
              ? "Join the FlashLocum coverage network."
              : "Sign in to continue."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 space-y-3">
          {mode === "signup" && (
            <Field
              label="Full name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder={normalizedRole === "cover" ? "Dr. Ada Okafor" : "Ada Okafor"}
            />
          )}
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            placeholder="you@example.com"
          />

          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Password</label>
            <div className="mt-1.5 flex items-center rounded-2xl bg-secondary px-4">
              <input
                type={showPw ? "text" : "password"}
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
          </div>

          {error && (
            <div className="rounded-xl px-3 py-2 text-[13px]" style={{ background: "color-mix(in oklab, var(--color-destructive, #d24) 14%, transparent)", color: "var(--color-destructive, #d24)" }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
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
            onClick={() => { setError(null); setMode(mode === "signup" ? "login" : "signup"); }}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </div>
      </div>
    </main>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
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
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);
const EyeOff = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M3 3l18 18M10.6 6.1A9 9 0 0122 12s-1.2 2.4-3.6 4.3M6.2 7.7C3.5 9.6 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.5 5-1.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
  </svg>
);
