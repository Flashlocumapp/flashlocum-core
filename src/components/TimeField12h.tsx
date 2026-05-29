// Calm 12-hour time picker. Value stays in 24h "HH:MM" so existing
// pricing / scheduling logic continues to work, but display is strictly
// 12-hour with AM/PM.

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = ["00", "15", "30", "45"];

function split24(value: string): { h12: number; m: string; p: "AM" | "PM" } {
  const [hRaw, mRaw] = value.split(":");
  let h = parseInt(hRaw ?? "8", 10);
  if (Number.isNaN(h)) h = 8;
  const m = (mRaw ?? "00").padStart(2, "0");
  const period: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  // Snap minutes to the nearest 15 for the selector display.
  const mNum = parseInt(m, 10);
  const snapped = MINUTES.reduce((acc, opt) => {
    return Math.abs(parseInt(opt, 10) - mNum) <
      Math.abs(parseInt(acc, 10) - mNum)
      ? opt
      : acc;
  }, "00");
  return { h12, m: snapped, p: period };
}

function combine(h12: number, m: string, p: "AM" | "PM"): string {
  let h = h12 % 12;
  if (p === "PM") h += 12;
  return `${String(h).padStart(2, "0")}:${m}`;
}

export function TimeField12h({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const { h12, m, p } = split24(value);

  const selCls =
    "appearance-none bg-transparent text-[14px] font-medium tabular-nums outline-none";

  return (
    <label className="flex flex-col gap-1 rounded-xl bg-secondary/60 px-3 py-2">
      <span className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <select
          aria-label={`${label} hour`}
          value={h12}
          onChange={(e) => onChange(combine(parseInt(e.target.value, 10), m, p))}
          className={selCls}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="text-[14px] font-medium leading-none text-foreground/60">
          :
        </span>
        <select
          aria-label={`${label} minute`}
          value={m}
          onChange={(e) => onChange(combine(h12, e.target.value, p))}
          className={selCls}
        >
          {MINUTES.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} period`}
          value={p}
          onChange={(e) =>
            onChange(combine(h12, m, e.target.value as "AM" | "PM"))
          }
          className={`${selCls} ml-1`}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </label>
  );
}
