"use client";

import { useAuthListener } from "@/hooks/useAuth";

// Thin wrapper that activates the Supabase auth listener
// Must be inside QueryProvider (uses useQuery internally)
export function AuthProvider({ children }: { children: React.ReactNode }) {
  useAuthListener();
  return <>{children}</>;
}
