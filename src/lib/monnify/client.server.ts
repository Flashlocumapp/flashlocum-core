// Server-only Monnify HTTP client.
// Handles auth (Basic → bearer access token, cached) and JSON requests.
//
// Concurrency notes
// -----------------
// • Single-flight: concurrent callers inside one isolate share one auth fetch
//   instead of all racing to /auth/login (was the "token storm" bug).
// • Refresh jitter: the cached `expiresAt` is randomised inside a 60–180s
//   pre-expiry window so multiple isolates do not all re-auth in lockstep.
// • Auto-recovery: a 401 from any business call invalidates the cache and
//   retries the request exactly once with a fresh token (covers tokens
//   revoked server-side before our local expiry).
//
// Cross-isolate dedup (e.g. Cloudflare Workers spawning many isolates at
// cold-start) is not solvable in-process; if it ever becomes a hot path,
// promote the cache to KV / Durable Object.

type AuthCache = { token: string; expiresAt: number } | null;
let cache: AuthCache = null;
let inflight: Promise<string> | null = null;

function baseUrl(): string {
  const u = process.env.MONNIFY_BASE_URL;
  if (!u) throw new Error("MONNIFY_BASE_URL is not configured");
  return u.replace(/\/$/, "");
}

async function doAuth(): Promise<string> {
  const key = process.env.MONNIFY_API_KEY;
  const secret = process.env.MONNIFY_SECRET_KEY;
  if (!key || !secret) throw new Error("Monnify API credentials missing");

  const basic = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(`${baseUrl()}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  const json = (await res.json()) as {
    requestSuccessful?: boolean;
    responseBody?: { accessToken: string; expiresIn: number };
    responseMessage?: string;
  };
  if (!res.ok || !json.requestSuccessful || !json.responseBody?.accessToken) {
    throw new Error(`Monnify auth failed: ${json.responseMessage ?? res.statusText}`);
  }
  const { accessToken, expiresIn } = json.responseBody;
  // Refresh somewhere in a 60–180s window before real expiry so concurrent
  // isolates don't all race to renew at the same instant.
  const safetyWindow = 60 + Math.floor(Math.random() * 120);
  cache = {
    token: accessToken,
    expiresAt: Date.now() + Math.max(30, expiresIn - safetyWindow) * 1000,
  };
  return accessToken;
}

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cache && cache.expiresAt > Date.now()) return cache.token;
  if (inflight) return inflight;
  if (forceRefresh) cache = null;
  inflight = doAuth().finally(() => {
    inflight = null;
  });
  return inflight;
}

export async function monnifyFetch<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const send = async (token: string) =>
    fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

  let token = await getAccessToken();
  let res = await send(token);

  // Token may have been revoked server-side before our local expiry — refresh once.
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await send(token);
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Monnify ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  const envelope = json as {
    requestSuccessful?: boolean;
    responseMessage?: string;
    responseBody?: T;
  };
  if (!res.ok || envelope.requestSuccessful === false) {
    throw new Error(
      `Monnify ${path} failed (${res.status}): ${envelope.responseMessage ?? "unknown error"}`,
    );
  }
  return (envelope.responseBody ?? (json as T)) as T;
}

export function getMonnifyContractCode(): string {
  const c = process.env.MONNIFY_CONTRACT_CODE;
  if (!c) throw new Error("MONNIFY_CONTRACT_CODE is not configured");
  return c;
}
