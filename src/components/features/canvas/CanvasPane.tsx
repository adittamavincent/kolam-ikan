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

interface CanvasPaneProps {
  streamId: string;
}

export function CanvasPane({ streamId }: CanvasPaneProps) {
  const { canvasWidth } = useLayout();
  const { canvas, updateCanvas, isLoading } = useCanvas(streamId);
  const { targetBlockId, setTargetBlockId } = useCanvasScroll();
  const [editor, setEditor] = useState<BlockNoteEditorType | null>(null);
  const [highlightTerm] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState("");
  const markDirty = useCanvasDraft((s) => s.markDirty);
  const markClean = useCanvasDraft((s) => s.markClean);
  const hasReceivedFirstChange = useRef(false);
  const ignoreStylainChangeRef = useRef(false);
  const editorRef = useRef<BlockNoteEditorType | null>(null);
  const canvasRef = useRef<typeof canvas>(canvas);
  const pendingModeSyncTimerRef = useRef<number | null>(null);
  const preModeSwitchDocRef = useRef<string | null>(null);
  const targetModeRef = useRef<"A" | "B" | null>(null);
  const [isModeChanging, setIsModeChanging] = useState(false);
  const supabase = createClient();
  const queryClient = useQueryClient();

  const isVisible = canvasWidth > 0;

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    canvasRef.current = canvas;
  }, [canvas]);

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
      debounce((id: string, blocks: PartialBlock[]) => {
        updateCanvas.mutate({
          id,
          updates: { content_json: blocks as unknown as Json },
        });
      }, 2000),
    [updateCanvas],
  );

  const handleContentChange = useCallback(
    (blocks: PartialBlock[]) => {
      if (canvas) {
        // Skip the first change event (BlockNote fires on mount)
        if (!hasReceivedFirstChange.current) {
          hasReceivedFirstChange.current = true;
          return;
        }
        // Ignore events that don't actually change content. Some editor
        // events (selection/cursor/programmatic updates) will emit
        // onChange without modifying the document; avoid marking the
        // canvas dirty in that case.
        const prev = canvas.content_json as PartialBlock[] | undefined;
        if (
          prev &&
          Array.isArray(prev) &&
          prev.length === blocks.length &&
          JSON.stringify(prev) === JSON.stringify(blocks)
        ) {
          return;
        }

        markDirty(streamId);
        debouncedUpdate(canvas.id, blocks);
      }
    },
    [canvas, debouncedUpdate, markDirty, streamId],
  );

  // Reset first-change flag when canvas key changes (e.g., after restore)
  useEffect(() => {
    hasReceivedFirstChange.current = false;
  }, [canvas?.id, canvas?.updated_at]);

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

    const clearPendingModeSync = () => {
      if (pendingModeSyncTimerRef.current !== null) {
        window.clearTimeout(pendingModeSyncTimerRef.current);
        pendingModeSyncTimerRef.current = null;
      }
    };

    const persistEditorDocument = () => {
      const currentCanvas = canvasRef.current;
      const currentEditor = editorRef.current;
      if (!currentCanvas || !currentEditor) return false;

      const blocks = currentEditor.document;
      const prev = currentCanvas.content_json as PartialBlock[] | undefined;

      if (
        prev &&
        Array.isArray(prev) &&
        prev.length === blocks.length &&
        JSON.stringify(prev) === JSON.stringify(blocks)
      ) {
        return true;
      }

      queryClient.setQueryData(["canvas", streamId], (oldData: unknown) => {
        if (oldData && typeof oldData === "object" && "id" in oldData) {
          return {
            ...oldData,
            content_json: blocks as unknown as Json,
          };
        }
        return oldData;
      });

      markDirty(streamId);
      updateCanvas.mutate({
        id: currentCanvas.id,
        updates: { content_json: blocks as unknown as Json },
      });

      return true;
    };

    const scheduleModeSync = (attempt = 0) => {
      clearPendingModeSync();
      pendingModeSyncTimerRef.current = window.setTimeout(() => {
        const currentEditor = editorRef.current;
        const currentDocJson = currentEditor
          ? JSON.stringify(currentEditor.document)
          : null;
        const preSwitchJson = preModeSwitchDocRef.current;
        const stillPreSwitchDoc =
          targetModeRef.current === "A" &&
          preSwitchJson !== null &&
          currentDocJson !== null &&
          currentDocJson === preSwitchJson;

        if (stillPreSwitchDoc && attempt < 10) {
          scheduleModeSync(attempt + 1);
          return;
        }

        persistEditorDocument();
        pendingModeSyncTimerRef.current = null;
      }, 30);
    };

    const will = (event: Event) => {
      try {
        const detail = (event as CustomEvent<{ mode?: "A" | "B" }>).detail;
        targetModeRef.current = detail?.mode ?? null;
        preModeSwitchDocRef.current = editorRef.current
          ? JSON.stringify(editorRef.current.document)
          : null;
        clearPendingModeSync();
        ignoreStylainChangeRef.current = true;
        setIsModeChanging(true);
        // Commit any debounced pending content before mode teardown.
        debouncedUpdate.flush();
        debouncedUpdate.cancel();
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
        // B -> A must wait for BaseEditor to rebuild BlockNote from raw markdown.
        if (targetModeRef.current === "A") {
          scheduleModeSync(0);
        } else {
          persistEditorDocument();
        }
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
      clearPendingModeSync();
      window.removeEventListener("stylain_mode_will_change", will as EventListener);
      window.removeEventListener("stylain_mode_changed", handleStylainModeChange as EventListener);
    };
  }, [updateCanvas, markDirty, streamId, queryClient, debouncedUpdate]);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("kolam_canvas_state", {
        detail: {
          streamId,
          hasCanvas: Boolean(canvas),
          snapshotName,
          isSavingSnapshot: saveSnapshotMutation.isPending,
        },
      }),
    );
  }, [streamId, canvas, snapshotName, saveSnapshotMutation.isPending]);

  return (
    <div
      className={`canvas-pane bg-surface-default relative overflow-hidden z-20 ${
        isVisible ? "" : "pointer-events-none"
      }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        {/* Editor area */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-24">
          {canvas ? (
            <BlockNoteEditor
              key={`canvas-${canvas.id}-${canvas.updated_at ?? "na"}`}
              initialContent={canvas.content_json as unknown as PartialBlock[]}
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
    </div>
  );
}
