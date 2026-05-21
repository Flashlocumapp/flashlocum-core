import { motion, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import { useEffect, type ReactNode } from "react";

type Props = {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  collapsedHeight?: number; // px
  expandedHeight?: number; // px
  children: ReactNode;
};

export function BottomSheet({
  expanded,
  onExpandedChange,
  collapsedHeight = 180,
  expandedHeight,
  children,
}: Props) {
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const expandedH = expandedHeight ?? Math.round(vh * 0.6);

  // y = translateY from a baseline of expandedH height container.
  // collapsed → y = expandedH - collapsedHeight; expanded → y = 0.
  const collapsedY = expandedH - collapsedHeight;
  const y = useMotionValue(collapsedY);

  useEffect(() => {
    const target = expanded ? 0 : collapsedY;
    const controls = animate(y, target, {
      type: "spring",
      stiffness: 260,
      damping: 32,
      mass: 0.9,
    });
    return controls.stop;
  }, [expanded, collapsedY, y]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const current = y.get();
    const velocity = info.velocity.y;
    const midpoint = collapsedY / 2;
    const shouldExpand = velocity < -300 ? true : velocity > 300 ? false : current < midpoint;
    onExpandedChange(shouldExpand);
  };

  const overlayOpacity = useTransform(y, [0, collapsedY], [0.35, 0]);

  return (
    <>
      <motion.div
        aria-hidden
        className="absolute inset-0 z-10 bg-foreground"
        style={{ opacity: overlayOpacity, pointerEvents: expanded ? "auto" : "none" }}
        onClick={() => onExpandedChange(false)}
      />
      <motion.section
        className="absolute inset-x-0 bottom-0 z-20 rounded-t-3xl shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.18)]"
        style={{
          height: expandedH,
          y,
          background: "var(--color-surface-elevated)",
        }}
        drag="y"
        dragConstraints={{ top: 0, bottom: collapsedY }}
        dragElastic={0.04}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
      >
        <button
          aria-label={expanded ? "Collapse" : "Expand"}
          onClick={() => onExpandedChange(!expanded)}
          className="flex w-full justify-center pt-3 pb-1"
        >
          <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </button>
        <div className="h-[calc(100%-1.5rem)] overflow-hidden">{children}</div>
      </motion.section>
    </>
  );
}
