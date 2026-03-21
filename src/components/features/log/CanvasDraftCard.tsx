"use client";

import { useMemo, useState, useEffect } from "react";
import { PartialBlock } from "@blocknote/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import { Json } from "@/lib/types/database.types";
import { normalizeCanvasContent } from "@/lib/utils/canvasContent";
import { CircleDot, GitCommitHorizontal, Loader2 } from "lucide-react";

interface CanvasDraftCardProps {
  streamId: string;
}

export function CanvasDraftCard({ streamId }: CanvasDraftCardProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { canvas } = useCanvas(streamId);
  const liveContent = useCanvasDraft((s) => s.liveContentByStream[streamId] ?? null);
  const starterBaselineContent = useCanvasDraft(
    (s) => s.starterBaselineByStream[streamId]?.content ?? null,
  );
  const setStarterBaseline = useCanvasDraft((s) => s.setStarterBaseline);
  const markClean = useCanvasDraft((s) => s.markClean);
  const [snapshotName, setSnapshotName] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  // Local override that represents the most-recently committed snapshot
  // This helps the UI immediately compare against the newly created
  // snapshot before the server-side `latestCanvasVersion` has refetched.
  const [committedBaseline, setCommittedBaseline] = useState<
    PartialBlock[] | null | undefined
  >(undefined);

  const { data: latestCanvasVersion, isLoading: isLatestVersionLoading } =
    useQuery({
      queryKey: ["canvas-latest-version", streamId],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("canvas_versions")
          .select("id, content_json, created_at")
          .eq("stream_id", streamId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        return data;
      },
      enabled: !!streamId,
    });

  const hasDraftDiff = useMemo(() => {
    // Prefer the locally committed baseline override if present. This ensures
    // the UI flips to "committed" immediately after a successful commit.
    const baselineSource =
      committedBaseline !== undefined
        ? committedBaseline
        : latestCanvasVersion
        ? latestCanvasVersion.content_json
        : starterBaselineContent;

    const baselineNormalized = normalizeCanvasContent(baselineSource);
    const currentNormalized = normalizeCanvasContent(
      liveContent ?? canvas?.content_json,
    );
    return baselineNormalized !== currentNormalized;
  }, [
    committedBaseline,
    latestCanvasVersion,
    starterBaselineContent,
    liveContent,
    canvas?.content_json,
  ]);

  // Clear the local committedBaseline override once the server's latest
  // snapshot matches the local committed content — avoids stale override.
  useEffect(() => {
    if (committedBaseline === undefined) return;
    const latestNormalized = normalizeCanvasContent(
      latestCanvasVersion?.content_json,
    );
    const committedNormalized = normalizeCanvasContent(committedBaseline);
    if (latestNormalized !== null && latestNormalized === committedNormalized) {
      // Defer clearing to avoid synchronous setState inside the effect body.
      // This prevents the lint rule complaining about cascading renders.
      setTimeout(() => setCommittedBaseline(undefined), 0);
    }
  }, [latestCanvasVersion?.content_json, committedBaseline]);

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!canvas) throw new Error("No canvas found");
      const name =
        snapshotName.trim() || `Snapshot ${new Date().toLocaleString()}`;
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("canvas_versions").insert({
        canvas_id: canvas.id,
        stream_id: streamId,
        content_json:
          (liveContent ?? canvas.content_json) as unknown as Json,
        name,
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      const committedContent =
        liveContent ?? (canvas?.content_json as unknown as PartialBlock[] | null);

      setSnapshotName("");
      setIsExpanded(false);

      // Ensure the draft checker uses the latest committed snapshot immediately.
      setStarterBaseline(streamId, canvas?.id ?? null, committedContent);
      // Local override so UI compares against the just-committed content
      setCommittedBaseline(committedContent);
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
    <div className=" border border-dashed border-border-default/50 bg-amber-500/4 overflow-hidden transition-all">
      {/* Header */}
      <div className="flex items-center px-2.5 py-1.5 bg-amber-500/6 border-b border-dashed border-border-default/20">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <CircleDot className="h-3 w-3 text-amber-500 animate-pulse" />
            <span className="text-[10px] font-semibold text-amber-500">
              Canvas Draft
            </span>
            <span className="text-[10px] text-text-muted">
              — unsaved changes
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-2.5 py-2">
        {isExpanded ? (
          <div className="flex items-center gap-1.5">
            <input
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              placeholder="Snapshot name (optional)..."
              className="flex-1 border border-border-default bg-surface-subtle px-2 py-1 text-xs text-text-default focus:border-border-default focus: focus: focus:"
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMutation.mutate();
                if (e.key === "Escape") setIsExpanded(false);
              }}
              autoFocus
            />
            <button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
              className="inline-flex items-center gap-1 bg-action-primary-bg px-2.5 py-1 text-xs font-semibold text-action-primary-text hover:opacity-90 disabled:opacity-50"
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
              className=" border border-border-default px-2 py-1 text-xs text-text-subtle hover:bg-surface-subtle"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center gap-1.5 border border-border-default/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <GitCommitHorizontal className="h-3 w-3" />
            Commit Snapshot
          </button>
        )}
      </div>
    </div>
  );
}
