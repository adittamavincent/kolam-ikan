'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export function ContextBag({
  streamId,
  selectedEntries,
  onSelectionChange,
  includeCanvas,
  onIncludeCanvasChange,
  disableSelectAll,
}: {
  streamId: string;
  selectedEntries: string[];
  onSelectionChange: (ids: string[]) => void;
  includeCanvas: boolean;
  onIncludeCanvasChange: (include: boolean) => void;
  disableSelectAll?: boolean;
}) {
  const supabase = createClient();

  const { data: entries } = useQuery({
    queryKey: ['bridge-entries', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .select('id, created_at, sections(id, persona_name_snapshot, search_text)')
        .eq('stream_id', streamId)
        .eq('is_draft', false)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!streamId,
  });

  const groupedEntries = useMemo(() => {
    const groups: Record<string, typeof entries> = {};
    (entries ?? []).forEach((entry) => {
      const dateKey = entry.created_at ? new Date(entry.created_at).toDateString() : 'Unknown Date';
      groups[dateKey] = groups[dateKey] || [];
      groups[dateKey]?.push(entry);
    });
    return Object.entries(groups);
  }, [entries]);

  const toggleEntry = (entryId: string) => {
    if (selectedEntries.includes(entryId)) {
      onSelectionChange(selectedEntries.filter((id) => id !== entryId));
    } else {
      onSelectionChange([...selectedEntries, entryId]);
    }
  };

  const selectAll = () => {
    if (disableSelectAll) return;
    onSelectionChange((entries ?? []).map((entry) => entry.id));
  };

  const selectLastFive = () => {
    const ids = (entries ?? []).slice(0, 5).map((entry) => entry.id);
    onSelectionChange(ids);
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  return (
    <div className="mb-4 rounded border border-border-default p-4">
      <h3 className="mb-2 font-medium text-text-default">Context Bag</h3>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-text-default text-sm">
          <input
            type="checkbox"
            checked={includeCanvas}
            onChange={(e) => onIncludeCanvasChange(e.target.checked)}
          />
          Include Current Canvas
        </label>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={selectAll}
            disabled={disableSelectAll}
            className="rounded bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover disabled:opacity-50"
          >
            Select All
          </button>
          <button
            onClick={selectLastFive}
            className="rounded bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
          >
            Last 5
          </button>
          <button
            onClick={clearAll}
            className="rounded bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
          >
            Clear
          </button>
          <span className="ml-auto text-text-muted">{selectedEntries.length} selected</span>
        </div>
        <div className="max-h-48 space-y-3 overflow-y-auto rounded border border-border-subtle p-2 text-xs">
          {groupedEntries.length === 0 && (
            <div className="text-text-muted">No entries yet.</div>
          )}
          {groupedEntries.map(([dateKey, group]) => (
            <div key={dateKey} className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {dateKey}
              </div>
              {group?.map((entry) => {
                const preview =
                  entry.sections?.[0]?.search_text ||
                  entry.sections?.[0]?.persona_name_snapshot ||
                  'Empty entry';
                return (
                  <label key={entry.id} className="flex items-start gap-2 text-text-default">
                    <input
                      type="checkbox"
                      checked={selectedEntries.includes(entry.id)}
                      onChange={() => toggleEntry(entry.id)}
                    />
                    <div>
                      <div className="text-[11px] text-text-default">{preview.slice(0, 80)}</div>
                      <div className="text-[10px] text-text-muted">
                        {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown time'}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
