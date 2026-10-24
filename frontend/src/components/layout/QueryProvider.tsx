"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { usePathname } from "next/navigation";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Create client inside component to avoid sharing state between requests on server
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,       // 1 min — don't refetch too often
            gcTime: 5 * 60_000,      // 5 min — keep unused data in cache
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {/* The floating launcher overlaps the mobile message send button. */}
      {process.env.NODE_ENV === "development" && !pathname.startsWith("/messages") && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
