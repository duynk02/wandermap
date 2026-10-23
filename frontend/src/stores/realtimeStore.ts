import { create } from "zustand";
import type { RealtimePhase } from "@/lib/realtime/lifecycle";

interface RealtimeState {
  userId: string | null;
  connected: boolean;
  notificationsAvailable: boolean;
  phase: RealtimePhase;
  setPhase: (phase: RealtimePhase) => void;
  setConnection: (userId: string | null, connected: boolean) => void;
  setNotificationsAvailable: (userId: string, available: boolean) => void;
}

/** Transport state only; notification content/counts remain in TanStack Query. */
export const useRealtimeStore = create<RealtimeState>()((set) => ({
  userId: null,
  connected: false,
  notificationsAvailable: false,
  phase: "disconnected",
  setPhase: (phase) => set({ phase }),
  setConnection: (userId, connected) => set((state) =>
    state.userId === userId && state.connected === connected ? state : {
      userId,
      connected,
      notificationsAvailable: connected && state.userId === userId ? state.notificationsAvailable : false,
    }),
  setNotificationsAvailable: (userId, available) => set((state) =>
    state.userId === userId ? { notificationsAvailable: available } : state),
}));
