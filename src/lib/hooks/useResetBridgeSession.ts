"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { latestBridgeJobQueryKey } from "@/lib/hooks/useBridgeJobs";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";

export function useResetBridgeSession(streamId: string) {
  const queryClient = useQueryClient();
  const clearBridgeSession = useUiPreferencesStore(
    (state) => state.clearBridgeSession,
  );

  return useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/bridge/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ streamId }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to reset bridge session");
      }

      return true;
    },
    onSuccess: async () => {
      clearBridgeSession(streamId);
      queryClient.setQueryData(latestBridgeJobQueryKey(streamId), null);
      await queryClient.invalidateQueries({
        queryKey: latestBridgeJobQueryKey(streamId),
      });
    },
  });
}
