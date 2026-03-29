"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { BridgeJob, BridgeJobProvider, BridgePayloadVariant } from "@/lib/types";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import { deriveBridgeSessionPatchFromJob } from "@/lib/bridge/bridge-jobs";

export const latestBridgeJobQueryKey = (streamId: string) => [
  "bridge-jobs",
  "latest",
  streamId,
] as const;

export function useLatestBridgeJob(streamId: string, refetchInterval = 4_000) {
  const supabase = createClient();
  const bridgeSession = useUiPreferencesStore(
    (state) => state.bridgeSessionsByStream[streamId],
  );
  const upsertBridgeSession = useUiPreferencesStore(
    (state) => state.upsertBridgeSession,
  );

  const query = useQuery({
    queryKey: latestBridgeJobQueryKey(streamId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bridge_jobs")
        .select("*")
        .eq("stream_id", streamId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as BridgeJob | null;
    },
    enabled: !!streamId,
    refetchInterval,
  });

  useEffect(() => {
    if (!query.data) return;
    upsertBridgeSession(
      streamId,
      deriveBridgeSessionPatchFromJob(
        query.data,
        bridgeSession?.isExternalSessionActive ?? false,
      ),
    );
  }, [
    bridgeSession?.isExternalSessionActive,
    query.data,
    streamId,
    upsertBridgeSession,
  ]);

  return query;
}

export function useCreateBridgeJob(streamId: string) {
  const queryClient = useQueryClient();

  return useMutation<
    { job: BridgeJob; deduped?: boolean },
    Error,
    {
      provider: BridgeJobProvider;
      payload: string;
      payloadVariant: BridgePayloadVariant;
      sessionKey: string;
      runnerDetails?: Record<string, unknown>;
    }
  >({
    mutationFn: async (input) => {
      const response = await fetch("/api/bridge/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          streamId,
          provider: input.provider,
          payload: input.payload,
          payloadVariant: input.payloadVariant,
          sessionKey: input.sessionKey,
          runnerDetails: input.runnerDetails,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; job?: BridgeJob; deduped?: boolean }
        | null;

      if (!response.ok || !payload?.job) {
        throw new Error(payload?.error ?? "Failed to queue bridge job");
      }

      return { job: payload.job, deduped: payload.deduped };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: latestBridgeJobQueryKey(streamId) });
    },
  });
}
