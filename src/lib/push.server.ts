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

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

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
 * Send a push to every device registered for `userId`.
 * Removes tokens that FCM reports as UNREGISTERED / INVALID_ARGUMENT.
 * No-ops with a log when FCM credentials are not configured.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const sa = loadServiceAccount();
  if (!sa) {
    console.warn("[push] FCM_SERVICE_ACCOUNT_JSON missing — skipping push to", userId);
    return;
  }
  const token = await getAccessToken(sa);
  if (!token) return;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows, error } = await supabaseAdmin
    .from("device_tokens")
    .select("id, token, platform")
    .eq("user_id", userId);
  if (error) {
    console.warn("[push] device token lookup failed:", error.message);
    return;
  }
  if (!rows?.length) return;

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const stale: string[] = [];

  await Promise.all(
    rows.map(async (row) => {
      const body = {
        message: {
          token: row.token,
          notification: { title: payload.title, body: payload.body },
          data: payload.data ?? {},
          android: { priority: "HIGH" as const },
          apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
        },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch((e: unknown) => {
        console.warn("[push] send failed:", (e as Error).message);
        return null;
      });
      if (!res) return;
      if (res.status === 404 || res.status === 400) {
        // UNREGISTERED or INVALID_ARGUMENT — prune the token.
        stale.push(row.id);
      } else if (!res.ok) {
        console.warn("[push] FCM responded", res.status, await res.text().catch(() => ""));
      }
    }),
  );

  if (stale.length) {
    await supabaseAdmin.from("device_tokens").delete().in("id", stale);
  }
}
