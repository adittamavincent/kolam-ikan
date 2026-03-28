"use client";

import { useEffect, useState } from "react";

type LogBranchState = {
  streamId: string;
  currentBranch: string;
  currentBranchHeadId: string | null;
};

type LogBranchDetail = Partial<LogBranchState>;

export function useLogBranchContext(streamId: string) {
  const [state, setState] = useState<Pick<
    LogBranchState,
    "currentBranch" | "currentBranchHeadId"
  >>({
    currentBranch: "main",
    currentBranchHeadId: null,
  });

  useEffect(() => {
    if (!streamId || typeof window === "undefined") return;

    const onLogState = (event: Event) => {
      const detail = (event as CustomEvent<LogBranchDetail>).detail;
      if (detail?.streamId !== streamId) return;

      setState((prev) => {
        const nextBranch =
          typeof detail.currentBranch === "string" && detail.currentBranch.trim()
            ? detail.currentBranch
            : prev.currentBranch;
        const nextHeadId =
          detail.currentBranchHeadId !== undefined
            ? detail.currentBranchHeadId
            : prev.currentBranchHeadId;

        if (
          nextBranch === prev.currentBranch &&
          nextHeadId === prev.currentBranchHeadId
        ) {
          return prev;
        }

        return {
          currentBranch: nextBranch,
          currentBranchHeadId: nextHeadId,
        };
      });
    };

    window.addEventListener("kolam_log_state", onLogState as EventListener);
    return () => {
      window.removeEventListener("kolam_log_state", onLogState as EventListener);
    };
  }, [streamId]);

  return state;
}
