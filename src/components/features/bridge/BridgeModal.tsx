'use client';

import { useState } from 'react';
import { Dialog } from '@headlessui/react';
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
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'ASK' | 'GO' | 'BOTH'>('ASK');
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const [includeCanvas, setIncludeCanvas] = useState(true);
  const [userInput, setUserInput] = useState('');

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" aria-hidden="true" />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="mx-auto max-w-4xl w-full max-h-[90vh] overflow-y-auto rounded-lg bg-surface-default p-6 shadow-xl border border-border-default">
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
          />

          {/* Token Counter */}
          <TokenCounter
            selectedEntries={selectedEntries}
            includeCanvas={includeCanvas}
            streamId={streamId}
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
