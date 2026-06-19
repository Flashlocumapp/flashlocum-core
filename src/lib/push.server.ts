// Server-only FCM v1 sender. Loaded inside server-function handlers only.
// Requires the FCM_SERVICE_ACCOUNT_JSON secret (a Firebase service-account
// JSON). When the secret is missing this no-ops with a console warning so the
// app keeps working in environments without push credentials configured.

import { createSign } from "crypto";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
};

/**
 * Canonical-event push payload. Mirrors the engine's CanonicalEvent shape so
 * the foreground push listener can rehydrate it as `fromPush(payload)` and
 * collapse with any realtime / local arrival inside the dedup window.
 *
 * `kind`, `entityId`, `version`, `occurredAt`, `audience` are required so the
 * client engine can enforce G2/G3/G4 regardless of arrival order.
 */
export type PushPayload = {
  title: string;
  body: string;
  /** Canonical event kind (e.g. "shift.started", "offer.new"). */
  kind: string;
  /** Coverage request id (or offer id for offer.new). */
  entityId: string;
  /** Monotonic version per (kind, entityId). Usually row updated_at ms. */
  version: number;
  /** Server timestamp ms. */
  occurredAt: number;
  /** Recipient role. */
  audience: "doctor" | "requester";
  /** Free-form extras forwarded to the client. */
  data?: Record<string, string>;
};

const HIGH_PRIORITY_KINDS = new Set<string>(["offer.new", "shift.cancelled"]);
const BRANDED_CHIME_KINDS = new Set<string>(["offer.new", "shift.cancelled"]);

let cachedToken: { token: string; exp: number } | null = null;
let cachedSA: ServiceAccount | null = null;

function loadServiceAccount(): ServiceAccount | null {
  if (cachedSA) return cachedSA;
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    cachedSA = parsed;
    return parsed;
  } catch (e) {
    console.warn("[push] FCM_SERVICE_ACCOUNT_JSON is not valid JSON:", (e as Error).message);
    return null;
  }
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(sa.private_key));
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch(sa.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    console.warn("[push] FCM token exchange failed:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedToken = { token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return json.access_token;
}

/**
 * Send a push to every device registered for `userId`. Per-kind priority
 * and sound are derived from `payload.kind`; HIGH priority is reserved for
 * offer.new + shift.cancelled per the spec.
 *
 * Removes tokens that FCM reports as UNREGISTERED / INVALID_ARGUMENT.
 *
 * Transient failures (FCM 5xx, network error, missing FCM credentials with
 * tokens present) enqueue the payload into `notification_outbox` so the
 * drain cron can retry with exponential backoff. Pass `skipOutbox: true`
 * from the drain itself to avoid re-enqueueing.
 *
 * No-ops with a log when FCM credentials are not configured AND no devices
 * are registered for the user.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  opts: { skipOutbox?: boolean } = {},
): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const sa = loadServiceAccount();

  const { data: rows, error } = await supabaseAdmin
    .from("device_tokens")
    .select("id, token, platform")
    .eq("user_id", userId);
  if (error) {
    console.warn("[push] device token lookup failed:", error.message);
    return;
  }
  if (!rows?.length) return;

  if (!sa) {
    console.warn("[push] FCM_SERVICE_ACCOUNT_JSON missing — enqueueing for", userId);
    if (!opts.skipOutbox) await enqueueOutbox(userId, payload, "fcm credentials missing");
    return;
  }
  const token = await getAccessToken(sa);
  if (!token) {
    if (!opts.skipOutbox) await enqueueOutbox(userId, payload, "fcm token exchange failed");
    return;
  }

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const stale: string[] = [];
  let transientFailure: string | null = null;
  let anySuccess = false;

  const highPriority = HIGH_PRIORITY_KINDS.has(payload.kind);
  const apnsSound = BRANDED_CHIME_KINDS.has(payload.kind) ? "offer.caf" : "default";
  const androidSound = BRANDED_CHIME_KINDS.has(payload.kind) ? "offer" : "default";

  const dataEnvelope: Record<string, string> = {
    ...(payload.data ?? {}),
    kind: payload.kind,
    entityId: payload.entityId,
    version: String(payload.version),
    occurredAt: String(payload.occurredAt),
    audience: payload.audience,
  };

  await Promise.all(
    rows.map(async (row) => {
      const body = {
        message: {
          token: row.token,
          notification: { title: payload.title, body: payload.body },
          data: dataEnvelope,
          android: {
            priority: highPriority ? ("HIGH" as const) : ("NORMAL" as const),
            notification: { sound: androidSound },
          },
          apns: {
            headers: { "apns-priority": highPriority ? "10" : "5" },
            payload: { aps: { sound: apnsSound } },
          },
        },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch((e: unknown) => {
        const msg = (e as Error).message;
        console.warn("[push] send failed:", msg);
        transientFailure = transientFailure ?? `network: ${msg}`;
        return null;
      });
      if (!res) return;
      if (res.status === 404 || res.status === 400) {
        // UNREGISTERED or INVALID_ARGUMENT — prune the token. Permanent.
        stale.push(row.id);
      } else if (res.status >= 500 || res.status === 429) {
        const text = await res.text().catch(() => "");
        console.warn("[push] FCM transient", res.status, text);
        transientFailure = transientFailure ?? `fcm ${res.status}: ${text.slice(0, 200)}`;
      } else if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("[push] FCM responded", res.status, text);
      } else {
        anySuccess = true;
      }
    }),
  );

  if (stale.length) {
    await supabaseAdmin.from("device_tokens").delete().in("id", stale);
  }

  if (!anySuccess && transientFailure && !opts.skipOutbox) {
    await enqueueOutbox(userId, payload, transientFailure);
  }
}

/**
 * Insert a payload into notification_outbox for retry. Idempotent per
 * (user_id, kind, entity_id, version): if a row already exists undelivered
 * we leave it alone so attempts/backoff are owned by the drain.
 */
async function enqueueOutbox(
  userId: string,
  payload: PushPayload,
  reason: string,
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("notification_outbox")
      .select("id")
      .eq("user_id", userId)
      .eq("kind", payload.kind)
      .eq("entity_id", payload.entityId)
      .eq("version", payload.version)
      .is("delivered_at", null)
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await supabaseAdmin.from("notification_outbox").insert({
      user_id: userId,
      kind: payload.kind,
      entity_id: payload.entityId,
      version: payload.version,
      occurred_at: payload.occurredAt,
      audience: payload.audience,
      title: payload.title,
      body: payload.body,
      payload: (payload.data ?? {}) as Record<string, string>,
      last_error: reason.slice(0, 500),
    });
  } catch (e) {
    console.warn("[push] outbox enqueue failed:", (e as Error).message);
  }
}
