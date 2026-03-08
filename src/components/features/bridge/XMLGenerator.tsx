'use client';

import { Copy, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { BlockNoteBlock } from '@/lib/types';

interface XMLGeneratorProps {
  streamId: string;
  interactionMode: string;
  selectedEntries: string[];
  includeCanvas: boolean;
  includeGlobalStream: boolean;
  globalStreamIds: string[];
  globalStreamName: string | null;
  userInput: string;
}

export function XMLGenerator({
  streamId,
  interactionMode,
  selectedEntries,
  includeCanvas,
  includeGlobalStream,
  globalStreamIds,
  globalStreamName,
  userInput,
}: XMLGeneratorProps) {
  const [copied, setCopied] = useState(false);
  const supabase = createClient();

  // Fetch data
  const { data: stream } = useQuery({
    queryKey: ['stream', streamId],
    queryFn: async () => {
      const { data } = await supabase
        .from('streams')
        .select('*, domain:domains(*)')
        .eq('id', streamId)
        .single();
      return data;
    },
  });

  const { data: entries } = useQuery({
    queryKey: ['entries-xml', streamId, selectedEntries],
    queryFn: async () => {
      const { data } = await supabase
        .from('entries')
        .select('*, sections(*)')
        .in('id', selectedEntries)
        .order('created_at', { ascending: true });
      return data as unknown as EntryWithSections[];
    },
    enabled: selectedEntries.length > 0,
  });

  const { data: canvas } = useQuery({
    queryKey: ['canvas', streamId],
    queryFn: async () => {
      const { data } = await supabase
        .from('canvases')
        .select('*')
        .eq('stream_id', streamId)
        .single();
      return data;
    },
    enabled: includeCanvas,
  });

  const additionalGlobalStreamIds = useMemo(
    () => (globalStreamIds ?? []).filter((id) => id !== streamId),
    [globalStreamIds, streamId]
  );

  const { data: globalStreamsMeta } = useQuery({
    queryKey: ['global-streams-meta-xml', additionalGlobalStreamIds],
    queryFn: async () => {
      if (additionalGlobalStreamIds.length === 0) return [];
      const { data } = await supabase
        .from('streams')
        .select('id, name')
        .in('id', additionalGlobalStreamIds);
      return data ?? [];
    },
    enabled: additionalGlobalStreamIds.length > 0,
  });

  const { data: globalEntries } = useQuery({
    queryKey: ['global-entries-xml', additionalGlobalStreamIds, includeGlobalStream],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0) return [];
      const { data } = await supabase
        .from('entries')
        .select('*, sections(*)')
        .in('stream_id', additionalGlobalStreamIds)
        .eq('is_draft', false)
        .order('created_at', { ascending: true });
      return data as unknown as EntryWithSections[];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const { data: globalCanvases } = useQuery({
    queryKey: ['global-canvas-xml', additionalGlobalStreamIds, includeGlobalStream],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0) return [];
      const { data } = await supabase
        .from('canvases')
        .select('*')
        .in('stream_id', additionalGlobalStreamIds);
      return data ?? [];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const generateXML = () => {
    const domainName = stream?.domain?.name || '';
    const isGlobal = stream?.stream_kind === 'GLOBAL' || (stream?.cabinet_id === null && stream?.sort_order === -100);
    const streamNameById = new Map((globalStreamsMeta ?? []).map((globalStream) => [globalStream.id, globalStream.name || globalStream.id]));
    
    return `<system_directive>
Target: ${interactionMode}
Stream: ${stream?.name || ''} ${isGlobal ? '(Global)' : ''}
Domain: ${domainName}
</system_directive>

${
  includeCanvas
    ? `<canvas_state>
${canvasToMarkdown((canvas?.content_json as unknown as BlockNoteBlock[]) || [])}
</canvas_state>`
    : ''
}

<log_context>
${entries?.map((entry) => entryToMarkdown(entry)).join('\n\n') || ''}
</log_context>

${
  includeGlobalStream && additionalGlobalStreamIds.length > 0
    ? `<global_context>
${globalStreamName || 'Domain Global Streams'}

<global_canvases>
${(globalCanvases ?? [])
  .map((canvasItem) => {
    const streamName = streamNameById.get(canvasItem.stream_id) || canvasItem.stream_id;
    return `<global_canvas stream="${streamName}">
${canvasToMarkdown((canvasItem.content_json as unknown as BlockNoteBlock[]) || [])}
</global_canvas>`;
  })
  .join('\n\n')}
</global_canvases>

<global_entries>
${
  globalEntries
    ?.map((entry) => {
      const streamName = streamNameById.get(entry.stream_id) || entry.stream_id;
      return `<global_entry stream="${streamName}">
${entryToMarkdown(entry)}
</global_entry>`;
    })
    .join('\n\n') || ''
}
</global_entries>
</global_context>`
    : ''
}

<instruction>
${userInput}
</instruction>`;
  };

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(generateXML());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4">
      <div className="rounded-lg border border-border-default bg-surface-subtle p-4">
        <pre className="overflow-x-auto text-xs whitespace-pre-wrap text-text-default">{generateXML()}</pre>
      </div>

      <button
        onClick={copyToClipboard}
        className="mt-2 flex items-center gap-2 rounded bg-action-primary-bg px-4 py-2 text-action-primary-text hover:bg-action-primary-hover transition-colors"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {copied ? 'Copied!' : 'Copy to Clipboard'}
      </button>
    </div>
  );
}

// Helper functions
function canvasToMarkdown(blocks: BlockNoteBlock[]): string {
  // Convert BlockNote blocks to markdown
  return blocks.map(blockToMarkdown).join('\n\n');
}

function blockToMarkdown(block: BlockNoteBlock): string {
  // Implementation depends on block type
  if (block.type === 'heading') {
    const level = (block.props?.level as number) || 1;
    return '#'.repeat(level) + ' ' + extractText(block);
  }
  if (block.type === 'paragraph') {
    return extractText(block);
  }
  // ... handle other types
  return extractText(block);
}

function extractText(block: BlockNoteBlock): string {
  return block.content?.map((c) => c.text).join('') || '';
}

import { EntryWithSections, SectionWithPersona } from '@/lib/types';

function entryToMarkdown(entry: EntryWithSections): string {
  return `Entry #${entry.id} - ${entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}
${entry.sections
  .map((s: SectionWithPersona) => canvasToMarkdown(s.content_json as unknown as BlockNoteBlock[]))
  .join('\n')}`;
}
