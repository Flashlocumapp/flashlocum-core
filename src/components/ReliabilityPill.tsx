import { useReliability } from "@/lib/reliability";

/**
 * ReliabilityPill — calm dependability trust marker.
 *  🟢 97%
 * No counts or "new user" labels. Defaults to 100% until 10 accepted shifts.
 */
export function ReliabilityPill({
  entityId,
  size = "sm",
  inline = false,
  className = "",
}: {
  entityId: string | null | undefined;
  size?: "sm" | "md";
  inline?: boolean;
  className?: string;
}) {
  const r = useReliability(entityId);
  const dot = size === "md" ? 9 : 7;
  const num = size === "md" ? "text-[13px]" : "text-[11.5px]";
  const color = "var(--color-trust)";

  return (
    <span
      className={`${inline ? "inline-flex" : "flex"} ${inline ? "items-center" : "flex-col"} ${className}`}
      style={{ lineHeight: 1.1 }}
    >
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden
          style={{
            width: dot,
            height: dot,
            borderRadius: "9999px",
            background: color,
            display: "inline-block",
          }}
        />
        <span
          className={`${num} font-medium tabular-nums`}
          style={{ color: "var(--color-trust)" }}
        >
          {r.display}
        </span>
      </span>
    </span>
  );
}
