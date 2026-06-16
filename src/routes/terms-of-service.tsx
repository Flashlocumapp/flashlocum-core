import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms-of-service")({
  component: TermsOfService,
  head: () => ({
    meta: [
      { title: "Terms of Service — FlashLocum" },
      { name: "description", content: "Terms of Service for the FlashLocum platform. Read how we connect verified locum doctors with healthcare professionals." },
      { property: "og:title", content: "Terms of Service — FlashLocum" },
      { property: "og:description", content: "Terms of Service for the FlashLocum platform." },
      { property: "og:url", content: "https://flashlocum-core.lovable.app/terms-of-service" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://flashlocum-core.lovable.app/terms-of-service" }],
  }),
});

function TermsOfService() {
  return (
    <main className="min-h-screen bg-background safe-top safe-bottom">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="flex items-center gap-1">
          <Link to="/role" className="inline-flex items-center gap-2 text-[14px] font-medium text-muted-foreground hover:text-foreground">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </Link>
        </div>

        <h1 className="mt-8 text-[26px] font-semibold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-[14px] text-muted-foreground">Effective Date: 20th of June, 2026</p>

        <div className="mt-8 space-y-8 text-[14px] leading-relaxed text-foreground">
          <p className="text-muted-foreground">
            These Terms of Service ("Terms") govern your use of the FlashLocum platform ("FlashLocum", "we", "us", "our"), a real-time locum coordination platform that connects verified post-NYSC medical doctors with healthcare professionals who require temporary locum cover.
          </p>
          <p className="text-muted-foreground">
            By accessing or using FlashLocum, you agree to these Terms.
          </p>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">1. What FlashLocum Does</h2>
            <p className="mt-2 text-muted-foreground">FlashLocum is a technology platform that enables users to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Request or book locum doctors in real time</li>
              <li>Accept locum opportunities as a doctor</li>
              <li>Coordinate temporary medical shift coverage</li>
              <li>Facilitate payments after shift completion</li>
              <li>Maintain ratings and reliability scores</li>
            </ul>
            <p className="mt-2 text-muted-foreground">FlashLocum is not a hospital, medical provider, employer, or recruitment agency. We do not employ doctors or control medical services provided during shifts.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">2. Eligibility</h2>
            <p className="mt-2 text-muted-foreground">To use FlashLocum:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Doctors must be verified post-NYSC medical practitioners</li>
              <li>Users must provide accurate registration information</li>
              <li>Users must comply with applicable medical and professional regulations</li>
            </ul>
            <p className="mt-2 text-muted-foreground">We reserve the right to verify, approve, or suspend accounts.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">3. Platform Role</h2>
            <p className="mt-2 text-muted-foreground">FlashLocum only provides a coordination platform. We do not:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Employ doctors or healthcare professionals</li>
              <li>Control medical decisions during shifts</li>
              <li>Guarantee availability of doctors</li>
              <li>Guarantee acceptance of requests</li>
            </ul>
            <p className="mt-2 text-muted-foreground">All medical services are provided independently by doctors.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">4. Booking and Acceptance</h2>
            <p className="mt-2 text-muted-foreground">Users may request or book locum cover through the platform. Doctors may choose to accept or decline requests. A booking is only confirmed when a doctor accepts the request.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">5. Payments</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>All payments are processed through FlashLocum&apos;s payment partners</li>
              <li>Payments are made after shift completion</li>
              <li>Payments may be split between the doctor and FlashLocum automatically</li>
              <li>FlashLocum does not guarantee payment outside the platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">6. Ratings and Reliability</h2>
            <p className="mt-2 text-muted-foreground">Users may be rated after shifts. Ratings reflect performance feedback. Reliability reflects cancellation and attendance behaviour. FlashLocum may use these metrics to improve platform trust and matching. We reserve the right to adjust rating calculations for fairness and abuse prevention.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">7. Cancellations</h2>
            <p className="mt-2 text-muted-foreground">Users may cancel bookings subject to platform rules. Repeated cancellations may impact reliability scores and access to the platform.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">8. Prohibited Use</h2>
            <p className="mt-2 text-muted-foreground">Users must not:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Misuse the platform</li>
              <li>Provide false medical credentials</li>
              <li>Attempt fraud or payment abuse</li>
              <li>Circumvent the FlashLocum platform for payments</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">9. Limitation of Liability</h2>
            <p className="mt-2 text-muted-foreground">FlashLocum is not liable for:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Medical outcomes</li>
              <li>Actions of doctors or users</li>
              <li>Missed shifts or cancellations</li>
              <li>Indirect or financial losses</li>
            </ul>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">10. Changes</h2>
            <p className="mt-2 text-muted-foreground">We may update these Terms at any time. Continued use means acceptance of updated Terms.</p>
          </section>

          <section>
            <h2 className="text-[17px] font-semibold tracking-tight">11. Contact</h2>
            <p className="mt-2 text-muted-foreground">support@flashlocum.com</p>
          </section>
        </div>
      </div>
    </main>
  );
}
