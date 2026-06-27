## Goal
Replace the in-app alert/confirm sound assets with the two uploaded WAVs, trim leading/trailing silence, and keep the existing playback wiring untouched so future swaps are a one-file drop-in.

## Current state (verified)
- `src/lib/sound.ts` already imports `@/assets/sounds/alert.wav` and `@/assets/sounds/confirm.wav` via `?url`, preloads them, and exposes `playAlert()` / `playConfirm()`.
- `src/lib/feedback.ts` already calls `playAlert()` only for new incoming requests and `playConfirm()` only on server-confirmed acceptance (with G3/G4/G7 dedup).
- Assets are bundled by Vite (offline-capable, low-latency once preloaded).

So no application logic needs to change. Only the two binary files are swapped.

## Steps
1. Copy `user-uploads://Alert.wav` and `Confirm.wav` to `/tmp/`.
2. Use `ffmpeg`'s `silenceremove` filter on each to strip only leading and trailing silence (threshold ~-50dB), preserving the original sample rate, bit depth, channels, and PCM codec — no normalization, no re-encoding to a lossy format, no remixing.
3. Overwrite `src/assets/sounds/alert.wav` and `src/assets/sounds/confirm.wav` with the trimmed outputs.
4. Verify with `ffprobe` that format/sample rate/bit depth match the originals (minus the silence) and that durations are sane.
5. Leave `src/lib/sound.ts`, `src/lib/feedback.ts`, and all call sites unchanged.

## Why this satisfies "easy future swap"
The playback layer already references two fixed file paths. Swapping sounds later = drop two WAVs at the same paths; no code edits, no rebuild config, no logic touched.

## Out of scope
- No changes to dedup, gating, push-sound config, haptics, or settings UI.
- No new "soundEnabled" preference.
