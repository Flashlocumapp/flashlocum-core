import { createFileRoute } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { getRole } from "@/lib/role";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/_app/help")({
  component: HelpScreen,
});

function HelpScreen() {
  const navigate = useNavigate();
  const role = getRole();
  const isDoctor = role === "cover";

  return (
    <section className="relative h-full w-full overflow-y-auto bg-background">
      <header className="safe-top px-5 pt-4">
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
          <h1 className="text-[26px] font-semibold tracking-tight">Help Center</h1>
        </div>
      </header>

      <div className="mx-auto mt-5 max-w-md px-5 pb-10">
        <p className="text-[14.5px] leading-relaxed text-muted-foreground">
          {isDoctor
            ? "Everything doctors need to know about using FlashLocum."
            : "Everything requesters need to know about using FlashLocum."}
        </p>

        {isDoctor ? <DoctorContent /> : <RequesterContent />}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Requester content — accordion / dropdown                            */
/* ------------------------------------------------------------------ */
function RequesterContent() {
  return (
    <Accordion type="multiple" className="mt-6 space-y-3">
      {/* 1. How FlashLocum works */}
      <AccordionItem
        value="how-it-works"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          1. How FlashLocum works
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>Hospitals create coverage requests for doctors.</p>
            <p>Requesters post shift requests.</p>
            <p>Doctors accept or decline requests.</p>
            <p>Only accepted doctors appear on the shift.</p>
            <p className="font-medium text-foreground">Requesters manage the shift lifecycle:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Start Shift</li>
              <li>Pause Shift</li>
              <li>End Shift</li>
            </ul>
            <p className="font-medium text-foreground">A request can be:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Single-day</li>
              <li>Multi-day (up to 7 days)</li>
            </ul>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 2. How payments work */}
      <AccordionItem
        value="payments"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          2. How payments work
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-3 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>Requesters pay for doctor coverage.</p>

            <p className="font-medium text-foreground">Single-day shifts</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Payment is made at the end of the shift</li>
              <li>After requester clicks End Shift</li>
              <li>Payment is confirmed via Monnify</li>
            </ul>
            <p className="font-medium text-foreground">After confirmation:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Shift is closed</li>
              <li>Doctor is paid by FlashLocum</li>
              <li>Ratings are triggered for both sides</li>
            </ul>
            <p>If payment is not completed within 15 minutes of clicking End Shift, the shift remains open and billing continues in additional 15-minute blocks until payment is successfully completed.</p>

            <p className="font-medium text-foreground">Multi-day shifts</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>A multi-day shift can last up to 7 consecutive days</li>
              <li>Payment is made only at the end of the entire shift</li>
              <li>There is no daily payment</li>
              <li>There is no payment during pause or resume</li>
            </ul>
            <p className="font-medium text-foreground">At the end of the shift:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Requester clicks End Shift</li>
              <li>Payment is made once for the full duration</li>
            </ul>
            <p className="font-medium text-foreground">After payment confirmation:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Shift is closed permanently</li>
              <li>Doctor is paid by FlashLocum</li>
              <li>Ratings are triggered for both sides</li>
            </ul>
            <p>If payment is not completed within 15 minutes of clicking End Shift, the shift remains open and billing continues in additional 15-minute blocks until payment is successfully completed.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 3. Ratings */}
      <AccordionItem
        value="ratings"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          3. Ratings
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>Requesters also have a rating score.</p>
            <p>Doctors rate requesters after completed shifts.</p>
            <p className="font-medium text-foreground">How it works</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Ratings are calculated in blocks of 20 shifts</li>
              <li>After every 20 shifts, the system calculates the average rating</li>
              <li>This replaces the previous rating block</li>
              <li>Ratings reflect performance in batches, not single shifts</li>
            </ul>
            <p className="font-medium text-foreground">Minimum rating rule</p>
            <p>A requester&apos;s rating cannot go below 3.5 stars. If rating falls below 3.5, the requester may be restricted from using the platform.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 4. Reliability Score */}
      <AccordionItem
        value="reliability"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          4. Reliability Score
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>Requesters also have a reliability score.</p>
            <p>This measures how often requesters cancel shifts.</p>
            <p className="font-medium text-foreground">Starting value</p>
            <p>Every requester starts with 100% reliability.</p>
            <p className="font-medium text-foreground">How it works</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Reliability is calculated in blocks of 20 shifts</li>
              <li>After every 20 shifts, the system calculates cancellation rate</li>
              <li>The previous reliability score is replaced</li>
            </ul>
            <p className="font-medium text-foreground">How shifts are counted</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Completed shift = success</li>
              <li>Cancelled shift (after acceptance) = failure</li>
            </ul>
            <p className="font-medium text-foreground">Cancellation rule</p>
            <p>Requesters must NOT cancel more than 5 shifts per 20 shifts. More than 5 cancellations will reduce reliability below acceptable level.</p>
            <p className="font-medium text-foreground">Minimum reliability rule</p>
            <p>Reliability cannot go below 75%. If reliability falls below 75%, requester may be restricted from creating or managing shifts.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 5. Single-day coverage request */}
      <AccordionItem
        value="single-day"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          5. Single-day coverage request
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Flow:</p>
            <p>Create request → Doctor accepts</p>
            <p>Start Shift → End Shift</p>
            <p>Payment is made after shift ends</p>
            <p>Rating is completed after payment confirmation</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 6. Multi-day coverage request */}
      <AccordionItem
        value="multi-day"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          6. Multi-day coverage request
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Flow:</p>
            <p>Create request (e.g. Mon–Weds)</p>
            <p>Doctor accepts assignment</p>
            <p>Start Shift → Pause/Resume → End Shift</p>
            <p>No partial payments during the shift</p>
            <p>Payment happens only at final End Shift</p>
            <p>Rating happens once at the end</p>
            <p className="mt-2 font-medium text-foreground">IMPORTANT</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Requesters cannot modify payment rules</li>
              <li>All payments are triggered only after final confirmation</li>
              <li>Ratings and reliability updates happen only after payment confirmation</li>
              <li>Doctors must complete shifts to be eligible for payment</li>
            </ul>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/* ------------------------------------------------------------------ */
