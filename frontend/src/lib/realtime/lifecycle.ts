import type { Socket } from "socket.io-client";

type RealtimeSocket = Pick<Socket, "on" | "connect" | "disconnect" | "removeAllListeners">;

interface RealtimeDependencies {
  createSocket: (token: string) => RealtimeSocket;
  getToken: () => string | null;
  refreshToken: () => Promise<string | null>;
  onConnectionChange?: (userId: string | null, connected: boolean) => void;
  onNotification?: (userId: string, payload: unknown) => void;
  onNotificationStatus?: (userId: string, payload: unknown) => void;
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
export function createRealtimeLifecycle({ createSocket, getToken, refreshToken, onConnectionChange, onNotification, onNotificationStatus }: RealtimeDependencies) {
  let userId: string | null = null;
  let socket: RealtimeSocket | null = null;
  let tokenUsed: string | null = null;
  let generation = 0;
  let refreshing = false;
  let refreshAttempted = false;
  let invalidated = false;
  let disposed = false;

  const disconnect = () => {
    const previous = socket;
    socket = null;
    tokenUsed = null;
    previous?.removeAllListeners();
    previous?.disconnect();
    onConnectionChange?.(userId, false);
  };

  const connect = () => {
    const token = getToken();
    if (disposed || !userId || !token || accessTokenSubject(token) !== userId || invalidated || refreshing || token === tokenUsed) return;
    disconnect();
    const next = createSocket(token);
    socket = next;
    tokenUsed = token;

    const refresh = async () => {
      if (socket !== next) return;
      disconnect();
      // A refreshed token rejected by the server must not cause another refresh loop.
      if (refreshAttempted || refreshing) {
        invalidated = true;
        return;
      }
      refreshAttempted = true;
      refreshing = true;
      const startedGeneration = generation;
      try {
        const refreshedToken = await refreshToken();
        if (disposed || startedGeneration !== generation) return;
        if (!refreshedToken) invalidated = true;
      } catch {
        // REST remains available. Retry only when credentials/session change externally.
        if (startedGeneration === generation) invalidated = true;
      } finally {
        if (!disposed && startedGeneration === generation) {
          refreshing = false;
          connect();
        }
      }
    };

    next.on("connect", () => {
      if (socket !== next) return;
      refreshAttempted = false;
      onConnectionChange?.(userId, true);
    });
    next.on("disconnect", () => {
      if (socket === next) onConnectionChange?.(userId, false);
    });
    next.on("notification:changed", (payload: unknown) => {
      if (socket === next && userId) onNotification?.(userId, payload);
    });
    next.on("notifications:status", (payload: unknown) => {
      if (socket === next && userId) onNotificationStatus?.(userId, payload);
    });
    next.on("connect_error", (error: Error & { data?: { code?: string } }) => {
      if (socket !== next) return;
      if (error.data?.code === "TOKEN_EXPIRED") {
        void refresh();
      } else if (error.data?.code === "UNAUTHORIZED" || error.data?.code === "ORIGIN_NOT_ALLOWED") {
        invalidated = true;
        disconnect();
      }
      // Socket.IO handles transport reconnections. No REST synchronization in Step 1.
    });
    next.on("auth:expired", () => { void refresh(); });
    next.on("auth:invalidated", () => {
      if (socket !== next) return;
      invalidated = true;
      disconnect();
    });
    next.connect();
  };

  return {
    setUser(nextUserId: string | null) {
      if (nextUserId === userId || disposed) return;
      generation += 1;
      disconnect();
      userId = nextUserId;
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
    dispose() {
      disposed = true;
      generation += 1;
      disconnect();
    },
  };
}
