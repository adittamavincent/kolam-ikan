"use client";

import type { ReactNode } from "react";
import { CanvasDiffLines } from "@/components/shared/CanvasDiffLines";
import type { DiffLine } from "@/lib/utils/canvasPreview";
import { GitCompare, X } from "lucide-react";

interface CanvasCompareModalAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

interface CanvasCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  diffs: DiffLine[];
  additions: number;
  deletions: number;
  primaryAction?: CanvasCompareModalAction;
}

export function CanvasCompareModal({
  isOpen,
  onClose,
  title,
  diffs,
  additions,
  deletions,
  primaryAction,
}: CanvasCompareModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-surface-dark p-4"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[80vh] w-full max-w-3xl flex-col border border-border-default bg-surface-default"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-default px-4 py-3">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-text-muted" />
            <span className="text-text-default">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-diff-add-text">+{additions}</span>
            <span className="font-mono text-diff-del-text">-{deletions}</span>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:bg-surface-subtle"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto font-mono">
          <CanvasDiffLines lines={diffs} />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-default px-4 py-3">
          <button
            onClick={onClose}
            className="border border-border-default px-3 py-1.5 text-text-subtle hover:bg-surface-subtle"
          >
            Close
          </button>
          {primaryAction ? (
            <button
              onClick={primaryAction.onClick}
              className="inline-flex items-center gap-1.5 bg-action-primary-bg px-3 py-1.5 text-action-primary-text hover:bg-action-primary-hover"
            >
              {primaryAction.icon}
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
