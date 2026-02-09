'use client';

import { LogPane } from '@/components/features/log/LogPane';
import { CanvasPane } from '@/components/features/canvas/CanvasPane';
import { LayoutControls } from '@/components/layout/LayoutControls';
import { BridgeModal } from '@/components/features/bridge/BridgeModal';
import { useRealtimeEntries } from '@/lib/hooks/useRealtimeEntries';
import { useLayout } from '@/lib/hooks/useLayout';
import { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';

export function StreamView({ streamId }: { streamId: string }) {
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const { logWidth, toggleLogCollapse } = useLayout();
  useRealtimeEntries(streamId);

  return (
    <div className="flex flex-1 relative h-full">
      <LogPane streamId={streamId} logWidth={logWidth} />
      <CanvasPane streamId={streamId} />
      
      <LayoutControls />

      {logWidth === 0 && (
        <button
          onClick={toggleLogCollapse}
          className="fixed left-4 top-20 z-40 flex items-center gap-2 rounded-full border border-border-default bg-surface-default px-3 py-1.5 text-xs font-semibold text-text-default shadow-sm transition hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg"
        >
          <ChevronRight className="h-4 w-4 text-text-muted" />
          Show Log
        </button>
      )}

      {/* Bridge Trigger Button */}
      <button
        onClick={() => setIsBridgeOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-action-primary-bg px-4 py-2 text-action-primary-text shadow-lg hover:opacity-90 transition-opacity"
      >
        <Sparkles className="h-4 w-4" />
        <span className="font-medium">Bridge</span>
      </button>

      <BridgeModal
        isOpen={isBridgeOpen}
        onClose={() => setIsBridgeOpen(false)}
        streamId={streamId}
      />
    </div>
  );
}
