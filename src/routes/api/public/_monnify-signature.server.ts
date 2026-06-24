// Server-only helper for verifying Monnify webhook signatures.
// Kept in a *.server.ts file so the Node `crypto` import never leaks into
// the client bundle when the surrounding route files are scanned by Vite.

import { createHmac, timingSafeEqual } from "crypto";

// Monnify signs with HMAC-SHA512 — output is exactly 128 hex chars.
const SIG_HEX_LEN = 128;
const HEX_RE = /^[0-9a-fA-F]+$/;

export function verifyMonnifySignature(
  signature: string | null,
  rawBody: string,
  context = "monnify-webhook",
): boolean {
  if (!signature) return false;
  const sig = signature.trim().toLowerCase();
  if (sig.length !== SIG_HEX_LEN || !HEX_RE.test(sig)) return false;

  const secret = process.env.MONNIFY_SECRET_KEY;
  if (!secret) {
    console.error(`[${context}] MONNIFY_SECRET_KEY is not set; rejecting`);
    return false;
  }

  // HMAC the RAW request body — re-serializing parsed JSON would change
  // byte order / whitespace and break verification.
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
