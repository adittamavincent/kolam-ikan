import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { PartialBlock } from '@blocknote/core';
import debounce from 'lodash/debounce';
import { EntryContentSchema } from '@/lib/validation/entry';
import { EntryWithSections } from '@/lib/types';
import { Json } from '@/lib/types/database.types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

interface UseDraftSystemProps {
  streamId: string;
  personaId?: string | null;
  personaName?: string | null;
}

interface DraftState {
  content: PartialBlock[];
  entryId: string | null;
  sectionId: string | null;
  updatedAt: number;
}

const STORAGE_PREFIX = 'kolam_draft_';

export function useDraftSystem({ streamId, personaId, personaName }: UseDraftSystemProps) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [activeEntry, setActiveEntry] = useState<{ id: string; sectionId: string } | null>(null);
  const [initialContent, setInitialContent] = useState<PartialBlock[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  // Refs for state access inside async/debounce
  const activeEntryRef = useRef(activeEntry);
  const contentRef = useRef<PartialBlock[]>([]);
  const saveQueueRef = useRef<{ content: PartialBlock[], attempt: number } | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Sync refs
  useEffect(() => {
    activeEntryRef.current = activeEntry;
  }, [activeEntry]);

  // Load draft on mount
  useEffect(() => {
    isMountedRef.current = true;
    
    async function loadDraft() {
      if (!streamId) return;
      
      try {
        // 1. Check LocalStorage
        const localDraftKey = `${STORAGE_PREFIX}${streamId}`;
        const localDraftStr = localStorage.getItem(localDraftKey);
        let localDraft: DraftState | null = null;
        
        if (localDraftStr) {
          try {
            localDraft = JSON.parse(localDraftStr);
          } catch (e) {
            console.error('Failed to parse local draft', e);
          }
        }

        // 2. Check Supabase
        const { data: dbDrafts, error } = await supabase
          .from('entries')
          .select(`
            id, 
            updated_at,
            sections (
              id,
              content_json,
              updated_at
            )
          `)
          .eq('stream_id', streamId)
          .eq('is_draft', true)
          .order('updated_at', { ascending: false })
          .limit(1);

        if (error) throw error;

        const dbDraft = dbDrafts?.[0];
        const dbSection = dbDraft?.sections?.[0];
        
        // 3. Compare and Decide
        let finalContent: PartialBlock[] = [];
        let finalEntryId: string | null = null;
        let finalSectionId: string | null = null;

        const dbTime = dbDraft ? new Date(dbDraft.updated_at || 0).getTime() : 0;
        const localTime = localDraft ? localDraft.updatedAt : 0;

        if (localDraft && localTime > dbTime) {
          // Local is newer
          console.log('Restoring from local storage');
          finalContent = localDraft.content;
          finalEntryId = localDraft.entryId;
          finalSectionId = localDraft.sectionId;
          setStatus('offline'); // Indicate it was loaded from offline source
        } else if (dbDraft && dbSection) {
          // DB is newer or no local
          console.log('Restoring from database');
          finalContent = dbSection.content_json as unknown as PartialBlock[];
          finalEntryId = dbDraft.id;
          finalSectionId = dbSection.id;
          setStatus('saved');
        }

        if (finalEntryId && finalSectionId) {
          setActiveEntry({ id: finalEntryId, sectionId: finalSectionId });
          setInitialContent(finalContent);
        } else {
          setInitialContent([]);
        }

      } catch (err) {
        console.error('Error loading draft:', err);
        setInitialContent([]);
      } finally {
        setIsLoading(false);
      }
    }

    loadDraft();

    return () => {
      isMountedRef.current = false;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    };
  }, [streamId, supabase]);

  // Save implementation with retry logic
  const performSave = useCallback(async (content: PartialBlock[], attempt = 0) => {
    if (!content || content.length === 0) return;
    if (!streamId) return;

    setStatus('saving');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Validation
      const validationResult = EntryContentSchema.safeParse(content);
      if (!validationResult.success) throw new Error('Invalid content');

      let entryId = activeEntryRef.current?.id;
      let sectionId = activeEntryRef.current?.sectionId;

      if (entryId && sectionId) {
        // UPDATE
        const { error } = await supabase
          .from('sections')
          .update({
            content_json: content as unknown as Json,
            updated_at: new Date().toISOString()
          })
          .eq('id', sectionId);
          
        if (error) throw error;
        
        // Also update entry updated_at
        await supabase.from('entries').update({ updated_at: new Date().toISOString() }).eq('id', entryId);

      } else {
        // CREATE
        const { data, error } = await supabase.rpc('create_entry_with_section', {
          p_stream_id: streamId,
          p_content_json: content as unknown as Json,
          p_persona_id: personaId || null,
          p_persona_name_snapshot: personaName || null,
          p_is_draft: true
        });

        if (error) throw error;
        
        // Parse result to get IDs
        const newEntry = data as unknown as EntryWithSections;
        if (newEntry && newEntry.sections?.[0]) {
          entryId = newEntry.id;
          sectionId = newEntry.sections[0].id;
          if (isMountedRef.current) {
            setActiveEntry({ id: entryId, sectionId });
          }
        }
      }

      // Success
      if (isMountedRef.current) {
        setStatus('saved');
        setLastSavedAt(new Date());
        
        // Clear local storage if sync successful? 
        // Or keep it as backup? Keep it but update timestamp.
        // Actually, we might want to keep it in case next save fails.
        // But if we are in sync, we can rely on DB.
        // Let's update the local storage with the new IDs if they were created.
        const localKey = `${STORAGE_PREFIX}${streamId}`;
        const newState: DraftState = {
            content,
            entryId: entryId ?? null,
            sectionId: sectionId ?? null,
            updatedAt: Date.now()
        };
        localStorage.setItem(localKey, JSON.stringify(newState));
      }
      
      saveQueueRef.current = null;

    } catch (error) {
      console.error(`Save failed (attempt ${attempt}):`, error);
      
      // Calculate backoff
      if (attempt < 5) { // Max 5 retries
        const backoff = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.log(`Retrying in ${backoff}ms...`);
        
        if (isMountedRef.current) {
          setStatus('saving'); // Keep showing saving
          saveQueueRef.current = { content, attempt: attempt + 1 };
          
          retryTimeoutRef.current = setTimeout(() => {
            performSave(content, attempt + 1);
          }, backoff);
        }
      } else {
        if (isMountedRef.current) {
          setStatus('error'); // Give up after max retries
          // Ensure it's in local storage at least
          const localKey = `${STORAGE_PREFIX}${streamId}`;
          const currentState: DraftState = {
              content,
              entryId: activeEntryRef.current?.id ?? null,
              sectionId: activeEntryRef.current?.sectionId ?? null,
              updatedAt: Date.now()
          };
          localStorage.setItem(localKey, JSON.stringify(currentState));
          setStatus('offline'); // Saved locally only
        }
      }
    }
  }, [streamId, personaId, personaName, supabase]);

  // Debounced Save Wrapper
  const debouncedSave = useRef(
    debounce((content: PartialBlock[]) => {
      performSave(content, 0);
    }, 1000) // 1s debounce
  ).current;

  // Public save method called by component
  const saveDraft = useCallback((content: PartialBlock[]) => {
    contentRef.current = content;
    
    // 1. Immediate Local Save
    const localKey = `${STORAGE_PREFIX}${streamId}`;
    const draftState: DraftState = {
      content,
      entryId: activeEntryRef.current?.id ?? null,
      sectionId: activeEntryRef.current?.sectionId ?? null,
      updatedAt: Date.now()
    };
    localStorage.setItem(localKey, JSON.stringify(draftState));
    
    // 2. Queue DB Save
    setStatus('saving');
    debouncedSave(content);
  }, [streamId, debouncedSave]);

  const commitDraft = useCallback(async () => {
    debouncedSave.cancel(); // Cancel pending saves
    
    const content = contentRef.current;
    if (!content || content.length === 0) return;
    
    // Force immediate save/update to is_draft = false
    try {
        // If we have an active entry, update it to not be draft
        if (activeEntryRef.current) {
            const { error } = await supabase
                .from('entries')
                .update({ is_draft: false })
                .eq('id', activeEntryRef.current.id);
            
            if (error) throw error;
            
            // Also ensure content is latest
             const { error: sectionError } = await supabase
                .from('sections')
                .update({
                    content_json: content as unknown as Json,
                    updated_at: new Date().toISOString()
                })
                .eq('id', activeEntryRef.current.sectionId);
             
             if (sectionError) throw sectionError;

        } else {
            // Create new committed entry
             const { error } = await supabase.rpc('create_entry_with_section', {
                p_stream_id: streamId,
                p_content_json: content as unknown as Json,
                p_persona_id: personaId || null,
                p_persona_name_snapshot: personaName || null,
                p_is_draft: false
            });
            if (error) throw error;
        }

        // Cleanup
        localStorage.removeItem(`${STORAGE_PREFIX}${streamId}`);
        setActiveEntry(null);
        setInitialContent([]); // Clear content
        setStatus('idle');
        
        // Invalidate queries
        queryClient.invalidateQueries({ queryKey: ['entries', streamId] });

    } catch (error) {
        console.error("Commit failed", error);
        setStatus('error');
        throw error;
    }
  }, [streamId, personaId, personaName, supabase, queryClient, debouncedSave]);

  return {
    status,
    lastSavedAt,
    saveDraft,
    commitDraft,
    initialLoadedContent: initialContent,
    isLoading,
    activeEntryId: activeEntry?.id,
  };
}
