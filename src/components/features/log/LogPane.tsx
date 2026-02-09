'use client';

import { useState, useRef, Fragment, useEffect } from 'react';
import { useEntries } from '@/lib/hooks/useEntries';
import { EntryCreator } from './EntryCreator';
import { LogSection } from './LogSection';
import { useStream } from '@/lib/hooks/useStream';
import { useUpdateStream } from '@/lib/hooks/useUpdateStream';
import { Pencil, Filter, ArrowUpDown, Search, Users, Download, Calendar } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { PersonaManager } from '../persona/PersonaManager';
import { exportEntriesToMarkdown, downloadMarkdown } from '@/lib/utils/export';

interface LogPaneProps {
  streamId: string;
  logWidth: number;
}

export function LogPane({ streamId, logWidth }: LogPaneProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const { 
    entries, 
    isLoading: isEntriesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    fetchAllEntriesForExport
  } = useEntries(streamId, {
    search: debouncedSearch,
    personaId: filterPersonaId,
    sortOrder
  });

  const { stream } = useStream(streamId);
  const updateStreamMutation = useUpdateStream(streamId);
  const { personas } = usePersonas();
  
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPersonaManagerOpen, setIsPersonaManagerOpen] = useState(false);

  const handleEdit = () => {
    setEditingName(stream?.name || '');
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = () => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setEditingName(stream?.name || '');
      setIsEditing(false);
      return;
    }
    
    if (trimmed !== stream?.name) {
       // Optimistic check (simplified)
       updateStreamMutation.mutate(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditingName(stream?.name || '');
      setIsEditing(false);
    }
  };

  const handleExport = async () => {
    try {
      const allEntries = await fetchAllEntriesForExport();
      if (!allEntries || !allEntries.length) return;
      const markdown = exportEntriesToMarkdown(allEntries);
      const filename = `${stream?.name || 'log'}-${new Date().toISOString().split('T')[0]}.md`;
      downloadMarkdown(markdown, filename);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const isVisible = logWidth > 0;

  const containerStyle = {
    width: `${logWidth}%`,
    minWidth: logWidth === 0 ? '0px' : 'auto',
    opacity: isVisible ? 1 : 0,
    transition: 'all 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  const contentStyle = {
    transform: isVisible ? 'translateX(0) scaleX(1)' : 'translateX(-100%) scaleX(0.95)',
    transformOrigin: 'right center',
    transition: 'transform 400ms cubic-bezier(0.4, 0, 0.2, 1)',
  };

  return (
    <div
      className={`border-r border-border-subtle bg-surface-default relative overflow-hidden z-30 flex flex-col ${
        isVisible ? '' : 'pointer-events-none'
      }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        {/* Header Area */}
        <div className="border-b border-border-subtle bg-surface-default shrink-0">
          <div className="p-4 pb-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-text-default">The Log</h2>
              <div className="flex items-center gap-1">
                <button 
                  onClick={handleExport}
                  className="p-1.5 text-text-muted hover:text-text-default hover:bg-surface-subtle rounded-md transition-colors"
                  title="Export to Markdown"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button 
                  onClick={() => setIsPersonaManagerOpen(true)}
                  className="p-1.5 text-text-muted hover:text-text-default hover:bg-surface-subtle rounded-md transition-colors"
                  title="Manage Personas"
                >
                  <Users className="h-4 w-4" />
                </button>
              </div>
            </div>
            
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSave}
                className="text-sm text-text-default w-full outline-none border-b border-action-primary-bg pb-0.5 bg-transparent"
              />
            ) : (
              <p 
                className="text-sm text-text-subtle cursor-pointer hover:text-text-default flex items-center gap-2 group truncate"
                onClick={handleEdit}
              >
                {stream ? stream.name : `Stream: ${streamId}`}
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <Pencil className="h-3 w-3" />
                </span>
              </p>
            )}
          </div>

          {/* Toolbar */}
          <div className="px-4 pb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-md border border-border-default bg-surface-subtle pl-8 pr-2 py-1.5 text-xs text-text-default focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg transition-all"
              />
            </div>
            
            {/* Filter Menu */}
            <Menu as="div" className="relative">
              <MenuButton 
                className={`p-1.5 rounded-md border transition-colors ${filterPersonaId ? 'bg-action-primary-bg/10 border-action-primary-bg text-action-primary-bg' : 'border-border-default text-text-muted hover:text-text-default hover:bg-surface-subtle'}`}
                title="Filter by Author"
              >
                <Filter className="h-3.5 w-3.5" />
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
                <MenuItems className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border-default bg-surface-default shadow-lg ring-1 ring-black/5 focus:outline-none p-1">
                   <MenuItem>
                    {({ focus }) => (
                      <button
                        onClick={() => setFilterPersonaId(null)}
                        className={`${
                          focus ? 'bg-surface-subtle' : ''
                        } flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-text-default`}
                      >
                        <span>All Authors</span>
                        {!filterPersonaId && <div className="h-1.5 w-1.5 rounded-full bg-action-primary-bg" />}
                      </button>
                    )}
                  </MenuItem>
                  {personas?.map((persona) => (
                    <MenuItem key={persona.id}>
                      {({ focus }) => (
                        <button
                          onClick={() => setFilterPersonaId(persona.id)}
                          className={`${
                            focus ? 'bg-surface-subtle' : ''
                          } flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-text-default`}
                        >
                          <div className="flex items-center gap-2">
                             <DynamicIcon name={persona.icon} className="h-3 w-3" />
                             <span>{persona.name}</span>
                          </div>
                          {filterPersonaId === persona.id && <div className="h-1.5 w-1.5 rounded-full bg-action-primary-bg" />}
                        </button>
                      )}
                    </MenuItem>
                  ))}
                </MenuItems>
              </Transition>
            </Menu>

            {/* Sort Button */}
            <button
              onClick={() => setSortOrder(prev => prev === 'newest' ? 'oldest' : 'newest')}
              className="p-1.5 rounded-md border border-border-default text-text-muted hover:text-text-default hover:bg-surface-subtle transition-colors"
              title={`Sort by: ${sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}`}
            >
              <ArrowUpDown className={`h-3.5 w-3.5 transition-transform ${sortOrder === 'oldest' ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <EntryCreator streamId={streamId} />
          
          <div className="space-y-6">
            {isEntriesLoading ? (
              <div className="space-y-4 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-32 rounded-xl bg-surface-subtle/50" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-10 text-text-muted text-sm">
                No entries found.
              </div>
            ) : (
              <>
                {entries.map((entry) => (
                  <div key={entry.id} className="relative group rounded-xl border border-border-subtle bg-surface-default shadow-sm overflow-hidden transition-all hover:shadow-md hover:border-border-default/50">
                     {/* Entry Header */}
                     <div className="flex items-center justify-between px-3 py-2 bg-surface-subtle/30 border-b border-border-subtle/30">
                       <div className="flex items-center gap-2">
                         <Calendar className="h-3 w-3 text-text-muted" />
                         <span className="text-[10px] font-medium text-text-subtle font-mono">
                           {new Date(entry.created_at || '').toLocaleString(undefined, { 
                             month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' 
                           })}
                         </span>
                       </div>
                       {/* Could add Entry Actions here like 'Add Section' or 'Delete Entry' */}
                     </div>

                     {/* Sections */}
                     <div className="p-1 space-y-px">
                      {entry.sections?.map((section) => (
                        <LogSection key={section.id} section={section} />
                      ))}
                    </div>
                  </div>
                ))}
                
                {hasNextPage && (
                  <div className="flex justify-center pt-4 pb-2">
                    <button
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="px-4 py-2 text-xs font-medium text-text-muted hover:text-text-default bg-surface-subtle hover:bg-surface-subtle/80 rounded-md transition-colors disabled:opacity-50"
                    >
                      {isFetchingNextPage ? 'Loading more...' : 'Load more entries'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      
      <PersonaManager isOpen={isPersonaManagerOpen} onClose={() => setIsPersonaManagerOpen(false)} />
    </div>
  );
}
