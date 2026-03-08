'use client';

import { useState } from 'react';
import { Dialog } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Globe } from 'lucide-react';
import { InteractionSwitcher } from './InteractionSwitcher';
import { ContextBag } from './ContextBag';
import { TokenCounter } from './TokenCounter';
import { XMLGenerator } from './XMLGenerator';
import { ResponseParser } from './ResponseParser';

interface BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  streamId: string;
}

export function BridgeModal({ isOpen, onClose, streamId }: BridgeModalProps) {
  const supabase = createClient();
  const [interactionMode, setInteractionMode] = useState<'ASK' | 'GO' | 'BOTH'>('ASK');
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [includeCanvas, setIncludeCanvas] = useState(true);
  const [userGlobalStreamChoice, setUserGlobalStreamChoice] = useState<boolean>(true);
  const [userInput, setUserInput] = useState('');
  const [tokenOverLimit, setTokenOverLimit] = useState(false);

  const { data: streamMeta, isLoading: isStreamMetaLoading } = useQuery({
    queryKey: ['bridge-stream-meta', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streams')
        .select('*')
        .eq('id', streamId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!streamId,
  });

  const { data: domainGlobalStreamsData, isLoading: isGlobalStreamLoading } = useQuery({
    queryKey: ['streams', streamMeta?.domain_id],
    queryFn: async () => {
      if (!streamMeta?.domain_id) return [];
      const { data, error } = await supabase
        .from('streams')
        .select('*')
        .eq('domain_id', streamMeta.domain_id)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    placeholderData: [],
    enabled: !!streamMeta?.domain_id,
  });

  const isGlobal = (s: { stream_kind: string; cabinet_id: string | null; sort_order: number }) =>
    s.stream_kind === 'GLOBAL' || (s.cabinet_id === null && s.sort_order === -100);

  const currentStreamIsGlobal = streamMeta ? isGlobal(streamMeta) : false;
  const allDomainStreams = domainGlobalStreamsData ?? [];
  const domainGlobalStreams = allDomainStreams.filter(isGlobal);
  const domainGlobalStreamIds = domainGlobalStreams.map((stream) => stream.id);
  const includeGlobalAvailable = domainGlobalStreamIds.length > 0;
  const includeGlobalStream = includeGlobalAvailable && userGlobalStreamChoice;
  const globalStreamName = domainGlobalStreams.length === 1
    ? domainGlobalStreams[0]?.name ?? null
    : domainGlobalStreams.length > 1
      ? `${domainGlobalStreams.length} global streams`
      : null;

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-lg bg-surface-default p-6 border border-border-default">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-2xl font-bold text-text-default">The Bridge</Dialog.Title>
            {streamMeta?.name && (
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <span>on</span>
                <span className="font-semibold text-text-default">{streamMeta.name}</span>
                {currentStreamIsGlobal && (
                  <div className="flex items-center gap-1 rounded-full border border-action-primary-bg/30 bg-action-primary-bg/10 px-2 py-0.5 text-[10px] font-semibold text-action-primary-bg">
                    <Globe className="h-3 w-3" />
                    Global
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interaction Mode */}
          <InteractionSwitcher value={interactionMode} onChange={setInteractionMode} />

          {/* Context Selection */}
          <ContextBag
            streamId={streamId}
            selectedEntries={selectedEntries}
            onSelectionChange={setSelectedEntries}
            includeCanvas={includeCanvas}
            onIncludeCanvasChange={setIncludeCanvas}
            includeGlobalStream={userGlobalStreamChoice}
            onIncludeGlobalStreamChange={setUserGlobalStreamChoice}
            globalStreamName={globalStreamName}
            globalStreamDisabled={currentStreamIsGlobal || !includeGlobalAvailable}
            globalStreamLoading={isStreamMetaLoading || isGlobalStreamLoading}
            currentStreamIsGlobal={currentStreamIsGlobal}
            disableSelectAll={tokenOverLimit}
          />

          {/* Token Counter */}
          <TokenCounter
            selectedEntries={selectedEntries}
            includeCanvas={includeCanvas}
            streamId={streamId}
            includeGlobalStream={includeGlobalStream}
            globalStreamIds={includeGlobalAvailable ? domainGlobalStreamIds : []}
            onTokenUpdate={(count, over) => {
              setTokenOverLimit(over);
            }}
            onReduceSelection={() => setSelectedEntries((prev) => prev.slice(0, 5))}
            onAutoSummarize={() => setIncludeCanvas(false)}
          />

          {/* User Input */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-text-default">Instruction</label>
            <textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="What would you like to accomplish?"
              className="w-full rounded border border-border-default bg-surface-subtle text-text-default p-3 focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg outline-none"
              rows={4}
            />
          </div>

          {/* Generate XML */}
          <XMLGenerator
            interactionMode={interactionMode}
            selectedEntries={selectedEntries}
            includeCanvas={includeCanvas}
            includeGlobalStream={includeGlobalStream}
            globalStreamIds={includeGlobalAvailable ? domainGlobalStreamIds : []}
            globalStreamName={globalStreamName}
            userInput={userInput}
            streamId={streamId}
          />

          {/* Parse Response */}
          <ResponseParser streamId={streamId} interactionMode={interactionMode} />

          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="rounded bg-surface-subtle px-4 py-2 text-text-default hover:bg-surface-hover transition-colors"
            >
              Close
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
