import type {
  LocationVisit,
  PaginatedResponse,
  TravelVisibility,
  VisitedLocation,
  TravelFilters,
  TravelMapData,
} from "@/types";
import { apiFetch } from "./client";

export interface VisitedLocationQuery extends TravelFilters {
  page?: number;
  pageSize?: number;
  location_id?: string;
}

export const getTravelMap = (username: string, filters: TravelFilters = {}) =>
  apiFetch<TravelMapData>(`/users/${encodeURIComponent(username)}/travel-map`, { query: { ...filters } });
export interface UpdateVisitedLocationRequest {
  note?: string | null;
  visibility?: TravelVisibility;
}
export interface CreateVisitedLocationRequest extends UpdateVisitedLocationRequest {
  location_id: string;
  visited_at?: string | null;
}
export interface LocationVisitRequest {
  visited_at: string;
  note?: string | null;
}

const own = "/users/me/visited-locations";
export const getMyVisitedLocations = (query: VisitedLocationQuery = {}) =>
  apiFetch<PaginatedResponse<VisitedLocation>>(own, { query: { ...query } });
export const getPublicVisitedLocations = (
  username: string,
  query: VisitedLocationQuery = {},
) =>
  apiFetch<PaginatedResponse<VisitedLocation>>(
    `/users/${encodeURIComponent(username)}/visited-locations`,
    { query: { ...query } },
  );
export const getMyVisitedLocation = (id: string) =>
  apiFetch<VisitedLocation>(`${own}/${id}`);
export const markLocationVisited = (body: CreateVisitedLocationRequest) =>
  apiFetch<VisitedLocation>(own, { method: "POST", body });
export const updateVisitedLocation = (
  id: string,
  body: UpdateVisitedLocationRequest,
) => apiFetch<VisitedLocation>(`${own}/${id}`, { method: "PATCH", body });
export const removeVisitedLocation = (id: string) =>
  apiFetch<{ deleted: boolean }>(`${own}/${id}`, { method: "DELETE" });
export const getLocationVisits = (id: string, page = 1) =>
  apiFetch<PaginatedResponse<LocationVisit>>(`${own}/${id}/visits`, {
    query: { page, pageSize: 10 },
  });
export const addLocationVisit = (id: string, body: LocationVisitRequest) =>
  apiFetch<LocationVisit>(`${own}/${id}/visits`, { method: "POST", body });
export const updateLocationVisit = (
  id: string,
  visitId: string,
  body: Partial<LocationVisitRequest>,
) =>
  apiFetch<LocationVisit>(`${own}/${id}/visits/${visitId}`, {
    method: "PATCH",
    body,
  });
export const removeLocationVisit = (id: string, visitId: string) =>
  apiFetch<{ deleted: boolean }>(`${own}/${id}/visits/${visitId}`, {
    method: "DELETE",
  });
