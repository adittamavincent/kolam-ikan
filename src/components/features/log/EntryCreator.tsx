'use client';

import { useState, useMemo, useRef, Fragment } from 'react';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { BlockNoteEditor as BlockNoteEditorType } from '@blocknote/core';
import { Loader2, Send, Check } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { useKeyboard } from '@/lib/hooks/useKeyboard';
import { NavigationGuard } from './NavigationGuard';
import { useDraftSystem } from '@/lib/hooks/useDraftSystem';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';

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
        <div className="relative rounded-xl border border-border-default bg-surface-default p-4 min-h-25 flex items-center justify-center shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      );
  }

  return (
    <div className="relative rounded-xl border border-border-default bg-surface-default shadow-sm transition-shadow hover:shadow-md overflow-hidden group">
      {/* Navigation Guard - warn if saving or error */}
      {(status === 'saving' || status === 'error') && <NavigationGuard />}

      <div className="flex flex-col">
        {/* Header / Persona Selector */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1 border-b border-border-subtle/50">
            <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-subtle uppercase tracking-wider">New Entry as</span>
                
                <Menu as="div" className="relative">
                    <MenuButton 
                        className="flex items-center gap-2 rounded-lg py-1 px-2 text-xs font-medium transition-colors hover:bg-surface-subtle border border-transparent hover:border-border-subtle focus:outline-none"
                    >
                        <div 
                            className="flex h-5 w-5 items-center justify-center rounded"
                            style={{ backgroundColor: `${activePersona?.color || '#94a3b8'}20`, color: activePersona?.color || '#94a3b8' }}
                        >
                            <DynamicIcon name={activePersona?.icon || 'user'} className="h-3 w-3" />
                        </div>
                        <span className="text-text-default">{activePersona?.name || 'Select Persona'}</span>
                    </MenuButton>

                    <Transition
                        as={Fragment}
                        enter="transition ease-out duration-100"
                        enterFrom="transform opacity-0 scale-95"
                        enterTo="transform opacity-100 scale-100"
                        leave="transition ease-in duration-75"
                        leaveFrom="transform opacity-100 scale-100"
                        leaveTo="transform opacity-0 scale-95"
                    >
                        <MenuItems className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border-default bg-surface-default p-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                            <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                Select Author
                            </div>
                            {personas?.map((persona) => (
                                <MenuItem key={persona.id}>
                                    {({ active }) => (
                                        <button
                                            onClick={() => setSelectedPersonaId(persona.id)}
                                            className={`${
                                                active ? 'bg-surface-subtle text-text-default' : 'text-text-subtle'
                                            } group flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors`}
                                        >
                                            <div className="flex items-center gap-2">
                                                <div 
                                                    className="flex h-5 w-5 items-center justify-center rounded"
                                                    style={{ backgroundColor: `${persona.color}20`, color: persona.color }}
                                                >
                                                    <DynamicIcon name={persona.icon} className="h-3 w-3" />
                                                </div>
                                                <span>{persona.name}</span>
                                            </div>
                                            {activePersonaId === persona.id && (
                                                <Check className="h-3 w-3 text-action-primary-bg" />
                                            )}
                                        </button>
                                    )}
                                </MenuItem>
                            ))}
                        </MenuItems>
                    </Transition>
                </Menu>
            </div>
            
            {status === 'saving' && <span className="text-[10px] text-text-muted animate-pulse">Saving...</span>}
            {status === 'error' && <span className="text-[10px] text-status-error-text">Error saving draft</span>}
        </div>

        {/* Editor Area */}
        <div className="p-4 min-h-20">
            <BlockNoteEditor
                initialContent={initialLoadedContent || undefined}
                onChange={saveDraft}
                placeholder="What's on your mind?"
                onEditorReady={(editor) => { editorRef.current = editor; }}
            />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-4 py-2 bg-surface-subtle/30 border-t border-border-subtle/50">
            <div className="text-[10px] text-text-muted">
                <span className="font-medium">Cmd+Enter</span> to commit
            </div>
            <button
                onClick={handleCommit}
                disabled={status === 'idle' && !activeEntryId}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    status !== 'idle' || activeEntryId
                        ? 'bg-action-primary-bg text-white hover:bg-action-primary-hover shadow-sm'
                        : 'bg-surface-subtle text-text-muted cursor-not-allowed'
                }`}
            >
                <Send className="h-3 w-3" />
                Commit Entry
            </button>
        </div>
      </div>
    </div>
  );
}
