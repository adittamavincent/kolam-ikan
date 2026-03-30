"use client";

import { useMemo, useState } from "react";
import { CanvasVersion } from "@/lib/types";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Eye,
  GitCompare,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import type { PartialBlock } from "@/lib/types/editor";
import { CanvasDiffLines } from "@/components/shared/CanvasDiffLines";
import { ThreadFrame } from "@/components/shared/SectionPreset";
import {
  CANVAS_PREVIEW_OPEN_EVENT,
  contentToDiffText,
  lineDiff,
} from "@/lib/utils/canvasPreview";
import { storedContentToBlocks, storedContentToMarkdown } from "@/lib/content-protocol";

interface CanvasSnapshotCardProps {
  version: CanvasVersion;
  streamId: string;
  aiModelLabel?: string | null;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function CanvasSnapshotCard({
  version,
  streamId,
  aiModelLabel = null,
  isCollapsed = false,
  onToggleCollapsed,
}: CanvasSnapshotCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const { canvas } = useCanvas(streamId);
  const liveContent = useCanvasDraft((s) => s.liveContentByStream[streamId] ?? null);
  const liveMarkdown = useCanvasDraft((s) => s.liveMarkdownByStream[streamId] ?? "");
  const canvasBlocks = useMemo(
    () => storedContentToBlocks(canvas ?? {}),
    [canvas],
  );
  const canvasMarkdown = useMemo(
    () => storedContentToMarkdown(canvas ?? {}),
    [canvas],
  );

  const isAIGenerated = version.name?.startsWith("AI Bridge") ?? false;
  const snapshotTitle = isAIGenerated
    ? aiModelLabel?.trim() || "AI"
    : version.name || "Untitled Snapshot";
  const currentContent = (liveContent ?? canvasBlocks ?? null) as PartialBlock[] | null;
  const currentMarkdown = liveMarkdown || canvasMarkdown;
  const snapshotContent = storedContentToBlocks(version);
  const snapshotMarkdown = storedContentToMarkdown(version);

  const diffs = useMemo(() => {
    const oldText = contentToDiffText(currentContent, currentMarkdown);
    const newText = contentToDiffText(snapshotContent, snapshotMarkdown);
    return lineDiff(oldText, newText);
  }, [currentContent, currentMarkdown, snapshotContent, snapshotMarkdown]);

  const additions = diffs.filter((d) => d.type === "add").length;
  const deletions = diffs.filter((d) => d.type === "del").length;

  const handleOpenInCanvas = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(CANVAS_PREVIEW_OPEN_EVENT, {
        detail: {
          streamId,
          versionId: version.id,
          versionName: snapshotTitle,
          versionCreatedAt: version.created_at,
          content: snapshotContent,
          markdown: snapshotMarkdown,
        },
      }),
    );
    setShowConfirm(false);
    setIsCompareOpen(false);
  };

  return (
    <>
      <ThreadFrame
        hideBody={isCollapsed}
        className="group"
        frameClassName={`overflow-hidden transition-colors ${
          isCollapsed
            ? "border-border-strong bg-surface-default"
            : "border-border-default bg-surface-subtle"
        }`}
        headerClassName={`transition-colors ${
          isCollapsed
            ? "bg-surface-hover hover:bg-surface-subtle"
            : "bg-surface-elevated hover:bg-surface-hover"
        }`}
        bodyClassName="bg-surface-subtle"
        header={
          <div
            role="button"
            tabIndex={0}
            aria-expanded={!isCollapsed}
            onClick={onToggleCollapsed}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggleCollapsed?.();
              }
            }}
            className="flex h-8 items-center justify-between gap-2"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center border ${
                  isCollapsed
                    ? "border-border-default bg-surface-default text-text-muted"
                    : "border-action-primary-bg bg-surface-default text-action-primary-bg"
                }`}
                aria-hidden="true"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="h-4 w-1 shrink-0 bg-border-strong" aria-hidden="true" />
              <Camera className="h-3 w-3 shrink-0 text-text-subtle" />
              <span className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-text-default">
                Canvas Snapshot
              </span>
            </div>
            <span className="shrink-0 font-mono text-[10px] font-medium text-text-subtle">
              {new Date(version.created_at || "").toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        }
      >
        <div className="px-2.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              {isAIGenerated ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <div className="persona-button-display__icon flex h-4 w-4 shrink-0 items-center justify-center border bg-action-primary-bg/10 text-action-primary-bg">
                    <Sparkles className="h-2.5 w-2.5" />
                  </div>
                  <span className="truncate text-[10px] font-medium tracking-wider text-text-subtle uppercase">
                    {snapshotTitle}
                  </span>
                  <span className="persona-button-display__type-badge shrink-0 px-1 py-px text-[9px] font-semibold uppercase tracking-[0.12em]">
                    AI
                  </span>
                </div>
              ) : (
                <div className="truncate text-xs font-medium text-text-default">
                  {snapshotTitle}
                </div>
              )}
              {version.summary && (
                <div className="mt-0.5 line-clamp-2 text-[10px] text-text-muted">
                  {version.summary}
                </div>
              )}
            </div>
            <div className="ml-2 shrink-0">
              {showConfirm ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleOpenInCanvas}
                    className="bg-action-primary-bg px-2 py-0.5 text-[10px] font-semibold text-action-primary-text transition-colors hover:bg-action-primary-hover"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="border border-border-default bg-surface-default px-2 py-0.5 text-[10px] font-semibold text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-default"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsCompareOpen(true)}
                    className="border border-border-subtle p-1 text-text-muted transition-colors hover:border-border-default hover:bg-surface-hover hover:text-text-default"
                    title="Compare with current canvas draft"
                  >
                    <GitCompare className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="border border-border-subtle p-1 text-text-muted transition-colors hover:border-border-default hover:bg-surface-hover hover:text-text-default"
                    title="Open this snapshot in canvas preview"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </ThreadFrame>

      {isCompareOpen && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-surface-dark"
          onClick={() => setIsCompareOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[80vh] flex flex-col border border-border-default bg-surface-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-text-muted" />
                <span className="text-sm font-semibold text-text-default">
                  Compare Snapshot vs Current Draft
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-diff-add-text">
                  +{additions}
                </span>
                <span className="text-[11px] font-mono text-diff-del-text">
                  -{deletions}
                </span>
                <button
                  onClick={() => setIsCompareOpen(false)}
                  className="p-1 text-text-muted hover:bg-surface-subtle"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 font-mono text-[11px]">
              <CanvasDiffLines lines={diffs} />
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border-default">
              <button
                onClick={() => setIsCompareOpen(false)}
                className="border border-border-default px-3 py-1.5 text-xs font-medium text-text-subtle hover:bg-surface-subtle"
              >
                Close
              </button>
              <button
                onClick={handleOpenInCanvas}
                className="inline-flex items-center gap-1.5 bg-action-primary-bg px-3 py-1.5 text-xs font-semibold text-action-primary-text hover:bg-action-primary-hover"
              >
                <Eye className="h-3.5 w-3.5" />
                Open in Canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
