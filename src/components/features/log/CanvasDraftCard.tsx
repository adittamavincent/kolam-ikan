"use client";

import { useMemo, useState, useEffect } from "react";
import type { PartialBlock } from "@/lib/types/editor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import { useCanvasDiff } from "@/lib/hooks/useCanvasDiff";
import { useLogBranchContext } from "@/lib/hooks/useLogBranchContext";
import type { CanvasVersion } from "@/lib/types";
import { normalizeCanvasContent } from "@/lib/utils/canvasContent";
import { CanvasCompareModal } from "@/components/shared/CanvasCompareModal";
import { CircleDot, GitCommitHorizontal, GitCompare, Loader2 } from "lucide-react";
import {
  buildStoredContentPayload,
  storedContentToMarkdown,
  storedContentToBlocks,
} from "@/lib/content-protocol";
import { isSupabaseSchemaMismatchError } from "@/lib/supabase/schema-compat";

interface CanvasDraftCardProps {
  streamId: string;
}

type CanvasVersionPreview = Pick<
  CanvasVersion,
  "id" | "content_json" | "raw_markdown" | "created_at"
>;

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
        const buildCanvasVersionQuery = (selectClause: string) =>
          supabase
            .from("canvas_versions")
            .select(selectClause)
            .eq("stream_id", streamId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        const { data, error } = await buildCanvasVersionQuery(
          "id, content_json, raw_markdown, created_at",
        );

        if (
          error &&
          isSupabaseSchemaMismatchError(error, ["raw_markdown"])
        ) {
          const fallback = await buildCanvasVersionQuery(
            "id, content_json, created_at",
          );
          if (fallback.error) throw fallback.error;
          return (fallback.data ?? null) as CanvasVersionPreview | null;
        }

        if (error) throw error;
        return (data ?? null) as CanvasVersionPreview | null;
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

  const { diffs, additions, deletions } = useCanvasDiff({
    oldContent: baselineContent,
    oldMarkdown: baselineMarkdown,
    newContent: currentContent,
    newMarkdown: currentMarkdown,
  });

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
    <div className="overflow-hidden bg-surface-subtle transition-colors">
      {/* Header */}
      <div className="flex items-center bg-surface-elevated">
        <div className="flex h-6 w-full items-center">
          <div className="h-4 w-4"/>
          <div className="flex items-center">
            <CircleDot className="h-4 w-4 animate-pulse text-action-primary-bg" />
            <span className="uppercase tracking-[0.14em] text-action-primary-bg">
              Canvas Draft
            </span>
            <span className="text-text-muted">
              changes since {compareLabel.toLowerCase()}
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="h-6">
        {isExpanded ? (
          <div className="flex h-full items-stretch">
            <button
              onClick={() => setIsCompareOpen(true)}
              className="inline-flex h-full items-center text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-default"
            >
              <GitCompare className="h-4 w-4" />
              Compare
            </button>
            <input
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="Snapshot name (optional)..."
              className="flex-1 bg-surface-default text-text-default outline-none placeholder:text-text-muted focus:border-border-strong"
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMutation.mutate();
                if (e.key === "Escape") setIsExpanded(false);
              }}
              autoFocus
            />
            <button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
              className="inline-flex h-full items-center text-action-primary-bg transition-colors hover:bg-surface-hover hover:text-action-primary-hover disabled:opacity-50"
            >
              {commitMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GitCommitHorizontal className="h-4 w-4" />
              )}
              Commit
            </button>
            <button
              onClick={() => setIsExpanded(false)}
              className="inline-flex h-full items-center text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-default"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex h-full items-stretch">
            <button
              onClick={() => setIsCompareOpen(true)}
              className="inline-flex h-full items-center text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-default"
              title={`Compare against ${compareLabel.toLowerCase()}`}
            >
              <GitCompare className="h-4 w-4" />
              Compare
            </button>
            <button
              onClick={() => setIsExpanded(true)}
              className="inline-flex h-full items-center text-action-primary-bg transition-colors hover:bg-surface-hover hover:text-action-primary-hover"
            >
              <GitCommitHorizontal className="h-4 w-4" />
              Commit Snapshot
            </button>
          </div>
        )}
      </div>

      <CanvasCompareModal
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        title={`Compare ${compareLabel} vs Current Draft`}
        diffs={diffs}
        additions={additions}
        deletions={deletions}
      />
    </div>
  );
}
