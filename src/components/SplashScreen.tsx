import { motion } from "framer-motion";
import flashSvg from "@/assets/logo-flash.svg";
import locumSvg from "@/assets/logo-locum.svg";

export function SplashScreen({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "var(--color-splash)" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={() => {
        window.setTimeout(onDone, 900);
      }}
    >
      <div className="relative flex items-center justify-center gap-1">
        <motion.img
          src={flashSvg}
          alt=""
          className="logo-light h-7 w-auto"
          initial={{ x: -28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.img
          src={locumSvg}
          alt="FlashLocum"
          className="logo-light h-7 w-auto"
          initial={{ x: 28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </motion.div>
  );
}
