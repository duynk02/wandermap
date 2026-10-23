import type { Socket } from "socket.io-client";

type RealtimeSocket = Pick<Socket, "on" | "connect" | "disconnect" | "removeAllListeners"> & Partial<Pick<Socket, "auth">>;

export type RealtimePhase = "connecting" | "connected" | "disconnected" | "reconnecting" | "authentication-failed" | "session-expired";

interface RealtimeDependencies {
  createSocket: (token: string) => RealtimeSocket;
  getToken: () => string | null;
  refreshToken: () => Promise<string | null>;
  onConnectionChange?: (userId: string | null, connected: boolean) => void;
  onNotification?: (userId: string, payload: unknown) => void;
  onNotificationStatus?: (userId: string, payload: unknown) => void;
  onPhaseChange?: (phase: RealtimePhase) => void;
}

/** Owner consistency only; the gateway independently verifies the JWT signature and user. */
export function accessTokenSubject(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const parsed: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return parsed && typeof parsed === "object" && "sub" in parsed && typeof parsed.sub === "string"
      ? parsed.sub
      : null;
  } catch {
    return null;
  }
}

/** Owns one authenticated transport; notification business logic stays outside the socket. */
export function createRealtimeLifecycle({ createSocket, getToken, refreshToken, onConnectionChange, onNotification, onNotificationStatus, onPhaseChange }: RealtimeDependencies) {
  let userId: string | null = null;
  let socket: RealtimeSocket | null = null;
  let tokenUsed: string | null = null;
  let generation = 0;
  let refreshing = false;
  let refreshAttempted = false;
  let invalidated = false;
  let disposed = false;
  let socketVersion = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = 1_000;
  let connected = false;
  const phase = (value: RealtimePhase) => onPhaseChange?.(value);

  const disconnect = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    connected = false;
    socketVersion += 1;
    const previous = socket;
    socket = null;
    tokenUsed = null;
    previous?.removeAllListeners();
    previous?.disconnect();
    if (previous && "auth" in previous) previous.auth = {};
    phase("disconnected");
    onConnectionChange?.(userId, false);
  };

  // Only namespace refusals/server disconnects and refresh outages need this timer.
  // Transport reconnection is owned by Socket.IO's Manager, never a parallel loop.
  const retry = () => {
    if (disposed || invalidated || !userId || retryTimer) return;
    phase("reconnecting");
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (disposed || invalidated) return;
      tokenUsed = null;
      connect();
    }, retryDelay + Math.random() * retryDelay * 0.5);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  };

  const connect = () => {
    const token = getToken();
    if (disposed || !userId || !token || accessTokenSubject(token) !== userId || invalidated || refreshing || token === tokenUsed) return;
    disconnect();
    const next = createSocket(token);
    socket = next;
    tokenUsed = token;
    const version = socketVersion;
    const isCurrent = () => socket === next && socketVersion === version;
    phase("connecting");

    const refresh = async () => {
      if (!isCurrent()) return;
      disconnect();
      // A refreshed token rejected by the server must not cause another refresh loop.
      if (refreshAttempted || refreshing) {
        invalidated = true;
        phase("authentication-failed");
        return;
      }
      refreshAttempted = true;
      refreshing = true;
      const startedGeneration = generation;
      try {
        const refreshedToken = await refreshToken();
        if (disposed || startedGeneration !== generation) return;
        if (!refreshedToken) { invalidated = true; phase("session-expired"); }
      } catch {
        if (startedGeneration === generation) {
          // Transient refresh failure is not a revoked session. Retry with backoff.
          refreshAttempted = false;
          retry();
        }
      } finally {
        if (!disposed && startedGeneration === generation) {
          refreshing = false;
          if (!retryTimer) connect();
        }
      }
    };

    next.on("connect", () => {
      if (!isCurrent()) return;
      refreshAttempted = false;
      connected = true;
      retryDelay = 1_000;
      phase("connected");
      onConnectionChange?.(userId, true);
    });
    next.on("disconnect", (reason: string) => {
      if (!isCurrent()) return;
      connected = false;
      phase("disconnected");
      onConnectionChange?.(userId, false);
      if (reason === "io server disconnect") { disconnect(); retry(); }
      else phase("reconnecting");
    });
    next.on("notification:changed", (payload: unknown) => {
      if (isCurrent() && userId) onNotification?.(userId, payload);
    });
    next.on("notifications:status", (payload: unknown) => {
      if (isCurrent() && userId) onNotificationStatus?.(userId, payload);
    });
    next.on("connect_error", (error: Error & { data?: { code?: string } }) => {
      if (!isCurrent()) return;
      if (error.data?.code === "TOKEN_EXPIRED") {
        void refresh();
      } else if (error.data?.code === "UNAUTHORIZED" || error.data?.code === "ORIGIN_NOT_ALLOWED") {
        invalidated = true;
        disconnect();
        phase("authentication-failed");
      } else if (error.data?.code === "SERVICE_UNAVAILABLE") {
        disconnect(); retry();
      } else {
        phase("reconnecting");
      }
      // Socket.IO handles transport reconnections; notification synchronization is external.
    });
    next.on("auth:expired", () => { void refresh(); });
    next.on("auth:unavailable", () => { if (isCurrent()) { disconnect(); retry(); } });
    next.on("auth:invalidated", () => {
      if (!isCurrent()) return;
      invalidated = true;
      disconnect();
      phase("authentication-failed");
    });
    next.connect();
  };

  return {
    setUser(nextUserId: string | null) {
      if (nextUserId === userId || disposed) return;
      generation += 1;
      disconnect();
      userId = nextUserId;
      phase("disconnected");
      onConnectionChange?.(userId, false);
      refreshing = false;
      refreshAttempted = false;
      invalidated = false;
      connect();
    },
    tokenChanged() {
      if (disposed) return;
      disconnect();
      if (!refreshing) {
        generation += 1;
        refreshAttempted = false;
        invalidated = false;
      }
      connect();
    },
    resume() {
      if (!disposed && userId && !invalidated && !refreshing && !retryTimer && !connected) {
        // A live Manager is already retrying network failures. Do not reset its backoff.
        if (!socket) connect();
      }
    },
    offline() { if (!disposed && userId && !connected) phase("disconnected"); },
    dispose() {
      disposed = true;
      generation += 1;
      disconnect();
    },
  };
}
