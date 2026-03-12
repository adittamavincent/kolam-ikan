"use client";

import { useLayout } from "@/lib/hooks/useLayout";
import { PanelLeft, PanelRight, Columns } from "lucide-react";

export function LayoutControls() {
  const { setMode, logWidth, canvasWidth } = useLayout();

  // Helper to check active state based on width
  const isLogMaximized = logWidth === 100 && canvasWidth === 0;
  const isBalanced = logWidth === 50 && canvasWidth === 50;
  const isCanvasMaximized = logWidth === 0 && canvasWidth === 100;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-lg border border-border-default bg-surface-default p-2">
      <button
        onClick={() => setMode("log-only")}
        className={`rounded p-2 transition-colors ${
          isLogMaximized
            ? "bg-action-primary-bg/10 text-action-primary-bg"
            : "text-text-muted hover:bg-surface-hover"
        }`}
        title="Maximize Log (⌘J)"
      >
        <PanelLeft className="h-5 w-5" />
      </button>

      <button
        onClick={() => setMode("balanced")}
        className={`rounded p-2 transition-colors ${
          isBalanced
            ? "bg-action-primary-bg/10 text-action-primary-bg"
            : "text-text-muted hover:bg-surface-hover"
        }`}
        title="Reset Layout (⌘K)"
      >
        <Columns className="h-5 w-5" />
      </button>

      <button
        onClick={() => setMode("canvas-only")}
        className={`rounded p-2 transition-colors ${
          isCanvasMaximized
            ? "bg-action-primary-bg/10 text-action-primary-bg"
            : "text-text-muted hover:bg-surface-hover"
        }`}
        title="Maximize Canvas (⌘L)"
      >
        <PanelRight className="h-5 w-5" />
      </button>
    </div>
  );
}
