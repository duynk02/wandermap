import type { CurrentUser } from "@/types";
import type { LoginInput, RegisterInput } from "@/lib/validations";
import { apiFetch, setAccessToken } from "./client";

interface AuthResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: CurrentUser;
}

export async function login(input: LoginInput): Promise<CurrentUser> {
  const res = await apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    body: input,
    retryOnUnauthorized: false,
  });
  setAccessToken(res.accessToken);
  return res.user;
}

export async function register(input: RegisterInput): Promise<CurrentUser> {
  const res = await apiFetch<AuthResponse>("/auth/register", {
    method: "POST",
    body: input,
    retryOnUnauthorized: false,
  });
  setAccessToken(res.accessToken);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST", retryOnUnauthorized: false });
  } finally {
    setAccessToken(null);
  }
}

/** The backend exposes the authenticated profile at GET /users/me. */
export const getMe = () => apiFetch<CurrentUser>("/users/me");
