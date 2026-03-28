"use client";

import { useMemo, useState, useEffect } from "react";
import type { PartialBlock } from "@/lib/types/editor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import { useLogBranchContext } from "@/lib/hooks/useLogBranchContext";
import { normalizeCanvasContent } from "@/lib/utils/canvasContent";
import { contentToDiffText, lineDiff } from "@/lib/utils/canvasPreview";
import { CanvasDiffLines } from "@/components/shared/CanvasDiffLines";
import { CircleDot, GitCommitHorizontal, GitCompare, Loader2, X } from "lucide-react";
import {
  buildStoredContentPayload,
  storedContentToMarkdown,
  storedContentToBlocks,
} from "@/lib/content-protocol";

interface CanvasDraftCardProps {
  streamId: string;
}

export function CanvasDraftCard({ streamId }: CanvasDraftCardProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { canvas } = useCanvas(streamId);
  const liveContent = useCanvasDraft((s) => s.liveContentByStream[streamId] ?? null);
  const liveMarkdown = useCanvasDraft((s) => s.liveMarkdownByStream[streamId] ?? "");
  const markClean = useCanvasDraft((s) => s.markClean);
  const [snapshotName, setSnapshotName] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const { currentBranch, currentBranchHeadId } = useLogBranchContext(streamId);
  // Local override that represents the most-recently committed snapshot
  // This helps the UI immediately compare against the newly created
  // snapshot before the server-side `latestCanvasVersion` has refetched.
  const [committedBaseline, setCommittedBaseline] = useState<
    | {
        blocks: PartialBlock[] | null;
        markdown: string;
      }
    | undefined
  >(undefined);
  const canvasBlocks = useMemo(
    () => storedContentToBlocks(canvas ?? {}),
    [canvas],
  );
  const canvasMarkdown = useMemo(
    () => storedContentToMarkdown(canvas ?? {}),
    [canvas],
  );

  const { data: latestCanvasVersion, isLoading: isLatestVersionLoading } =
    useQuery({
      queryKey: ["canvas-latest-version", streamId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("canvas_versions")
          .select("id, content_json, raw_markdown, created_at")
          .eq("stream_id", streamId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      enabled: !!streamId,
    });

  const baselineContent =
    committedBaseline !== undefined
      ? committedBaseline.blocks
      : latestCanvasVersion
      ? storedContentToBlocks(latestCanvasVersion)
      : null;
  const baselineMarkdown =
    committedBaseline !== undefined
      ? committedBaseline.markdown
      : latestCanvasVersion
        ? storedContentToMarkdown(latestCanvasVersion)
        : "";
  const currentContent = (liveContent ?? canvasBlocks ?? null) as PartialBlock[] | null;
  const currentMarkdown = liveMarkdown || canvasMarkdown;
  const compareLabel = latestCanvasVersion ? "Latest Snapshot" : "Start Fresh";

  const hasDraftDiff = useMemo(() => {
    const baselineNormalized = normalizeCanvasContent(baselineContent);
    const currentNormalized = normalizeCanvasContent(currentContent);
    return baselineNormalized !== currentNormalized;
  }, [
    baselineContent,
    currentContent,
  ]);

  const diffs = useMemo(() => {
    const oldText = contentToDiffText(baselineContent, baselineMarkdown);
    const newText = contentToDiffText(currentContent, currentMarkdown);
    return lineDiff(oldText, newText);
  }, [baselineContent, baselineMarkdown, currentContent, currentMarkdown]);

  const additions = diffs.filter((d) => d.type === "add").length;
  const deletions = diffs.filter((d) => d.type === "del").length;

  // Clear the local committedBaseline override once the server's latest
  // snapshot matches the local committed content — avoids stale override.
  useEffect(() => {
    if (committedBaseline === undefined) return;
    const latestNormalized = normalizeCanvasContent(
      storedContentToBlocks(latestCanvasVersion ?? {}),
    );
    const committedNormalized = normalizeCanvasContent(committedBaseline.blocks);
    if (latestNormalized !== null && latestNormalized === committedNormalized) {
      // Defer clearing to avoid synchronous setState inside the effect body.
      // This prevents the lint rule complaining about cascading renders.
      setTimeout(() => setCommittedBaseline(undefined), 0);
    }
  }, [latestCanvasVersion, committedBaseline]);

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!canvas) throw new Error("No canvas found");
      const name =
        snapshotName.trim() || `Snapshot ${new Date().toLocaleString()}`;
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("canvas_versions").insert({
        canvas_id: canvas.id,
        stream_id: streamId,
        branch_name: currentBranch,
        source_entry_id: currentBranchHeadId,
        ...buildStoredContentPayload(
          liveContent ?? canvasBlocks,
          liveMarkdown || canvasMarkdown,
        ),
        name,
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const committedContent = liveContent ?? canvasBlocks;
      const committedMarkdown = liveMarkdown || canvasMarkdown;

      setSnapshotName("");
      setIsExpanded(false);

      // Local override so UI compares against the just-committed content
      setCommittedBaseline({
        blocks: committedContent,
        markdown: committedMarkdown,
      });
      markClean(streamId);

      queryClient.invalidateQueries({
        queryKey: ["canvas-versions", streamId],
      });
      queryClient.invalidateQueries({
        queryKey: ["canvas-latest-version", streamId],
      });
    },
  });

  if (isLatestVersionLoading) return null;
  if (!hasDraftDiff) return null;

  return (
    <div className="overflow-hidden border border-border-default bg-surface-subtle transition-colors">
      {/* Header */}
      <div className="flex items-center border-b border-border-subtle bg-surface-elevated px-2.5 py-2">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <span className="h-4 w-1 bg-action-primary-bg" aria-hidden="true" />
            <CircleDot className="h-3 w-3 animate-pulse text-action-primary-bg" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-action-primary-bg">
              Canvas Draft
            </span>
            <span className="text-[10px] text-text-muted">
              changes since {compareLabel.toLowerCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-2.5 py-2.5">
        {isExpanded ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsCompareOpen(true)}
              className="inline-flex items-center gap-1 border border-border-default bg-surface-default px-2 py-1 text-xs font-medium text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-default"
            >
              <GitCompare className="h-3 w-3" />
              Compare
            </button>
            <input
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="Snapshot name (optional)..."
              className="flex-1 border border-border-default bg-surface-default px-2 py-1 text-xs text-text-default outline-none placeholder:text-text-muted focus:border-border-strong"
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMutation.mutate();
                if (e.key === "Escape") setIsExpanded(false);
              }}
              autoFocus
            />
            <button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
              className="inline-flex items-center gap-1 bg-action-primary-bg px-2.5 py-1 text-xs font-semibold text-action-primary-text transition-colors hover:bg-action-primary-hover disabled:opacity-50"
            >
              {commitMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <GitCommitHorizontal className="h-3 w-3" />
              )}
              Commit
            </button>
            <button
              onClick={() => setIsExpanded(false)}
              className="border border-border-default bg-surface-default px-2 py-1 text-xs font-medium text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-default"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsCompareOpen(true)}
              className="inline-flex items-center gap-1.5 border border-border-default bg-surface-default px-2.5 py-1.5 text-[11px] font-semibold text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-default"
              title={`Compare against ${compareLabel.toLowerCase()}`}
            >
              <GitCompare className="h-3 w-3" />
              Compare
            </button>
            <button
              onClick={() => setIsExpanded(true)}
              className="inline-flex items-center gap-1.5 border border-action-primary-bg bg-surface-elevated px-2.5 py-1.5 text-[11px] font-semibold text-action-primary-bg transition-colors hover:bg-surface-hover hover:text-action-primary-hover"
            >
              <GitCommitHorizontal className="h-3 w-3" />
              Commit Snapshot
            </button>
          </div>
        )}
      </div>

      {isCompareOpen && (
        <div
          className="fixed inset-0 z-200 flex items-center justify-center bg-surface-dark p-4"
          onClick={() => setIsCompareOpen(false)}
        >
          <div
            className="relative flex max-h-[80vh] w-full max-w-3xl flex-col border border-border-default bg-surface-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border-default px-4 py-3">
              <div className="flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-text-muted" />
                <span className="text-sm font-semibold text-text-default">
                  Compare {compareLabel} vs Current Draft
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

            <div className="flex-1 overflow-y-auto font-mono text-[11px]">
              <CanvasDiffLines lines={diffs} />
            </div>

            <div className="flex items-center justify-end border-t border-border-default px-4 py-3">
              <button
                onClick={() => setIsCompareOpen(false)}
                className="border border-border-default px-3 py-1.5 text-xs font-medium text-text-subtle hover:bg-surface-subtle"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
