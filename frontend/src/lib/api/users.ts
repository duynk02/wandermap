import type { PaginatedResponse, Profile, UserPin, UserRelation } from "@/types";
import { apiFetch, nullOn404 } from "./client";
import type { UpdateProfileInput } from "@/lib/validations";

export type UpdateProfileRequest = Partial<Omit<UpdateProfileInput, "bio" | "home_city">> & {
  avatar_url?: string | null;
  bio?: string | null;
  home_city?: string | null;
};

export const updateMyProfile = (input: UpdateProfileRequest) =>
  apiFetch<Profile>("/users/me", { method: "PATCH", body: input });

export const getProfileByUsername = (username: string) =>
  nullOn404(apiFetch<Profile>(`/users/${encodeURIComponent(username)}`));

export const getUserRelations = (username: string, relation: "followers" | "following", page: number, signal?: AbortSignal) =>
  apiFetch<PaginatedResponse<UserRelation>>(`/users/${encodeURIComponent(username)}/${relation}`, { query: { page, pageSize: 20 }, signal });

/** Own pins only: the API has no endpoint for another user's pins yet. */
export const getMyPins = () => apiFetch<UserPin[]>("/users/me/pins");


export const followUser = (username: string) =>
  apiFetch<{ following: boolean; changed: boolean }>(
    `/users/${encodeURIComponent(username)}/follow`,
    { method: "POST" }
  );

export const unfollowUser = (username: string) =>
  apiFetch<{ following: boolean; changed: boolean }>(
    `/users/${encodeURIComponent(username)}/follow`,
    { method: "DELETE" }
  );
