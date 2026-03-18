"use client";

import { useEffect, useRef } from "react";

export function NavigationGuard({ onFlush }: { onFlush: () => void }) {
  const hasFlushedRef = useRef(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasFlushedRef.current) return;
      hasFlushedRef.current = true;
      onFlush();
      e.preventDefault();
      e.returnValue = "";
    };

    const handlePageHide = () => {
      if (hasFlushedRef.current) return;
      hasFlushedRef.current = true;
      onFlush();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [onFlush]);

  return null;
}
