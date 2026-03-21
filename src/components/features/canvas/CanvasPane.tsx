"use client";

import { useLayout } from "@/lib/hooks/useLayout";
import { useCanvas } from "@/lib/hooks/useCanvas";
import { useCanvasScroll } from "@/lib/hooks/useCanvasScroll";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import { BlockNoteEditor } from "@/components/shared/BlockNoteEditor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash/debounce";
import {
  PartialBlock,
  BlockNoteEditor as BlockNoteEditorType,
} from "@blocknote/core";
import { Json } from "@/lib/types/database.types";
import { createClient } from "@/lib/supabase/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { areCanvasContentsEquivalent } from "@/lib/utils/canvasContent";
import {
  blocksToPlainText,
  CANVAS_PREVIEW_OPEN_EVENT,
  CanvasPreviewOpenDetail,
  lineDiff,
  saveCanvasPreviewStash,
} from "@/lib/utils/canvasPreview";
import { Eye, GitCompare, RotateCcw, Save, X } from "lucide-react";

interface CanvasPaneProps {
  streamId: string;
}

interface PreviewSession {
  versionId: string;
  versionName: string;
  versionCreatedAt: string | null;
  previousDraftContent: PartialBlock[] | null;
}

export function CanvasPane({ streamId }: CanvasPaneProps) {
  const { canvasWidth } = useLayout();
  const { canvas, updateCanvas, isLoading } = useCanvas(streamId);
  const { targetBlockId, setTargetBlockId } = useCanvasScroll();
  const [editor, setEditor] = useState<BlockNoteEditorType | null>(null);
  const [highlightTerm] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const markClean = useCanvasDraft((s) => s.markClean);
  const setLiveContent = useCanvasDraft((s) => s.setLiveContent);
  const clearLiveContent = useCanvasDraft((s) => s.clearLiveContent);
  const setStarterBaseline = useCanvasDraft((s) => s.setStarterBaseline);
  const setSyncStatus = useCanvasDraft((s) => s.setSyncStatus);
  const markDirty = useCanvasDraft((s) => s.markDirty);
  const setLocalStatus = useCanvasDraft((s) => s.setLocalStatus);
  const syncStatus = useCanvasDraft((s) => s.dbSyncStatusByStream[streamId]) || "idle";
  const localStatus = useCanvasDraft((s) => s.localSaveStatusByStream[streamId]) || "idle";
  const hasReceivedFirstChange = useRef(false);
  const ignoreStylainChangeRef = useRef(false);
  const [isModeChanging, setIsModeChanging] = useState(false);
  const [previewSession, setPreviewSession] = useState<PreviewSession | null>(null);
  const [editorSeed, setEditorSeed] = useState(0);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const liveContent = useCanvasDraft((s) => s.liveContentByStream[streamId]);
  const isPreviewing = previewSession !== null;
  const previewDiffs = useMemo(() => {
    if (!previewSession) return [];
    const before = blocksToPlainText(previewSession.previousDraftContent);
    const after = blocksToPlainText((liveContent ?? canvas?.content_json ?? null) as PartialBlock[] | null);
    return lineDiff(before, after);
  }, [previewSession, liveContent, canvas?.content_json]);
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

  const debouncedUpdate = useMemo(
    () =>
      debounce(async (id: string, blocks: PartialBlock[]) => {
        // Double check against latest DB version if needed, but for now 
        // rely on the caller sending only real changes.
        setSyncStatus(streamId, "syncing");
        setLocalStatus(streamId, "saving");
        try {
          await updateCanvas.mutateAsync({
            id,
            updates: { content_json: blocks as unknown as Json },
          });
          setSyncStatus(streamId, "synced");
          setLocalStatus(streamId, "saved");
          markClean(streamId);
          // After a short delay, move back to idle if no more changes
          setTimeout(() => {
            if (useCanvasDraft.getState().dbSyncStatusByStream[streamId] === "synced") {
              setSyncStatus(streamId, "idle");
            }
          }, 2000);
        } catch {
          setSyncStatus(streamId, "error");
          setLocalStatus(streamId, "error");
        }
      }, 2000),
    [updateCanvas, setSyncStatus, setLocalStatus, streamId, markClean],
  );

  const handleContentChange = useCallback(
    (blocks: PartialBlock[]) => {
      if (canvas) {
        // Skip the first change event (BlockNote fires on mount)
        if (!hasReceivedFirstChange.current) {
          hasReceivedFirstChange.current = true;
          return;
        }
        
        // Compare canonicalized content and ignore only volatile IDs.
        const prev = liveContent || canvas.content_json;
        if (areCanvasContentsEquivalent(prev, blocks)) {
          return;
        }

        setLiveContent(streamId, blocks);
        markDirty(streamId);
        if (isPreviewing) {
          setLocalStatus(streamId, "saved");
          return;
        }
        debouncedUpdate(canvas.id, blocks);
      }
    },
    [
      canvas,
      liveContent,
      setLiveContent,
      markDirty,
      streamId,
      debouncedUpdate,
      isPreviewing,
      setLocalStatus,
    ],
  );

  // Reset first-change flag when canvas ID changes (but NOT on updated_at)
  useEffect(() => {
    hasReceivedFirstChange.current = false;
  }, [canvas?.id]);

  // Sync initial content once if DB canvas is loaded but no local cache yet
  useEffect(() => {
    if (isPreviewing) return;
    if (canvas?.content_json) {
      if (!liveContent) {
        setLiveContent(streamId, (canvas.content_json as PartialBlock[] | null) ?? null);
      } else {
        // If we HAVE local content but it's different from DB, start background sync
        if (!areCanvasContentsEquivalent(canvas.content_json, liveContent)) {
           console.log(`[CanvasPane] detecting local change on mount, starting sync for ${streamId}`);
           debouncedUpdate(canvas.id, liveContent);
        }
      }
    }
  }, [
    canvas?.id,
    canvas?.content_json,
    liveContent,
    setLiveContent,
    streamId,
    debouncedUpdate,
    isPreviewing,
  ]);

  useEffect(() => {
    setStarterBaseline(
      streamId,
      canvas?.id ?? null,
      (canvas?.content_json as PartialBlock[] | null) ?? null,
    );
  }, [canvas?.id, canvas?.content_json, setStarterBaseline, streamId]);

  useEffect(() => {
    return () => {
      clearLiveContent(streamId);
      setStarterBaseline(streamId, null, null);
    };
  }, [clearLiveContent, setStarterBaseline, streamId]);

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
        content_json: canvas.content_json as unknown as Json,
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
      // Small timeout to ensure content is rendered
      const timer = setTimeout(() => {
        // Try to find the block in the document
        const block = editor.document.find((b) => b.id === targetBlockId);

        if (block) {
          // Set selection to the block
          editor.setTextCursorPosition(targetBlockId, "end");

          // Clear the target
          setTargetBlockId(null);
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [targetBlockId, editor, canvas, setTargetBlockId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const cancelCurrentWriteSession = () => {
      debouncedUpdate.cancel();
    };

    const will = () => {
      try {
        cancelCurrentWriteSession();
        ignoreStylainChangeRef.current = true;
        setIsModeChanging(true);
        // Clear after a short period in case no did event fires
        window.setTimeout(() => {
          try {
            ignoreStylainChangeRef.current = false;
            setIsModeChanging(false);
          } catch {}
        }, 300);
      } catch {}
    };

    const handleStylainModeChange = () => {
      try {
        cancelCurrentWriteSession();
        // Allow a small settling time before re-enabling
        window.setTimeout(() => {
          try {
            setIsModeChanging(false);
          } catch {}
        }, 50);
      } catch (error) {
        console.error("Error handling Stylain mode change:", error);
        setIsModeChanging(false);
      }
    };

    window.addEventListener("stylain_mode_will_change", will as EventListener);
    window.addEventListener("stylain_mode_changed", handleStylainModeChange as EventListener);

    return () => {
      cancelCurrentWriteSession();
      window.removeEventListener("stylain_mode_will_change", will as EventListener);
      window.removeEventListener("stylain_mode_changed", handleStylainModeChange as EventListener);
    };
  }, [debouncedUpdate]);

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

  const syncDirtyAgainstDb = useCallback(
    (nextContent: PartialBlock[] | null) => {
      if (areCanvasContentsEquivalent(nextContent, canvas?.content_json)) {
        markClean(streamId);
      } else {
        markDirty(streamId);
      }
    },
    [canvas?.content_json, markClean, markDirty, streamId],
  );

  const restorePreviousDraft = useCallback(() => {
    if (!previewSession) return;
    debouncedUpdate.cancel();
    setLiveContent(streamId, previewSession.previousDraftContent);
    setLocalStatus(streamId, "saved");
    setSyncStatus(streamId, "idle");
    syncDirtyAgainstDb(previewSession.previousDraftContent);
    hasReceivedFirstChange.current = false;
    setEditorSeed((seed) => seed + 1);
    setPreviewSession(null);
    setIsCompareOpen(false);
  }, [
    previewSession,
    debouncedUpdate,
    setLiveContent,
    streamId,
    setLocalStatus,
    setSyncStatus,
    syncDirtyAgainstDb,
  ]);

  const applyPreviewToCanvas = useCallback(async () => {
    if (!canvas || !previewSession) return;
    const nextContent =
      (useCanvasDraft.getState().liveContentByStream[streamId] ??
        canvas.content_json ??
        []) as PartialBlock[] | null;
    try {
      setSyncStatus(streamId, "syncing");
      await updateCanvas.mutateAsync({
        id: canvas.id,
        updates: { content_json: (nextContent ?? []) as unknown as Json },
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
    previewSession,
    streamId,
    updateCanvas,
    setSyncStatus,
    setLocalStatus,
    markClean,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOpenPreview = (event: Event) => {
      const detail = (event as CustomEvent<CanvasPreviewOpenDetail>).detail;
      if (!detail || detail.streamId !== streamId || !canvas) return;

      debouncedUpdate.cancel();

      const currentDraft = (liveContent ?? canvas.content_json ?? null) as
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
      });
      setLiveContent(streamId, detail.content ?? []);
      setLocalStatus(streamId, "saved");
      setSyncStatus(streamId, "idle");
      markDirty(streamId);
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
    liveContent,
    debouncedUpdate,
    setLiveContent,
    setLocalStatus,
    setSyncStatus,
    markDirty,
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
          <div className="mx-3 mt-2 mb-1 border border-amber-400/40 bg-amber-500/10 px-3 py-2">
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
            <BlockNoteEditor
              key={`canvas-${canvas.id}-${editorSeed}`}
              initialContent={(liveContent || canvas.content_json) as unknown as PartialBlock[]}
              onChange={handleContentChange}
              onEditorReady={setEditor}
              placeholder="Start writing on the canvas..."
              highlightTerm={highlightTerm ?? undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-text-muted text-sm">
              {isLoading && !isModeChanging ? "Loading canvas..." : "No canvas found"}
            </div>
          )}
        </div>
      </div>
      {isPreviewing && isCompareOpen && (
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
              {previewDiffs.length === 0 ? (
                <div className="px-4 py-6 text-center text-text-muted text-xs">
                  No differences.
                </div>
              ) : (
                previewDiffs.map((line, index) => (
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
          </div>
        </div>
      )}
    </div>
  );
}
