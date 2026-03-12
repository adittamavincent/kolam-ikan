"use client";

import { useLayout } from "@/lib/hooks/useLayout";
import { useKeyboard } from "@/lib/hooks/useKeyboard";

export function KeyboardShortcutsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { setMode } = useLayout();

  useKeyboard([
    {
      key: "j",
      metaKey: true,
      handler: () => setMode("log-only"),
      description: "Maximize Log",
    },
    {
      key: "k",
      metaKey: true,
      handler: () => setMode("balanced"),
      description: "Reset Layout",
    },
    {
      key: "l",
      metaKey: true,
      handler: () => setMode("canvas-only"),
      description: "Maximize Canvas",
    },
  ]);

  return <>{children}</>;
}
