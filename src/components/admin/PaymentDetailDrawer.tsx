/**
 * Payment Detail Drawer — opened from the Unpaid page (and any "Payment"
 * link). Surfaces the full payment record (provider, reference, amounts,
 * surcharge log, underpayment, payment-only admin actions) and exposes the
 * payment-specific investigation tools: reconcile, refund, write-off,
 * record offline.
 */
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminGetPaymentDetail,
  adminPaymentReconcile,
  adminPaymentRefund,
  adminPaymentWriteOff,
  adminPaymentRecordOffline,
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

export function PaymentDetailDrawer({
  shiftId,
  onClose,
  onOpenShift,
  onOpenUser,
}: {
  shiftId: string | null;
  onClose: () => void;
  onOpenShift?: (id: string) => void;
  onOpenUser?: (id: string) => void;
}) {
  const qc = useQueryClient();
  const get = useServerFn(adminGetPaymentDetail);
  const reconcile = useServerFn(adminPaymentReconcile);
  const refund = useServerFn(adminPaymentRefund);
  const writeOff = useServerFn(adminPaymentWriteOff);
  const offline = useServerFn(adminPaymentRecordOffline);

  const q = useQuery({
    queryKey: ["admin", "payment-detail", shiftId],
    queryFn: () => get({ data: { shiftId: shiftId! } }),
    enabled: !!shiftId,
    staleTime: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "payment-detail", shiftId] });
    qc.invalidateQueries({ queryKey: ["admin", "actions"] });
  };

  const reconcileM = useMutation({
    mutationFn: () => reconcile({ data: { shiftId: shiftId! } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Reconciliation requested." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const refundM = useMutation({
    mutationFn: (i: { reason: string; amount?: number }) =>
      refund({ data: { shiftId: shiftId!, reason: i.reason, amount: i.amount ?? 0 } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Refund initiated." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const writeOffM = useMutation({
    mutationFn: (reason: string) => writeOff({ data: { shiftId: shiftId!, reason } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Written off." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const offlineM = useMutation({
    mutationFn: (i: { reason: string; amount?: number; reference?: string }) =>
      offline({
        data: {
          shiftId: shiftId!,
          amount: i.amount ?? 0,
          reference: i.reference,
          note: i.reason,
        },
      }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Offline payment recorded." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const [open, setOpen] = useState<null | "refund" | "writeOff" | "offline">(null);

  const d = q.data;

  return (
    <AdminDrawer
      open={!!shiftId}
      onClose={onClose}
      title={d ? `Payment · ${d.hospital}` : q.isLoading ? "Loading…" : "Payment"}
      subtitle={
        d ? (
          <span className="flex items-center gap-2">
            <Chip color={d.payment_status === "paid" ? "var(--color-presence)" : "#c2410c"}>
              {d.payment_status || "unpaid"}
            </Chip>
            <span>{d.area}</span>
            <span>·</span>
            <Copyable text={d.shift_id} />
          </span>
        ) : null
      }
    >
      {q.isError && (
        <div className="m-4 rounded-xl bg-destructive/10 p-3 text-[12.5px] text-destructive">
          {(q.error as Error).message}
        </div>
      )}
      {d && (
        <>
          <Section title="Actions">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => reconcileM.mutate()}
                disabled={reconcileM.isPending}
                className="h-8 rounded-full bg-secondary px-3 text-[12px] font-semibold"
              >
                Reconcile with provider
              </button>
              <button
                onClick={() => setOpen("offline")}
                className="h-8 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground"
              >
                Record offline payment
              </button>
              {d.payment_status === "paid" && (
                <button
                  onClick={() => setOpen("refund")}
                  className="h-8 rounded-full bg-secondary px-3 text-[12px] font-semibold"
                >
                  Refund
                </button>
              )}
              {d.payment_status !== "paid" && (
                <button
                  onClick={() => setOpen("writeOff")}
                  className="h-8 rounded-full bg-destructive/15 px-3 text-[12px] font-semibold text-destructive"
                >
                  Write off
                </button>
              )}
              {onOpenShift && (
                <button
                  onClick={() => onOpenShift(d.shift_id)}
                  className="ml-auto h-8 rounded-full bg-secondary px-3 text-[12px] font-semibold"
                >
                  Open shift
                </button>
              )}
            </div>
          </Section>

          <Section title="Parties">
            <Field
              label="Requester"
              value={
                <button
                  onClick={() => onOpenUser?.(d.requester_id)}
                  className="text-foreground underline-offset-2 hover:underline"
                  disabled={!onOpenUser}
                >
                  {d.requester_name || d.requester_id.slice(0, 8)}
                </button>
              }
            />
            <Field
              label="Doctor"
              value={
                d.doctor_id ? (
                  <button
                    onClick={() => onOpenUser?.(d.doctor_id!)}
                    className="text-foreground underline-offset-2 hover:underline"
                    disabled={!onOpenUser}
                  >
                    {d.doctor_name || d.doctor_id.slice(0, 8)}
                  </button>
                ) : (
                  "—"
                )
              }
            />
          </Section>

          <Section title="Amounts">
            <Field label="Base" value={fmtNaira(d.base_amount)} />
            <Field label="Surcharge" value={fmtNaira(d.surcharge_amount)} />
            <Field label="Total billed" value={fmtNaira(d.total_billed_amount)} />
            <Field label="Settled" value={fmtNaira(d.settled_amount)} />
            {d.underpayment && (
              <div
                className="mt-3 rounded-xl px-3 py-2 text-[12px]"
                style={{
                  background: "color-mix(in oklab, #b91c1c 12%, transparent)",
                  color: "#b91c1c",
                }}
              >
                Underpayment — expected {fmtNaira(d.underpayment.expected_amount)}, received{" "}
                {fmtNaira(d.underpayment.received_amount)} on {fmt(d.underpayment.received_at)}.
              </div>
            )}
          </Section>

          <Section title="Provider record">
            <Field label="Provider" value={d.payment_provider || "—"} />
            <Field
              label="Reference"
              value={d.payment_reference ? <Copyable text={d.payment_reference} /> : "—"}
            />
            <Field
              label="Hosted URL"
              value={
                d.payment_url ? (
                  <a href={d.payment_url} target="_blank" rel="noreferrer" className="underline">
                    open
                  </a>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Due at"
              value={
                d.payment_due_at
                  ? `${fmt(d.payment_due_at)} (${fmtRelative(d.payment_due_at)})`
                  : "—"
              }
            />
            <Field label="Extensions" value={d.payment_extension_count} />
            <Field
              label="Surcharge cap"
              value={
                d.surcharge_capped_at ? (
                  <span style={{ color: "#b91c1c" }}>capped {fmt(d.surcharge_capped_at)}</span>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Billing locked"
              value={d.billing_locked_at ? fmt(d.billing_locked_at) : "—"}
            />
            <Field label="Paid at" value={d.paid_at ? fmt(d.paid_at) : "—"} />
            <Field label="Remitted at" value={d.remitted_at ? fmt(d.remitted_at) : "—"} />
          </Section>

          <Section title="Surcharge ledger">
            {d.surcharge_log.length === 0 ? (
              <Empty>No surcharge entries.</Empty>
            ) : (
              <div className="overflow-hidden rounded-xl border">
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
                        <td className="px-2.5 py-1.5 text-muted-foreground">{fmt(r.applied_at)}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{r.source || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Payment history">
            <AuditLogPanel
              filter={{ targetShiftId: d.shift_id, actionPrefix: "payment." }}
              emptyLabel="No payment admin actions recorded."
            />
          </Section>
        </>
      )}

      <ReasonPrompt
        open={open === "refund"}
        title="Initiate refund"
        hint="Records the refund intent in the admin log; the finance ops team completes it externally."
        submitting={refundM.isPending}
        onClose={() => setOpen(null)}
        onSubmit={async ({ reason, amount }) => {
          await refundM.mutateAsync({ reason, amount });
          setOpen(null);
        }}
        confirmLabel="Initiate refund"
        amountField
      />
      <ReasonPrompt
        open={open === "writeOff"}
        title="Write off payment"
        hint="Marks this payment uncollectable. Use sparingly."
        submitting={writeOffM.isPending}
        onClose={() => setOpen(null)}
        onSubmit={async ({ reason }) => {
          await writeOffM.mutateAsync(reason);
          setOpen(null);
        }}
        confirmLabel="Write off"
        destructive
      />
      <ReasonPrompt
        open={open === "offline"}
        title="Record offline payment"
        hint="For payments received outside the provider. Provide bank reference and amount."
        submitting={offlineM.isPending}
        onClose={() => setOpen(null)}
        onSubmit={async ({ reason, amount, reference }) => {
          await offlineM.mutateAsync({ reason, amount, reference });
          setOpen(null);
        }}
        confirmLabel="Record"
        amountField
        referenceField
      />
    </AdminDrawer>
  );
}
