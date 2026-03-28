"use client";

import { useLayout } from "@/lib/hooks/useLayout";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasScroll } from "@/lib/hooks/useCanvasScroll";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import { useLogBranchContext } from "@/lib/hooks/useLogBranchContext";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/shared/MarkdownEditor";
import { CanvasDiffLines } from "@/components/shared/CanvasDiffLines";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash/debounce";
import type { PartialBlock } from "@/lib/types/editor";
import { createClient } from "@/lib/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { areCanvasContentsEquivalent } from "@/lib/utils/canvasContent";
import {
  CANVAS_PREVIEW_OPEN_EVENT,
  CanvasPreviewOpenDetail,
  contentToDiffText,
  lineDiff,
  saveCanvasPreviewStash,
} from "@/lib/utils/canvasPreview";
import { Eye, GitCompare, RotateCcw, Save, X } from "lucide-react";
import {
  blocksToStoredMarkdown,
  buildStoredContentPayload,
  storedContentToMarkdown,
  storedContentToBlocks,
} from "@/lib/content-protocol";

interface CanvasPaneProps {
  streamId: string;
}

interface PreviewSession {
  versionId: string;
  versionName: string;
  versionCreatedAt: string | null;
  previousDraftContent: PartialBlock[] | null;
  previousDraftMarkdown: string;
}

