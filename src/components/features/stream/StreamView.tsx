'use client';

import { LogPane } from '@/components/features/log/LogPane';
import { CanvasPane } from '@/components/features/canvas/CanvasPane';
import { BridgeModal } from '@/components/features/bridge/BridgeModal';
import { useRealtimeEntries } from '@/lib/hooks/useRealtimeEntries';
import { useLayout } from '@/lib/hooks/useLayout';
import { useState } from 'react';
import { Sparkles, Globe } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export function StreamView({ streamId }: { streamId: string }) {
  const supabase = createClient();
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const { logWidth } = useLayout();
  useRealtimeEntries(streamId);

  const { data: streamMeta } = useQuery({
    queryKey: ['stream-kind', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streams')
        .select('stream_kind')
        .eq('id', streamId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!streamId,
  });

  const isGlobalStream = streamMeta?.stream_kind === 'GLOBAL';

  return (
    <div className="flex flex-1 relative h-full">
      {isGlobalStream && (
        <div className="absolute left-2 top-1.75 z-30 inline-flex items-center gap-1 rounded-full border border-action-primary-bg/30 bg-action-primary-bg/10 px-2.5 py-1 text-xs font-semibold text-action-primary-bg">
          <Globe className="h-3.5 w-3.5" />
          Global Stream
        </div>
      )}
      <LogPane streamId={streamId} logWidth={logWidth} />
      <CanvasPane streamId={streamId} />
      
      {/* Bridge Trigger Button */}
      <button
        onClick={() => {
          window.dispatchEvent(new Event('kolam_flush_drafts'));
          setIsBridgeOpen(true);
        }}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-action-primary-bg px-4 py-2 text-action-primary-text hover:opacity-90 transition-opacity"
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
