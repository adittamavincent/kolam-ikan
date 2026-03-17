"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useLayoutEffect, useState } from "react";
import { initStylain } from "@/lib/theme/stylain";
import { useSidebar } from "@/lib/hooks/useSidebar";
import { useLayout } from "@/lib/hooks/useLayout";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes
            retry: 3,
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, 30000),
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 1,
            onError: (error) => {
              console.error("[QueryClient] Mutation error:", error);
              // TODO: Add toast notification
            },
          },
        },
      }),
  );

  useLayoutEffect(() => {
    // Initialize stylain synchronously before paint to avoid
    // hydration mismatches for attributes like `data-stylain-mode`.
    try {
      initStylain();
    } catch {}

    // Restore persisted UI state
    try {
      useSidebar.persist.rehydrate();
      useLayout.persist.rehydrate();
    } catch {}
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools
          initialIsOpen={false}
          buttonPosition="bottom-right"
        />
      )}
    </QueryClientProvider>
  );
}
