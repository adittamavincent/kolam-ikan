'use client';

import { useMemo, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { BlockNoteBlock, BlockNoteContent } from '@/lib/types';
import { z } from 'zod';
import { BlockSchema } from '@/lib/validation/entry';
import { Json } from '@/lib/types/database.types';

interface ResponseParserProps {
  streamId?: string;
  interactionMode?: 'ASK' | 'GO' | 'BOTH';
  pastedXML: string;
  onPastedXMLChange: (value: string) => void;
  onStatusChange?: (status: {
    isApplying: boolean;
    canApply: boolean;
    canParse: boolean;
    hasParsed: boolean;
  }) => void;
}

export interface ResponseParserHandle {
  parse: () => void;
  apply: () => void;
  reset: () => void;
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

function parseInlineMarkdown(text: string): BlockNoteContent[] {
  const tokens: BlockNoteContent[] = [];
  const pattern = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;

    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        text: text.slice(lastIndex, match.index),
      });
    }

    const matched = match[0];
    if (matched.startsWith('**') && matched.endsWith('**')) {
      tokens.push({
        type: 'text',
        text: matched.slice(2, -2),
        styles: { bold: true },
      });
    } else if (matched.startsWith('*') && matched.endsWith('*')) {
      tokens.push({
        type: 'text',
        text: matched.slice(1, -1),
        styles: { italic: true },
      });
    } else if (matched.startsWith('`') && matched.endsWith('`')) {
      tokens.push({
        type: 'text',
        text: matched.slice(1, -1),
        styles: { code: true },
      });
    }

    lastIndex = match.index + matched.length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      text: text.slice(lastIndex),
    });
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', text }];
}

function toParagraphBlocks(text: string): BlockNoteBlock[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: [{ type: 'text', text: '' }],
      },
    ];
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trimEnd());

  const blocks: BlockNoteBlock[] = [];
  let blankStreak = 0;

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (!line) {
      blankStreak += 1;
      if (blankStreak >= 2) {
        blocks.push({
          id: crypto.randomUUID(),
          type: 'paragraph',
          content: [{ type: 'text', text: '' }],
        });
        blankStreak = 0;
      }
      return;
    }

    blankStreak = 0;

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: 'heading',
        props: { level: headingMatch[1].length as unknown as Json },
        content: parseInlineMarkdown(headingMatch[2]),
        children: [],
      });
      return;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: 'bulletListItem',
        content: parseInlineMarkdown(bulletMatch[1]),
        children: [],
      });
      return;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      blocks.push({
        id: crypto.randomUUID(),
        type: 'numberedListItem',
        content: parseInlineMarkdown(numberedMatch[1]),
        children: [],
      });
      return;
    }

    blocks.push({
      id: crypto.randomUUID(),
      type: 'paragraph',
      content: parseInlineMarkdown(line),
      children: [],
    });
  });

  if (blocks.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: [{ type: 'text', text: normalized }],
        children: [],
      },
    ];
  }

  return blocks;
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

function resolveCanvasBlocks(raw: string): {
  blocks: BlockNoteBlock[];
  format: 'json' | 'markdown';
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { blocks: [], format: 'markdown' };
  }

  const looksLikeJson = trimmed.startsWith('[') || trimmed.startsWith('{');
  if (looksLikeJson) {
    const jsonResult = resolveIncomingBlocks(trimmed);
    if (!jsonResult.error) {
      return { blocks: jsonResult.blocks, format: 'json' };
    }
    return {
      blocks: [],
      format: 'json',
      error: 'Canvas update looks like JSON but is invalid. Use valid JSON or compact markdown.',
    };
  }

  return { blocks: toParagraphBlocks(trimmed), format: 'markdown' };
}

function extractTagContent(text: string, tagName: string): string | null {
  const pattern = new RegExp(
    `<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`,
    'i'
  );
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  return match[1].trim();
}

