"use client";

import { useAuthListener } from "@/hooks/useAuth";

// Thin wrapper that restores the session (refresh cookie → access token) on load
// Must be inside QueryProvider (uses useQuery internally)
export function AuthProvider({ children }: { children: React.ReactNode }) {
  useAuthListener();
  return <>{children}</>;
}
