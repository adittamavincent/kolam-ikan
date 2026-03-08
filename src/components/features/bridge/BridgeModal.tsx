'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { PersonaSelector } from './PersonaSelector';
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
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'ASK' | 'GO' | 'BOTH'>('ASK');
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [includeCanvas, setIncludeCanvas] = useState(true);
  const [includeGlobalStream, setIncludeGlobalStream] = useState(true);
  const [userInput, setUserInput] = useState('');
  const [tokenOverLimit, setTokenOverLimit] = useState(false);

  const { data: streamMeta } = useQuery({
    queryKey: ['bridge-stream-meta', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streams')
        .select('id, domain_id, stream_kind')
        .eq('id', streamId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!streamId,
  });

  const { data: domainGlobalStream } = useQuery({
    queryKey: ['bridge-domain-global-stream', streamMeta?.domain_id],
    queryFn: async () => {
      if (!streamMeta?.domain_id) return null;
      const { data, error } = await supabase
        .from('streams')
        .select('id, name, stream_kind, is_system_global')
        .eq('domain_id', streamMeta.domain_id)
        .eq('stream_kind', 'GLOBAL')
        .eq('is_system_global', true)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!streamMeta?.domain_id,
  });

  const currentStreamIsGlobal = streamMeta?.stream_kind === 'GLOBAL';
  const includeGlobalAvailable = !!domainGlobalStream && domainGlobalStream.id !== streamId;

  useEffect(() => {
    setIncludeGlobalStream(includeGlobalAvailable);
  }, [includeGlobalAvailable]);

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-lg bg-surface-default p-6 border border-border-default">
          <Dialog.Title className="text-2xl font-bold mb-4 text-text-default">The Bridge</Dialog.Title>

          {/* Persona Selection */}
          <PersonaSelector value={selectedPersona} onChange={setSelectedPersona} />

          {/* Interaction Mode */}
          <InteractionSwitcher value={interactionMode} onChange={setInteractionMode} />

          {/* Context Selection */}
          <ContextBag
            streamId={streamId}
            selectedEntries={selectedEntries}
            onSelectionChange={setSelectedEntries}
            includeCanvas={includeCanvas}
            onIncludeCanvasChange={setIncludeCanvas}
            includeGlobalStream={includeGlobalStream}
            onIncludeGlobalStreamChange={setIncludeGlobalStream}
            globalStreamName={domainGlobalStream?.name ?? null}
            globalStreamDisabled={!includeGlobalAvailable}
            currentStreamIsGlobal={currentStreamIsGlobal}
            disableSelectAll={tokenOverLimit}
          />

          {/* Token Counter */}
          <TokenCounter
            selectedEntries={selectedEntries}
            includeCanvas={includeCanvas}
            streamId={streamId}
            includeGlobalStream={includeGlobalStream}
            globalStreamId={includeGlobalAvailable ? domainGlobalStream?.id ?? null : null}
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
            personaId={selectedPersona}
            interactionMode={interactionMode}
            selectedEntries={selectedEntries}
            includeCanvas={includeCanvas}
            includeGlobalStream={includeGlobalStream}
            globalStreamId={includeGlobalAvailable ? domainGlobalStream?.id ?? null : null}
            globalStreamName={domainGlobalStream?.name ?? null}
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
