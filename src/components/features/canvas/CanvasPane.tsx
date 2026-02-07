'use client';

import { useLayout } from '@/lib/hooks/useLayout';
import { useCanvas } from '@/lib/hooks/useCanvas';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { useCallback, useMemo } from 'react';
import debounce from 'lodash/debounce';
import { Loader2 } from 'lucide-react';
import { PartialBlock } from '@blocknote/core';
import { Json } from '@/lib/types/database.types';

interface CanvasPaneProps {
  streamId: string;
}

export function CanvasPane({ streamId }: CanvasPaneProps) {
  const { canvasWidth } = useLayout();
  const { canvas, updateCanvas, isLoading } = useCanvas(streamId);

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

  if (canvasWidth === 0) return null;

  return (
    <div
      className="bg-white transition-all duration-300 ease-in-out"
      style={{ width: `${canvasWidth}%` }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">The Canvas</h2>
            <p className="text-sm text-gray-500">Stream: {streamId}</p>
          </div>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {canvas ? (
            <BlockNoteEditor
              initialContent={canvas.content_json as unknown as PartialBlock[]}
              onChange={handleContentChange}
              placeholder="Start writing on the canvas..."
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              {isLoading ? 'Loading canvas...' : 'No canvas found'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
