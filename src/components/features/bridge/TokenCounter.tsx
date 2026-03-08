'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { encode } from 'gpt-tokenizer';
import { BlockNoteBlock, EntryWithSections } from '@/lib/types';

function blocksToText(blocks: BlockNoteBlock[]): string {
  return blocks
    .map((block) => {
      const content = Array.isArray(block.content) ? block.content : [];
      return content
        .map((item) =>
          typeof (item as { text?: unknown }).text === 'string' ? (item as { text: string }).text : ''
        )
        .join('');
    })
    .filter(Boolean)
    .join('\n');
}

export function TokenCounter({
  selectedEntries,
  includeCanvas,
  streamId,
  includeGlobalStream,
  globalStreamIds,
  tokenLimit = 8000,
  onTokenUpdate,
  onReduceSelection,
  onAutoSummarize,
}: {
  selectedEntries: string[];
  includeCanvas: boolean;
  streamId: string;
  includeGlobalStream: boolean;
  globalStreamIds: string[];
  tokenLimit?: number;
  onTokenUpdate?: (tokens: number, overLimit: boolean) => void;
  onReduceSelection?: () => void;
  onAutoSummarize?: () => void;
}) {
  const supabase = createClient();
  const additionalGlobalStreamIds = (globalStreamIds ?? []).filter((id) => id !== streamId);

  const { data: entries } = useQuery({
    queryKey: ['bridge-token-entries', streamId, selectedEntries],
    queryFn: async () => {
      if (selectedEntries.length === 0) return [];
      const { data, error } = await supabase
        .from('entries')
        .select('id, created_at, sections(content_json, persona_name_snapshot)')
        .in('id', selectedEntries)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as EntryWithSections[];
    },
    enabled: selectedEntries.length > 0,
  });

  const { data: canvas } = useQuery({
    queryKey: ['bridge-token-canvas', streamId, includeCanvas],
    queryFn: async () => {
      if (!includeCanvas) return null;
      const { data, error } = await supabase
        .from('canvases')
        .select('content_json')
        .eq('stream_id', streamId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: includeCanvas,
  });

  const { data: globalEntries } = useQuery({
    queryKey: ['bridge-token-global-entries', additionalGlobalStreamIds, includeGlobalStream],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0) return [];
      const { data, error } = await supabase
        .from('entries')
        .select('id, created_at, sections(content_json, persona_name_snapshot)')
        .in('stream_id', additionalGlobalStreamIds)
        .eq('is_draft', false)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as unknown as EntryWithSections[];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const { data: globalCanvases } = useQuery({
    queryKey: ['bridge-token-global-canvas', additionalGlobalStreamIds, includeGlobalStream],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0) return [];
      const { data, error } = await supabase
        .from('canvases')
        .select('content_json')
        .in('stream_id', additionalGlobalStreamIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const tokens = useMemo(() => {
    const entryText =
      entries?.map((entry) => {
        const sectionsText =
          entry.sections
            ?.map((section) => blocksToText(section.content_json as unknown as BlockNoteBlock[]))
            .join('\n') ?? '';
        return sectionsText;
      }) ?? [];
    const canvasText = includeCanvas
      ? blocksToText((canvas?.content_json as unknown as BlockNoteBlock[]) ?? [])
      : '';
    const globalEntryText = includeGlobalStream && additionalGlobalStreamIds.length > 0
      ? (globalEntries?.map((entry) => {
        const sectionsText =
          entry.sections
            ?.map((section) => blocksToText(section.content_json as unknown as BlockNoteBlock[]))
            .join('\n') ?? '';
        return sectionsText;
      }) ?? [])
      : [];
    const globalCanvasText = includeGlobalStream && additionalGlobalStreamIds.length > 0
      ? (globalCanvases?.map((canvasItem) => blocksToText((canvasItem.content_json as unknown as BlockNoteBlock[]) ?? [])) ?? [])
      : [];

    const combined = [...entryText, canvasText, ...globalEntryText, ...globalCanvasText]
      .filter(Boolean)
      .join('\n');
    return encode(combined).length;
  }, [entries, canvas, globalEntries, globalCanvases, includeCanvas, includeGlobalStream, additionalGlobalStreamIds.length]);

  const overLimit = tokens > tokenLimit;

  useEffect(() => {
    onTokenUpdate?.(tokens, overLimit);
  }, [tokens, overLimit, onTokenUpdate]);

  return (
    <div className="mb-4 space-y-2 text-sm text-text-muted">
      <div className="flex items-center justify-between">
        <span>Tokens: {tokens}</span>
        <span className={overLimit ? 'text-status-error-text' : 'text-text-muted'}>
          Limit: {tokenLimit}
        </span>
      </div>
      {overLimit && (
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={onReduceSelection}
            className="rounded bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
          >
            Reduce Selection
          </button>
          <button
            onClick={onAutoSummarize}
            className="rounded bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
          >
            Auto-Summarize
          </button>
        </div>
      )}
    </div>
  );
}
