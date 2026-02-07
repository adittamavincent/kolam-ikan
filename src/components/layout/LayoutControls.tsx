'use client';

import { useLayout } from '@/lib/hooks/useLayout';
import { PanelLeft, PanelRight, Columns } from 'lucide-react';

export function LayoutControls() {
  const { setMode, logWidth, canvasWidth } = useLayout();

  // Helper to check active state based on width
  const isLogMaximized = logWidth === 100 && canvasWidth === 0;
  const isBalanced = logWidth === 50 && canvasWidth === 50;
  const isCanvasMaximized = logWidth === 0 && canvasWidth === 100;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
      <button
        onClick={() => setMode('log-only')}
        className={`rounded p-2 transition-colors ${
          isLogMaximized
            ? 'bg-primary-100 text-primary-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
        title="Maximize Log (⌘J)"
      >
        <PanelLeft className="h-5 w-5" />
      </button>

      <button
        onClick={() => setMode('balanced')}
        className={`rounded p-2 transition-colors ${
          isBalanced
            ? 'bg-primary-100 text-primary-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
        title="Reset Layout (⌘K)"
      >
        <Columns className="h-5 w-5" />
      </button>

      <button
        onClick={() => setMode('canvas-only')}
        className={`rounded p-2 transition-colors ${
          isCanvasMaximized
            ? 'bg-primary-100 text-primary-700'
            : 'text-gray-600 hover:bg-gray-100'
        }`}
        title="Maximize Canvas (⌘L)"
      >
        <PanelRight className="h-5 w-5" />
      </button>
    </div>
  );
}