export function CanvasPane({ streamId }: CanvasPaneProps) {
  const { canvasWidth } = useLayout();
  const { canvas, updateCanvas, isLoading } = useCanvas(streamId);
  const { targetBlockId, setTargetBlockId } = useCanvasScroll();
  const [editor, setEditor] = useState<MarkdownEditorHandle | null>(null);
  const [highlightTerm] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const markClean = useCanvasDraft((s) => s.markClean);
  const setLiveContent = useCanvasDraft((s) => s.setLiveContent);
  const setLiveMarkdown = useCanvasDraft((s) => s.setLiveMarkdown);
  const setSyncStatus = useCanvasDraft((s) => s.setSyncStatus);
  const markDirty = useCanvasDraft((s) => s.markDirty);
  const setLocalStatus = useCanvasDraft((s) => s.setLocalStatus);
  const syncStatus = useCanvasDraft((s) => s.dbSyncStatusByStream[streamId]) || "idle";
  const localStatus = useCanvasDraft((s) => s.localSaveStatusByStream[streamId]) || "idle";
  const hasReceivedFirstChange = useRef(false);
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [editorSeed, setEditorSeed] = useState(0);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const { currentBranch, currentBranchHeadId } = useLogBranchContext(streamId);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const debouncedUpdateRef = useRef<
    ReturnType<typeof debounce<(id: string, blocks: PartialBlock[], markdown: string) => void>> | null
  >(null);
  const liveContent = useCanvasDraft((s) => s.liveContentByStream[streamId]);
  const liveMarkdown = useCanvasDraft((s) => s.liveMarkdownByStream[streamId]) || "";
  const canvasBlocks = useMemo(
    () => storedContentToBlocks(canvas ?? {}),
    [canvas],
  );
  const canvasMarkdown = useMemo(
    () => storedContentToMarkdown(canvas ?? {}),
    [canvas],
  );
  const isPreviewing = previewSession !== null;
  const previewDiffs = useMemo(() => {
    if (!previewSession) return [];
    const before = contentToDiffText(
      previewSession.previousDraftContent,
      previewSession.previousDraftMarkdown,
    );
    const after = contentToDiffText(liveContent ?? canvasBlocks, liveMarkdown || canvasMarkdown);
    return lineDiff(before, after);
  }, [previewSession, liveContent, liveMarkdown, canvasBlocks, canvasMarkdown]);
  const previewAdditions = previewDiffs.filter((line) => line.type === "add").length;
  const previewDeletions = previewDiffs.filter((line) => line.type === "del").length;

  const isVisible = canvasWidth > 0;

  // Calculate smooth animation - slides in from right with decompression
  const containerStyle = {
    width: `${canvasWidth}%`,
    maxWidth: `${canvasWidth}%`,
    flex: `0 0 ${canvasWidth}%`,
    minWidth: "0px",
    opacity: isVisible ? 1 : 0,
    transition: "all 400ms cubic-bezier(0.4, 0, 0.2, 1)",
  };

  const contentStyle = {
    transform: isVisible
      ? "translateX(0) scaleX(1)"
      : "translateX(100%) scaleX(0.95)",
    transformOrigin: "left center",
    transition: "transform 400ms cubic-bezier(0.4, 0, 0.2, 1)",
  };

  useEffect(() => {
    const debounced = debounce(
      async (id: string, blocks: PartialBlock[], markdown: string) => {
        // Local persistence happens in the draft store; this status tracks DB sync only.
        setSyncStatus(streamId, "syncing");
        try {
          await updateCanvas.mutateAsync({
            id,
            updates: buildStoredContentPayload(blocks, markdown),
          });
          setSyncStatus(streamId, "synced");
          markClean(streamId);
          // After a short delay, move back to idle if no more changes
          setTimeout(() => {
            if (useCanvasDraft.getState().dbSyncStatusByStream[streamId] === "synced") {
              setSyncStatus(streamId, "idle");
            }
          }, 2000);
        } catch {
          setSyncStatus(streamId, "error");
        }
      },
      1000,
    );

    debouncedUpdateRef.current = debounced;

    return () => {
      debounced.cancel();
      if (debouncedUpdateRef.current === debounced) {
        debouncedUpdateRef.current = null;
      }
    };
  }, [markClean, setSyncStatus, streamId, updateCanvas]);

  const syncDirtyAgainstDb = useCallback(
    (nextContent: PartialBlock[] | null, nextMarkdown?: string) => {
      const markdownToCompare =
        typeof nextMarkdown === "string" ? nextMarkdown : liveMarkdown;
      const matchesBlocks = areCanvasContentsEquivalent(nextContent, canvasBlocks);
      const matchesMarkdown = markdownToCompare === canvasMarkdown;

      if (matchesBlocks && matchesMarkdown) {
        markClean(streamId);
      } else {
        markDirty(streamId);
      }
    },
    [canvasBlocks, canvasMarkdown, liveMarkdown, markClean, markDirty, streamId],
  );

  const handleContentChange = useCallback(
    (blocks: PartialBlock[], markdown: string) => {
      if (canvas) {
        // Skip the first change event triggered on mount.
        if (!hasReceivedFirstChange.current) {
          hasReceivedFirstChange.current = true;
          return;
        }

        const previousMarkdown = liveMarkdown || canvasMarkdown;
        const markdownChanged = markdown !== previousMarkdown;
        // Compare canonicalized content and ignore only volatile IDs.
        const prev = liveContent || canvasBlocks;
        if (areCanvasContentsEquivalent(prev, blocks) && !markdownChanged) {
          syncDirtyAgainstDb(blocks, markdown);
          return;
        }

        setLiveContent(streamId, blocks);
        setLiveMarkdown(streamId, markdown);
        syncDirtyAgainstDb(blocks, markdown);
        if (isPreviewing) {
          setLocalStatus(streamId, "saved");
          return;
        }
        debouncedUpdateRef.current?.(canvas.id, blocks, markdown);
      }
    },
    [
      canvas,
      canvasBlocks,
      canvasMarkdown,
      liveContent,
      liveMarkdown,
      setLiveContent,
      setLiveMarkdown,
      streamId,
      isPreviewing,
      setLocalStatus,
      syncDirtyAgainstDb,
    ],
  );

  // Reset first-change flag when canvas ID changes (but NOT on updated_at)
  useEffect(() => {
    hasReceivedFirstChange.current = false;
  }, [canvas?.id]);

  // Sync initial content once if DB canvas is loaded but no local cache yet
  useEffect(() => {
    if (isPreviewing) return;
    if (canvas) {
      if (!liveContent) {
        setLiveContent(streamId, canvasBlocks);
        syncDirtyAgainstDb(canvasBlocks, canvasMarkdown);
      } else {
        // If we HAVE local content but it's different from DB, start background sync
        if (!areCanvasContentsEquivalent(canvasBlocks, liveContent)) {
           syncDirtyAgainstDb(liveContent, liveMarkdown || canvasMarkdown);
           console.log(`[CanvasPane] detecting local change on mount, starting sync for ${streamId}`);
           debouncedUpdateRef.current?.(
             canvas.id,
             liveContent,
             liveMarkdown || canvasMarkdown,
           );
        } else {
           syncDirtyAgainstDb(liveContent, liveMarkdown || canvasMarkdown);
        }
      }
    } else {
      syncDirtyAgainstDb(liveContent ?? null, "");
    }
  }, [
    canvas,
    canvas?.id,
    canvasBlocks,
    canvasMarkdown,
    liveContent,
    liveMarkdown,
    setLiveContent,
    streamId,
    isPreviewing,
    syncDirtyAgainstDb,
  ]);

  useEffect(() => {
    return () => {
      debouncedUpdateRef.current?.flush();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const flushPendingCanvasSave = () => {
      debouncedUpdateRef.current?.flush();
    };

    window.addEventListener("beforeunload", flushPendingCanvasSave);
    window.addEventListener("pagehide", flushPendingCanvasSave);

    return () => {
      window.removeEventListener("beforeunload", flushPendingCanvasSave);
      window.removeEventListener("pagehide", flushPendingCanvasSave);
    };
  }, []);

  const saveSnapshotMutation = useMutation({
    mutationFn: async (nameOverride?: string) => {
      if (!canvas) return;
      const name =
        (nameOverride ?? snapshotName).trim() ||
        `Snapshot ${new Date().toLocaleString()}`;
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
      setSnapshotName("");
      markClean(streamId);
      queryClient.invalidateQueries({
        queryKey: ["canvas-versions", streamId],
      });
      queryClient.invalidateQueries({
        queryKey: ["canvas-latest-version", streamId],
      });
    },
  });

  const handleSaveSnapshot = useCallback(
    (nameOverride?: string) => {
      saveSnapshotMutation.mutate(nameOverride);
    },
    [saveSnapshotMutation],
  );

  // Handle auto-scroll to target block
  useEffect(() => {
    if (targetBlockId && editor && canvas) {
      const timer = setTimeout(() => {
        editor.focus();
        setTargetBlockId(null);
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [targetBlockId, editor, canvas, setTargetBlockId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onSnapshotName = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      if (typeof detail?.name === "string") {
        setSnapshotName(detail.name);
      }
    };

    const onSaveSnapshot = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string }>).detail;
      handleSaveSnapshot(detail?.name);
    };

    window.addEventListener(
      "kolam_header_canvas_snapshot_name",
      onSnapshotName as EventListener,
    );
    window.addEventListener(
      "kolam_header_canvas_save_snapshot",
      onSaveSnapshot as EventListener,
    );

    return () => {
      window.removeEventListener(
        "kolam_header_canvas_snapshot_name",
        onSnapshotName as EventListener,
      );
      window.removeEventListener(
        "kolam_header_canvas_save_snapshot",
        onSaveSnapshot as EventListener,
      );
    };
  }, [handleSaveSnapshot]);

  const restorePreviousDraft = useCallback(() => {
    if (!previewSession) return;
    debouncedUpdateRef.current?.cancel();
    setLiveContent(streamId, previewSession.previousDraftContent);
    setLiveMarkdown(streamId, previewSession.previousDraftMarkdown);
    setLocalStatus(streamId, "saved");
    setSyncStatus(streamId, "idle");
    syncDirtyAgainstDb(
      previewSession.previousDraftContent,
      previewSession.previousDraftMarkdown,
    );
    hasReceivedFirstChange.current = false;
    setEditorSeed((seed) => seed + 1);
    setPreviewSession(null);
    setIsCompareOpen(false);
  }, [
    previewSession,
    setLiveContent,
    setLiveMarkdown,
    streamId,
    setLocalStatus,
    setSyncStatus,
    syncDirtyAgainstDb,
  ]);

  const applyPreviewToCanvas = useCallback(async () => {
    if (!canvas || !previewSession) return;
    const nextContent =
      (useCanvasDraft.getState().liveContentByStream[streamId] ??
        canvasBlocks ??
        []) as PartialBlock[] | null;
    try {
      setSyncStatus(streamId, "syncing");
      await updateCanvas.mutateAsync({
        id: canvas.id,
        updates: buildStoredContentPayload(
          nextContent ?? [],
          liveMarkdown || canvasMarkdown,
        ),
      });
      setSyncStatus(streamId, "synced");
      setLocalStatus(streamId, "saved");
      markClean(streamId);
      setPreviewSession(null);
      setIsCompareOpen(false);
    } catch {
      setSyncStatus(streamId, "error");
      setLocalStatus(streamId, "error");
    }
  }, [
    canvas,
    canvasBlocks,
    canvasMarkdown,
    previewSession,
    streamId,
    updateCanvas,
    liveMarkdown,
    setSyncStatus,
    setLocalStatus,
    markClean,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOpenPreview = (event: Event) => {
      const detail = (event as CustomEvent<CanvasPreviewOpenDetail>).detail;
      if (!detail || detail.streamId !== streamId || !canvas) return;

      debouncedUpdateRef.current?.cancel();

      const currentDraft = (liveContent ?? canvasBlocks ?? null) as
        | PartialBlock[]
        | null;

      saveCanvasPreviewStash(streamId, {
        streamId,
        snapshotId: detail.versionId,
        snapshotName: detail.versionName,
        snapshotCreatedAt: detail.versionCreatedAt ?? null,
        stashedAt: new Date().toISOString(),
        draftContent: currentDraft,
      });

      setPreviewSession({
        versionId: detail.versionId,
        versionName: detail.versionName,
        versionCreatedAt: detail.versionCreatedAt ?? null,
        previousDraftContent: currentDraft,
        previousDraftMarkdown: liveMarkdown || canvasMarkdown,
      });
      setLiveContent(streamId, detail.content ?? []);
      setLiveMarkdown(
        streamId,
        detail.markdown ?? blocksToStoredMarkdown(detail.content ?? []),
      );
      setLocalStatus(streamId, "saved");
      setSyncStatus(streamId, "idle");
      syncDirtyAgainstDb(
        detail.content ?? [],
        detail.markdown ?? blocksToStoredMarkdown(detail.content ?? []),
      );
      hasReceivedFirstChange.current = false;
      setEditorSeed((seed) => seed + 1);
    };

    window.addEventListener(CANVAS_PREVIEW_OPEN_EVENT, onOpenPreview as EventListener);
    return () => {
      window.removeEventListener(
        CANVAS_PREVIEW_OPEN_EVENT,
        onOpenPreview as EventListener,
      );
    };
  }, [
    streamId,
    canvas,
    canvasBlocks,
    canvasMarkdown,
    liveContent,
    liveMarkdown,
    setLiveContent,
    setLiveMarkdown,
    setLocalStatus,
    setSyncStatus,
    syncDirtyAgainstDb,
  ]);

  const isCanvasDirty = useCanvasDraft((s) => s.dirtyStreams.has(streamId));
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("kolam_canvas_state", {
        detail: {
          streamId,
          hasCanvas: Boolean(canvas),
          snapshotName,
          isSavingSnapshot: saveSnapshotMutation.isPending,
          syncStatus,
          localStatus,
          isDirty: isCanvasDirty,
        },
      }),
    );
  }, [streamId, canvas, snapshotName, saveSnapshotMutation.isPending, syncStatus, isCanvasDirty, localStatus]);

  return (
    <div
      className={`canvas-pane bg-surface-default relative overflow-hidden z-20 ${
        isVisible ? "" : "pointer-events-none"
      }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        {isPreviewing && (
          <div className="mx-3 mt-2 mb-1 border border-amber-400/40 bg-amber-950 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  <Eye className="h-3.5 w-3.5" />
                  Snapshot Preview
                </div>
                <div className="truncate text-xs text-text-default">
                  {previewSession?.versionName || "Untitled Snapshot"}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setIsCompareOpen(true)}
                  className="inline-flex items-center gap-1 border border-border-default px-2 py-1 text-[11px] text-text-subtle hover:bg-surface-subtle"
                >
                  <GitCompare className="h-3 w-3" />
                  Compare
                </button>
                <button
                  onClick={restorePreviousDraft}
                  className="inline-flex items-center gap-1 border border-border-default px-2 py-1 text-[11px] text-text-subtle hover:bg-surface-subtle"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore Draft
                </button>
                <button
                  onClick={() => {
                    void applyPreviewToCanvas();
                  }}
                  className="inline-flex items-center gap-1 bg-action-primary-bg px-2 py-1 text-[11px] font-semibold text-action-primary-text hover:opacity-90"
                >
                  <Save className="h-3 w-3" />
                  Apply to Canvas
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Editor area */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-24">
          {canvas ? (
            <MarkdownEditor
              key={`canvas-${canvas.id}-${editorSeed}`}
              initialContent={liveContent || canvasBlocks}
              initialMarkdown={liveMarkdown || canvasMarkdown}
              onChange={handleContentChange}
              onEditorReady={setEditor}
              placeholder="Start writing on the canvas..."
              highlightTerm={highlightTerm ?? undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-text-muted text-sm">
              {isLoading ? "Loading canvas..." : "No canvas found"}
            </div>
          )}
        </div>
      </div>
      {isPreviewing && isCompareOpen && (
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
                  Preview Compare
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-emerald-500">
                  +{previewAdditions}
                </span>
                <span className="text-[11px] font-mono text-rose-500">
                  -{previewDeletions}
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
              <CanvasDiffLines lines={previewDiffs} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
