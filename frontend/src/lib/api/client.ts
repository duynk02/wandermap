/**
 * HTTP client for the WanderMap NestJS API (see /backend).
 *
 * Auth model (matches the backend):
 *  - Access token (JWT, ~15 min) lives ONLY in memory here. It is never written to
 *    localStorage, so an XSS bug cannot exfiltrate it.
 *  - Refresh token is an HttpOnly cookie managed entirely by the API. On a 401 we call
 *    POST /auth/refresh once and retry the original request.
 *
 * Server Components / SSR call the API anonymously (no token exists on the server), so
 * they only ever see public data.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const isServer = () => typeof window === "undefined";

/** Browser: NEXT_PUBLIC_API_URL (default "/api/v1", proxied by next.config.ts). Server: direct. */
export function apiBaseUrl(): string {
  return isServer()
    ? (process.env.API_INTERNAL_URL ?? "http://localhost:4000/api/v1")
    : (process.env.NEXT_PUBLIC_API_URL ?? "/api/v1");
}

// ── Access token (memory only) ───────────────────────────────────────────────
let accessToken: string | null = null;
let onSessionExpired: (() => void) | null = null;

export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
/** Called when a refresh fails with 401 (session really ended). */
export const setSessionExpiredHandler = (handler: (() => void) | null) => {
  onSessionExpired = handler;
};

/**
 * Rotates the refresh cookie and returns a new access token, or null if the session is
 * invalid (401). Concurrent callers share ONE request: the backend rotates refresh tokens
 * and treats re-use of a rotated token as theft, revoking every session of the user.
 */
let refreshInFlight: Promise<string | null> | null = null;
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${apiBaseUrl()}/auth/refresh`, {
          method: "POST",
          credentials: "include",
        });
        if (res.status === 401) {
          accessToken = null;
          return null;
        }
        if (!res.ok) throw await toApiError(res);
        accessToken = ((await res.json()) as { accessToken: string }).accessToken;
        return accessToken;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

// ── Requests ─────────────────────────────────────────────────────────────────
type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Set false for /auth/* calls: no 401 → refresh → retry loop. */
  retryOnUnauthorized?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return `${apiBaseUrl()}${path}${qs ? `?${qs}` : ""}`;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: { message?: string | string[]; code?: string; requestId?: string } | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const message = Array.isArray(body?.message)
    ? body.message.join("; ")
    : (body?.message ?? res.statusText ?? "Request failed");
  return new ApiError(
    res.status,
    body?.code ?? "HTTP_ERROR",
    message,
    body?.requestId ?? res.headers.get("x-request-id") ?? undefined
  );
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, retryOnUnauthorized = true, signal } = options;

  // FormData (file uploads): let the browser set the multipart Content-Type with its boundary.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const send = () => {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(buildUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined :isForm ? (body as FormData) : JSON.stringify(body),
      credentials: "include",
      cache: isServer() ? "no-store" : undefined,
      signal,
    });
  };

  let res = await send();

  if (res.status === 401 && retryOnUnauthorized && !isServer()) {
    const token = await refreshAccessToken();
    if (token) res = await send();
    else onSessionExpired?.();
  }

  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** For pages that map "not found" to notFound(): resolves null on 404, rethrows the rest. */
export async function nullOn404<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
