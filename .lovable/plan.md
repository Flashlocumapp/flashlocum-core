## Root cause to validate

The failure is consistent with top-level Node built-in imports being included in the browser/client build graph:

- `src/routes/api/public/monnify-webhook.ts` imports `node:crypto` at module scope.
- `src/routes/api/public/monnify-disbursement-webhook.ts` imports `node:crypto` at module scope.
- `src/lib/push.server.ts` imports `crypto` at module scope.

Even though these files are intended for server-only execution, the TanStack/Vite route scan still parses/transforms them during the client build. Vite externalizes Node built-ins for browser compatibility, so Rollup sees `__vite-browser-external` and fails on `createHmac` / `createSign`.

## Plan

1. **Reproduce against GitHub commit `20fce8a`, not the sandbox branch**
   - Use an isolated temporary copy/archive of the repository at exactly `20fce8a`.
   - Confirm the failing files and imports match the user’s reported output.
   - Use this copy only for verification; do not rely on the current internal branch state.

2. **Apply the minimal durable fix**
   - Remove all static Node built-in imports from the files entering the route/client scan.
   - Replace Monnify HMAC verification in both webhook route files with Web Crypto (`globalThis.crypto.subtle`) using HMAC-SHA512 over the raw body.
   - Replace the FCM JWT RSA signature in `src/lib/push.server.ts` with Web Crypto RSASSA-PKCS1-v1_5 signing.
   - Keep the same external behavior: same signature validation rules, same Monnify RPC calls, same notification payloads, same outbox behavior.

3. **Search for remaining Node built-in imports in app source**
   - Confirm no remaining `crypto`, `node:crypto`, or accidental `node` imports exist in files that can be scanned by the browser build.
   - Do not change unrelated backend or UI logic.

4. **Verify the fix against the same commit basis**
   - Re-run the production build from the isolated `20fce8a` copy after applying the exact patch.
   - Confirm the previous errors are gone:
     - `Module "node" has been externalized`
     - `Module "crypto" has been externalized`
     - `"createHmac" is not exported by "__vite-browser-external"`

5. **Report evidence**
   - Provide the changed files, the root cause, and the verification result specifically tied to `20fce8a`.