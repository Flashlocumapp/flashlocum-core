type Props = {
  title: string;
  description: string;
  bullets?: string[];
};

export function AdminStub({ title, description, bullets }: Props) {
  return (
    <div className="mx-auto max-w-4xl px-8 pt-10 pb-16">
      <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">{description}</p>
      <div
        className="mt-6 rounded-2xl border border-dashed p-6"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Coming soon
        </div>
        <p className="mt-2 text-[13.5px] text-foreground">
          This module is scaffolded. Implementation lands in a follow-up pass.
        </p>
        {bullets && bullets.length > 0 && (
          <ul className="mt-3 space-y-1.5 text-[12.5px] text-muted-foreground">
            {bullets.map((b) => (
              <li key={b}>• {b}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
