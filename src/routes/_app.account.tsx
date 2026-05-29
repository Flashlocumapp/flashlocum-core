import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { clearRole, getRole, setRole, type Role } from "@/lib/role";
import { isOnboarded } from "@/lib/onboarding";

export const Route = createFileRoute("/_app/account")({
  component: AccountScreen,
});


type Section = { label: string; rows: { id: string; title: string; meta?: string }[] };

const REQUESTER_SECTIONS: Section[] = [
  {
    label: "Identity",
    rows: [
      { id: "profile", title: "Profile" },
      { id: "verification", title: "Verification", meta: "Verified" },
      { id: "facility", title: "Facility profile" },
    ],
  },
  {
    label: "Operations",
    rows: [
      { id: "payouts", title: "Payouts" },
      { id: "support", title: "Support" },
      { id: "settings", title: "Settings" },
    ],
  },
];

const COVER_SECTIONS: Section[] = [
  {
    label: "Identity",
    rows: [
      { id: "profile", title: "Profile" },
      { id: "verification", title: "Verification", meta: "Verified" },
    ],
  },
  {
    label: "Operations",
    rows: [
      { id: "payouts", title: "Payouts" },
      { id: "support", title: "Support" },
      { id: "settings", title: "Settings" },
    ],
  },
];

function AccountScreen() {
  const navigate = useNavigate();
  const [role, setLocalRole] = useState<Role>("request");
  const [switchPrompt, setSwitchPrompt] = useState<Role | null>(null);
  useEffect(() => setLocalRole(getRole()), []);

  const roleLabel = role === "cover" ? "Cover & Earn" : "Request Coverage";
  const otherLabel = role === "cover" ? "Request Coverage" : "Cover & Earn";

  const doSwitch = (next: Role) => {
    setRole(next);
    setLocalRole(next);
    if (!isOnboarded(next)) {
      navigate({ to: "/onboarding/$role", params: { role: next } });
    } else {
      navigate({ to: "/home" });
    }
  };

  const switchRole = () => {
    const next: Role = role === "cover" ? "request" : "cover";
    if (!isOnboarded(next)) {
      setSwitchPrompt(next);
      return;
    }
    doSwitch(next);
  };

  const openProfile = () => {
    navigate({ to: "/onboarding/$role", params: { role } });
  };


  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="safe-top px-5 pt-4">
        <div className="mx-auto max-w-md">
          <h1 className="text-[26px] font-semibold tracking-tight">Account</h1>
        </div>
      </header>

      <div className="mx-auto mt-4 max-w-md px-5 pb-10">
        <div
          className="flex items-center gap-3 rounded-2xl p-4"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full text-[16px] font-semibold"
            style={{
              background: "color-mix(in oklab, var(--color-primary) 12%, transparent)",
              color: "var(--color-primary)",
            }}
          >
            AO
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-medium">Dr. Adaobi Okeke</div>
            <div className="text-[12.5px] text-muted-foreground">
              {roleLabel} · Lagos
            </div>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em]"
            style={{
              background: "color-mix(in oklab, var(--color-presence) 14%, transparent)",
              color: "var(--color-presence)",
            }}
          >
            Online
          </span>
        </div>

        <button
          onClick={switchRole}
          className="mt-3 flex w-full items-center justify-between rounded-2xl px-4 py-3.5 text-left active:bg-accent"
          style={{ background: "var(--color-surface-elevated)" }}
        >
          <span className="flex flex-col">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Switch to
            </span>
            <span className="text-[14.5px] font-medium">{otherLabel}</span>
          </span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-muted-foreground">
            <path d="M7 7h10v10M17 7L7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {(role === "cover" ? COVER_SECTIONS : REQUESTER_SECTIONS).map((s) => (
          <div key={s.label} className="mt-6">
            <div className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {s.label}
            </div>
            <ul
              className="mt-2 overflow-hidden rounded-2xl"
              style={{ background: "var(--color-surface-elevated)" }}
            >
              {s.rows.map((r, i) => (
                <li
                  key={r.id}
                  style={{
                    borderTop:
                      i === 0
                        ? "none"
                        : "1px solid color-mix(in oklab, var(--color-foreground) 5%, transparent)",
                  }}
                >
                  <button
                    onClick={() => {
                      if (r.id === "profile" || r.id === "verification") openProfile();
                    }}
                    className="flex w-full items-center justify-between px-4 py-3.5 text-left active:bg-accent"
                  >
                    <span className="text-[14.5px]">{r.title}</span>
                    <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                      {r.meta}
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </span>
                  </button>

                </li>
              ))}
            </ul>
          </div>
        ))}

        <button
          onClick={() => {
            clearRole();
            navigate({ to: "/role" });
          }}
          className="mt-8 w-full rounded-2xl py-3.5 text-[14px] font-medium text-muted-foreground active:bg-accent"
          style={{ background: "var(--color-secondary)" }}
        >
          Sign out
        </button>
      </div>
    </section>
  );
}