export const ResponseParser = forwardRef<ResponseParserHandle, ResponseParserProps>(({ 
  streamId, 
  interactionMode = 'ASK',
  pastedXML,
  onPastedXMLChange,
  onStatusChange,
}, ref) => {
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

  const reset = () => {
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
    onPastedXMLChange('');
  };

  useImperativeHandle(ref, () => ({
    parse: parseResponse,
    apply: handleApply,
    reset,
  }));

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

  const canApply = !isApplying && (!!thoughtLog || !!mergedBlocks);
  const canParse = !!pastedXML.trim();
  const hasParsed = !!thoughtLog || !!incomingBlocks;

  useEffect(() => {
    onStatusChange?.({
      isApplying,
      canApply,
      canParse,
      hasParsed,
    });
  }, [isApplying, canApply, canParse, hasParsed, onStatusChange]);

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

      const raw = pastedXML.trim();
      if (!raw) {
        throw new Error('No response to parse');
      }

      const nextIgnored: string[] = [];
      const warnings: string[] = [];

      const thoughtContent = extractTagContent(raw, 'thought_log');
      const canvasJsonContent = extractTagContent(raw, 'canvas_update_json');
      const canvasMarkdownContent = extractTagContent(raw, 'canvas_update_md');
      const canvasDefaultContent = extractTagContent(raw, 'canvas_update');
      const canvasContent = canvasJsonContent ?? canvasMarkdownContent ?? canvasDefaultContent;
      const baseUpdatedAt = extractTagContent(raw, 'canvas_base_updated_at');

      if (!thoughtContent && !canvasContent) {
        throw new Error(
          'Could not find <thought_log> or canvas update tags (<canvas_update>, <canvas_update_md>, <canvas_update_json>) in the response. ' +
          'Make sure the LLM response contains the expected XML structure.'
        );
      }

      if (thoughtContent && canProcessLog) {
        setThoughtLog(thoughtContent);
      } else if (thoughtContent) {
        nextIgnored.push('thought_log');
      }

      if (canProcessLog && !thoughtContent) {
        warnings.push('No <thought_log> found — expected for this interaction mode.');
      }

      let resolvedBlocks: BlockNoteBlock[] | null = null;
      if (canvasContent && canProcessCanvas) {
        const result = (() => {
          if (canvasJsonContent) {
            const jsonResult = resolveIncomingBlocks(canvasJsonContent);
            return {
              blocks: jsonResult.blocks,
              error: jsonResult.error,
              format: 'json' as const,
            };
          }
          return resolveCanvasBlocks(canvasContent);
        })();
        if (result.error) {
          setCanvasParseError(result.error);
          warnings.push('Canvas update could not be parsed');
        } else {
          resolvedBlocks = result.blocks;
          setIncomingBlocks(result.blocks);
          if (result.format === 'markdown') {
            warnings.push('Canvas update parsed in compact markdown mode.');
          }
        }
      } else if (canvasContent) {
        nextIgnored.push('canvas_update');
      }

      if (canProcessCanvas && !canvasContent) {
        warnings.push('No canvas update tag found — expected <canvas_update>, <canvas_update_md>, or <canvas_update_json>.');
      }

      if (baseUpdatedAt) {
        const { data: canvas } = await supabase
          .from('canvases')
          .select('id, updated_at, content_json')
          .eq('stream_id', streamId)
          .single();
        if (canvas?.updated_at && canvas.updated_at !== baseUpdatedAt) {
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
          p_persona_id: undefined,
          p_persona_name_snapshot: aiPersonaName,
          p_is_draft: false,
        });
        await supabase.from('audit_logs').insert({
          action: 'bridge_log_create',
          target_table: 'entries',
          payload: { content: thoughtLog },
        });
        queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
        queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
        queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
        queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
        queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });
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

          // Auto-save a canvas snapshot so it appears in the timeline
          const { data: userData } = await supabase.auth.getUser();
          const summaryText = thoughtLog
            ? thoughtLog.length > 200
              ? thoughtLog.slice(0, 200) + '…'
              : thoughtLog
            : null;
          await supabase.from('canvas_versions').insert({
            canvas_id: canvas.id,
            stream_id: streamId,
            content_json: mergedBlocks as unknown as Json,
            name: 'AI Bridge Update',
            summary: summaryText,
            created_by: userData.user?.id ?? null,
          });

          queryClient.invalidateQueries({ queryKey: ['canvas', streamId] });
          queryClient.invalidateQueries({ queryKey: ['canvas-versions', streamId] });
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
    const raw =
      extractTagContent(pastedXML, 'canvas_update_md') ??
      extractTagContent(pastedXML, 'canvas_update') ??
      extractTagContent(pastedXML, 'canvas_update_json') ??
      '';
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
        <p className="mb-2 text-xs text-text-muted">Paste the model output in the same XML structure to parse and merge safely.</p>
        <textarea
          value={pastedXML}
          onChange={(e) => onPastedXMLChange(e.target.value)}
          className="w-full rounded border border-border-default bg-surface-subtle p-3 font-mono text-[12px] leading-5 text-text-default focus:border-action-primary-bg focus:ring-1 focus:ring-action-primary-bg outline-none"
          rows={6}
          placeholder={`Paste the LLM response here. Expected format:\n<response>\n  ${canProcessLog ? '<thought_log>...</thought_log>' : ''}${canProcessLog && canProcessCanvas ? '\n  ' : ''}${canProcessCanvas ? '<canvas_update>markdown or JSON</canvas_update>' : ''}\n</response>`}
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

      {conflictWarning && (
        <div className="rounded-lg border border-status-error-border bg-status-error-bg/20 p-3 text-xs text-status-error-text">
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

      {(thoughtLog || incomingBlocks) && (
        <div className="rounded border border-border-default bg-surface-subtle p-3 text-xs space-y-2">
          <div className="font-medium text-text-default">Parsed Content</div>
          {thoughtLog && (
            <div>
              <span className="font-medium text-text-muted">Thought Log → New Entry:</span>
              <div className="mt-1 max-h-32 overflow-y-auto rounded bg-surface-default p-2 text-text-default whitespace-pre-wrap">
                {thoughtLog}
              </div>
            </div>
          )}
          {incomingBlocks && (
            <div>
              <span className="font-medium text-text-muted">
                Canvas Update: {incomingBlocks.length} block{incomingBlocks.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
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
                  className={`rounded px-3 py-1 text-xs ${previewMode === mode
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

          <div className="divide-y divide-border-subtle/30 overflow-hidden rounded-lg border border-border-default/50 bg-surface-default shadow-sm">
            {changes.map((change) => (
              <div key={change.id} className="flex flex-col md:flex-row items-stretch group hover:bg-surface-subtle/30 transition-colors">
                {/* Meta info & Labels */}
                <div className="flex flex-row md:flex-col items-center md:items-start justify-between md:justify-center px-4 py-2 bg-surface-subtle/50 md:w-32 border-b md:border-b-0 md:border-r border-border-subtle/30">
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${change.type === 'add' ? 'text-status-success-text' : 'text-action-primary-bg'}`}>
                    {change.type === 'add' ? 'New' : 'Update'}
                  </span>
                  {change.originalId && <span className="text-[9px] text-text-muted font-mono truncate max-w-full md:mt-1 opacity-50 group-hover:opacity-100 transition-opacity">ID: {change.originalId.slice(0,8)}</span>}
                </div>

                {/* Content area */}
                <div className="flex-1 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border-subtle/20">
                  {change.current && (
                    <div className="flex-1 p-3 flex flex-col gap-1 min-w-0">
                      <span className="text-[9px] font-bold text-text-muted uppercase">Current</span>
                      <div className="text-[12px] text-text-muted line-clamp-3 md:line-clamp-6 leading-relaxed">
                        {extractBlockText(change.current)}
                      </div>
                    </div>
                  )}
                  <div className="flex-1 p-3 flex flex-col gap-1 min-w-0 bg-surface-subtle/10">
                    <span className="text-[9px] font-bold text-text-muted uppercase">Incoming</span>
                    <div className="text-[12px] text-text-default font-medium leading-relaxed">
                      {extractBlockText(change.incoming)}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex p-2 items-center justify-center gap-1.5 bg-surface-subtle/20 border-t md:border-t-0 md:border-l border-border-subtle/30 min-w-[120px]">
                  <button
                    onClick={() => updateDecision(change.id, 'accept')}
                    title="Accept"
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-bold transition-all ${
                      change.decision === 'accept'
                        ? 'bg-action-primary-bg text-action-primary-text shadow-sm'
                        : 'text-text-muted hover:text-text-default hover:bg-surface-hover/50'
                    }`}
                  >
                    Accept
                  </button>
                  {change.type === 'modify' && (
                    <button
                      onClick={() => updateDecision(change.id, 'both')}
                      title="Keep both"
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-bold transition-all ${
                        change.decision === 'both'
                          ? 'bg-action-primary-bg text-action-primary-text shadow-sm'
                          : 'text-text-muted hover:text-text-default hover:bg-surface-hover/50'
                      }`}
                    >
                      Both
                    </button>
                  )}
                  <button
                    onClick={() => updateDecision(change.id, 'reject')}
                    title="Reject"
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-bold transition-all ${
                      change.decision === 'reject'
                        ? 'bg-action-primary-bg text-action-primary-text shadow-sm'
                        : 'text-text-muted hover:text-text-default hover:bg-surface-hover/50'
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
});

ResponseParser.displayName = 'ResponseParser';
