/**
 * Shift Detail Drawer — replaces the inline rating-only drawer on the
 * Shifts page. Shows the full lifecycle (parties, billing, payment, timeline,
 * segments, surcharge ledger, ratings, cancellation, audit) and exposes
 * support actions: extend payment window, lift surcharge cap, force complete,
 * force cancel, mark paid (manual).
 */
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminGetShiftDetail,
  adminShiftForceCancel,
  adminShiftForceComplete,
  adminShiftExtendPaymentWindow,
  adminShiftLiftSurchargeCap,
  adminShiftMarkPaid,
} from "@/lib/admin-ops.functions";
import {
  AdminDrawer,
  Field,
  ReasonPrompt,
  Section,
  Copyable,
} from "@/components/admin/AdminDrawer";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { Chip, Empty, fmt, fmtNaira, fmtRelative } from "@/lib/admin-ui";
import { pushToast } from "@/lib/notifications";

function statusColor(s: string): string {
  switch (s) {
    case "active":
    case "accepted":
      return "var(--color-presence)";
    case "searching":
      return "#2563eb";
    case "paused":
      return "#c2410c";
    case "completed":
      return "var(--color-muted-foreground)";
    case "cancelled":
      return "#b91c1c";
    default:
      return "var(--color-muted-foreground)";
  }
}

