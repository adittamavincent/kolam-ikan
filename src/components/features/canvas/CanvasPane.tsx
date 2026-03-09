'use client';

import { useLayout } from '@/lib/hooks/useLayout';
import { useCanvas } from '@/lib/hooks/useCanvas';
import { useCanvasScroll } from '@/lib/hooks/useCanvasScroll';
import { useCanvasDraft } from '@/lib/hooks/useCanvasDraft';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import debounce from 'lodash/debounce';
import { PartialBlock, BlockNoteEditor as BlockNoteEditorType } from '@blocknote/core';
import { Json } from '@/lib/types/database.types';
import { createClient } from '@/lib/supabase/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, PanelLeft, Globe } from 'lucide-react';
import { useSidebar } from '@/lib/hooks/useSidebar';
import { useStream } from '@/lib/hooks/useStream';

interface CanvasPaneProps {
  streamId: string;
}

export function CanvasPane({ streamId }: CanvasPaneProps) {
  const { canvasWidth } = useLayout();
  const { visible: sidebarVisible, show: showSidebar } = useSidebar();
  const { stream } = useStream(streamId);
  const { canvas, updateCanvas, isLoading } = useCanvas(streamId);
  const { targetBlockId, setTargetBlockId } = useCanvasScroll();
  const [editor, setEditor] = useState<BlockNoteEditorType | null>(null);
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);
  const supabase = createClient();
  const queryClient = useQueryClient();
  const markDirty = useCanvasDraft((s) => s.markDirty);
  const markClean = useCanvasDraft((s) => s.markClean);
  const hasReceivedFirstChange = useRef(false);

  const isVisible = canvasWidth > 0;

  // Calculate smooth animation - slides in from right with decompression
  const containerStyle = {
    width: `${canvasWidth}%`,
    minWidth: '0px',
    opacity: isVisible ? 1 : 0,
    transition: 'all 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const contentStyle = {
    transform: isVisible ? 'translateX(0) scaleX(1)' : 'translateX(100%) scaleX(0.95)',
    transformOrigin: 'left center',
    transition: 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const debouncedUpdate = useMemo(
    () =>
      debounce((id: string, blocks: PartialBlock[]) => {
        updateCanvas.mutate({ id, updates: { content_json: blocks as unknown as Json } });
      }, 2000),
    [updateCanvas]
  );

  const handleContentChange = useCallback(
    (blocks: PartialBlock[]) => {
      if (canvas) {
        // Skip the first change event (BlockNote fires on mount)
        if (!hasReceivedFirstChange.current) {
          hasReceivedFirstChange.current = true;
          return;
        }
        markDirty(streamId);
        debouncedUpdate(canvas.id, blocks);
      }
    },
    [canvas, debouncedUpdate, markDirty, streamId]
  );

  // Reset first-change flag when canvas key changes (e.g., after restore)
  useEffect(() => {
    hasReceivedFirstChange.current = false;
  }, [canvas?.id, canvas?.updated_at]);

  const saveSnapshotMutation = useMutation({
    mutationFn: async () => {
      if (!canvas) return;
      const name = snapshotName.trim() || `Snapshot ${new Date().toLocaleString()}`;
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await supabase.from('canvas_versions').insert({
        canvas_id: canvas.id,
        stream_id: streamId,
        content_json: canvas.content_json as unknown as Json,
        name,
        created_by: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setSnapshotName('');
      setShowNameInput(false);
      markClean(streamId);
      queryClient.invalidateQueries({ queryKey: ['canvas-versions', streamId] });
    },
  });

  const handleSaveSnapshot = () => {
    saveSnapshotMutation.mutate();
  };

  // Handle auto-scroll to target block
  useEffect(() => {
    if (targetBlockId && editor && canvas) {
      // Small timeout to ensure content is rendered
      const timer = setTimeout(() => {
        // Try to find the block in the document
        const block = editor.document.find((b) => b.id === targetBlockId);

        if (block) {
          // Set selection to the block
          editor.setTextCursorPosition(targetBlockId, 'end');

          // Clear the target
          setTargetBlockId(null);
        }
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [targetBlockId, editor, canvas, setTargetBlockId]);

  useEffect(() => {
    const raw = sessionStorage.getItem('kolam_search_highlight');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as {
        term: string;
        target: 'log' | 'canvas';
        streamId?: string;
      };
      if (payload.target === 'canvas' && payload.streamId === streamId) {
        setHighlightTerm(payload.term);
        sessionStorage.removeItem('kolam_search_highlight');
      }
    } finally {
    }
  }, [streamId]);

  return (
    <div
      className={`bg-surface-default relative overflow-hidden z-20 ${isVisible ? '' : 'pointer-events-none'
        }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        {/* Compact toolbar */}
        {canvas && (
          <div className="border-b border-border-subtle bg-surface-default shrink-0">
            <div className="px-2 py-1.5">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  {canvasWidth === 100 && !sidebarVisible && (
                    <button
                      onClick={showSidebar}
                      className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg"
                      title="Show sidebar"
                    >
                      <PanelLeft className="h-4 w-4" />
                    </button>
                  )}
                  {canvasWidth === 100 && stream?.stream_kind === 'GLOBAL' && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-action-primary-bg/30 bg-action-primary-bg/10 px-2 py-1 text-[11px] font-semibold text-action-primary-bg">
                      <Globe className="h-3 w-3" />
                      Global
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                {showNameInput ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      value={snapshotName}
                      onChange={(e) => setSnapshotName(e.target.value)}
                      placeholder="Snapshot name..."
                      className="flex-1 rounded-md border border-border-default bg-surface-subtle px-2 py-1 text-xs text-text-default focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveSnapshot();
                        if (e.key === 'Escape') setShowNameInput(false);
                      }}
                      autoFocus
                    />
                    <button
                      onClick={handleSaveSnapshot}
                      disabled={saveSnapshotMutation.isPending}
                      className="rounded-md bg-action-primary-bg px-2 py-1 text-xs text-action-primary-text hover:opacity-90 disabled:opacity-50"
                    >
                      {saveSnapshotMutation.isPending ? '...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setShowNameInput(false)}
                      className="rounded-md border border-border-default px-2 py-1 text-xs text-text-subtle hover:bg-surface-subtle"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNameInput(true)}
                    className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default disabled:opacity-50"
                    title="Save Snapshot"
                  >
                    <Save className="h-4 w-4" />
                  </button>
                )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Editor area */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-24">
          {canvas ? (
            <BlockNoteEditor
              key={`canvas-${canvas.id}-${canvas.updated_at ?? 'na'}`}
              initialContent={canvas.content_json as unknown as PartialBlock[]}
              onChange={handleContentChange}
              onEditorReady={setEditor}
              placeholder="Start writing on the canvas..."
              highlightTerm={highlightTerm ?? undefined}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-text-muted text-sm">
              {isLoading ? 'Loading canvas...' : 'No canvas found'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
