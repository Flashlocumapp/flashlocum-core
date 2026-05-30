import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordScreen,
});

function ResetPasswordScreen() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");

    if (!access_token || !refresh_token) {
      if (!cancelled) setError("Invalid or expired reset link. Please request a new one.");
      return;
    }

    (async () => {
      try {
        const { error: sessionErr } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (cancelled) return;
        if (sessionErr) {
          setError(sessionErr.message || "Could not validate reset session.");
          return;
        }
        setReady(true);
      } catch {
        if (!cancelled) setError("Could not validate reset session.");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !ready) return;
    setError(null);
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
      setTimeout(() => navigate({ to: "/role", search: { reset: "success" } }), 1400);
    } catch (err) {
      setError((err as Error).message || "Could not update password.");
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
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Reset password</div>
          <div className="h-9 w-9" />
        </div>

        <div className="mt-10">
          <h1 className="text-[26px] font-semibold tracking-tight">Set a new password</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            {ready
              ? "Choose a new password to finish signing back in."
              : "Open this page from the email link we sent you."}
          </p>
        </div>

        {done ? (
          <div className="mt-7 rounded-2xl bg-secondary px-4 py-4 text-[14px]">
            Password updated. Redirecting…
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-7 space-y-3">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">New password</label>
              <div className="mt-1.5 flex items-center rounded-2xl bg-secondary px-4">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={!ready}
                  className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/70 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground"
                >
                  {showPw ? "🙈" : "👁"}
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
              disabled={busy || !ready}
              className="mt-4 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90 disabled:opacity-60"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
