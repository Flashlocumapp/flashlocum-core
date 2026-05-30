// Calm operational audio + haptic cues for shift lifecycle events.
//
// Designed to be subtle, professional, and unmistakable — so doctors and
// requesters immediately register Start / Pause / Resume / End transitions
// even when the screen is glanced rather than read.
//
// All cues are synthesized via WebAudio (no asset shipping), brief, and
// gentle in volume. Vibration uses navigator.vibrate when available
// (mobile). Both fail silent on unsupported environments.

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur = 0.18, when = 0, gain = 0.05) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  o.connect(g).connect(a.destination);
  const t = a.currentTime + when;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.025);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.03);
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator === "undefined") return;
  const v = (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate;
  if (!v) return;
  try {
    v.call(navigator, pattern as number & number[]);
  } catch {
    /* noop */
  }
}

export type ShiftCue = "start" | "pause" | "resume" | "end" | "request";

/** Play a calm two-tone cue + light vibration for a shift lifecycle event. */
export function shiftCue(cue: ShiftCue) {
  switch (cue) {
    case "start":
      tone(660, 0.16);
      tone(880, 0.22, 0.14);
      vibrate(35);
      return;
    case "resume":
      tone(620, 0.14);
      tone(784, 0.2, 0.12);
      vibrate(25);
      return;
    case "pause":
      tone(560, 0.22);
      vibrate([20, 50, 20]);
      return;
    case "end":
      tone(660, 0.16);
      tone(440, 0.26, 0.16);
      vibrate([30, 60, 30]);
      return;
    case "request":
      // Calm rising notification — new coverage request reached the doctor.
      tone(740, 0.14);
      tone(988, 0.18, 0.12);
      vibrate(30);
      return;
  }
}
