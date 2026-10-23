/** One effect resource per tab; importing this module never starts a session. */
export function createRealtimeSessionRegistry() {
  let session: { owner: object; start: () => () => void; stop?: () => void; leases: Set<symbol> } | null = null;
  let scheduled = false;
  const reconcile = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!session) return;
      if (!session.leases.size) {
        const previous = session;
        session = null;
        previous.stop?.();
      } else if (!session.stop) session.stop = session.start();
    });
  };
  return {
    acquire(owner: object, start: () => () => void): () => void {
      if (typeof window === "undefined") return () => {};
      if (session && session.owner !== owner) {
        if (session.leases.size) throw new Error("Realtime must share the application's QueryClient.");
        const previous = session;
        session = null;
        previous.stop?.();
      }
      session ??= { owner, start, leases: new Set() };
      const lease = Symbol();
      const current = session;
      current.leases.add(lease);
      reconcile();
      return () => { current.leases.delete(lease); reconcile(); };
    },
  };
}

export const realtimeSession = createRealtimeSessionRegistry();
