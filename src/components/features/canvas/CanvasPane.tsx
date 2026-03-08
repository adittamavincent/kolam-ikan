'use client';

import { useLayout } from '@/lib/hooks/useLayout';
import { useCanvas } from '@/lib/hooks/useCanvas';
import { useCanvasScroll } from '@/lib/hooks/useCanvasScroll';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { useCallback, useEffect, useMemo, useState } from 'react';
import debounce from 'lodash/debounce';
import { PartialBlock, BlockNoteEditor as BlockNoteEditorType } from '@blocknote/core';
import { Json } from '@/lib/types/database.types';
import { createClient } from '@/lib/supabase/client';
import { useQuery, useMutation } from '@tanstack/react-query';
import { History, Save, RotateCcw } from 'lucide-react';

interface CanvasPaneProps {
  streamId: string;
}

export function CanvasPane({ streamId }: CanvasPaneProps) {
  const { canvasWidth } = useLayout();
  const { canvas, updateCanvas, isLoading } = useCanvas(streamId);
  const { targetBlockId, setTargetBlockId } = useCanvasScroll();
  const [editor, setEditor] = useState<BlockNoteEditorType | null>(null);
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [snapshotName, setSnapshotName] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const supabase = createClient();

  const isVisible = canvasWidth > 0;

  // Calculate smooth animation - slides in from right with decompression
  const containerStyle = {
    width: `${canvasWidth}%`,
    minWidth: canvasWidth === 0 ? '0px' : 'auto',
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
        debouncedUpdate(canvas.id, blocks);
      }
    },
    [canvas, debouncedUpdate]
  );

  const { data: versions, isLoading: versionsLoading, refetch: refetchVersions } = useQuery({
    queryKey: ['canvas-versions', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canvas_versions')
        .select('*')
        .eq('stream_id', streamId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!streamId,
  });

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
      refetchVersions();
    },
  });

  const handleSaveSnapshot = () => {
    saveSnapshotMutation.mutate();
  };

  const handleRestoreVersion = async (versionId: string, content: Json) => {
    if (!canvas) return;
    await updateCanvas.mutateAsync({ id: canvas.id, updates: { content_json: content } });
    setShowVersions(false);
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
          
          // Scroll into view - getting the DOM element might be tricky with BlockNote's abstraction
          // but focusing it usually brings it into view or we can use the selection
          
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
      className={`bg-surface-default relative overflow-hidden z-20 ${
        isVisible ? '' : 'pointer-events-none'
      }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        {/* Compact toolbar */}
        {canvas && (
          <div className="border-b border-border-subtle bg-surface-default shrink-0">
            <div className="px-2 py-1.5">
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={handleSaveSnapshot}
                  disabled={saveSnapshotMutation.isPending}
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default disabled:opacity-50"
                  title={saveSnapshotMutation.isPending ? 'Saving...' : 'Save Snapshot'}
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowVersions((prev) => !prev)}
                  className={`rounded-md p-1.5 transition-colors ${showVersions ? 'bg-surface-subtle text-text-default' : 'text-text-muted hover:bg-surface-subtle hover:text-text-default'}`}
                  title={showVersions ? 'Hide History' : 'View History'}
                >
                  <History className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Collapsible snapshot name + version history */}
            <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showVersions ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
                <div className="px-3 pb-2 space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={snapshotName}
                      onChange={(event) => setSnapshotName(event.target.value)}
                      placeholder="Snapshot name..."
                      className="flex-1 rounded-md border border-border-default bg-surface-subtle px-2 py-1 text-xs text-text-default focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
                    />
                    <button
                      onClick={handleSaveSnapshot}
                      disabled={saveSnapshotMutation.isPending}
                      className="rounded-md bg-action-primary-bg px-2.5 py-1 text-xs text-action-primary-text hover:bg-action-primary-hover disabled:opacity-50"
                    >
                      {saveSnapshotMutation.isPending ? '...' : 'Save'}
                    </button>
                  </div>
                  {versionsLoading && <div className="text-xs text-text-muted py-1">Loading...</div>}
                  {!versionsLoading && versions?.length === 0 && (
                    <div className="text-xs text-text-muted py-1">No snapshots yet.</div>
                  )}
                  {versions?.map((version) => (
                    <div
                      key={version.id}
                      className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-subtle px-2 py-1 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-text-default text-[11px]">{version.name || 'Untitled'}</div>
                        <div className="text-[10px] text-text-muted">
                          {version.created_at ? new Date(version.created_at).toLocaleString() : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRestoreVersion(version.id, version.content_json as Json)}
                        className="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text-default"
                        title="Restore this version"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Editor area */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
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
