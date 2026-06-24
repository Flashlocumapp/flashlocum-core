## Plan — Reproduce the "Edit only works once" bug before any fix

You've approved the audit. The next step is the **5-cycle Playwright reproduction** with two browser contexts (requester + doctor) against the running preview. This requires switching to build mode so I can execute shell commands; no source files will be modified during this phase.

### What the repro will do

Single Playwright script under `/tmp/browser/edit-cycles/`, two contexts in one browser:

- **Context A — Requester**: restore Supabase session, navigate to `/home`, publish a coverage request (or reuse one already broadcasting if present).
- **Context B — Doctor**: restore a doctor's Supabase session, navigate to `/coverage` (or doctor home feed), confirm online.

Then run the exact cycle the user described, five times in a row:

```text
for i in 1..5:
  A: click "Edit Request"           → screenshot A, screenshot B
  A: change one field, click Save   → screenshot A, screenshot B
  wait 1500ms for realtime fanout   → screenshot B
```

### Evidence captured per cycle

For each of the 5 cycles, persist to `/tmp/browser/edit-cycles/evidence/cycle-<n>/`:

1. **Doctor screenshot** immediately after Edit click (the card should disappear).
2. **Doctor screenshot** 1.5s after Save (the card should reappear with refreshed details).
3. **Requester `state.requests[id]` JSON** — `localStorage.flash:net`.
4. **Server row** — read via supabase RPC `read_query`:
   `SELECT id, status, rev, broadcast_started_at, updated_at FROM coverage_requests WHERE id = '<id>'` immediately after the Edit click and again after Save.
5. **Requester console log** — captured via `page.on("console")` for any `pauseRequest` / `resumeRequest` / `applyRemoteEvent` traces. (If none exist today, add `console.debug` calls in a throwaway local patch that is reverted before the fix phase — these will not be committed.)
6. **Doctor network frames** — Playwright `page.on("websocket")` to record realtime frames on `coverage_invalidations` and `realtime:public:coverage_requests`.

### Pass / fail criteria per cycle

For every cycle 1…5, all of the following must be true; the first cycle that violates any one of them is the failing cycle and pinpoints the root cause:

- Server row flips to `status='paused'` after Edit click.
- `coverage_invalidations` broadcast frame observed by the doctor within 1s.
- Doctor `list_open_coverage_requests` result no longer contains the row.
- Doctor card is visually gone in the screenshot.
- After Save, server flips back to `status='searching'`, `rev` increments by ≥1, and doctor card reappears.

### Root-cause mapping (what each failure mode proves)

- **Server still shows `status='searching'` after Edit click** → fix A (handleSaveEdit ordering / pause-effect race). Doctor never had a reason to drop the card.
- **Server flips to `paused` but no `coverage_invalidations` frame on cycle ≥2** → trigger / realtime authorization regression (would also indicate the recent realtime policy migration needs another look).
- **Frame received but doctor still shows the card** → fix C (snapshot-listener short-circuit). The hash bug at `coverage-remote.ts:337` is independently confirmed and will be fixed regardless.
- **`pauseRequest` returns early without writing** → fix B (status-paused guard hit by stale echo).

### Deliverable from this phase

A short report posted back in chat with:
- Which cycle failed (1, 2, 3, 4, or 5).
- The four boolean checks above for the failing cycle.
- The matching root cause from the mapping.
- The exact fix to apply (1, 2, 3, or 4 from the previous audit, or a new one if the evidence rules them all out).

Only after you confirm the root cause will I propose the implementation plan for the fix.

### Out of scope (this phase)

- No source file edits.
- No DB migrations.
- No changes to the realtime authorization policy.
- The doctor's session must already exist in `LOVABLE_BROWSER_AUTH_STATUS=injected` mode for context B; if only one Supabase session is injected, the second context will sign in by reusing the same session pattern via a service-issued token (read-only repro). If that's not feasible in this sandbox, I will fall back to a single-context repro that asserts via direct supabase reads what the doctor *would* have received (server row + RPC result + websocket frames on the requester's own connection joined to `coverage_invalidations`).

### After you approve

I switch to build mode, run the repro, and report findings. No code is touched until you confirm the root cause from the evidence.