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
    <div className="my-2 flex flex-col gap-3 rounded-xl border border-border-default/50 bg-surface-subtle/30 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text-default">Context Tokens</span>
          <span className="text-xs text-text-muted mt-0.5">Estimated cost of included entries</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold tabular-nums tracking-tight ${overLimit ? 'text-status-error-text' : 'text-action-primary-bg'}`}>
            {tokens.toLocaleString()}
          </span>
          <span className="text-sm font-medium text-text-muted mt-1.5">/ {tokenLimit.toLocaleString()}</span>
        </div>
      </div>
      
      {overLimit && (
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg bg-status-error-bg/10 p-3 pt-2.5 border border-status-error-bg/20">
          <span className="text-sm font-medium text-status-error-text w-full">Token limit exceeded</span>
          <div className="flex gap-2">
            <button
              onClick={onReduceSelection}
              className="rounded-md bg-surface-default px-3 py-1.5 text-xs font-semibold text-text-default shadow-sm ring-1 ring-border-default/50 hover:bg-surface-hover transition-colors whitespace-nowrap"
            >
              Select Last 5
            </button>
            <button
              onClick={onAutoSummarize}
              className="rounded-md bg-surface-default px-3 py-1.5 text-xs font-semibold text-text-default shadow-sm ring-1 ring-border-default/50 hover:bg-surface-hover transition-colors whitespace-nowrap"
            >
              Drop Canvas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
