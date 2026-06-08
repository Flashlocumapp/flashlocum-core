// Server-only Monnify HTTP client.
// Handles auth (Basic → bearer access token, cached) and JSON requests.

type AuthCache = { token: string; expiresAt: number } | null;
let cache: AuthCache = null;

function baseUrl(): string {
  const u = process.env.MONNIFY_BASE_URL;
  if (!u) throw new Error("MONNIFY_BASE_URL is not configured");
  return u.replace(/\/$/, "");
}

async function fetchAccessToken(): Promise<string> {
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
  cache = {
    token: accessToken,
    // refresh 60s before actual expiry
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  return accessToken;
}

async function getAccessToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now()) return cache.token;
  return fetchAccessToken();
}

export async function monnifyFetch<T = unknown>(
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
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
