import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { setRole, type Role } from "@/lib/role";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth/$role")({
  component: AuthScreen,
});

type Mode = "signin" | "signup" | "forgot";

function AuthScreen() {
  const { role } = Route.useParams();
  const navigate = useNavigate();
  const normalizedRole: Role = role === "cover" ? "cover" : "request";
  const roleLabel = normalizedRole === "cover" ? "Cover & Earn" : "Request Coverage";

  const [mode, setMode] = useState<Mode>("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [hasExistingSession, setHasExistingSession] = useState(false);

  useEffect(() => {
    // Check for existing session but DON'T auto-redirect — let the user
    // see the auth screen so they can sign in/up or switch accounts.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setHasExistingSession(true);
        setMode("signin");
      }
    });
    // Only route after a NEW auth event (sign-in/sign-up just completed).
    const { data: sub } = supabase.auth.onAuthStateChange((evt) => {
      if (evt === "SIGNED_IN") routeAfterAuth();
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const routeAfterAuth = () => {
    setRole(normalizedRole);
    // Always route to /home — the app shell enforces the backend
    // onboarding gate and will redirect to /onboarding/$role if needed.
    navigate({ to: "/home" });
  };

  const handleContinueExisting = () => {
    routeAfterAuth();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setHasExistingSession(false);
    setMode("signup");
    setEmail("");
    setPassword("");
    setName("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (mode === "forgot") {
      if (!email) {
        setError("Enter your email to receive a reset link.");
        return;
      }
      setSubmitting(true);
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        setInfo("Check your email for a password reset link.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not send reset email.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + `/auth/${normalizedRole}`,
            data: { full_name: name, role: normalizedRole },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Check your email to confirm your account, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + `/auth/${normalizedRole}` },
    });
    if (error) setError(error.message);
  };

  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <Link
            to="/role"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-secondary"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {roleLabel}
          </div>
          <div className="h-9 w-9" />
        </div>

        <div className="mt-10">
          <h1 className="text-[26px] font-semibold tracking-tight">
            {mode === "signin"
              ? "Welcome back"
              : mode === "signup"
                ? "Create your account"
                : "Reset your password"}
          </h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {mode === "signin"
              ? "Sign in to continue to FlashLocum."
              : mode === "signup"
                ? "Set up your FlashLocum account in seconds."
                : "Enter your email and we'll send you a reset link."}
          </p>
        </div>

        {mode !== "forgot" && (
          <>
            <button
              type="button"
              onClick={handleGoogle}
              className="mt-7 flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl bg-secondary text-[15px] font-medium active:bg-accent"
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.2 29 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.6 6.2 29 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 43.5c5 0 9.5-1.7 13-4.6l-6-4.9c-2 1.4-4.5 2.2-7 2.2-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39 16.2 43.5 24 43.5z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6 4.9c4.2-3.9 6.7-9.7 6.7-15.9 0-1.2-.1-2.4-.4-3.5z"/>
              </svg>
              Continue with Google
            </button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit} className={`space-y-3 ${mode === "forgot" ? "mt-7" : ""}`}>
          {mode === "signup" && (
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Full name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder={normalizedRole === "cover" ? "Dr. Ada Okafor" : "Ada Okafor"}
                className="mt-1.5 h-12 w-full rounded-2xl bg-secondary px-4 text-[15px] outline-none placeholder:text-muted-foreground/70"
              />
            </div>
          )}
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-1.5 h-12 w-full rounded-2xl bg-secondary px-4 text-[15px] outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          {mode !== "forgot" && (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-muted-foreground">Password</label>
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("forgot");
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative mt-1.5">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  placeholder="••••••••"
                  className="h-12 w-full rounded-2xl bg-secondary px-4 pr-12 text-[15px] outline-none placeholder:text-muted-foreground/70"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground active:bg-accent"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10.7 10.7 0 0112 5c5 0 9.3 3.1 11 7-0.5 1.2-1.3 2.3-2.3 3.3M6.3 6.3C4.5 7.6 3 9.6 2 12c1.7 3.9 6 7 10 7 1.7 0 3.4-.4 4.9-1.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-[12.5px] text-destructive">{error}</p>}
          {info && <p className="text-[12.5px] text-muted-foreground">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
          >
            {submitting
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setInfo(null);
          }}
          className="mt-5 text-center text-[13px] text-muted-foreground"
        >
          {mode === "forgot"
            ? "Back to sign in"
            : mode === "signin"
              ? "New to FlashLocum? Create an account"
              : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
