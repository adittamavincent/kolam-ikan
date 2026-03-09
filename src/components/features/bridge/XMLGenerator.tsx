'use client';

import { Copy, Check } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { BlockNoteBlock, EntryWithSections, SectionWithPersona } from '@/lib/types';

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
    const canvasUpdatedAt = (canvas as Record<string, unknown>)?.updated_at as string | undefined;

    const responseFormatDirective = buildResponseDirective(interactionMode, canvasUpdatedAt);

    return `<system_directive>
Target: ${interactionMode}
Stream: ${stream?.name || ''} ${isGlobal ? '(Global)' : ''}
Domain: ${domainName}

${responseFormatDirective}
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
    <div className="mt-4 space-y-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-text-default">Generated Bridge XML</label>
        <p className="mb-2 text-xs text-text-muted">Review and copy this payload to your model before generating a response.</p>
      </div>

      <div className="rounded border border-border-default bg-surface-subtle p-3">
        <textarea
          readOnly
          rows={6}
          value={generateXML()}
          className="w-full rounded border border-border-default bg-surface-default p-3 font-mono text-[12px] leading-5 text-text-default outline-none resize-none"
        />
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

function entryToMarkdown(entry: EntryWithSections): string {
  return `Entry #${entry.id} - ${entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}
${entry.sections
  .map((s: SectionWithPersona) => canvasToMarkdown(s.content_json as unknown as BlockNoteBlock[]))
  .join('\n')}`;
}

function buildResponseDirective(mode: string, canvasUpdatedAt?: string): string {
  const askDirective = `<response_format_ask>
You MUST respond with a <thought_log> tag containing your analysis, reasoning, or answer.
This content will be saved as a new entry (log item) in the stream's left pillar.

Write in natural prose. Separate paragraphs with blank lines.
Each double-newline-separated paragraph becomes a distinct block in the entry.

Do NOT include any canvas-related tags.

Example response:
<response>
<thought_log>
Your analysis paragraph one goes here.

Another paragraph with further reasoning.
</thought_log>
</response>
</response_format_ask>`;

  const goDirective = `<response_format_go>
You MUST respond with a <canvas_update> tag containing compact markdown-style text.
This updates the stream canvas (right pillar) with minimal token usage.

Allowed syntax inside <canvas_update>:
- Headings: #, ##, ###
- Bullets: - item
- Numbered list: 1. item
- Paragraphs: plain lines
- Inline style: **bold**, *italic*, \`code\`

${canvasUpdatedAt ? `<canvas_base_updated_at>${canvasUpdatedAt}</canvas_base_updated_at>\nEcho this exact <canvas_base_updated_at> value back in your response for conflict detection.` : ''}

Do NOT include any thought_log tags in GO mode.

Example response:
<response>
<canvas_update>
# Recommendation List

- Stabilize team alignment in week 1
- Run 1:1 check-ins with core members

1. Define 3 top priorities
2. Assign owners and due dates
</canvas_update>
${canvasUpdatedAt ? `<canvas_base_updated_at>${canvasUpdatedAt}</canvas_base_updated_at>` : ''}
</response>
</response_format_go>`;

  const bothDirective = `<response_format_both>
You MUST respond with BOTH a <thought_log> tag AND a <canvas_update> tag.

1. <thought_log>: Your analysis/reasoning in natural prose (saved as a new log entry in the left pillar).
   Separate paragraphs with blank lines.

2. <canvas_update>: compact markdown-style content for canvas update.
   Use #/## headings, - bullets, numbered lists, and plain paragraphs.
  Inline style allowed: **bold**, *italic*, \`code\`.

${canvasUpdatedAt ? `<canvas_base_updated_at>${canvasUpdatedAt}</canvas_base_updated_at>\nEcho this exact <canvas_base_updated_at> value back in your response for conflict detection.` : ''}

Example response:
<response>
<thought_log>
Your reasoning and analysis go here.

Additional observations in a second paragraph.
</thought_log>
<canvas_update>
## Action Plan

- Quick win 1
- Quick win 2

1. Step one
2. Step two
</canvas_update>
${canvasUpdatedAt ? `<canvas_base_updated_at>${canvasUpdatedAt}</canvas_base_updated_at>` : ''}
</response>
</response_format_both>`;

  const modeDirectives: Record<string, string> = {
    ASK: askDirective,
    GO: goDirective,
    BOTH: bothDirective,
  };

  return `<response_instructions>
You are an AI assistant integrated into a structured knowledge management system called "Kolam Ikan".
Your response MUST be wrapped in a <response> root tag and follow the structured output format below exactly.
Do NOT output any text outside the <response> tags. The system parses your XML response programmatically.

The user's interaction mode is: ${mode}
${mode === 'ASK' ? '- ASK mode: Generate a thought log entry only (left pillar / log).' : ''}${mode === 'GO' ? '- GO mode: Generate a canvas update only (right pillar / canvas).' : ''}${mode === 'BOTH' ? '- BOTH mode: Generate both a thought log entry AND a canvas update.' : ''}

${modeDirectives[mode] || modeDirectives['ASK']}
</response_instructions>`;
}
