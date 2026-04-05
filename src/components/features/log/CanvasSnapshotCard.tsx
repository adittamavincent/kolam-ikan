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
} from "lucide-react";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import type { PartialBlock } from "@/lib/types/editor";
import { useCanvasDiff } from "@/lib/hooks/useCanvasDiff";
import { CanvasCompareModal } from "@/components/shared/CanvasCompareModal";
import { ThreadFrame } from "@/components/shared/SectionPreset";
import { CANVAS_PREVIEW_OPEN_EVENT } from "@/lib/utils/canvasPreview";
import {
  storedContentToBlocks,
  storedContentToMarkdown,
} from "@/lib/content-protocol";

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
  const liveContent = useCanvasDraft(
    (s) => s.liveContentByStream[streamId] ?? null,
  );
  const liveMarkdown = useCanvasDraft(
    (s) => s.liveMarkdownByStream[streamId] ?? "",
  );
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
  const currentContent = (liveContent ?? canvasBlocks ?? null) as
    | PartialBlock[]
    | null;
  const currentMarkdown = liveMarkdown || canvasMarkdown;
  const snapshotContent = storedContentToBlocks(version);
  const snapshotMarkdown = storedContentToMarkdown(version);

  const { diffs, additions, deletions } = useCanvasDiff({
    oldContent: currentContent,
    oldMarkdown: currentMarkdown,
    newContent: snapshotContent,
    newMarkdown: snapshotMarkdown,
  });

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
          isCollapsed ? "bg-surface-default" : "bg-surface-subtle"
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
            className="flex h-6 items-center justify-between"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </span>
              <Camera className="h-4 w-4 shrink-0 text-text-subtle" />
              <span className="truncate uppercase text-text-default">
                Canvas Snapshot
              </span>
            </div>
            <span className="shrink-0 text-text-subtle">
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
        <div>
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              {isAIGenerated ? (
                <div className="flex min-w-0 items-center">
                  <div className="persona-button-display__icon log-pane__accent-icon flex h-4 w-4 shrink-0 items-center justify-center">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <span className="truncate tracking-wider text-text-subtle uppercase">
                    {snapshotTitle}
                  </span>
                  <span className="persona-button-display__type-badge log-pane__accent-badge shrink-0 px-1 py-px uppercase tracking-[0.12em]">
                    AI
                  </span>
                </div>
              ) : (
                <div className="truncate text-text-default gap-2 flex">
                  <div className="h-4 w-4" />
                  {snapshotTitle}
                </div>
              )}
              {version.summary && (
                <div className="mt-0.5 line-clamp-2 text-text-muted">
                  {version.summary}
                </div>
              )}
            </div>
            <div className="ml-2 shrink-0">
              {showConfirm ? (
                <div className="flex items-center">
                  <button
                    onClick={handleOpenInCanvas}
                    className="log-pane__action-button px-2 py-0.5 transition-colors"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className="log-pane__action-button px-2 py-0.5 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center">
                  <button
                    onClick={() => setIsCompareOpen(true)}
                    className="log-pane__action-button p-1 transition-colors"
                    title="Compare with current canvas draft"
                  >
                    <GitCompare className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setShowConfirm(true)}
                    className="log-pane__action-button p-1 transition-colors"
                    title="Open this snapshot in canvas preview"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </ThreadFrame>

      <CanvasCompareModal
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        title="Compare Snapshot vs Current Draft"
        diffs={diffs}
        additions={additions}
        deletions={deletions}
        primaryAction={{
          label: "Open in Canvas",
          onClick: handleOpenInCanvas,
          icon: <Eye className="h-4 w-4" />,
        }}
      />
    </>
  );
}
