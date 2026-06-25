// Provider-agnostic notification dispatcher.
//
// Today this forwards directly to the FCM adapter in `push.server.ts`. When we
// swap to OneSignal (or add additional channels) the body of `notifyUser` is
// the only thing that needs to change — every call site already speaks this
// neutral shape, so no app-wide refactor is required at swap time.
//
// Server-only module (filename ends in `.server.ts`) — import from inside
// server-function or server-route handlers, not from client code.

import { sendPushToUser, type PushPayload } from "./push.server";

/**
 * Send a canonical notification event to a user across all of their
 * registered devices. `payload.kind` MUST be one of the locked event kinds
 * documented in `mem://constraints/notification-events.md`.
 *
 * Failure semantics (transient FCM errors → notification_outbox retry) live
 * inside the underlying adapter and are preserved.
 */
export async function notifyUser(
  userId: string,
  payload: PushPayload,
  opts: { skipOutbox?: boolean } = {},
): Promise<void> {
  return sendPushToUser(userId, payload, opts);
}

export type { PushPayload } from "./push.server";
