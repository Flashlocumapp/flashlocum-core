import { memo } from "react";

/**
 * Image with explicit intrinsic dimensions and a key tied to `src` so the
 * browser doesn't reuse the DOM node across URL changes — that node reuse
 * was the source of the brief "blank → decoded" flicker every time a row
 * re-rendered with the same logical avatar.
 *
 * Memoised so unchanged `src` values skip the render entirely; the
 * surrounding card can re-render freely without touching the <img>.
 */
type StableImageProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
};

function StableImageBase({ src, alt, width, height, className }: StableImageProps) {
  return (
    <img
      key={src}
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
