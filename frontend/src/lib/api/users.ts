import type { Profile, UserPin } from "@/types";
import { apiFetch, nullOn404 } from "./client";

export const getProfileByUsername = (username: string) =>
  nullOn404(apiFetch<Profile>(`/users/${encodeURIComponent(username)}`));

/** Own pins only: the API has no endpoint for another user's pins yet. */
export const getMyPins = () => apiFetch<UserPin[]>("/users/me/pins");
