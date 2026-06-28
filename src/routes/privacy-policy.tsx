import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy-policy")({
  component: PrivacyPolicy,
  head: () => ({
    meta: [
      { title: "Privacy Policy — FlashLocum" },
      {
        name: "description",
        content:
          "Privacy Policy for the FlashLocum platform. Learn how we collect, use, and protect your information.",
      },
      { property: "og:title", content: "Privacy Policy — FlashLocum" },
      { property: "og:description", content: "Privacy Policy for the FlashLocum platform." },
      { property: "og:url", content: "https://app.flashlocum.com/privacy-policy" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://app.flashlocum.com/privacy-policy" }],
  }),
});

function PrivacyPolicy() {
  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center gap-1">
          <Link
            to="/role"
            className="inline-flex items-center gap-2 text-[14px] font-medium text-muted-foreground hover:text-foreground"
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
            Back
          </Link>
        </div>

        <h1 className="mt-8 text-[26px] font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">Effective Date: 20th of June, 2026</p>

        <div className="mt-8 space-y-8 text-[14px] leading-relaxed text-foreground">
          <p className="text-muted-foreground">
            FlashLocum ("we", "our", "us") is a real-time locum coordination platform that connects
            verified medical doctors with healthcare professionals who require temporary locum
            cover.
          </p>
          <p className="text-muted-foreground">
            This Privacy Policy explains how we collect, use, and protect your information.
          </p>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">1. Information We Collect</h2>
            <p className="mt-2 text-muted-foreground">We collect:</p>

            <h3 className="mt-3 text-[15px] font-semibold">A. Personal Information</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Full name</li>
              <li>Email address</li>
              <li>Phone number</li>
              <li>Professional details (for doctors)</li>
            </ul>

            <h3 className="mt-3 text-[15px] font-semibold">B. Platform Data</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Shift requests and bookings</li>
              <li>Acceptance and cancellation history</li>
              <li>Ratings and reliability scores</li>
            </ul>

            <h3 className="mt-3 text-[15px] font-semibold">C. Technical Data</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Device information</li>
              <li>Usage logs</li>
              <li>IP address</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">2. How We Use Information</h2>
            <p className="mt-2 text-muted-foreground">We use your information to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Match doctors with requests</li>
              <li>Enable booking and coordination</li>
              <li>Process payments</li>
              <li>Maintain ratings and reliability systems</li>
              <li>Improve platform performance</li>
              <li>Prevent fraud and abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">3. Payments</h2>
            <p className="mt-2 text-muted-foreground">
              Payment processing is handled through third-party providers. We do not store full
              payment card details. We may store transaction references for reconciliation and
              dispute handling.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">4. Sharing of Information</h2>
            <p className="mt-2 text-muted-foreground">We may share limited information between:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Requesters and doctors (for coordination purposes)</li>
              <li>Payment providers (for settlement)</li>
              <li>Regulatory or legal authorities if required</li>
            </ul>
            <p className="mt-2 text-muted-foreground">We do not sell user data.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">5. Data Security</h2>
            <p className="mt-2 text-muted-foreground">
              We use reasonable technical and organizational measures to protect your data. However,
              no system is 100% secure.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">6. Data Retention</h2>
            <p className="mt-2 text-muted-foreground">
              We retain user data as long as necessary to:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Provide services</li>
              <li>Meet legal obligations</li>
              <li>Maintain platform integrity</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">7. Your Rights</h2>
            <p className="mt-2 text-muted-foreground">You may request:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Access to your data</li>
              <li>Correction of inaccurate data</li>
              <li>Deletion of your account (subject to legal obligations)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">8. Cookies and Tracking</h2>
            <p className="mt-2 text-muted-foreground">
              We may use cookies or similar technologies to improve user experience.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">9. Changes to This Policy</h2>
            <p className="mt-2 text-muted-foreground">
              We may update this Privacy Policy periodically. Continued use of FlashLocum implies
              acceptance of changes.
            </p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">10. Contact</h2>
            <p className="mt-2 text-muted-foreground">support@flashlocum.com</p>
          </section>
        </div>
      </div>
    </main>
  );
}
