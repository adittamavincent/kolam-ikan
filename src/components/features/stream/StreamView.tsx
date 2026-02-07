'use client';

import { LogPane } from '@/components/features/log/LogPane';
import { CanvasPane } from '@/components/features/canvas/CanvasPane';
import { LayoutControls } from '@/components/layout/LayoutControls';
import { BridgeModal } from '@/components/features/bridge/BridgeModal';
import { useRealtimeEntries } from '@/lib/hooks/useRealtimeEntries';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';

export function StreamView({ streamId }: { streamId: string }) {
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  useRealtimeEntries(streamId);

  return (
    <div className="flex flex-1 relative h-full">
      <LogPane streamId={streamId} />
      <CanvasPane streamId={streamId} />
      
      <LayoutControls />

      {/* Bridge Trigger Button */}
      <button
        onClick={() => setIsBridgeOpen(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-white shadow-lg hover:bg-indigo-700 transition-colors"
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
