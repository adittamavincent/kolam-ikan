'use client';

import { useState, useRef, Fragment, useEffect } from 'react';
import { useEntries } from '@/lib/hooks/useEntries';
import { EntryCreator } from './EntryCreator';
import { LogSection } from './LogSection';
import { useStream } from '@/lib/hooks/useStream';
import { useUpdateStream } from '@/lib/hooks/useUpdateStream';
import { Pencil, Filter, ArrowUpDown, Search, Users, Download, Calendar, ChevronLeft, Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { PersonaManager } from '../persona/PersonaManager';
import { exportEntriesToMarkdown, downloadMarkdown } from '@/lib/utils/export';
import { useLayout } from '@/lib/hooks/useLayout';

interface LogPaneProps {
  streamId: string;
  logWidth: number;
}

export function LogPane({ streamId, logWidth }: LogPaneProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const { toggleLogCollapse } = useLayout();
  
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
  const [isToolbarOpen, setIsToolbarOpen] = useState(false);

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

  const getEntryLevel = (entry: (typeof entries)[number]) => {
    const text = entry.sections
      ?.map((section) => section.search_text ?? section.persona_name_snapshot ?? '')
      .join(' ')
      .toLowerCase();

    if (!text) return 'info';

    const errorTokens = ['error', 'failed', 'exception', 'critical', 'panic', 'fatal'];
    const warningTokens = ['warn', 'warning', 'deprecated', 'risk', 'caution'];

    if (errorTokens.some((token) => text.includes(token))) return 'error';
    if (warningTokens.some((token) => text.includes(token))) return 'warning';
    return 'info';
  };

  const levelMeta = {
    info: { label: 'Info', icon: Info, badge: 'text-sky-600 dark:text-sky-400 bg-sky-500/10 ring-1 ring-sky-500/20' },
    warning: { label: 'Warning', icon: AlertTriangle, badge: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/20' },
    error: { label: 'Error', icon: AlertCircle, badge: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 ring-1 ring-rose-500/20' },
  };

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
          <div className="px-3 pb-2 pt-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-text-default">The Log</h2>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={toggleLogCollapse}
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg"
                  title="Collapse log"
                  aria-label="Collapse log"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setIsToolbarOpen(!isToolbarOpen)}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg ${
                    isToolbarOpen 
                      ? 'bg-surface-subtle text-text-default' 
                      : 'text-text-muted hover:bg-surface-subtle hover:text-text-default'
                  }`}
                  title={isToolbarOpen ? "Hide toolbar" : "Show toolbar"}
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  onClick={handleExport}
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg"
                  title="Export to Markdown"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setIsPersonaManagerOpen(true)}
                  className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg"
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
                className="mt-1 w-full border-b border-action-primary-bg bg-transparent pb-0.5 text-sm text-text-default outline-none"
              />
            ) : (
              <p
                className="group mt-1 flex items-center gap-2 truncate text-xs text-text-subtle transition-colors hover:text-text-default"
                onClick={handleEdit}
              >
                <span className="truncate">{stream ? stream.name : `Stream: ${streamId}`}</span>
                <span className="opacity-0 transition-opacity group-hover:opacity-100">
                  <Pencil className="h-3 w-3" />
                </span>
              </p>
            )}
          </div>

          {/* Toolbar */}
          <div 
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              isToolbarOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden">
              <div className="px-3 pb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-md border border-border-default bg-surface-subtle pl-8 pr-2 py-1 text-xs text-text-default transition-all focus:border-action-primary-bg focus:outline-none focus:ring-1 focus:ring-action-primary-bg"
              />
            </div>
            
            {/* Filter Menu */}
            <Menu as="div" className="relative">
              <MenuButton
                className={`rounded-md border p-1.5 transition-colors ${filterPersonaId ? 'bg-action-primary-bg/10 border-action-primary-bg text-action-primary-bg' : 'border-border-default text-text-muted hover:bg-surface-subtle hover:text-text-default'}`}
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
                <MenuItems className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border-default bg-surface-default p-1 shadow-lg ring-1 ring-black/5 focus:outline-none">
                   <MenuItem>
                    {({ focus }) => (
                      <button
                        onClick={() => setFilterPersonaId(null)}
                        className={`${focus ? 'bg-surface-subtle' : ''} flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-text-default`}
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
                        className={`${focus ? 'bg-surface-subtle' : ''} flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-text-default`}
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
              className="rounded-md border border-border-default p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default"
              title={`Sort by: ${sortOrder === 'newest' ? 'Newest First' : 'Oldest First'}`}
            >
              <ArrowUpDown className={`h-3.5 w-3.5 transition-transform ${sortOrder === 'oldest' ? 'rotate-180' : ''}`} />
            </button>
          </div>
            </div>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-3 pb-5 pt-4 space-y-4">
          <EntryCreator streamId={streamId} />
          
          <div className="space-y-4">
            {isEntriesLoading ? (
              <div className="space-y-4 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-28 rounded-lg bg-surface-subtle/50" />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-10 text-text-muted text-sm">
                No entries found.
              </div>
            ) : (
              <>
                {entries.map((entry) => (
                  <div key={entry.id} className="relative group rounded-lg border border-border-subtle bg-surface-default shadow-sm overflow-hidden transition-all hover:border-border-default/50 hover:shadow-md">
                     {/* Entry Header */}
                     <div className="flex items-center justify-between px-3 py-1.5 bg-surface-subtle/40 border-b border-border-subtle/40">
                       <div className="flex items-center gap-2">
                         <Calendar className="h-3 w-3 text-text-muted" />
                         <span className="text-[10px] font-medium text-text-subtle font-mono">
                           {new Date(entry.created_at || '').toLocaleString(undefined, { 
                             month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' 
                           })}
                         </span>
                       </div>
                       {(() => {
                         const level = getEntryLevel(entry) as keyof typeof levelMeta;
                         const meta = levelMeta[level];
                         const Icon = meta.icon;
                         return (
                           <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.badge}`}>
                             <Icon className="h-3 w-3" />
                             {meta.label}
                           </span>
                         );
                       })()}
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
