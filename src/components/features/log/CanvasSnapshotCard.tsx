"use client";

import { useMemo, useState } from "react";
import { CanvasVersion } from "@/lib/types";
import {
  Camera,
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
import {
  CANVAS_PREVIEW_OPEN_EVENT,
  contentToDiffText,
  lineDiff,
} from "@/lib/utils/canvasPreview";
import { storedContentToBlocks, storedContentToMarkdown } from "@/lib/content-protocol";

interface CanvasSnapshotCardProps {
  version: CanvasVersion;
  streamId: string;
}

export function CanvasSnapshotCard({
  version,
  streamId,
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
          versionName: version.name || "Untitled Snapshot",
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
      <div className="relative group border border-dashed border-violet-800 bg-violet-950 overflow-hidden transition-all ">
        {/* Header */}
        <div className="flex items-center px-2.5 py-1.5 bg-violet-950 border-b border-dashed border-violet-800">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Camera className="h-3 w-3 text-violet-500" />
              <span className="text-[10px] font-semibold text-violet-500">
                Canvas Snapshot
              </span>
              {isAIGenerated ? (
                <span className="inline-flex items-center gap-0.5 border border-violet-800 bg-violet-950 px-1.5 py-0.5 text-[9px] font-semibold text-violet-500">
                  <Sparkles className="h-2.5 w-2.5" />
                  AI
                </span>
              ) : null}
            </div>
            <span className="text-[10px] font-medium text-text-subtle font-mono">
              {new Date(version.created_at || "").toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="px-2.5 py-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-text-default truncate">
                {version.name || "Untitled Snapshot"}
              </div>
              {version.summary && (
                <div className="text-[10px] text-text-muted mt-0.5 line-clamp-2">
                  {version.summary}
                </div>
              )}
            </div>
            <div className="shrink-0 ml-2">
              {showConfirm ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleOpenInCanvas}
                    className=" bg-action-primary-bg px-2 py-0.5 text-[10px] font-semibold text-action-primary-text hover:opacity-90"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => setShowConfirm(false)}
                    className=" border border-border-default px-2 py-0.5 text-[10px] font-semibold text-text-subtle hover:bg-surface-subtle"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={() => setIsCompareOpen(true)}
                    className=" p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
                    title="Compare with current canvas draft"
                  >
                    <GitCompare className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setShowConfirm(true)}
                    className=" p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
                    title="Open this snapshot in canvas preview"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

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
                <span className="text-[11px] font-mono text-emerald-500">
                  +{additions}
                </span>
                <span className="text-[11px] font-mono text-rose-500">
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
                className="inline-flex items-center gap-1.5 bg-action-primary-bg px-3 py-1.5 text-xs font-semibold text-action-primary-text hover:opacity-90"
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
