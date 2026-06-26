import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * SplashScreen — calm operational typing sequence.
 * A white circle ("cursor") sweeps left-to-right, typing each phrase
 * character-by-character. Each prelude phrase takes ~2s, the final
 * "FlashLocum" word holds ~3s before the app opens.
 */

type Phrase = { text: string; ms: number };

const PHRASES: Phrase[] = [
  { text: "Let's request", ms: 2000 },
  { text: "Let's respond", ms: 2000 },
  { text: "Let's cover", ms: 2000 },
];

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (index >= PHRASES.length) {
      onDone();
      return;
    }
    const t = window.setTimeout(() => setIndex((i) => i + 1), PHRASES[index].ms);
    return () => window.clearTimeout(t);
  }, [index, onDone]);

  const phrase = PHRASES[Math.min(index, PHRASES.length - 1)];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ backgroundColor: "var(--color-splash)", colorScheme: "dark" }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="relative flex h-12 w-full max-w-[78%] items-center justify-center">
        <AnimatePresence mode="wait">
          <TypingLine key={index} phrase={phrase.text} ms={phrase.ms} />
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function TypingLine({ phrase, ms }: { phrase: string; ms: number }) {
  // Type during ~62% of the slot; hold during the remainder.
  const typeMs = Math.max(600, Math.floor(ms * 0.62));
  const stepMs = Math.max(36, Math.floor(typeMs / phrase.length));
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    let i = 0;
    const t = window.setInterval(() => {
      i += 1;
      setCount(i);
      if (i >= phrase.length) window.clearInterval(t);
    }, stepMs);
    return () => window.clearInterval(t);
  }, [phrase, stepMs]);

  const typed = phrase.slice(0, count);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="flex items-center gap-2"
    >
      <span
        className="select-none whitespace-pre text-[22px] font-medium tracking-tight"
        style={{ color: "rgba(255,255,255,0.92)" }}
      >
        {typed}
      </span>
      <motion.span
        aria-hidden
        className="block rounded-full"
        style={{
          background: "white",
          height: 10,
          width: 10,
          boxShadow: "0 0 14px rgba(255,255,255,0.45)",
        }}
        animate={{ scale: [1, 1.18, 1], opacity: [0.85, 1, 0.85] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.div>
  );
}