/*  Doctor content — original static cards                              */
/* ------------------------------------------------------------------ */
function DoctorContent() {
  return (
    <Accordion type="multiple" className="mt-6 space-y-3">
      {/* 1. How FlashLocum works */}
      <AccordionItem
        value="how-it-works"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          1. How FlashLocum works
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>Doctors receive shift requests from hospitals.</p>
            <p>Doctors can accept or decline requests.</p>
            <p>Doctors cannot take more than 3 non-conflicting shifts at the same time.</p>
            <p>Shifts can be:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Single-day</li>
              <li>Multi-day (up to 7 days)</li>
            </ul>
            <p>Once a shift is accepted, it appears in the doctor&apos;s coverage list.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 2. How payments work */}
      <AccordionItem
        value="payments"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          2. How payments work
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-3 text-[13.5px] leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Single-day shifts</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Requester pays FlashLocum at the end of the shift</li>
              <li>After payment is confirmed, doctor is automatically paid by FlashLocum</li>
              <li>Payment is sent to doctor by 10PM same day</li>
            </ul>
            <p className="font-medium text-foreground">Multi-day shifts</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>A multi-day shift can last up to 7 consecutive days</li>
              <li>Payment is collected only at the end of the entire shift</li>
              <li>There is no daily payment</li>
              <li>There is no payment when pausing or resuming</li>
            </ul>
            <p>At the end of the shift:</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Requester clicks End Shift</li>
              <li>Payment is made once for the full duration</li>
              <li>After payment confirmation, doctor receives full accumulated earnings</li>
              <li>Payment is sent by 10PM same day the shift ends</li>
            </ul>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 3. Ratings Score */}
      <AccordionItem
        value="ratings"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          3. Ratings Score
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>Doctors are rated by requesters after each completed shift.</p>
            <p className="font-medium text-foreground">Starting value</p>
            <p>Every doctor starts with 5.0 stars.</p>
            <p className="font-medium text-foreground">How it works</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Ratings are calculated in blocks of 20 shifts</li>
              <li>After every 20 completed shifts, the system calculates the average rating of those 20 shifts</li>
              <li>This becomes the doctor&apos;s new rating</li>
              <li>The previous rating is replaced completely</li>
            </ul>
            <p className="font-medium text-foreground">Important rules</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Ratings do NOT update after every shift</li>
              <li>Ratings only update after every 20 shifts</li>
              <li>Ratings reflect performance in batches, not single shifts</li>
            </ul>
            <p className="font-medium text-foreground">Minimum rating rule</p>
            <p>A doctor&apos;s rating cannot go below 3.5 stars. If the calculated rating is below 3.5, the doctor&apos;s account might be suspended or deactivated.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 4. Reliability Score */}
      <AccordionItem
        value="reliability"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          4. Reliability Score
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>Reliability measures how consistent a doctor is with attendance.</p>
            <p className="font-medium text-foreground">Starting value</p>
            <p>Every doctor starts with 100% reliability.</p>
            <p className="font-medium text-foreground">How it works</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Reliability is calculated in blocks of 20 shifts</li>
              <li>After every 20 completed shifts, the system checks how many shifts were cancelled</li>
              <li>Reliability is recalculated for that block</li>
              <li>The previous reliability score is replaced</li>
            </ul>
            <p className="font-medium text-foreground">How shifts are counted</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Completed shift = success</li>
              <li>Cancelled shift (after acceptance) = failure</li>
            </ul>
            <p className="font-medium text-foreground">Minimum reliability rule</p>
            <p>Reliability cannot go below 85%.</p>
            <p className="font-medium text-foreground">Cancellation rule</p>
            <p>Doctors must NOT cancel more than 3 shifts per 20 shifts. More than 3 cancellations will push reliability below acceptable level.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 5. Single-day coverage */}
      <AccordionItem
        value="single-day"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          5. Single-day coverage
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>One shift = one work period.</p>
            <p className="font-medium text-foreground">Flow</p>
            <p>Start Shift → End Shift → Payment → Rating</p>
            <p>Doctor must complete the full shift to receive payment.</p>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* 6. Multi-day coverage */}
      <AccordionItem
        value="multi-day"
        className="rounded-2xl border-0 px-4"
        style={{ background: "var(--color-surface-elevated)" }}
      >
        <AccordionTrigger className="py-4 text-[16px] font-semibold tracking-tight hover:no-underline">
          6. Multi-day coverage
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <div className="space-y-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <p>One assignment can last multiple days (max 7 days). Same doctor stays for the entire assignment.</p>
            <p className="font-medium text-foreground">Flow</p>
            <p>Start Shift → Resume/Pause → End Shift</p>
            <p>Only the final End Shift closes the entire assignment. Ratings happen only once at the end.</p>
            <p className="mt-2 font-medium text-foreground">Important</p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Doctors cannot modify payment rules</li>
              <li>All payments are triggered only after final confirmation</li>
              <li>Ratings happen only after completion</li>
              <li>Reliability is system-controlled</li>
              <li>Multi-day shifts have no interim payments</li>
            </ul>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

