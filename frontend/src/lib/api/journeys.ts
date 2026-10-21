import type {
  Journey,
  JourneySummary,
  JourneyWriteInput,
  PaginatedResponse,
  TravelVisibility,
} from "@/types";
import { apiFetch } from "./client";

export const getJourneys = (
  query: {
    username?: string;
    mine?: boolean;
    page?: number;
    pageSize?: number;
  } = {},
) =>
  apiFetch<PaginatedResponse<JourneySummary>>("/journeys", {
    query: { ...query },
  });
export const getJourney = (id: string) => apiFetch<Journey>(`/journeys/${id}`);
export const createJourney = (
  input: JourneyWriteInput & { request_id: string },
) => apiFetch<Journey>("/journeys", { method: "POST", body: input });
export const updateJourney = (
  id: string,
  input: Partial<JourneyWriteInput> & { revision: number },
) => apiFetch<Journey>(`/journeys/${id}`, { method: "PATCH", body: input });
export const publishJourney = (
  id: string,
  revision: number,
  visibility?: TravelVisibility,
) =>
  apiFetch<Journey>(`/journeys/${id}/publish`, {
    method: "POST",
    body: { revision, ...(visibility ? { visibility } : {}) },
  });
export const deleteJourney = (id: string, revision: number) =>
  apiFetch<{ deleted: boolean }>(`/journeys/${id}`, {
    method: "DELETE",
    query: { revision },
  });
