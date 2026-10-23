"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { getAuthSessionVersion, subscribeAccessToken } from "@/lib/api/client";
import type { LocalMessage } from "@/lib/messaging/model";
import { useAuthStore } from "@/stores/authStore";

export interface Draft {
  text: string;
  messages: LocalMessage[];
}
interface DraftState {
  owner: string | null;
  session: number;
  drafts: Record<string, Draft>;
}

/** Private drafts and optimistic messages stay in memory for exactly one auth session. */
export const useMessageDraftStore = create<DraftState>(() => ({
  owner: null,
  session: getAuthSessionVersion(),
  drafts: {},
}));

export function resetMessageDrafts(owner: string | null) {
  const session = getAuthSessionVersion();
  const previous = useMessageDraftStore.getState();
  if (previous.owner !== owner || previous.session !== session) {
    useMessageDraftStore.setState({ owner, session, drafts: {} });
  }
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
