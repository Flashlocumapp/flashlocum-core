import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { setRole, type Role } from "@/lib/role";
import { isOnboarded } from "@/lib/onboarding";

export const Route = createFileRoute("/auth/$role")({
  component: AuthScreen,
});

/**
 * Backend has been removed in preparation for connecting a fresh Supabase project.
 * This screen now performs a local-only "continue" — no signup, login, OTP, or
 * password reset. Once a backend is rewired, restore the real auth flows here.
 */
function AuthScreen() {
  const { role } = Route.useParams();
  const navigate = useNavigate();
  const normalizedRole: Role = role === "cover" ? "cover" : "request";
  const roleLabel = normalizedRole === "cover" ? "Cover & Earn" : "Request Coverage";
  const [name, setName] = useState("");

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setRole(normalizedRole);
    if (isOnboarded(normalizedRole)) {
      navigate({ to: "/home" });
    } else {
      navigate({ to: "/onboarding/$role", params: { role: normalizedRole } });
    }
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
          <h1 className="text-[26px] font-semibold tracking-tight">Continue to FlashLocum</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">
            Authentication is temporarily disabled while a new backend is being connected.
            Enter a display name to continue locally.
          </p>
        </div>

        <form onSubmit={handleContinue} className="mt-7 space-y-3">
          <div>
            <label className="text-[12px] font-medium text-muted-foreground">Display name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder={normalizedRole === "cover" ? "Dr. Ada Okafor" : "Ada Okafor"}
              className="mt-1.5 h-12 w-full rounded-2xl bg-secondary px-4 text-[15px] outline-none placeholder:text-muted-foreground/70"
            />
          </div>
          <button
            type="submit"
            className="mt-4 h-13 w-full rounded-2xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground active:opacity-90"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
