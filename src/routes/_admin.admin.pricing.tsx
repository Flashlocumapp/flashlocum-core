import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminPageHeader, RefreshButton, Empty } from "@/lib/admin-ui";
import { loadPricingTable } from "@/lib/pricing";

export const Route = createFileRoute("/_admin/admin/pricing")({
  ssr: false,
  component: PricingPage,
});

type VersionRow = {
  id: string;
  label: string;
  is_active: boolean;
  effective_at: string;
  notes: string | null;
  created_at: string;
};
type RateRow = { tier: string; rate_day: number; rate_night: number };
type FlatRow = { product: string; amount: number };
type ModRow = { key: string; value: number };

const TIERS = ["<4h", "4-6h", ">6h", "home_flat"] as const;
const FLATS = ["straight_24h", "straight_48h", "home_hour"] as const;
const MODS = [
  "busy_mult",
  "tolerance_min",
  "block_min",
  "first_hour_min",
  "home_busy_applies",
] as const;

async function fetchPricingState() {
  const versionsRes = await supabase
    .from("pricing_versions" as never)
    .select("id, label, is_active, effective_at, notes, created_at")
    .order("effective_at", { ascending: false });
  const versions = (versionsRes.data ?? []) as VersionRow[];
  const active = versions.find((v) => v.is_active);
  if (!active) return { versions, active: null, rates: [], flats: [], mods: [] };
  const [rates, flats, mods] = await Promise.all([
    supabase
      .from("pricing_rates" as never)
      .select("tier, rate_day, rate_night")
      .eq("version_id", active.id),
    supabase
      .from("pricing_flats" as never)
      .select("product, amount")
      .eq("version_id", active.id),
    supabase
      .from("pricing_modifiers" as never)
      .select("key, value")
      .eq("version_id", active.id),
  ]);
  return {
    versions,
    active,
    rates: (rates.data ?? []) as RateRow[],
    flats: (flats.data ?? []) as FlatRow[],
    mods: (mods.data ?? []) as ModRow[],
  };
}

function PricingPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin", "pricing"],
    queryFn: fetchPricingState,
    staleTime: 30_000,
  });
  const data = q.data;

  const [draft, setDraft] = useState<null | {
    label: string;
    notes: string;
    rates: Record<string, { day: number; night: number }>;
    flats: Record<string, number>;
    mods: Record<string, number>;
  }>(null);

  function openDraft() {
    if (!data?.active) return;
    setDraft({
      label: `v${data.versions.length + 1}`,
      notes: "",
      rates: Object.fromEntries(
        TIERS.map((t) => {
          const r = data.rates.find((x) => x.tier === t);
          return [t, { day: r?.rate_day ?? 0, night: r?.rate_night ?? 0 }];
        }),
      ),
      flats: Object.fromEntries(
        FLATS.map((f) => [f, data.flats.find((x) => x.product === f)?.amount ?? 0]),
      ),
      mods: Object.fromEntries(
        MODS.map((m) => [m, Number(data.mods.find((x) => x.key === m)?.value ?? 0)]),
      ),
    });
  }

  const publish = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No draft");
      const ratesPayload = TIERS.map((t) => ({
        tier: t,
        rate_day: draft.rates[t].day,
        rate_night: draft.rates[t].night,
      }));
      const flatsPayload = FLATS.map((p) => ({ product: p, amount: draft.flats[p] }));
      const modsPayload = MODS.map((k) => ({ key: k, value: draft.mods[k] }));
      const { error } = await supabase.rpc(
        "admin_publish_pricing_version" as never,
        {
          _label: draft.label,
          _rates: ratesPayload,
          _flats: flatsPayload,
          _modifiers: modsPayload,
          _notes: draft.notes || null,
        } as never,
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["admin", "pricing"] });
      void loadPricingTable();
    },
  });

  // Refresh client-side pricing cache whenever this page loads fresh data.
  useEffect(() => {
    if (data?.active) void loadPricingTable();
  }, [data?.active?.id]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-6">
      <AdminPageHeader
        title="Pricing"
        subtitle="Tiers, flat products, and modifiers for the billing engine. Publishing creates a new immutable version."
        right={<RefreshButton onClick={() => q.refetch()} busy={q.isFetching} />}
      />

      {!data?.active ? (
        <Empty>No active pricing version.</Empty>
      ) : (
        <section className="rounded-2xl border bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-[15px] font-semibold">Active: {data.active.label}</div>
              <div className="text-[12px] text-muted-foreground">
                Effective {new Date(data.active.effective_at).toLocaleString()}
                {data.active.notes ? ` · ${data.active.notes}` : ""}
              </div>
            </div>
            {!draft ? (
              <button
                onClick={openDraft}
                className="rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-medium text-primary-foreground"
              >
                Draft new version
              </button>
            ) : null}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Section title="Tier rates (₦/hr)">
              <Table headers={["Tier", "Day", "Night"]}>
                {TIERS.map((t) => {
                  const r = data.rates.find((x) => x.tier === t);
                  return (
                    <tr key={t} className="border-t">
                      <td className="py-1.5 font-mono text-[12px]">{t}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        ₦{r?.rate_day.toLocaleString() ?? "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        ₦{r?.rate_night.toLocaleString() ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Section>
            <Section title="Flat products (₦)">
              <Table headers={["Product", "Amount"]}>
                {FLATS.map((p) => {
                  const f = data.flats.find((x) => x.product === p);
                  return (
                    <tr key={p} className="border-t">
                      <td className="py-1.5 font-mono text-[12px]">{p}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        ₦{f?.amount.toLocaleString() ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </Section>
            <Section title="Modifiers">
              <Table headers={["Key", "Value"]}>
                {MODS.map((k) => {
                  const m = data.mods.find((x) => x.key === k);
                  return (
                    <tr key={k} className="border-t">
                      <td className="py-1.5 font-mono text-[12px]">{k}</td>
                      <td className="py-1.5 text-right tabular-nums">{m?.value ?? "—"}</td>
                    </tr>
                  );
                })}
              </Table>
            </Section>
            <Section title="History">
              <ul className="space-y-1.5 text-[12.5px]">
                {data.versions.map((v) => (
                  <li key={v.id} className="flex justify-between border-b py-1.5">
                    <span className={v.is_active ? "font-semibold" : ""}>{v.label}</span>
                    <span className="text-muted-foreground">
                      {new Date(v.effective_at).toLocaleDateString()}
                      {v.is_active ? " · active" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </section>
      )}

      {draft ? (
        <section className="rounded-2xl border-2 border-primary/40 bg-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[15px] font-semibold">Draft new version</div>
            <div className="flex gap-2">
              <button
                onClick={() => setDraft(null)}
                className="rounded-full border px-4 py-1.5 text-[12.5px]"
              >
                Cancel
              </button>
              <button
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
                className="rounded-full bg-primary px-4 py-1.5 text-[12.5px] font-medium text-primary-foreground disabled:opacity-60"
              >
                {publish.isPending ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
          {publish.error ? (
            <div className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {(publish.error as Error).message}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Field label="Label">
                <input
                  value={draft.label}
                  onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  className="w-full rounded-md border px-2 py-1 text-[13px]"
                />
              </Field>
              <Field label="Notes">
                <input
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  className="w-full rounded-md border px-2 py-1 text-[13px]"
                />
              </Field>
            </div>
            <div />

            <Section title="Tier rates (₦/hr)">
              <Table headers={["Tier", "Day", "Night"]}>
                {TIERS.map((t) => (
                  <tr key={t} className="border-t">
                    <td className="py-1.5 font-mono text-[12px]">{t}</td>
                    <td className="py-1.5 text-right">
                      <NumInput
                        value={draft.rates[t].day}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            rates: { ...draft.rates, [t]: { ...draft.rates[t], day: v } },
                          })
                        }
                      />
                    </td>
                    <td className="py-1.5 text-right">
                      <NumInput
                        value={draft.rates[t].night}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            rates: { ...draft.rates, [t]: { ...draft.rates[t], night: v } },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </Table>
            </Section>

            <Section title="Flat products (₦)">
              <Table headers={["Product", "Amount"]}>
                {FLATS.map((p) => (
                  <tr key={p} className="border-t">
                    <td className="py-1.5 font-mono text-[12px]">{p}</td>
                    <td className="py-1.5 text-right">
                      <NumInput
                        value={draft.flats[p]}
                        onChange={(v) => setDraft({ ...draft, flats: { ...draft.flats, [p]: v } })}
                      />
                    </td>
                  </tr>
                ))}
              </Table>
            </Section>

            <Section title="Modifiers">
              <Table headers={["Key", "Value"]}>
                {MODS.map((k) => (
                  <tr key={k} className="border-t">
                    <td className="py-1.5 font-mono text-[12px]">{k}</td>
                    <td className="py-1.5 text-right">
                      <NumInput
                        step={k === "busy_mult" ? 0.05 : 1}
                        value={draft.mods[k]}
                        onChange={(v) => setDraft({ ...draft, mods: { ...draft.mods, [k]: v } })}
                      />
                    </td>
                  </tr>
                ))}
              </Table>
            </Section>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-muted-foreground">
        <tr>
          {headers.map((h, i) => (
            <th key={h} className={`py-1.5 ${i === 0 ? "" : "text-right"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumInput({
  value,
  onChange,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-28 rounded-md border px-2 py-1 text-right text-[13px] tabular-nums"
    />
  );
}
