"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { useUiPreferencesSync } from "@/lib/hooks/useUiPreferencesSync";
import { shouldRetrySupabaseQuery } from "@/lib/supabase/schema-compat";

function UiPreferencesBootstrap() {
  useUiPreferencesSync();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes
            retry: (failureCount, error) =>
              shouldRetrySupabaseQuery(failureCount, error, 3),
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
  return (
    <QueryClientProvider client={queryClient}>
      <UiPreferencesBootstrap />
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
