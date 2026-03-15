"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import { Json } from "@/lib/types/database.types";
import { CircleDot, GitCommitHorizontal, Loader2 } from "lucide-react";

interface CanvasDraftCardProps {
  streamId: string;
}

export function CanvasDraftCard({ streamId }: CanvasDraftCardProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { canvas } = useCanvas(streamId);
  const markClean = useCanvasDraft((s) => s.markClean);
  const isDirty = useCanvasDraft((s) => s.isDirty(streamId));
  const [snapshotName, setSnapshotName] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!canvas) throw new Error("No canvas found");
      const name =
        snapshotName.trim() || `Snapshot ${new Date().toLocaleString()}`;
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from("canvas_versions").insert({
        canvas_id: canvas.id,
        stream_id: streamId,
        content_json: canvas.content_json as unknown as Json,
        name,
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSnapshotName("");
      setIsExpanded(false);
      markClean(streamId);
      queryClient.invalidateQueries({
        queryKey: ["canvas-versions", streamId],
      });
    },
  });

  if (!isDirty) return null;

  return (
    <div className=" border border-dashed border-border-default border-border-default/50 bg-amber-500/4 overflow-hidden transition-all">
      {/* Header */}
      <div className="flex items-center px-2.5 py-1.5 bg-amber-500/6 border-b border-dashed border-border-default border-border-default/20">
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
              className="flex-1  border border-border-default bg-surface-subtle px-2 py-1 text-xs text-text-default focus:border-border-default focus: focus: focus:"
              onKeyDown={(e) => {
                if (e.key === "Enter") commitMutation.mutate();
                if (e.key === "Escape") setIsExpanded(false);
              }}
              autoFocus
            />
            <button
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
              className="inline-flex items-center gap-1  bg-action-primary-bg px-2.5 py-1 text-xs font-semibold text-action-primary-text hover:opacity-90 disabled:opacity-50"
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
            className="inline-flex items-center gap-1.5  border border-border-default/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <GitCommitHorizontal className="h-3 w-3" />
            Commit Snapshot
          </button>
        )}
      </div>
    </div>
  );
}
