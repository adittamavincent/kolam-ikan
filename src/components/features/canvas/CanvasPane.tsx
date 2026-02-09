'use client';

import { useLayout } from '@/lib/hooks/useLayout';
import { useCanvas } from '@/lib/hooks/useCanvas';
import { useCanvasScroll } from '@/lib/hooks/useCanvasScroll';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { useCallback, useEffect, useMemo, useState } from 'react';
import debounce from 'lodash/debounce';
import { Loader2 } from 'lucide-react';
import { PartialBlock, BlockNoteEditor as BlockNoteEditorType } from '@blocknote/core';
import { Json } from '@/lib/types/database.types';

interface CanvasPaneProps {
  streamId: string;
}

export function CanvasPane({ streamId }: CanvasPaneProps) {
  const { canvasWidth } = useLayout();
  const { canvas, updateCanvas, isLoading } = useCanvas(streamId);
  const { targetBlockId, setTargetBlockId } = useCanvasScroll();
  const [editor, setEditor] = useState<BlockNoteEditorType | null>(null);

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

  return (
    <div
      className={`bg-surface-default relative overflow-hidden z-20 ${
        isVisible ? '' : 'pointer-events-none'
      }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {canvas ? (
            <BlockNoteEditor
              initialContent={canvas.content_json as unknown as PartialBlock[]}
              onChange={handleContentChange}
              onEditorReady={setEditor}
              placeholder="Start writing on the canvas..."
            />
          ) : (
            <div className="flex h-full items-center justify-center text-text-muted">
              {isLoading ? 'Loading canvas...' : 'No canvas found'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
