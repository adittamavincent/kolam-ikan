"use client";

import { useMemo, useState } from "react";
import { CanvasVersion } from "@/lib/types";
import {
  Camera,
  Eye,
  GitCompare,
  RotateCcw,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import { PartialBlock } from "@blocknote/core";
import {
  blocksToPlainText,
  CANVAS_PREVIEW_OPEN_EVENT,
  lineDiff,
} from "@/lib/utils/canvasPreview";

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

  const isAIGenerated = version.name?.startsWith("AI Bridge") ?? false;
  const currentContent = (liveContent ?? canvas?.content_json ?? null) as
    | PartialBlock[]
    | null;
  const snapshotContent = (version.content_json ?? null) as PartialBlock[] | null;

  const diffs = useMemo(() => {
    const oldText = blocksToPlainText(currentContent);
    const newText = blocksToPlainText(snapshotContent);
    return lineDiff(oldText, newText);
  }, [currentContent, snapshotContent]);

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
        },
      }),
    );
    setShowConfirm(false);
    setIsCompareOpen(false);
  };

  return (
    <>
      <div className="relative group border border-dashed border-border-default/40 bg-action-primary-bg/3 overflow-hidden transition-all ">
        {/* Header */}
        <div className="flex items-center px-2.5 py-1.5 bg-action-primary-bg/5 border-b border-dashed border-border-default/20">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Camera className="h-3 w-3 text-action-primary-bg" />
              <span className="text-[10px] font-semibold text-action-primary-bg">
                Canvas Snapshot
              </span>
              {isAIGenerated ? (
                <span className="inline-flex items-center gap-0.5 border border-border-default/30 bg-action-primary-bg/10 px-1.5 py-0.5 text-[9px] font-semibold text-action-primary-bg">
                  <Sparkles className="h-2.5 w-2.5" />
                  AI
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 border border-border-default/60 bg-surface-subtle px-1.5 py-0.5 text-[9px] font-semibold text-text-muted">
                  <User className="h-2.5 w-2.5" />
                  Manual
                </span>
              )}
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
          className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setIsCompareOpen(false)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[80vh] flex flex-col border border-border-default bg-surface-default shadow-2xl"
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
              {diffs.length === 0 ? (
                <div className="px-4 py-6 text-center text-text-muted text-xs">
                  No differences.
                </div>
              ) : (
                diffs.map((line, index) => (
                  <div
                    key={`${line.type}-${index}`}
                    className={`flex gap-3 px-4 py-0.5 leading-5 ${
                      line.type === "add"
                        ? "bg-emerald-500/8 text-emerald-600 dark:text-emerald-400"
                        : line.type === "del"
                          ? "bg-rose-500/8 text-rose-600 dark:text-rose-400 line-through opacity-70"
                          : "text-text-subtle"
                    }`}
                  >
                    <span className="select-none w-3 shrink-0 text-text-muted opacity-60">
                      {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                    </span>
                    <span className="whitespace-pre-wrap wrap-break-word">
                      {line.text || " "}
                    </span>
                  </div>
                ))
              )}
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
