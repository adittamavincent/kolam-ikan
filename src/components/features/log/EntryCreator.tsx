'use client';

import { useState, useMemo, useRef } from 'react';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { BlockNoteEditor as BlockNoteEditorType } from '@blocknote/core';
import { Loader2, User as UserIcon } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { useKeyboard } from '@/lib/hooks/useKeyboard';
import { NavigationGuard } from './NavigationGuard';
import { useDraftSystem } from '@/lib/hooks/useDraftSystem';

interface EntryCreatorProps {
  streamId: string;
  personaId?: string; // Optional override
}

export function EntryCreator({ streamId, personaId }: EntryCreatorProps) {
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(personaId || null);
  const editorRef = useRef<BlockNoteEditorType | null>(null);
  
  const { personas } = usePersonas();

  // Compute default persona ID
  const defaultPersonaId = useMemo(() => {
    if (personas && personas.length > 0) {
      const myself = personas.find(p => p.name === 'Myself');
      return myself ? myself.id : personas[0].id;
    }
    return null;
  }, [personas]);

  // Determine the effective persona ID
  const activePersonaId = personaId || selectedPersonaId || defaultPersonaId;
  const activePersona = personas?.find(p => p.id === activePersonaId);

  // Draft System Hook
  const {
    status,
    saveDraft,
    commitDraft,
    initialLoadedContent,
    isLoading,
    activeEntryId
  } = useDraftSystem({
    streamId,
    personaId: activePersonaId,
    personaName: activePersona?.name
  });

  const isSaved = status === 'saved';

  // Keyboard shortcuts
  useKeyboard([
    {
      key: 'n',
      metaKey: true,
      description: 'New Entry',
      handler: (e) => {
        e.preventDefault();
        editorRef.current?.focus();
      },
    },
    {
        key: 'Enter',
        metaKey: true,
        description: 'Commit Entry',
        handler: (e) => {
            e.preventDefault();
            handleCommit();
        }
    }
  ]);

  const handleCommit = async () => {
      try {
        await commitDraft();
        // Clear editor
        if (editorRef.current) {
             editorRef.current.replaceBlocks(editorRef.current.document, [{ type: "paragraph", content: [] }]);
        }
      } catch (e) {
          console.error("Failed to commit", e);
      }
  };

  if (isLoading) {
      return (
        <div className="relative rounded-lg border border-border-default bg-surface-default p-4 min-h-[100px] flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      );
  }

  return (
    <div className="relative rounded-lg border border-border-default bg-surface-default p-4 overflow-hidden">
      {/* Navigation Guard - warn if saving or error */}
      {(status === 'saving' || status === 'error') && <NavigationGuard />}

      {/* Header Controls (Status + Persona) */}
      <div className="absolute right-4 top-2 z-10 flex items-center gap-2">
        
        {personas && personas.length > 0 && (
          <div className="relative flex items-center">
            <select
              value={selectedPersonaId || ''}
              onChange={(e) => setSelectedPersonaId(e.target.value)}
              className="appearance-none rounded-md border border-border-subtle bg-surface-subtle py-1 pl-2 pr-6 text-xs text-text-default hover:bg-surface-hover focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <UserIcon className="pointer-events-none absolute right-2 h-3 w-3 text-text-muted" />
          </div>
        )}
      </div>

      <div className="mt-4">
        <BlockNoteEditor
            initialContent={initialLoadedContent || undefined}
            onChange={saveDraft}
            placeholder={`What's on your mind, ${personas?.find(p => p.id === selectedPersonaId)?.name || '...'}?`}
            onEditorReady={(editor) => { editorRef.current = editor; }}
        />
        
        {/* Commit Button */}
        {/* Show button if we have an active entry or content (status != idle usually implies content) */}
        {(activeEntryId || status !== 'idle') && (
            <div className="flex justify-end mt-2">
                 <button
                     onClick={handleCommit}
                     className={`px-3 py-1 rounded text-xs flex items-center gap-1 transition-colors duration-500 ease-in-out ${
                       isSaved
                         ? 'bg-status-success-text text-status-success-bg hover:opacity-90'
                         : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                     }`}
                 >
                     Commit (Cmd+Enter)
                 </button>
            </div>
        )}
      </div>
    </div>
  );
}
