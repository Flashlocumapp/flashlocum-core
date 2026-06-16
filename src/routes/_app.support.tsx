import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/support")({
  component: SupportScreen,
});

function SupportScreen() {
  const navigate = useNavigate();

  const openWhatsApp = () => {
    const phone = "2349134336851";
    const url = `https://wa.me/${phone}`;
    window.open(url, "_blank");
  };

  const openEmail = () => {
    window.location.href = "mailto:support@flashlocum.com";
  };

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="px-5 pt-4">
        <div className="mx-auto max-w-md">
          <button
            onClick={() => navigate({ to: "/account" })}
            className="mb-3 flex items-center gap-1 text-[14px] text-muted-foreground active:opacity-70"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Back
          </button>
          <h1 className="text-[26px] font-semibold tracking-tight">Contact Support</h1>
        </div>
      </header>

      <div className="mx-auto mt-5 max-w-md px-5 pb-10">
        <p className="text-[14.5px] leading-relaxed text-muted-foreground">
          Need help? Reach out to us directly and we&apos;ll be happy to assist.
        </p>

        <div className="mt-6 space-y-3">
          {/* WhatsApp */}
          <button
            onClick={openWhatsApp}
            className="flex w-full items-center gap-4 rounded-2xl p-4 text-left active:bg-accent"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: "color-mix(in oklab, #22c55e 12%, transparent)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">WhatsApp Support</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">+234 913 433 6851</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-muted-foreground">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Email */}
          <button
            onClick={openEmail}
            className="flex w-full items-center gap-4 rounded-2xl p-4 text-left active:bg-accent"
            style={{ background: "var(--color-surface-elevated)" }}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: "color-mix(in oklab, var(--color-primary) 12%, transparent)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium">Email Support</div>
              <div className="mt-0.5 truncate text-[13px] text-muted-foreground">support@flashlocum.com</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-muted-foreground">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}
