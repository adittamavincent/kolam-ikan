'use client';

import { useMemo, useState } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { createClient } from '@/lib/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { BlockNoteBlock } from '@/lib/types';
import { z } from 'zod';
import { BlockSchema } from '@/lib/validation/entry';
import { Json } from '@/lib/types/database.types';

interface ResponseParserProps {
  streamId?: string;
  interactionMode?: 'ASK' | 'GO' | 'BOTH';
}

type ChangeDecision = 'accept' | 'reject' | 'both';

interface BlockChange {
  id: string;
  type: 'add' | 'modify';
  incoming: BlockNoteBlock;
  current?: BlockNoteBlock;
  decision: ChangeDecision;
  originalId?: string;
}

const BlockArraySchema = z.array(BlockSchema);

function extractBlockText(block: BlockNoteBlock): string {
  return block.content?.map((c) => c.text).join('') || '';
}

function toParagraphBlocks(text: string): BlockNoteBlock[] {
  const chunks = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (chunks.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: [{ type: 'text', text: text.trim() }],
      },
    ];
  }
  return chunks.map((chunk) => ({
    id: crypto.randomUUID(),
    type: 'paragraph',
    content: [{ type: 'text', text: chunk }],
  }));
}

function resolveIncomingBlocks(raw: string): { blocks: BlockNoteBlock[]; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { blocks: [] };
  }
  try {
    const parsed = JSON.parse(trimmed) as BlockNoteBlock[];
    const validated = BlockArraySchema.safeParse(parsed);
    if (!validated.success) {
      return { blocks: [], error: 'Invalid BlockNote JSON' };
    }
    return { blocks: validated.data };
  } catch {
    return { blocks: [], error: 'Canvas update is not valid JSON' };
  }
}

