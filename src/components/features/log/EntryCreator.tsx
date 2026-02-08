'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { BlockNoteEditor } from '@/components/shared/BlockNoteEditor';
import { PartialBlock } from '@blocknote/core';
import debounce from 'lodash/debounce';
import { Loader2 } from 'lucide-react';
import { Json } from '@/lib/types/database.types';

interface EntryCreatorProps {
  streamId: string;
  personaId?: string; // Optional if not yet implemented
}

export function EntryCreator({ streamId, personaId }: EntryCreatorProps) {
  const [ghostId, setGhostId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [content, setContent] = useState<PartialBlock[]>([]);
  const queryClient = useQueryClient();
  const supabase = createClient();

  const saveEntry = useMutation({
    mutationFn: async (contentBlocks: PartialBlock[]) => {
      // Create entry container
      const { data: entry, error: entryError } = await supabase
        .from('entries')
        .insert({ stream_id: streamId })
        .select()
        .single();

      if (entryError) throw entryError;

      // Create section with content
      // Note: We MUST create a section even if personaId is missing, 
      // otherwise the content is lost. The DB allows nullable persona_id.
      const { error: sectionError } = await supabase.from('sections').insert({
        entry_id: entry.id,
        persona_id: personaId || null,
        content_json: contentBlocks as unknown as Json, // Cast to Json
        sort_order: 0,
      });

      if (sectionError) throw sectionError;

      return entry;
    },
    onSuccess: () => {
      // Clear ghost entry
      setGhostId(null);
      setContent([]);
      setIsSaving(false);

      // Invalidate entries query
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
    },
    onError: (error) => {
      console.error('Failed to save entry:', error);
      // Log detailed error for debugging
      console.error('Error details:', JSON.stringify(error, null, 2));
      setIsSaving(false);
    },
  });

  // Debounced save function
  const debouncedSave = useMemo(
    () =>
      debounce((contentBlocks: PartialBlock[]) => {
        // Check if blocks have content
        const hasContent = contentBlocks.length > 0 && contentBlocks.some((block) => {
          // Check if block has text content or children
          if (block.content && Array.isArray(block.content) && block.content.length > 0) {
            // @ts-expect-error - dynamic type check
            return block.content.some(c => c.text && c.text.trim().length > 0);
          }
          return false;
        });

        if (hasContent) {
          saveEntry.mutate(contentBlocks);
        } else {
          // Clear ghost if empty
          setGhostId(null);
          setIsSaving(false);
        }
      }, 1500),
    [saveEntry]
  );

  const handleContentChange = useCallback(
    (blocks: PartialBlock[]) => {
      setContent(blocks);

      // Create ghost ID on first change
      if (!ghostId) {
        setGhostId('ghost-' + Date.now());
        setIsSaving(true);
      }

      // Debounce save
      debouncedSave(blocks);
    },
    [ghostId, debouncedSave]
  );

  // Force flush on unmount
  useEffect(() => {
    return () => {
      if (ghostId && content.length > 0) {
        debouncedSave.flush();
      }
    };
  }, [ghostId, content, debouncedSave]);

  return (
    <div className="relative rounded-lg border border-border-default bg-surface-default p-4">
      {isSaving && (
        <div className="absolute right-4 top-4 flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      <BlockNoteEditor
        initialContent={content}
        onChange={handleContentChange}
        placeholder="Start typing to create a new entry..."
      />
    </div>
  );
}
