import { useRating, type RatingRole } from "@/lib/ratings";

/**
 * RatingPill — small calm trust marker.
 *  ⭐ 4.8
 * No verified labels, counts, or review words. Restrained typography.
 */
export function RatingPill({
  entityId,
  role,
  size = "sm",
  inline = false,
  className = "",
}: {
  entityId: string | null | undefined;
  role: RatingRole;
  size?: "sm" | "md";
  inline?: boolean;
  className?: string;
}) {
  const r = useRating(entityId);
  const star = size === "md" ? 13 : 11;
  const num = size === "md" ? "text-[13px]" : "text-[11.5px]";

  return (
    <span
      className={`${inline ? "inline-flex" : "flex"} ${inline ? "items-center" : "flex-col"} ${className}`}
      style={{ lineHeight: 1.1 }}
    >
      <span className="inline-flex items-center gap-1">
        <svg width={star} height={star} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"
            fill="var(--color-rating)"
            stroke="var(--color-rating)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        <span
          className={`${num} font-medium tabular-nums`}
          style={{ color: "var(--color-rating)" }}
        >
          {r.score.toFixed(1)}
        </span>
      </span>
    </span>
  );
}