export function ResponseParser({ streamId, interactionMode = 'ASK' }: ResponseParserProps) {
  const [pastedXML, setPastedXML] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [ignoredTags, setIgnoredTags] = useState<string[]>([]);
  const [thoughtLog, setThoughtLog] = useState<string | null>(null);
  const [incomingBlocks, setIncomingBlocks] = useState<BlockNoteBlock[] | null>(null);
  const [changes, setChanges] = useState<BlockChange[]>([]);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [canvasParseError, setCanvasParseError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'current' | 'incoming' | 'merged'>('merged');
  const [usePlainText, setUsePlainText] = useState(false);

  const supabase = createClient();
  const queryClient = useQueryClient();

  const canProcessCanvas = interactionMode === 'GO' || interactionMode === 'BOTH';
  const canProcessLog = interactionMode === 'ASK' || interactionMode === 'BOTH';

  const mergedBlocks = useMemo(() => {
    if (!incomingBlocks) return null;
    const current = queryClient.getQueryData<{ content_json: Json }>(['canvas', streamId])
      ?.content_json as unknown as BlockNoteBlock[] | undefined;
    const currentBlocks = Array.isArray(current) ? current : [];
    if (previewMode === 'current') return currentBlocks;
    if (previewMode === 'incoming') return incomingBlocks;

    const next = [...currentBlocks];
    const indexById = new Map<string, number>();
    next.forEach((block, index) => indexById.set(block.id, index));

    changes.forEach((change) => {
      if (change.type === 'modify' && change.current) {
        if (change.decision === 'accept') {
          const idx = indexById.get(change.current.id);
          if (idx !== undefined) {
            next[idx] = { ...change.incoming, id: change.current.id };
          }
        } else if (change.decision === 'both') {
          const idx = indexById.get(change.current.id);
          if (idx !== undefined) {
            next.splice(idx + 1, 0, change.incoming);
          }
        }
      }
      if (change.type === 'add') {
        if (change.decision !== 'reject') {
          next.push(change.incoming);
        }
      }
    });

    return next;
  }, [changes, incomingBlocks, previewMode, queryClient, streamId]);

  const parseResponse = async () => {
    try {
      setParseError(null);
      setApplyError(null);
      setIgnoredTags([]);
      setThoughtLog(null);
      setIncomingBlocks(null);
      setChanges([]);
      setConflictWarning(null);
      setParseWarnings([]);
      setCanvasParseError(null);
      setUsePlainText(false);

      if (!streamId) {
        throw new Error('Stream not available');
      }

      const sanitized = DOMPurify.sanitize(pastedXML);
      const parser = new DOMParser();
      const doc = parser.parseFromString(sanitized, 'text/xml');

      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        throw new Error('Invalid XML format');
      }

      const nextIgnored: string[] = [];
      const warnings: string[] = [];

      const thoughtNode = doc.querySelector('thought_log');
      const canvasNode = doc.querySelector('canvas_update');
      const baseUpdatedAtNode = doc.querySelector('canvas_base_updated_at');

      if (thoughtNode?.textContent && canProcessLog) {
        setThoughtLog(thoughtNode.textContent.trim());
      } else if (thoughtNode?.textContent) {
        nextIgnored.push('thought_log');
      }

      let resolvedBlocks: BlockNoteBlock[] | null = null;
      if (canvasNode?.textContent && canProcessCanvas) {
        const rawCanvas = canvasNode.textContent.trim();
        const result = resolveIncomingBlocks(rawCanvas);
        if (result.error) {
          setCanvasParseError(result.error);
          warnings.push('Canvas update could not be parsed as JSON');
        } else {
          resolvedBlocks = result.blocks;
          setIncomingBlocks(result.blocks);
        }
      } else if (canvasNode?.textContent) {
        nextIgnored.push('canvas_update');
      }

      if (baseUpdatedAtNode?.textContent) {
        const baseUpdated = baseUpdatedAtNode.textContent.trim();
        const { data: canvas } = await supabase
          .from('canvases')
          .select('id, updated_at, content_json')
          .eq('stream_id', streamId)
          .single();
        if (canvas?.updated_at && baseUpdated && canvas.updated_at !== baseUpdated) {
          setConflictWarning('Canvas was edited after the AI response was generated.');
        }
        if (canvas?.content_json) {
          queryClient.setQueryData(['canvas', streamId], canvas);
        }
      }

      setIgnoredTags(nextIgnored);
      setParseWarnings(warnings);

      if (canProcessCanvas && resolvedBlocks) {
        const currentCanvas = await supabase
          .from('canvases')
          .select('id, content_json, updated_at')
          .eq('stream_id', streamId)
          .single();
        if (currentCanvas.data) {
          queryClient.setQueryData(['canvas', streamId], currentCanvas.data);
        }
        const currentBlocks = (currentCanvas.data?.content_json as unknown as BlockNoteBlock[]) || [];
        const currentMap = new Map(currentBlocks.map((block) => [block.id, block]));
        const nextChanges: BlockChange[] = [];
        resolvedBlocks.forEach((block) => {
          const existing = currentMap.get(block.id);
          if (!existing) {
            nextChanges.push({
              id: block.id,
              type: 'add',
              incoming: block,
              decision: 'accept',
            });
            return;
          }
          const existingText = extractBlockText(existing);
          const incomingText = extractBlockText(block);
          if (existingText !== incomingText) {
            const newId = crypto.randomUUID();
            nextChanges.push({
              id: newId,
              type: 'modify',
              incoming: { ...block, id: newId },
              current: existing,
              decision: 'accept',
              originalId: block.id,
            });
          }
        });
        setChanges(nextChanges);
      }
    } catch (err) {
      setParseError((err as Error).message);
    }
  };

  const handleApply = async () => {
    if (!streamId) return;
    setApplyError(null);
    setIsApplying(true);
    try {
      if (canProcessLog && thoughtLog) {
        const aiPersonaName = 'AI';
        const blocks = toParagraphBlocks(thoughtLog);
        await supabase.rpc('create_entry_with_section', {
          p_stream_id: streamId,
          p_content_json: blocks as unknown as Json,
          p_persona_id: null,
          p_persona_name_snapshot: aiPersonaName,
          p_search_text: null,
          p_is_draft: false,
        });
        await supabase.from('audit_logs').insert({
          action: 'bridge_log_create',
          target_table: 'entries',
          payload: { content: thoughtLog },
        });
        queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      }

      if (canProcessCanvas && mergedBlocks) {
        const { data: canvas, error } = await supabase
          .from('canvases')
          .select('id')
          .eq('stream_id', streamId)
          .single();
        if (error) throw error;
        if (canvas?.id) {
          const { error: updateError } = await supabase
            .from('canvases')
            .update({ content_json: mergedBlocks as unknown as Json })
            .eq('id', canvas.id);
          if (updateError) throw updateError;
          await supabase.from('audit_logs').insert({
            action: 'bridge_canvas_merge',
            target_table: 'canvases',
            target_id: canvas.id,
            payload: {
              changes: changes.map((change) => ({
                id: change.id,
                type: change.type,
                decision: change.decision,
                originalId: change.originalId ?? null,
              })),
            } as unknown as Json,
          });
          queryClient.invalidateQueries({ queryKey: ['canvas', streamId] });
        }
      }
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setIsApplying(false);
    }
  };

  const handlePlainTextImport = () => {
    if (!canProcessCanvas) return;
    const canvasNodeMatch = /<canvas_update[^>]*>([\s\S]*?)<\/canvas_update>/i.exec(pastedXML);
    const raw = canvasNodeMatch?.[1] ?? '';
    const blocks = toParagraphBlocks(raw);
    setIncomingBlocks(blocks);
    setChanges(
      blocks.map((block) => ({
        id: block.id,
        type: 'add',
        incoming: block,
        decision: 'accept',
      }))
    );
    setUsePlainText(true);
    setCanvasParseError(null);
  };

  const updateDecision = (id: string, decision: ChangeDecision) => {
    setChanges((prev) =>
      prev.map((change) => (change.id === id ? { ...change, decision } : change))
    );
  };

  const bulkDecision = (decision: ChangeDecision) => {
    setChanges((prev) => prev.map((change) => ({ ...change, decision })));
  };

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label className="mb-2 block text-sm font-medium text-text-default">
          Paste Response XML
        </label>
        <textarea
          value={pastedXML}
          onChange={(e) => setPastedXML(e.target.value)}
          className="w-full rounded border border-border-default bg-surface-subtle text-text-default p-3 focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg outline-none"
          rows={6}
          placeholder="<response>...</response>"
        />
      </div>

      {parseError && (
        <div className="rounded bg-status-error-bg p-3 text-sm text-status-error-text border border-status-error-border">
          Error: {parseError}
        </div>
      )}

      {ignoredTags.length > 0 && (
        <div className="rounded border border-border-default bg-surface-subtle p-3 text-xs text-text-muted">
          Ignored tags: {ignoredTags.join(', ')}
        </div>
      )}

      {parseWarnings.length > 0 && (
        <div className="rounded border border-border-default bg-surface-subtle p-3 text-xs text-text-muted">
          {parseWarnings.join(' ')}
        </div>
      )}

      {conflictWarning && (
        <div className="rounded border border-status-error-border bg-status-error-bg p-3 text-xs text-status-error-text">
          {conflictWarning}
        </div>
      )}

      {canvasParseError && canProcessCanvas && (
        <div className="flex items-center justify-between rounded border border-border-default bg-surface-subtle p-3 text-xs text-text-muted">
          <span>{canvasParseError}</span>
          <button
            onClick={handlePlainTextImport}
            className="rounded bg-action-primary-bg px-2 py-1 text-[11px] text-action-primary-text hover:bg-action-primary-hover"
          >
            Import as Plain Text
          </button>
        </div>
      )}

      {changes.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              {(['current', 'incoming', 'merged'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPreviewMode(mode)}
                  className={`rounded px-3 py-1 text-xs ${
                    previewMode === mode
                      ? 'bg-action-primary-bg text-action-primary-text'
                      : 'bg-surface-subtle text-text-default hover:bg-surface-hover'
                  }`}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex gap-2 text-xs">
              <button
                onClick={() => bulkDecision('accept')}
                className="rounded bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
              >
                Merge All
              </button>
              <button
                onClick={() => bulkDecision('reject')}
                className="rounded bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
              >
                Reject All
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {changes.map((change) => (
              <div key={change.id} className="rounded border border-border-default bg-surface-default p-3">
                <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
                  <span>{change.type === 'add' ? 'New Block' : 'Changed Block'}</span>
                  {change.originalId && <span>Original ID: {change.originalId}</span>}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {change.current && (
                    <div className="rounded border border-border-default bg-surface-subtle p-2 text-xs text-text-default">
                      {extractBlockText(change.current)}
                    </div>
                  )}
                  <div className="rounded border border-border-default bg-surface-subtle p-2 text-xs text-text-default">
                    {extractBlockText(change.incoming)}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <button
                    onClick={() => updateDecision(change.id, 'accept')}
                    className={`rounded px-2 py-1 ${
                      change.decision === 'accept'
                        ? 'bg-action-primary-bg text-action-primary-text'
                        : 'bg-surface-subtle text-text-default hover:bg-surface-hover'
                    }`}
                  >
                    Accept
                  </button>
                  {change.type === 'modify' && (
                    <button
                      onClick={() => updateDecision(change.id, 'both')}
                      className={`rounded px-2 py-1 ${
                        change.decision === 'both'
                          ? 'bg-action-primary-bg text-action-primary-text'
                          : 'bg-surface-subtle text-text-default hover:bg-surface-hover'
                      }`}
                    >
                      Take Both
                    </button>
                  )}
                  <button
                    onClick={() => updateDecision(change.id, 'reject')}
                    className={`rounded px-2 py-1 ${
                      change.decision === 'reject'
                        ? 'bg-action-primary-bg text-action-primary-text'
                        : 'bg-surface-subtle text-text-default hover:bg-surface-hover'
                    }`}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {applyError && (
        <div className="rounded bg-status-error-bg p-3 text-sm text-status-error-text border border-status-error-border">
          Error: {applyError}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={parseResponse}
          className="rounded bg-action-primary-bg px-4 py-2 text-action-primary-text hover:bg-action-primary-hover transition-colors"
        >
          Parse Response
        </button>
        <button
          onClick={handleApply}
          disabled={isApplying || (!thoughtLog && !mergedBlocks)}
          className="rounded bg-surface-subtle px-4 py-2 text-text-default hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          {isApplying ? 'Applying...' : 'Apply Changes'}
        </button>
        {usePlainText && (
          <span className="text-xs text-text-muted self-center">Canvas imported as plain text</span>
        )}
      </div>
    </div>
  );
}
