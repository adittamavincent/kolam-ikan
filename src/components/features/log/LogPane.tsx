'use client';

import { useState, Fragment, useEffect, useRef, useCallback } from 'react';
import { useEntries } from '@/lib/hooks/useEntries';
import { EntryCreator } from './EntryCreator';
import { LogSection } from './LogSection';
import { useStream } from '@/lib/hooks/useStream';
import { Filter, ArrowUpDown, Search, Download, Calendar, Info, AlertTriangle, AlertCircle } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { exportEntriesToMarkdown, downloadMarkdown } from '@/lib/utils/export';
import { EntryWithSections } from '@/lib/types';

interface LogPaneProps {
  streamId: string;
  logWidth: number;
  forceWidth?: number;
}

export function LogPane({ streamId, logWidth, forceWidth }: LogPaneProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    const raw = sessionStorage.getItem('kolam_search_highlight');
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as {
        term: string;
        target: 'log' | 'canvas';
        entryId?: string | null;
        streamId?: string;
      };
      if (payload.target === 'log' && payload.streamId === streamId) {
        setSearchTerm(payload.term);
        setIsToolbarOpen(true);
        setHighlightTerm(payload.term);
        setHighlightEntryId(payload.entryId ?? null);
        sessionStorage.removeItem('kolam_search_highlight');
      }
    } finally {
    }
  }, [streamId]);

  const scrollToHighlighted = useCallback(() => {
    if (!highlightEntryId) return;
    const ref = entryRefs.current[highlightEntryId];
    if (ref) {
      ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightEntryId]);

  const {
    items: entryList,
    isLoading: isEntriesLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    fetchAllEntriesForExport,
  } = useEntries(streamId, {
    search: debouncedSearch,
    personaId: filterPersonaId,
    sortOrder,
  });
  useEffect(() => {
    scrollToHighlighted();
  }, [entryList, scrollToHighlighted]);

  const { stream } = useStream(streamId);
  const { personas } = usePersonas();

  const [isToolbarOpen, setIsToolbarOpen] = useState(false);

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

  const resolvedWidth = forceWidth ?? logWidth;
  const isVisible = resolvedWidth > 0;

  const getEntryLevel = (entry: EntryWithSections) => {
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
    width: `${resolvedWidth}%`,
    minWidth: resolvedWidth === 0 ? '0px' : 'auto',
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
      className={`border-r border-border-subtle bg-surface-default relative overflow-hidden z-30 flex flex-col ${isVisible ? '' : 'pointer-events-none'
        }`}
      style={containerStyle}
    >
      <div className="flex h-full flex-col" style={contentStyle}>
        {/* Header Area */}
        <div className="border-b border-border-subtle bg-surface-default shrink-0">
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsToolbarOpen(!isToolbarOpen)}
                  className={`rounded-md p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg ${isToolbarOpen
                      ? 'bg-surface-subtle text-text-default'
                      : 'text-text-muted hover:bg-surface-subtle hover:text-text-default'
                    }`}
                  title={isToolbarOpen ? 'Hide local search' : 'Show local search'}
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
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${isToolbarOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
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
                {mounted && (
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
                      <MenuItems className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border-default bg-surface-default p-1 ring-1 ring-black/5 focus:outline-none">
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
                )}

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
        <div className="flex-1 overflow-y-auto px-3">
          <div className="sticky top-0 z-20 pt-4">
            <EntryCreator streamId={streamId} />
          </div>
          <div className="pb-5 pt-4">
            {isEntriesLoading ? (
              <div className="space-y-4 animate-pulse">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-28 rounded-lg bg-surface-subtle/50" />
                ))}
              </div>
            ) : entryList.length === 0 ? (
              <div className="text-center py-10 text-text-muted text-sm">
                No entries found.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4">
                  {entryList.map((entry) => (
                    <div
                      key={entry.id}
                      ref={(node) => {
                        entryRefs.current[entry.id] = node;
                      }}
                    >
                      <div className="relative group rounded-lg border border-border-subtle bg-surface-default overflow-hidden transition-all hover:border-border-default/50">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-subtle/40 border-b border-border-subtle/40">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-3 w-3 text-text-muted" />
                            <span className="text-[10px] font-medium text-text-subtle font-mono">
                              {mounted ? new Date(entry.created_at || '').toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              }) : new Date(entry.created_at || '').toISOString()}
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
                        <div className="p-3 flex flex-col gap-3">
                          {entry.sections?.map((section: EntryWithSections['sections'][number]) => (
                            <LogSection
                              key={section.id}
                              section={section}
                              highlightTerm={entry.id === highlightEntryId ? highlightTerm ?? undefined : undefined}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
    </div>
  );
}
