"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface UseEnsureThumbnailArgs {
  documentId?: string | null;
  importStatus?: string | null;
  thumbnailPath?: string | null;
  thumbnailStatus?: string | null;
}

export function useEnsureThumbnail({
  documentId,
  thumbnailPath,
  thumbnailStatus,
}: UseEnsureThumbnailArgs) {
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(thumbnailStatus ?? null);
  const [retryTick, setRetryTick] = useState(0);
  const requestedRef = useRef(false);
  const forceAttemptedRef = useRef(false);

  // keep initial state derived from `thumbnailStatus`; avoid setting state
  // synchronously inside an effect to prevent cascading renders

  const effectivePath = thumbnailPath ?? localPath;
  const effectiveStatus = localStatus ?? thumbnailStatus ?? null;

  const shouldEnsure = useMemo(() => {
    if (!documentId) return false;
    if (effectivePath) return false;
    if (effectiveStatus === "unsupported") return false;
    return true;
  }, [documentId, effectivePath, effectiveStatus]);

  useEffect(() => {
    if (!shouldEnsure) return;
    if (requestedRef.current) return;

    requestedRef.current = true;
    const force = effectiveStatus === "failed" && !forceAttemptedRef.current;
    if (force) forceAttemptedRef.current = true;

    const controller = new AbortController();

    const run = async () => {
      try {
        const resp = await fetch("/api/documents/thumbnails/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId, force }),
          signal: controller.signal,
        });

        const payload = (await resp.json().catch(() => null)) as
          | { status?: string; thumbnailPath?: string | null }
          | null;

        if (payload?.thumbnailPath) {
          setLocalPath(payload.thumbnailPath);
        }

        if (payload?.status) {
          setLocalStatus(payload.status);
        }

        if (payload?.status === "pending" || payload?.status === "processing") {
          requestedRef.current = false;
          setRetryTick((tick) => tick + 1);
        }
      } catch {
        requestedRef.current = false;
      }
    };

    void run();

    return () => controller.abort();
  }, [documentId, shouldEnsure, retryTick, effectiveStatus]);

  useEffect(() => {
    if (!shouldEnsure) return;
    if (effectiveStatus === "pending" || effectiveStatus === "processing") {
      const timer = setTimeout(() => {
        requestedRef.current = false;
        setRetryTick((tick) => tick + 1);
      }, 3000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [shouldEnsure, effectiveStatus]);

  return {
    thumbnailPath: effectivePath,
    thumbnailStatus: effectiveStatus,
  };
}
