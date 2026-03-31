"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BRIDGE_STATUS_TIMEOUT_MS,
  type BridgeStatusResult,
  isBridgeRunnerHealthPayload,
  resolveBrowserHealthCandidates,
} from "@/lib/bridge/runner-status";

type RunnerMode = "checking" | "online" | "offline";

interface UseBridgeRunnerStatusOptions {
  enabled?: boolean;
  pollIntervalMs?: number;
}

async function tryFetchHealth(url: string) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(BRIDGE_STATUS_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    if (!isBridgeRunnerHealthPayload(payload)) return null;
    return {
      online: true,
      runnerId: payload.runnerId,
      providers: payload.providers,
    } satisfies BridgeStatusResult;
  } catch {
    return null;
  }
}

export function useBridgeRunnerStatus({
  enabled = true,
  pollIntervalMs,
}: UseBridgeRunnerStatusOptions = {}) {
  const [status, setStatus] = useState<BridgeStatusResult>({ online: false });
  const [mode, setMode] = useState<RunnerMode>(enabled ? "checking" : "offline");
  const [isChecking, setIsChecking] = useState(enabled);
  const inFlightRef = useRef<Promise<BridgeStatusResult> | null>(null);

  const checkNow = useCallback(async () => {
    if (!enabled) {
      setIsChecking(false);
      return { online: false } satisfies BridgeStatusResult;
    }

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    const promise = (async () => {
      setIsChecking(true);
      setMode((current) => (current === "online" ? current : "checking"));

      for (const url of resolveBrowserHealthCandidates()) {
        const payload = await tryFetchHealth(url);
        if (payload) {
          setStatus(payload);
          setMode("online");
          setIsChecking(false);
          return payload;
        }
      }

      const fallback = await tryFetchHealth("/api/bridge/status");
      if (fallback?.online) {
        setStatus(fallback);
        setMode("online");
        setIsChecking(false);
        return fallback;
      }

      const offline = { online: false } satisfies BridgeStatusResult;
      setStatus(offline);
      setMode("offline");
      setIsChecking(false);
      return offline;
    })();

    inFlightRef.current = promise;
    try {
      return await promise;
    } finally {
      inFlightRef.current = null;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setIsChecking(false);
      return;
    }

    void checkNow();
  }, [enabled, checkNow]);

  useEffect(() => {
    if (!enabled || !pollIntervalMs) return;
    const interval = window.setInterval(() => {
      void checkNow();
    }, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [enabled, pollIntervalMs, checkNow]);

  return {
    status,
    mode,
    isChecking,
    online: status.online,
    checkNow,
  };
}
