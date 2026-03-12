"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export function NavigationGuard({ onFlush }: { onFlush: () => void }) {
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      onFlush();
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [onFlush]);

  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev && prev !== pathname) {
      onFlush();
    }
    prevPathRef.current = pathname;
  }, [pathname, onFlush]);

  return null;
}
