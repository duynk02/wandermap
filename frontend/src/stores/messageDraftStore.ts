"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { getAuthSessionVersion, subscribeAccessToken } from "@/lib/api/client";
import type { LocalMessage } from "@/lib/messaging/model";
import type { ShareAttempt } from "@/lib/messaging/share";
import { useAuthStore } from "@/stores/authStore";

export interface Draft {
  text: string;
  messages: LocalMessage[];
}
export interface MessageScrollPosition {
  key: string | null;
  sequence: string | null;
  offset: number;
  top: number;
  followLatest: boolean;
  newestSequence: string | null;
}
interface DraftState {
  owner: string | null;
  session: number;
  drafts: Record<string, Draft>;
  shareAttempts: Record<string, ShareAttempt>;
  scrollPositions: Record<string, MessageScrollPosition>;
}

/** Private drafts and optimistic messages stay in memory for exactly one auth session. */
export const useMessageDraftStore = create<DraftState>(() => ({
  owner: null,
  session: getAuthSessionVersion(),
  drafts: {},
  shareAttempts: {},
  scrollPositions: {},
}));

export function resetMessageDrafts(owner: string | null) {
  const session = getAuthSessionVersion();
  const previous = useMessageDraftStore.getState();
  if (previous.owner !== owner || previous.session !== session) {
    useMessageDraftStore.setState({
      owner,
      session,
      drafts: {},
      shareAttempts: {},
      scrollPositions: {},
    });
  }
}

/** Only message identities/geometry, never content or browser storage. Bounded per session. */
export function saveMessageScrollPosition(
  viewer: string,
  id: string,
  position: MessageScrollPosition,
) {
  useMessageDraftStore.setState((state) => {
    if (
      useAuthStore.getState().user?.id !== viewer ||
      state.owner !== viewer ||
      state.session !== getAuthSessionVersion()
    )
      return state;
    const positions = new Map(Object.entries(state.scrollPositions));
    positions.delete(id);
    positions.set(id, position);
    if (positions.size > 100) positions.delete(positions.keys().next().value!);
    return { scrollPositions: Object.fromEntries(positions) };
  });
}

export function getMessageScrollPosition(
  viewer: string,
  id: string,
): MessageScrollPosition | undefined {
  const state = useMessageDraftStore.getState();
  return state.owner === viewer &&
    state.session === getAuthSessionVersion() &&
    useAuthStore.getState().user?.id === viewer
    ? state.scrollPositions[id]
    : undefined;
}

export function updateShareAttempt(
  viewer: string,
  key: string,
  attempt: ShareAttempt | null,
) {
  useMessageDraftStore.setState((state) => {
    if (
      useAuthStore.getState().user?.id !== viewer ||
      state.owner !== viewer ||
      state.session !== getAuthSessionVersion()
    )
      return state;
    const shareAttempts = { ...state.shareAttempts };
    if (attempt) shareAttempts[key] = attempt;
    else delete shareAttempts[key];
    return { shareAttempts };
  });
}

export function updateMessageDraft(
  viewer: string,
  id: string,
  update: (draft: Draft) => Draft,
) {
  useMessageDraftStore.setState((state) => {
    if (
      useAuthStore.getState().user?.id !== viewer ||
      state.owner !== viewer ||
      state.session !== getAuthSessionVersion()
    )
      return state;
    return {
      drafts: {
        ...state.drafts,
        [id]: update(state.drafts[id] ?? { text: "", messages: [] }),
      },
    };
  });
}

/** AuthProvider keeps this active while the user visits pages outside messaging. */
export function useMessageDraftSession() {
  useEffect(() => {
    const sync = () =>
      resetMessageDrafts(useAuthStore.getState().user?.id ?? null);
    const stopAuth = useAuthStore.subscribe((state, previous) => {
      if (state.user?.id !== previous.user?.id) sync();
    });
    // Normal token rotation leaves getAuthSessionVersion unchanged and preserves drafts.
    const stopToken = subscribeAccessToken(sync);
    sync();
    return () => {
      stopAuth();
      stopToken();
    };
  }, []);
}
