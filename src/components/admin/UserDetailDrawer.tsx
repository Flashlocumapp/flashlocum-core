/**
 * User Detail Drawer — opened from the Users table. Shows profile,
 * verification, trust state, presence, devices, counts, and the user-scoped
 * admin audit history. Trust mutations (freeze/unfreeze/escalate) live here
 * so support can act without leaving the user.
 */
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  adminGetUserDetail,
  adminTrustFreeze,
  adminTrustUnfreeze,
  adminTrustEscalate,
} from "@/lib/admin-ops.functions";
import {
  AdminDrawer,
  Field,
  ReasonPrompt,
  Section,
  Copyable,
} from "@/components/admin/AdminDrawer";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { Chip, Empty, fmt, fmtNaira, fmtRelative, statusTone } from "@/lib/admin-ui";
import { pushToast } from "@/lib/notifications";

export function UserDetailDrawer({
  userId,
  onClose,
}: {
  userId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const get = useServerFn(adminGetUserDetail);
  const freeze = useServerFn(adminTrustFreeze);
  const unfreeze = useServerFn(adminTrustUnfreeze);
  const escalate = useServerFn(adminTrustEscalate);

  const q = useQuery({
    queryKey: ["admin", "user-detail", userId],
    queryFn: () => get({ data: { userId: userId! } }),
    enabled: !!userId,
    staleTime: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "user-detail", userId] });
    qc.invalidateQueries({ queryKey: ["admin", "actions"] });
  };

  const freezeM = useMutation({
    mutationFn: (reason: string) => freeze({ data: { userId: userId!, reason } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "User trust frozen." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const unfreezeM = useMutation({
    mutationFn: () => unfreeze({ data: { userId: userId! } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Freeze lifted." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });
  const escalateM = useMutation({
    mutationFn: (note: string) => escalate({ data: { userId: userId!, note } }),
    onSuccess: () => {
      pushToast({ tone: "presence", title: "Escalated for review." });
      invalidate();
    },
    onError: (e) => pushToast({ tone: "warn", title: (e as Error).message }),
  });

  const [freezeOpen, setFreezeOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);

  const d = q.data;
  const p = d?.profile;
  const tone = p?.verification_status
    ? statusTone(p.verification_status as Parameters<typeof statusTone>[0])
    : null;

  return (
    <AdminDrawer
      open={!!userId}
      onClose={onClose}
      title={p?.full_name || (q.isLoading ? "Loading…" : "User")}
      subtitle={
        p ? (
          <span className="flex items-center gap-2">
            <span className="capitalize">{p.role || "—"}</span>
            <span>·</span>
            <Copyable text={p.id} />
          </span>
        ) : null
      }
    >
      {q.isError && (
        <div className="m-4 rounded-xl bg-destructive/10 p-3 text-[12.5px] text-destructive">
          {(q.error as Error).message}
        </div>
      )}
      {p && d && (
        <>
          <Section title="Profile">
            <Field label="Name" value={p.full_name || "—"} />
            <Field label="Phone" value={p.phone || "—"} />
            <Field label="Email" value={p.email || "—"} />
            <Field label="Location" value={p.location || "—"} />
            <Field label="Gender" value={p.gender || "—"} />
            <Field label="MDCN" value={p.mdcn || "—"} />
            <Field label="Joined" value={fmt(p.created_at)} />
            <Field label="Onboarded (Cover)" value={fmt(p.onboarded_cover_at)} />
            <Field label="Onboarded (Request)" value={fmt(p.onboarded_request_at)} />
            <Field
              label="Last seen"
              value={
                d.presence?.online ? (
                  <span style={{ color: "var(--color-presence)" }}>online</span>
                ) : (
                  fmtRelative(p.last_seen_at ?? d.presence?.last_seen)
                )
              }
            />
          </Section>

          <Section title="Verification">
            <div className="mb-2">{tone && <Chip color={tone.color}>{tone.label}</Chip>}</div>
            {p.verification_action_reason && (
              <div
                className="mb-2 rounded-xl px-3 py-2 text-[12px]"
                style={{
                  background: "color-mix(in oklab, #b45309 12%, transparent)",
                  color: "#92400e",
                }}
              >
                <div className="font-semibold">{p.verification_action_reason}</div>
                {p.verification_action_note && (
                  <div className="mt-0.5 opacity-90">{p.verification_action_note}</div>
                )}
              </div>
            )}
            <Field
              label="Bank"
              value={`${p.bank_name || "—"}${p.bank_account ? ` · ${p.bank_account}` : ""}`}
            />
            <Field label="Account name" value={p.bank_account_name || "—"} />
          </Section>

          <Section
            title="Trust state"
            right={
              <div className="flex gap-1.5">
                {p.trust_frozen_at ? (
                  <button
                    onClick={() => unfreezeM.mutate()}
                    disabled={unfreezeM.isPending}
                    className="h-7 rounded-full bg-secondary px-3 text-[11.5px] font-medium"
                  >
                    Unfreeze
                  </button>
                ) : (
                  <button
                    onClick={() => setFreezeOpen(true)}
                    className="h-7 rounded-full bg-secondary px-3 text-[11.5px] font-medium"
                  >
                    Freeze
                  </button>
                )}
                <button
                  onClick={() => setEscalateOpen(true)}
                  className="h-7 rounded-full bg-secondary px-3 text-[11.5px] font-medium"
                >
                  Escalate
                </button>
              </div>
            }
          >
            <Field
              label="Frozen"
              value={
                p.trust_frozen_at ? (
                  <span className="text-[#b45309]">
                    {fmt(p.trust_frozen_at)} — {p.trust_frozen_reason || "no reason"}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Field
              label="Escalated"
              value={
                p.trust_escalated_at
                  ? `${fmt(p.trust_escalated_at)} — ${p.trust_escalated_note || "no note"}`
                  : "—"
              }
            />
            <Field
              label="Restriction expires"
              value={p.trust_restriction_expires_at ? fmt(p.trust_restriction_expires_at) : "—"}
            />
          </Section>

          <Section title="Activity">
            <Field label="Shifts (total)" value={d.counts.shifts_total} />
            <Field label="Completed" value={d.counts.shifts_completed} />
            <Field label="Cancelled" value={d.counts.shifts_cancelled} />
            <Field label="Ratings received" value={d.counts.ratings_received} />
            <Field label="Ratings given" value={d.counts.ratings_given} />
            <Field label="Outstanding" value={fmtNaira(d.counts.outstanding_amount)} />
          </Section>

          <Section title="Devices">
            {d.devices.length === 0 ? (
              <Empty>No registered device tokens.</Empty>
            ) : (
              <div className="space-y-1.5">
                {d.devices.map((dv) => (
                  <div
                    key={dv.id}
                    className="flex items-center justify-between rounded-xl bg-secondary px-3 py-2 text-[12.5px]"
                  >
                    <div>
                      <div className="font-medium capitalize">{dv.platform || "unknown"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {dv.app_version || "—"} · last {fmtRelative(dv.last_seen_at)}
                      </div>
                    </div>
                    <div className="text-[10.5px] font-mono text-muted-foreground">
                      {dv.id.slice(0, 8)}…
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Admin history">
            <AuditLogPanel
              filter={{ targetUserId: p.id }}
              emptyLabel="No admin actions recorded for this user."
            />
          </Section>
        </>
      )}

      <ReasonPrompt
        open={freezeOpen}
        title="Freeze user trust"
        hint="Pauses new acceptances/requests while you investigate. Reversible."
        submitting={freezeM.isPending}
        onClose={() => setFreezeOpen(false)}
        onSubmit={async ({ reason }) => {
          await freezeM.mutateAsync(reason);
          setFreezeOpen(false);
        }}
        confirmLabel="Freeze"
        destructive
      />
      <ReasonPrompt
        open={escalateOpen}
        title="Escalate for review"
        hint="Flag this user for senior support review."
        submitting={escalateM.isPending}
        onClose={() => setEscalateOpen(false)}
        onSubmit={async ({ reason }) => {
          await escalateM.mutateAsync(reason);
          setEscalateOpen(false);
        }}
        confirmLabel="Escalate"
      />
    </AdminDrawer>
  );
}
