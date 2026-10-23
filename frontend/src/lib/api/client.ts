/**
 * HTTP client for the WanderMap NestJS API (see /backend).
 *
 * Auth model (matches the backend):
 *  - Access token (JWT, ~15 min) lives ONLY in memory here. It is never written to
 *    localStorage or any other persistent browser storage.
 *  - Refresh token is an HttpOnly cookie managed entirely by the API. On a 401 we call
 *    POST /auth/refresh once and retry the original request.
 *
 * Server Components / SSR call the API anonymously (no token exists on the server), so
 * they only ever see public data.
 */

export type SessionChange = "signed-in" | "signed-out";
const sessionListeners = new Set<(change: SessionChange) => void>();
let sessionChannel: BroadcastChannel | null = null;
function openSessionChannel() {
  if (!sessionChannel && typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
    sessionChannel = new BroadcastChannel("wandermap-session");
    sessionChannel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data === "signed-in" || data === "signed-out") sessionListeners.forEach((listener) => listener(data));
    };
  }
  return sessionChannel;
}
export function announceSessionChange(change: SessionChange) { sessionChannel?.postMessage(change); }
export function subscribeSessionChange(listener: (change: SessionChange) => void) {
  sessionListeners.add(listener);
  openSessionChannel();
  return () => {
    sessionListeners.delete(listener);
    if (!sessionListeners.size) { sessionChannel?.close(); sessionChannel = null; }
  };
}
export async function withSessionCookieLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request("wandermap-session-cookie", operation);
  }
  return operation();
}

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
let credentialVersion = 0;
let sessionVersion = 0;
let authTransitionDepth = 0;
let authTransitionTail: Promise<void> = Promise.resolve();
const tokenListeners = new Set<(token: string | null) => void>();

export const getAccessToken = () => accessToken;
/** Changes even when a replacement JWT has identical bytes (for example, a rapid login). */
export const getAccessTokenVersion = () => credentialVersion;
/** Stable across normal access-token refreshes; changes at login/logout/session replacement. */
export const getAuthSessionVersion = () => sessionVersion;
function publishAccessToken(token: string | null) {
  credentialVersion += 1;
  accessToken = token;
  tokenListeners.forEach((listener) => listener(token));
}
export const setAccessToken = (token: string | null) => {
  sessionVersion += 1;
  publishAccessToken(token);
};
/** Realtime uses the same in-memory credentials as REST, including logout/token rotation. */
export function subscribeAccessToken(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => { tokenListeners.delete(listener); };
}
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
function tokenSubject(token: string | null): string | null {
  try {
    if (!token) return null;
    const value: unknown = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return value && typeof value === "object" && "sub" in value && typeof value.sub === "string" ? value.sub : null;
  } catch { return null; }
}
export function refreshAccessToken(): Promise<string | null> {
  if (authTransitionDepth) return Promise.resolve(null);
  if (!refreshInFlight) {
    const startedVersion = credentialVersion;
    const startedSubject = tokenSubject(accessToken);
    refreshInFlight = withSessionCookieLock(async () => {
      try {
        if (startedVersion !== credentialVersion || authTransitionDepth) return null;
        const res = await fetch(`${apiBaseUrl()}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401) {
          if (startedVersion === credentialVersion) {
            setAccessToken(null);
            onSessionExpired?.();
          }
          return null;
        }
        if (!res.ok) throw await toApiError(res);
        const refreshedToken = ((await res.json()) as { accessToken: string }).accessToken;
        // A pending refresh belongs to the credentials it started with. It must never
        // restore a logged-out session or replace a newly signed-in account's token.
        if (startedVersion !== credentialVersion) return null;
        // A different tab may have changed the shared cookie before its lifecycle
        // signal arrives. Never attach that account's token to this tab's old UI.
        if (startedSubject && tokenSubject(refreshedToken) !== startedSubject) {
          setAccessToken(null);
          onSessionExpired?.();
          return null;
        }
        publishAccessToken(refreshedToken);
        return accessToken;
      } finally {
        refreshInFlight = null;
      }
    });
  }
  return refreshInFlight;
}

/** Finish cookie rotation before logout revokes the resulting refresh session. */
export async function settleAccessTokenRefresh(): Promise<void> {
  try {
    await refreshInFlight;
  } catch {
    // Logout still needs to be sent when a refresh failed due to a network/server error.
  }
}

/** Serialize HttpOnly cookie writes and invalidate old requests before switching accounts. */
export function runAuthTransition<T>(operation: (commitToken: (token: string) => void) => Promise<T>): Promise<T> {
  authTransitionDepth += 1;
  setAccessToken(null);
  const startedSession = sessionVersion;
  const previous = authTransitionTail;
  let release!: () => void;
  authTransitionTail = new Promise<void>((resolve) => { release = resolve; });
  const assertCurrent = () => {
    if (startedSession !== sessionVersion) throw new ApiError(401, "AUTH_SESSION_CHANGED", "Phiên đăng nhập đã thay đổi.");
  };
  return (async () => {
    try {
      await previous;
      await settleAccessTokenRefresh();
      let signedIn = false;
      const result = await withSessionCookieLock(async () => {
        const result = await operation((token) => { assertCurrent(); publishAccessToken(token); signedIn = true; });
        announceSessionChange(signedIn ? "signed-in" : "signed-out");
        return result;
      });
      assertCurrent();
      return result;
    } finally {
      authTransitionDepth -= 1;
      release();
    }
  })();
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
  const requestCredentialVersion = credentialVersion;
  const requestSessionVersion = sessionVersion;

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
      signal: signal ?? (path.startsWith("/auth/") ? AbortSignal.timeout(15_000) : undefined),
    });
  };

  let res = await send();

  if (res.status === 401 && retryOnUnauthorized && !isServer() && !authTransitionDepth && requestSessionVersion === sessionVersion) {
    // Another request/socket may already have refreshed this same session while
    // this 401 was in transit. Reuse that token rather than rotating again.
    const token = requestCredentialVersion !== credentialVersion && accessToken
      ? accessToken : await refreshAccessToken();
    // The request belongs to its original session. A logout/account switch while it
    // was pending must not trigger rotation or replay it under the next account.
    if (token && token === accessToken && !authTransitionDepth && requestSessionVersion === sessionVersion) res = await send();
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
