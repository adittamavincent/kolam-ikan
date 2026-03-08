'use client';

import { useState, Fragment, useEffect, useRef, useCallback } from 'react';
import { useEntries } from '@/lib/hooks/useEntries';
import { EntryCreator } from './EntryCreator';
import { LogSection } from './LogSection';
import { useStream } from '@/lib/hooks/useStream';
import { Filter, ArrowUpDown, Search, Download, Calendar, PanelLeft, Check, X, PencilLine, Loader2 } from 'lucide-react';
import { usePersonas } from '@/lib/hooks/usePersonas';
import { Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { DynamicIcon } from '@/components/shared/DynamicIcon';
import { exportEntriesToMarkdown, downloadMarkdown } from '@/lib/utils/export';
import { useSidebar } from '@/lib/hooks/useSidebar';
import { EntryWithSections } from '@/lib/types';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { PartialBlock } from '@blocknote/core';

interface AmendState {
  entryId: string;
  sections: Record<string, PartialBlock[]>;
}

interface LogPaneProps {
  streamId: string;
  logWidth: number;
  forceWidth?: number;
}

export function LogPane({ streamId, logWidth, forceWidth }: LogPaneProps) {
  const supabase = createClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterPersonaId, setFilterPersonaId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [amendState, setAmendState] = useState<AmendState | null>(null);
  const [amendError, setAmendError] = useState<string | null>(null);
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
    amendEntry,
    fetchAllEntriesForExport,
  } = useEntries(streamId, {
    search: debouncedSearch,
    personaId: filterPersonaId,
    sortOrder,
  });

  const { data: latestEntryId } = useQuery({
    queryKey: ['latest-entry-id', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .select('id')
        .eq('stream_id', streamId)
        .eq('is_draft', false)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data?.id ?? null;
    },
    enabled: !!streamId,
  });
  useEffect(() => {
    scrollToHighlighted();
  }, [entryList, scrollToHighlighted]);

  const { stream } = useStream(streamId);
  const { personas } = usePersonas();
  const { visible: sidebarVisible, show: showSidebar } = useSidebar();

  const [isToolbarOpen, setIsToolbarOpen] = useState(false);

  const handleStartAmend = (entry: EntryWithSections) => {
    const sections = Object.fromEntries(
      (entry.sections ?? []).map((section) => [
        section.id,
        ((section.content_json as unknown as PartialBlock[]) ?? []) as PartialBlock[],
      ]),
    );
    setAmendState({ entryId: entry.id, sections });
    setAmendError(null);
  };

  const handleCancelAmend = () => {
    setAmendState(null);
    setAmendError(null);
  };

  const handleSaveAmend = async (entry: EntryWithSections) => {
    if (!amendState || amendState.entryId !== entry.id) return;

    const changedSections = (entry.sections ?? []).flatMap((section) => {
      const draftBlocks = amendState.sections[section.id];
      if (!draftBlocks) return [];

      const original = JSON.stringify((section.content_json as unknown as PartialBlock[]) ?? []);
      const updated = JSON.stringify(draftBlocks);

      if (original === updated) return [];

      return [
        {
          sectionId: section.id,
          content: draftBlocks,
        },
      ];
    });

    if (!changedSections.length) {
      handleCancelAmend();
      return;
    }

    try {
      setAmendError(null);
      await amendEntry.mutateAsync({
        entryId: entry.id,
        sections: changedSections,
      });
      setAmendState(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to amend entry';
      setAmendError(message);
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

  const resolvedWidth = forceWidth ?? logWidth;
  const isVisible = resolvedWidth > 0;

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
                {!sidebarVisible && (
                  <button
                    onClick={showSidebar}
                    className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-primary-bg"
                    title="Show sidebar"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </button>
                )}
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
                <div className="flex flex-col gap-2.5">
                  {entryList.map((entry) => {
                    const isLatestEntry = latestEntryId === entry.id;
                    const isAmending = amendState?.entryId === entry.id;

                    return (
                    <div
                      key={entry.id}
                      ref={(node) => {
                        entryRefs.current[entry.id] = node;
                      }}
                    >
                      <div className={`relative group rounded-lg border bg-surface-default overflow-hidden transition-all ${isAmending ? 'border-action-primary-bg/50 ring-1 ring-action-primary-bg/40' : 'border-border-subtle hover:border-border-default/50'}`}>
                        <div className="flex items-center px-2.5 py-1 bg-surface-subtle/40 border-b border-border-subtle/40">
                          <div className="flex w-full items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <Calendar className="h-3 w-3 text-text-muted" />
                              <span className="text-[10px] font-medium text-text-subtle font-mono">
                                {mounted ? new Date(entry.created_at || '').toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                }) : new Date(entry.created_at || '').toISOString()}
                              </span>
                              {isLatestEntry && (
                                <span className="inline-flex items-center rounded-full border border-action-primary-bg/30 bg-action-primary-bg/10 px-2 py-0.5 text-[10px] font-semibold text-action-primary-bg">
                                  Latest
                                </span>
                              )}
                            </div>

                            {isLatestEntry && (
                              <div className="flex items-center gap-1">
                                {isAmending ? (
                                  <>
                                    <button
                                      onClick={() => handleSaveAmend(entry)}
                                      disabled={amendEntry.isPending}
                                      className="inline-flex items-center gap-1 rounded-md bg-action-primary-bg px-2 py-1 text-[10px] font-semibold text-action-primary-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                                      title="Save amendment"
                                    >
                                      {amendEntry.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                                      Save
                                    </button>
                                    <button
                                      onClick={handleCancelAmend}
                                      disabled={amendEntry.isPending}
                                      className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-[10px] font-semibold text-text-subtle transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-70"
                                      title="Cancel amendment"
                                    >
                                      <X className="h-3 w-3" />
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => handleStartAmend(entry)}
                                    className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-[10px] font-semibold text-text-subtle transition-colors hover:bg-surface-subtle"
                                    title="Amend latest entry"
                                  >
                                    <PencilLine className="h-3 w-3" />
                                    Amend
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        {isAmending && amendError && (
                          <div className="px-2.5 py-1 text-[11px] text-danger-text bg-danger-bg/15 border-b border-danger-border/30">
                            {amendError}
                          </div>
                        )}
                        <div className="px-2.5 py-2 flex flex-col gap-1.5">
                          {entry.sections?.map((section: EntryWithSections['sections'][number]) => (
                            <LogSection
                              key={section.id}
                              section={section}
                              editable={isAmending}
                              onContentChange={(content) => {
                                if (!isAmending) return;
                                setAmendState((prev) => {
                                  if (!prev || prev.entryId !== entry.id) return prev;
                                  return {
                                    ...prev,
                                    sections: {
                                      ...prev.sections,
                                      [section.id]: content,
                                    },
                                  };
                                });
                              }}
                              highlightTerm={entry.id === highlightEntryId ? highlightTerm ?? undefined : undefined}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                    );
                  })}
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
