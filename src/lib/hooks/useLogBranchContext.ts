"use client";

import { useCallback, useSyncExternalStore } from "react";

type LogBranchState = {
  streamId: string;
  currentBranch: string;
  currentBranchHeadId: string | null;
};

type LogBranchDetail = Partial<LogBranchState>;

type KolamLogStateDetail = {
  streamId: string;
  [key: string]: unknown;
};

declare global {
  interface Window {
    __kolamLogStateByStream?: Record<string, Record<string, unknown>>;
  }
}

function readCachedLogState(streamId: string) {
  if (typeof window === "undefined" || !streamId) {
    return {
      currentBranch: "main",
      currentBranchHeadId: null,
    };
  }

  const cached = window.__kolamLogStateByStream?.[streamId];
  return {
    currentBranch:
      typeof cached?.currentBranch === "string" && cached.currentBranch.trim()
        ? cached.currentBranch
        : "main",
    currentBranchHeadId:
      cached?.currentBranchHeadId === undefined
        ? null
        : (cached.currentBranchHeadId as string | null),
  };
}

export function dispatchKolamLogState(detail: KolamLogStateDetail) {
  if (typeof window === "undefined" || !detail.streamId) return;

  const previous = window.__kolamLogStateByStream?.[detail.streamId] ?? {};
  window.__kolamLogStateByStream = {
    ...(window.__kolamLogStateByStream ?? {}),
    [detail.streamId]: {
      ...previous,
      ...detail,
    },
  };

  window.dispatchEvent(
    new CustomEvent("kolam_log_state", {
      detail,
    }),
  );
}

export function useLogBranchContext(streamId: string) {
  const getSnapshot = useCallback(() => readCachedLogState(streamId), [streamId]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!streamId || typeof window === "undefined") {
        return () => undefined;
      }

      const onLogState = (event: Event) => {
        const detail = (event as CustomEvent<LogBranchDetail>).detail;
        if (detail?.streamId !== streamId) return;

        const previous = window.__kolamLogStateByStream?.[streamId] ?? {};
        window.__kolamLogStateByStream = {
          ...(window.__kolamLogStateByStream ?? {}),
          [streamId]: {
            ...previous,
            ...detail,
          },
        };

        onStoreChange();
      };

      window.addEventListener("kolam_log_state", onLogState as EventListener);
      return () => {
        window.removeEventListener("kolam_log_state", onLogState as EventListener);
      };
    },
    [streamId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
