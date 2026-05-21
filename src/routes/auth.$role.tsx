import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/auth/$role")({
  component: AuthScreen,
});

function AuthScreen() {
  const { role } = Route.useParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [showPw, setShowPw] = useState(false);

  const roleLabel = role === "cover" ? "Cover & Earn" : "Request Coverage";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Dev-mode bypass — go straight in.
    navigate({ to: "/home" });
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
            <Field label="Full name" type="text" placeholder="Dr. Ada Okafor" />
          )}
          <Field label="Email" type="email" placeholder="you@hospital.com" />
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Password</label>
            <div className="mt-1.5 flex items-center rounded-2xl bg-secondary px-4">
              <input
                type={showPw ? "text" : "password"}
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

          <button
            type="submit"
            className="mt-4 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90"
          >
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={() => navigate({ to: "/home" })}
          className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-card text-[14px] font-medium hairline-t hairline-b active:bg-accent"
          style={{ boxShadow: "inset 0 0 0 1px var(--color-hairline)" }}
        >
          <GoogleG />
          Continue with Google
        </button>

        <div className="mt-auto pt-8 text-center text-[13px] text-muted-foreground">
          {mode === "signup" ? "Already have an account?" : "New to FlashLocum?"}{" "}
          <button
            onClick={() => setMode(mode === "signup" ? "login" : "signup")}
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
const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.5 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.2 0-9.5-3.5-11.2-8.2l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C40.4 36.6 44 30.8 44 24c0-1.2-.1-2.3-.4-3.5z"/>
  </svg>
);
