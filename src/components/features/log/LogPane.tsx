'use client';

import { useLayout } from '@/lib/hooks/useLayout';
import { useEntries } from '@/lib/hooks/useEntries';
import { EntryCreator } from './EntryCreator';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { Loader2 } from 'lucide-react';
import { PartialBlock } from '@blocknote/core';

interface LogPaneProps {
  streamId: string;
}

export function LogPane({ streamId }: LogPaneProps) {
  const { logWidth } = useLayout();
  const { entries, isLoading, error } = useEntries(streamId);

  if (logWidth === 0) return null;

  return (
    <div
      className="border-r border-gray-200 bg-white transition-all duration-300 ease-in-out"
      style={{ width: `${logWidth}%` }}
    >
      <div className="flex h-full flex-col">
        <div className="border-b border-gray-200 p-4">
          <h2 className="text-lg font-semibold text-gray-900">The Log</h2>
          <p className="text-sm text-gray-500">Stream: {streamId}</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Entry Creator */}
          <EntryCreator streamId={streamId} />

          {/* Error State */}
          {error && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
              Error loading entries. Please try refreshing.
            </div>
          )}

          {/* Entries List */}
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-6">
              {entries?.map((entry) => (
                <div key={entry.id} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
                    <span>{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span>
                    <span>#{entry.id.slice(0, 8)}</span>
                  </div>
                  
                  {/* Render sections */}
                  <div className="space-y-4">
                    {entry.sections?.map((section) => (
                      <div key={section.id} className="bg-white rounded p-2 border border-gray-100">
                         <div className="mb-1 text-xs font-medium text-gray-600">
                           {section.persona?.name || 'User'}
                         </div>
                         <BlockNoteEditor
                           initialContent={section.content_json as unknown as PartialBlock[]}
                           editable={false}
                         />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              
              {entries?.length === 0 && (
                <div className="text-center text-sm text-gray-400 py-8">
                  No entries yet. Start typing above!
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
