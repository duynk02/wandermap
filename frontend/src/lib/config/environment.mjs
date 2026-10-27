/** Shared by next.config and the existing API/realtime clients. Never includes credentials. */
function serviceUrl(value, production, name, api = false) {
  try {
    const url = new URL(value);
    const local = /^(localhost|0\.0\.0\.0|127\..*|\[::1\])$/i.test(url.hostname) || url.hostname.endsWith(".localhost");
    if (!["http:", "https:"].includes(url.protocol) || url.hostname.includes("*") || url.username || url.password || url.search || url.hash
      || (production && (url.protocol !== "https:" || local))
      || (api ? url.pathname.replace(/\/$/, "") !== "/api/v1" : url.pathname !== "/")) throw new Error();
    return api ? `${url.origin}/api/v1` : url.origin;
  } catch { throw new Error(`${name} must be a ${production ? "public HTTPS" : "HTTP(S)"} ${api ? "URL ending in /api/v1" : "origin"} without credentials, query or fragment.`); }
}

export const serverApiUrl = (value, production) => serviceUrl(value || (production ? "" : "http://localhost:4000/api/v1"), production, "API_INTERNAL_URL", true);
export const realtimeUrl = (value, production) => serviceUrl(value || (production ? "" : "http://localhost:4000"), production, "NEXT_PUBLIC_REALTIME_URL");
export function browserApiUrl(value, production) {
  const base = value || "/api/v1";
  if (production && base !== "/api/v1") throw new Error("NEXT_PUBLIC_API_URL must be /api/v1 in production to preserve same-origin refresh cookies.");
  return base;
}
export function validateFrontendEnvironment(input) {
  const production = input.NODE_ENV === "production";
  const api = serverApiUrl(input.API_INTERNAL_URL, production);
  const realtime = realtimeUrl(input.NEXT_PUBLIC_REALTIME_URL, production);
  browserApiUrl(input.NEXT_PUBLIC_API_URL, production);
  if (production && (!input.NEXT_PUBLIC_MAPBOX_TOKEN?.startsWith("pk.") || input.NEXT_PUBLIC_MAPBOX_TOKEN.length < 8)) {
    throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN must be a public pk.* Mapbox token in production.");
  }
  return { api, realtime };
}
