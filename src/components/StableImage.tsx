import { memo } from "react";

/**
 * Image with explicit intrinsic dimensions and a stable React key so the
 * browser does not reuse the DOM node across logically distinct images — but
 * also does not tear the node down when only the URL's query-string token
 * changes (e.g. signed-URL refresh).
 *
 * Key derivation:
 *   • If `stableKey` is provided, use it verbatim (e.g. storage path).
 *   • Otherwise strip the query string from `src` so signed-URL refreshes
 *     within the same logical asset keep the same <img> node.
 *
 * Memoised so unchanged props skip the render entirely; surrounding cards
 * can re-render freely without touching the <img>.
 */
type StableImageProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** Stable identity for this image (e.g. storage path). Optional. */
  stableKey?: string;
};

function stripQuery(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function StableImageBase({ src, alt, width, height, className, stableKey }: StableImageProps) {
  const key = stableKey ?? stripQuery(src);
  return (
    <img
      key={key}
      src={src}
      alt={alt}
      width={width}
      height={height}
      decoding="async"
      loading="eager"
      draggable={false}
      className={className}
      style={{ aspectRatio: `${width} / ${height}` }}
    />
  );
}

export const StableImage = memo(StableImageBase);
