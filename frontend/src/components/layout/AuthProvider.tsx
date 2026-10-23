"use client";

import { useAuthListener } from "@/hooks/useAuth";
import { useRealtimeConnection } from "@/hooks/useRealtimeConnection";

// Thin wrapper that restores the session (refresh cookie → access token) on load
// Must be inside QueryProvider (uses useQuery internally)
export function AuthProvider({ children }: { children: React.ReactNode }) {
  useAuthListener();
  useRealtimeConnection();
  return <>{children}</>;
}
