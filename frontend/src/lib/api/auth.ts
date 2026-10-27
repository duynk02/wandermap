import type { CurrentUser } from "@/types";
import type { LoginInput, RegisterInput } from "@/lib/validations";
import { apiFetch, runAuthTransition } from "./client";

interface AuthResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  user: CurrentUser;
}

export async function login(input: LoginInput): Promise<CurrentUser> {
  return runAuthTransition(async (commitToken) => {
    const res = await apiFetch<AuthResponse>("/auth/login", {
      method: "POST",
      body: input,
      retryOnUnauthorized: false,
    });
    commitToken(res.accessToken);
    return res.user;
  });
}

/** Registration finishes on the login page, without publishing an authenticated viewer. */
export async function register(input: RegisterInput): Promise<{ sessionCleared: boolean }> {
  return runAuthTransition(async () => {
    await apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      body: input,
      retryOnUnauthorized: false,
    });
    // The existing backend creates a refresh session on registration. Clear it under
    // the same cookie lock so refreshes/other tabs cannot race the handoff to login.
    try {
      await apiFetch("/auth/logout", { method: "POST", retryOnUnauthorized: false });
      return { sessionCleared: true };
    } catch {
      // The account already exists: do not report a failed registration or resubmit it.
      return { sessionCleared: false };
    }
  });
}

export async function logout(): Promise<void> {
  await runAuthTransition(async () => {
    await apiFetch("/auth/logout", { method: "POST", retryOnUnauthorized: false });
  });
}

/** The backend exposes the authenticated profile at GET /users/me. */
export const getMe = () => apiFetch<CurrentUser>("/users/me");