export function ShiftDetailDrawer({
  shiftId,
  onClose,
  onOpenUser,
}: {
  shiftId: string | null;
  onClose: () => void;
  onOpenUser?: (userId: string) => void;
}) {
  const qc = useQueryClient();
  const get = useServerFn(adminGetShiftDetail);
  const forceCancel = useServerFn(adminShiftForceCancel);
  const forceComplete = useServerFn(adminShiftForceComplete);
  const extendWindow = useServerFn(adminShiftExtendPaymentWindow);
  const liftCap = useServerFn(adminShiftLiftSurchargeCap);
  const markPaid = useServerFn(adminShiftMarkPaid);

  const q = useQuery({
    queryKey: ["admin", "shift-detail", shiftId],
    queryFn: () => get({ data: { shiftId: shiftId! } }),
    enabled: !!shiftId,
    staleTime: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "shift-detail", shiftId] });
    qc.invalidateQueries({ queryKey: ["admin", "actions"] });
  };

  const cancelM = useMutation({
    mutationFn: (reason: string) => forceCancel({ data: { shiftId: shiftId!, reason } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Shift force-cancelled." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const completeM = useMutation({
    mutationFn: (reason: string) => forceComplete({ data: { shiftId: shiftId!, reason } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Shift force-completed." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const extendM = useMutation({
    mutationFn: (input: { reason: string; minutes: number }) =>
      extendWindow({
        data: { shiftId: shiftId!, minutes: input.minutes, reason: input.reason },
      }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Payment window extended." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const liftM = useMutation({
    mutationFn: (reason: string) => liftCap({ data: { shiftId: shiftId!, reason } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Surcharge cap lifted." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const markPaidM = useMutation({
    mutationFn: (input: { reason: string; amount?: number; reference?: string }) =>
      markPaid({
        data: {
          shiftId: shiftId!,
          reason: input.reason,
          amount: input.amount,
          reference: input.reference,
        },
      }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Marked as paid." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const [openAction, setOpenAction] = useState<
    | null
    | "cancel"
    | "complete"
    | "extend"
    | "liftCap"
    | "markPaid"
  >(null);

  const d = q.data;
  const s = d?.shift;

  return (
    <AdminDrawer
      open={!!shiftId}
      onClose={onClose}
      title={s ? `${s.hospital} · ${s.area}` : q.isLoading ? "Loading…" : "Shift"}
      subtitle={
        s ? (
          <span className="flex items-center gap-2">
            <Chip color={statusColor(s.status)}>{s.status}</Chip>
            <span>{s.coverage_type}</span>
            <span>·</span>
            <Copyable text={s.id} />
          </span>
        ) : null
      }
    >
      {q.isError && (
        <div className="m-4 rounded-xl bg-destructive/10 p-3 text-[12.5px] text-destructive">
          {(q.error as Error).message}
        </div>
      )}
      {s && d && (
        <>
          <Section
            title="Actions"
            right={null}
          >
            <div className="flex flex-wrap gap-2">
              {s.status !== "cancelled" && s.status !== "completed" && (
                <button
                  onClick={() => setOpenAction("cancel")}
                  className="h-8 rounded-full bg-destructive/15 px-3 text-[12px] font-semibold text-destructive"
                >
                  Force cancel
                </button>
              )}
              {s.status !== "completed" && s.status !== "cancelled" && (
                <button
                  onClick={() => setOpenAction("complete")}
                  className="h-8 rounded-full bg-secondary px-3 text-[12px] font-semibold"
                >
                  Force complete
                </button>
              )}
              {s.status === "completed" && s.payment_status !== "paid" && (
                <>
                  <button
                    onClick={() => setOpenAction("extend")}
                    className="h-8 rounded-full bg-secondary px-3 text-[12px] font-semibold"
                  >
                    Extend window
                  </button>
                  {s.surcharge_capped_at && (
                    <button
                      onClick={() => setOpenAction("liftCap")}
                      className="h-8 rounded-full bg-secondary px-3 text-[12px] font-semibold"
                    >
                      Lift surcharge cap
                    </button>
                  )}
                  <button
                    onClick={() => setOpenAction("markPaid")}
                    className="h-8 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground"
                  >
                    Mark paid (manual)
                  </button>
                </>
              )}
            </div>
          </Section>

          <Section title="Parties">
            <Field
              label="Requester"
              value={
                <button
                  onClick={() => onOpenUser?.(s.requester_id)}
                  className="text-foreground underline-offset-2 hover:underline"
                  disabled={!onOpenUser}
                >
                  {s.requester_name || s.requester_id.slice(0, 8)}
                </button>
              }
            />
            <Field label="Requester phone" value={s.requester_phone || "—"} />
            <Field
              label="Doctor"
              value={
                s.accepted_by ? (
                  <button
                    onClick={() => onOpenUser?.(s.accepted_by!)}
                    className="text-foreground underline-offset-2 hover:underline"
                    disabled={!onOpenUser}
                  >
                    {s.doctor_name || s.accepted_by.slice(0, 8)}
                  </button>
                ) : (
                  "—"
                )
              }
            />
            <Field label="Doctor phone" value={s.doctor_phone || "—"} />
          </Section>

          <Section title="Schedule">
            <Field label="Day" value={s.day} />
            <Field
              label="Window"
              value={`${s.start_time} → ${s.end_time} · ${s.duration_hrs}h${
                s.days && s.days > 1 ? ` · ${s.days} days` : ""
              }`}
            />
            <Field
              label="First started"
              value={s.first_started_at ? fmt(s.first_started_at) : "—"}
            />
            <Field
              label="Started at"
              value={s.started_at ? fmt(s.started_at) : "—"}
            />
            <Field label="End ts" value={s.end_ts ? fmt(s.end_ts) : "—"} />
            <Field
              label="Broadcast"
              value={s.broadcast_started_at ? fmt(s.broadcast_started_at) : "—"}
            />
            <Field label="Environment" value={s.environment || "—"} />
            <Field label="Accommodation" value={s.accommodation || "—"} />
            {s.note && <Field label="Note" value={s.note} />}
          </Section>

          <Section title="Billing">
            <Field label="Estimate" value={fmtNaira(s.amount)} />
            <Field label="Base (locked)" value={fmtNaira(s.base_amount)} />
            <Field label="Surcharge" value={fmtNaira(s.surcharge_amount)} />
            <Field label="Total billed" value={fmtNaira(s.total_billed_amount)} />
            <Field label="Settled" value={fmtNaira(s.settled_amount)} />
            <Field label="Fee %" value={`${s.fee_pct}%`} />
            <Field
              label="Billing locked"
              value={s.billing_locked_at ? fmt(s.billing_locked_at) : "—"}
            />
            <Field
              label="Surcharge cap"
              value={
                s.surcharge_capped_at ? (
                  <span style={{ color: "#b91c1c" }}>capped {fmt(s.surcharge_capped_at)}</span>
                ) : (
                  "—"
                )
              }
            />

            {d.surcharge_log.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-xl border">
                <table className="w-full text-[12px]">
                  <thead className="bg-secondary/60 text-left text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-2.5 py-1.5">#</th>
                      <th className="px-2.5 py-1.5">Block</th>
                      <th className="px-2.5 py-1.5">Running</th>
                      <th className="px-2.5 py-1.5">When</th>
                      <th className="px-2.5 py-1.5">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.surcharge_log.map((r) => (
                      <tr key={r.block_index} className="border-t">
                        <td className="px-2.5 py-1.5">{r.block_index}</td>
                        <td className="px-2.5 py-1.5">{fmtNaira(r.block_amount)}</td>
                        <td className="px-2.5 py-1.5">{fmtNaira(r.running_total)}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">
                          {fmt(r.applied_at)}
                        </td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">
                          {r.source || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Payment">
            <Field label="Status" value={s.payment_status || "—"} />
            <Field
              label="Reference"
              value={s.payment_reference ? <Copyable text={s.payment_reference} /> : "—"}
            />
            <Field
              label="Due at"
              value={s.payment_due_at ? `${fmt(s.payment_due_at)} (${fmtRelative(s.payment_due_at)})` : "—"}
            />
            <Field label="Extensions" value={s.payment_extension_count} />
            <Field label="Paid at" value={s.paid_at ? fmt(s.paid_at) : "—"} />
            <Field label="Remitted at" value={s.remitted_at ? fmt(s.remitted_at) : "—"} />
            {d.underpayment && (
              <div
                className="mt-3 rounded-xl px-3 py-2 text-[12px]"
                style={{
                  background: "color-mix(in oklab, #b91c1c 12%, transparent)",
                  color: "#b91c1c",
                }}
              >
                Underpayment recorded — expected {fmtNaira(d.underpayment.expected_amount)},
                received {fmtNaira(d.underpayment.received_amount)} on{" "}
                {fmt(d.underpayment.received_at)}.
              </div>
            )}
          </Section>

          <Section title="Segments">
            {d.segments.length === 0 ? (
              <Empty>No segment records.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-[12px]">
                  <thead className="bg-secondary/60 text-left text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-2.5 py-1.5">#</th>
                      <th className="px-2.5 py-1.5">Started</th>
                      <th className="px-2.5 py-1.5">Paused</th>
                      <th className="px-2.5 py-1.5">Resumed</th>
                      <th className="px-2.5 py-1.5">Ended</th>
                      <th className="px-2.5 py-1.5">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.segments.map((g) => (
                      <tr key={g.id} className="border-t">
                        <td className="px-2.5 py-1.5">{g.seg_index}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{fmt(g.started_at)}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{fmt(g.paused_at)}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{fmt(g.resumed_at)}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{fmt(g.ended_at)}</td>
                        <td className="px-2.5 py-1.5 tabular-nums">
                          {g.duration_ms != null ? `${Math.round(g.duration_ms / 60000)}m` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Ratings">
            <div className="space-y-3">
              <RatingBlock
                title="Requester → Doctor"
                rating={d.ratings.r2d}
                rater={s.requester_name}
                ratee={s.doctor_name}
              />
              <RatingBlock
                title="Doctor → Requester"
                rating={d.ratings.d2r}
                rater={s.doctor_name}
                ratee={s.requester_name}
              />
            </div>
          </Section>

          {(s.cancellation_reason_code || s.cancelled_at) && (
            <Section title="Cancellation">
              <Field label="When" value={fmt(s.cancelled_at)} />
              <Field label="By" value={s.cancelled_by || "—"} />
              <Field label="Code" value={s.cancellation_reason_code || "—"} />
              {s.cancellation_reason_text && (
                <Field label="Reason" value={s.cancellation_reason_text} />
              )}
            </Section>
          )}

          <Section title="Admin history">
            <AuditLogPanel
              filter={{ targetShiftId: s.id }}
              emptyLabel="No admin actions on this shift."
            />
          </Section>
        </>
      )}

      <ReasonPrompt
        open={openAction === "cancel"}
        title="Force cancel shift"
        hint="This stops the shift immediately and notifies both parties."
        submitting={cancelM.isPending}
        onClose={() => setOpenAction(null)}
        onSubmit={async ({ reason }) => {
          await cancelM.mutateAsync(reason);
          setOpenAction(null);
        }}
        confirmLabel="Force cancel"
        destructive
      />
      <ReasonPrompt
        open={openAction === "complete"}
        title="Force complete shift"
        hint="Locks billing and moves the shift to completed. Use when end-of-shift failed."
        submitting={completeM.isPending}
        onClose={() => setOpenAction(null)}
        onSubmit={async ({ reason }) => {
          await completeM.mutateAsync(reason);
          setOpenAction(null);
        }}
        confirmLabel="Force complete"
      />
      <ReasonPrompt
        open={openAction === "extend"}
        title="Extend payment window"
        hint="Adds 15 minutes to the payment deadline."
        submitting={extendM.isPending}
        onClose={() => setOpenAction(null)}
        onSubmit={async ({ reason }) => {
          await extendM.mutateAsync({ reason, minutes: 15 });
          setOpenAction(null);
        }}
        confirmLabel="Extend 15m"
      />
      <ReasonPrompt
        open={openAction === "liftCap"}
        title="Lift surcharge cap"
        hint="Clears the 24h surcharge cap on this shift."
        submitting={liftM.isPending}
        onClose={() => setOpenAction(null)}
        onSubmit={async ({ reason }) => {
          await liftM.mutateAsync(reason);
          setOpenAction(null);
        }}
        confirmLabel="Lift cap"
      />
      <ReasonPrompt
        open={openAction === "markPaid"}
        title="Mark as paid (manual)"
        hint="Records an out-of-band payment. Provide the bank reference and amount."
        submitting={markPaidM.isPending}
        onClose={() => setOpenAction(null)}
        onSubmit={async ({ reason, amount, reference }) => {
          await markPaidM.mutateAsync({ reason, amount, reference });
          setOpenAction(null);
        }}
        confirmLabel="Mark paid"
        amountField
        referenceField
      />
    </AdminDrawer>
  );
}

function RatingBlock({
  title,
  rater,
  ratee,
  rating,
}: {
  title: string;
  rater: string | null;
  ratee: string | null;
  rating: { score: number; feedback: string | null; created_at: string } | null;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </div>
      <div className="mt-0.5 text-[12px] text-muted-foreground">
        {rater || "—"} → {ratee || "—"}
      </div>
      {rating ? (
        <>
          <div className="mt-1.5 text-[16px] font-semibold">★ {rating.score}/5</div>
          {rating.feedback && (
            <div className="mt-1 whitespace-pre-wrap text-[12.5px]">{rating.feedback}</div>
          )}
          <div className="mt-1 text-[10.5px] text-muted-foreground">{fmt(rating.created_at)}</div>
        </>
      ) : (
        <div className="mt-1 text-[12px] text-muted-foreground">Not yet rated.</div>
      )}
    </div>
  );
}
