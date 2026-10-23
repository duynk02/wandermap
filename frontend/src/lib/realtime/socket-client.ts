import { io, type Socket } from "socket.io-client";

/** Lazy transport owned by a single application lifecycle, reused across token rotation. */
export function createSocketClient(origin: string): (token: string) => Socket {
  let socket: Socket | undefined;
  return (token) => {
    if (typeof window === "undefined") throw new Error("Realtime connections require a browser.");
    socket ??= io(`${origin.replace(/\/$/, "")}/realtime`, {
      path: "/socket.io",
      autoConnect: false,
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      forceNew: true,
    });
    socket.receiveBuffer = [];
    socket.sendBuffer = [];
    socket.auth = { token };
    return socket;
  };
}
