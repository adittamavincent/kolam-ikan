import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { PartialBlock } from '@blocknote/core';
import debounce from 'lodash/debounce';
import { EntryContentSchema } from '@/lib/validation/entry';
import { Json } from '@/lib/types/database.types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

interface UseDraftSystemProps {
  streamId: string;
}

interface SectionDraft {
  sectionId: string | null;
  personaId: string;
  content: PartialBlock[];
  updatedAt: number;
}

interface DraftState {
  entryId: string | null;
  sections: Record<string, SectionDraft>; // instanceId -> draft
  updatedAt: number;
}

const STORAGE_PREFIX = 'kolam_draft_';

export interface DraftContent {
  personaId: string;
  content: PartialBlock[];
}

export function useDraftSystem({ streamId }: UseDraftSystemProps) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  
  // Map of instanceId -> { personaId, content } (for initial load)
  const [initialDrafts, setInitialDrafts] = useState<Record<string, DraftContent>>({});
  const [isLoading, setIsLoading] = useState(true);
  
  const queryClient = useQueryClient();
  const supabase = createClient();
  
  // Refs
  const activeEntryIdRef = useRef<string | null>(null);
  // Map instanceId -> sectionId
  const sectionIdsRef = useRef<Record<string, string>>({});
  
  // We need to track content per instance to save it
  // instanceId -> content
  const contentRefs = useRef<Record<string, PartialBlock[]>>({});
  
  // We need to track persona per instance
  // instanceId -> personaId
  const personaIdsRef = useRef<Record<string, string>>({});
  
  // Track which instances are currently active/visible
  const activeInstancesRef = useRef<Set<string>>(new Set());
  
  const isMountedRef = useRef(true);
  const creationPromiseRef = useRef<Promise<string> | null>(null);
  const sectionCreationPromisesRef = useRef<Record<string, Promise<string> | undefined>>({});
  const pendingSavesRef = useRef<Set<Promise<void>>>(new Set());
  
  // Debouncers cache: instanceId -> debounced function
  type DebouncedSaveFunc = ReturnType<typeof debounce>;
  const debouncersRef = useRef<Record<string, DebouncedSaveFunc>>({});

  // Sync refs
  useEffect(() => {
    activeEntryIdRef.current = activeEntryId;
  }, [activeEntryId]);

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
            const parsed = JSON.parse(localDraftStr);
            // Migration check: if it's the old format (personaId keys) or older
            // We'll just ignore old formats for simplicity in this refactor
            // or we could try to detect if keys are UUIDs vs persona IDs, but simpler to reset if schema changes significantly
             localDraft = parsed;
             setRecoveryAvailable(true);
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
              persona_id,
              updated_at
            )
          `)
          .eq('stream_id', streamId)
          .eq('is_draft', true)
          .order('updated_at', { ascending: false })
          .limit(1);

        if (error) throw error;

        const dbDraft = dbDrafts?.[0];
        
        // 3. Compare and Decide
        const loadedDrafts: Record<string, DraftContent> = {};
        const loadedSectionIds: Record<string, string> = {};
        const loadedPersonaIds: Record<string, string> = {};
        let loadedEntryId: string | null = null;

        const dbTime = dbDraft ? new Date(dbDraft.updated_at || 0).getTime() : 0;
        const localTime = localDraft ? localDraft.updatedAt : 0;

        if (localDraft && localTime > dbTime) {
          // Local is newer
          loadedEntryId = localDraft.entryId;
          
          Object.entries(localDraft.sections).forEach(([instanceId, draft]) => {
             loadedDrafts[instanceId] = {
               personaId: draft.personaId,
               content: draft.content
             };
             if (draft.sectionId) loadedSectionIds[instanceId] = draft.sectionId;
             loadedPersonaIds[instanceId] = draft.personaId;
          });
          
          setStatus('offline');
        } else if (dbDraft) {
          // DB is newer
          loadedEntryId = dbDraft.id;
          
          dbDraft.sections.forEach(section => {
             if (section.persona_id) {
                 // Use section.id as instanceId for DB drafts
                 const instanceId = section.id;
                 loadedDrafts[instanceId] = {
                   personaId: section.persona_id,
                   content: section.content_json as unknown as PartialBlock[]
                 };
                 loadedSectionIds[instanceId] = section.id;
                 loadedPersonaIds[instanceId] = section.persona_id;
             }
          });
          
          setStatus('saved');
        }

        if (loadedEntryId) {
          setActiveEntryId(loadedEntryId);
          sectionIdsRef.current = loadedSectionIds;
          personaIdsRef.current = loadedPersonaIds;
          setInitialDrafts(loadedDrafts);
          
          // Initialize content refs
          const contentMap: Record<string, PartialBlock[]> = {};
          Object.entries(loadedDrafts).forEach(([k, v]) => {
            contentMap[k] = v.content;
          });
          contentRefs.current = contentMap;
        }

      } catch (err) {
        console.error('Error loading draft:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadDraft();

    const debouncers = debouncersRef.current;
    return () => {
      isMountedRef.current = false;
      // Cleanup debouncers
      Object.values(debouncers).forEach((d) => d.cancel?.());
    };
  }, [streamId, supabase]);

  const flushPendingSaves = useCallback(async () => {
    Object.values(debouncersRef.current).forEach((d) => d.flush());
    if (pendingSavesRef.current.size > 0) {
      await Promise.all(Array.from(pendingSavesRef.current));
    }
    if (creationPromiseRef.current) {
      await creationPromiseRef.current;
    }
  }, []);

  const buildDraftSnapshot = useCallback(() => {
    const sections = Object.keys(contentRefs.current).map((instanceId) => ({
      instanceId,
      sectionId: sectionIdsRef.current[instanceId] ?? null,
      personaId: personaIdsRef.current[instanceId] ?? null,
      content: contentRefs.current[instanceId],
      updatedAt: Date.now(),
    }));
    return {
      streamId,
      entryId: activeEntryIdRef.current,
      sections,
      updatedAt: Date.now(),
    };
  }, [streamId]);

  useEffect(() => {
    const handlePageHide = () => {
      const snapshot = buildDraftSnapshot();
      if (snapshot.sections.length === 0) return;
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
        navigator.sendBeacon('/api/draft-beacon', blob);
      }
    };

    const handleBeforeUnload = () => {
      void flushPendingSaves();
      handlePageHide();
    };

    const handleFlushEvent = () => {
      void flushPendingSaves();
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('kolam_flush_drafts', handleFlushEvent);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('kolam_flush_drafts', handleFlushEvent);
    };
  }, [buildDraftSnapshot, flushPendingSaves]);

  // Update Local Storage Helper
  const updateLocalStorage = useCallback(() => {
     const state: DraftState = {
         entryId: activeEntryIdRef.current,
         sections: {},
         updatedAt: Date.now()
     };
     
     // Populate sections from refs
     Object.keys(contentRefs.current).forEach(instanceId => {
         state.sections[instanceId] = {
             sectionId: sectionIdsRef.current[instanceId] || null,
             personaId: personaIdsRef.current[instanceId],
             content: contentRefs.current[instanceId],
             updatedAt: Date.now()
         };
     });
     
     localStorage.setItem(`${STORAGE_PREFIX}${streamId}`, JSON.stringify(state));
  }, [streamId]);

  // Save implementation
  const performSave = useCallback(async (instanceId: string, personaId: string, content: PartialBlock[], personaName?: string) => {
    if (!streamId) return;

    const savePromise = (async () => {
      setStatus('saving');

      try {
        // Handle empty content - delete section if it exists
        if (!content || content.length === 0) {
            const sectionId = sectionIdsRef.current[instanceId];
            if (sectionId) {
                await supabase.from('sections').delete().eq('id', sectionId);
                delete sectionIdsRef.current[instanceId];
            }
            // Clean up refs for this instance since it has no content
            contentRefs.current[instanceId] = [];
            delete personaIdsRef.current[instanceId];
            activeInstancesRef.current.delete(instanceId);
            
            updateLocalStorage();
            setStatus('saved');
            return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('User not authenticated');

        // Validation
        const validationResult = EntryContentSchema.safeParse(content);
        if (!validationResult.success) throw new Error('Invalid content');

        let entryId = activeEntryIdRef.current;
        let sectionId = sectionIdsRef.current[instanceId];

        if (!entryId) {
            // Create Entry (and first section)
            // Use lock to prevent race conditions
            if (!creationPromiseRef.current) {
                creationPromiseRef.current = (async () => {
                    const { data, error } = await supabase.rpc('create_entry_with_section', {
                      p_stream_id: streamId,
                      p_content_json: content as unknown as Json,
                      p_persona_id: personaId ?? undefined,
                      p_persona_name_snapshot: personaName ?? undefined,
                      p_is_draft: true
                    });
                    
                    if (error) throw error;

                    const created = data as Record<string, unknown> | null;
                    const sections = created?.sections as Record<string, unknown>[] | undefined;
                    if (!created?.id || !sections?.[0]?.id) {
                      throw new Error('Failed to create entry section');
                    }
                    const newEntryId = created.id as string;
                    const newSectionId = sections[0].id as string;
                    
                    return { newEntryId, newSectionId };
                })().then(res => {
                    activeEntryIdRef.current = res.newEntryId;
                    sectionIdsRef.current[instanceId] = res.newSectionId; // Ensure creator's section ID is set
                    if (isMountedRef.current) setActiveEntryId(res.newEntryId);
                    return res.newEntryId; // Return ID
                }).catch(e => {
                    creationPromiseRef.current = null; // Reset on error
                    throw e;
                });
            }
            
            // Wait for creation
            entryId = await creationPromiseRef.current;
        }
        
        // If we are here, entryId exists.
        
        // Check if we have a sectionId
        sectionId = sectionIdsRef.current[instanceId];

        // If no known section ID, check if one is being created
        if (!sectionId && sectionCreationPromisesRef.current[instanceId]) {
            sectionId = await sectionCreationPromisesRef.current[instanceId];
            sectionIdsRef.current[instanceId] = sectionId;
        }
        
        if (sectionId) {
            // UPDATE existing section
            const { error } = await supabase
              .from('sections')
              .update({
                content_json: content as unknown as Json,
                persona_id: personaId, // Allow updating personaId if changed
                persona_name_snapshot: personaName,
                updated_at: new Date().toISOString()
              })
              .eq('id', sectionId);
              
            if (error) throw error;
        } else {
            // INSERT new section
            const createPromise = (async () => {
                const { data, error } = await supabase
                  .from('sections')
                  .insert({
                      entry_id: entryId,
                      persona_id: personaId,
                      persona_name_snapshot: personaName,
                      content_json: content as unknown as Json,
                      sort_order: 0 // logic for order?
                  })
                  .select('id')
                  .single();
                  
                if (error) throw error;
                return data.id;
            })();

            sectionCreationPromisesRef.current[instanceId] = createPromise;

            try {
                const newId = await createPromise;
                sectionIdsRef.current[instanceId] = newId;
            } finally {
                delete sectionCreationPromisesRef.current[instanceId];
            }
        }
        
        // Update entry updated_at
        await supabase.from('entries').update({ updated_at: new Date().toISOString() }).eq('id', entryId);

        // Success
        if (isMountedRef.current) {
          setStatus('saved');
          setLastSavedAt(new Date());
          updateLocalStorage();
        }

      } catch (error) {
        const errMsg = error instanceof Error ? error.message : (error as Record<string, unknown>)?.message ?? JSON.stringify(error);
        console.error(`Save failed for instance ${instanceId}:`, errMsg);
        setStatus('error');
      }
    })();

    // Track promise
    pendingSavesRef.current.add(savePromise);
    savePromise.finally(() => {
        pendingSavesRef.current.delete(savePromise);
    });

    return savePromise;
  }, [streamId, supabase, updateLocalStorage]);

  // Get or create debouncer for an instance
  const getDebouncer = useCallback((instanceId: string) => {
      if (!debouncersRef.current[instanceId]) {
          debouncersRef.current[instanceId] = debounce((personaId: string, content: PartialBlock[], personaName?: string) => {
              performSave(instanceId, personaId, content, personaName);
          }, 1000);
      }
      return debouncersRef.current[instanceId];
  }, [performSave]);

  // Public save method
  const saveDraft = useCallback((instanceId: string, personaId: string, content: PartialBlock[], personaName?: string) => {
    contentRefs.current[instanceId] = content;
    personaIdsRef.current[instanceId] = personaId;
    // Mark this instance as active
    activeInstancesRef.current.add(instanceId);
    updateLocalStorage(); // Sync to local immediately
    setStatus('saving');

    // Deletions must run immediately; if debounced they can be canceled by
    // setActiveInstances() during section removal and leave status stuck in saving.
    if (!content || content.length === 0) {
      const debouncer = debouncersRef.current[instanceId];
      if (debouncer) {
        debouncer.cancel();
        delete debouncersRef.current[instanceId];
      }
      void performSave(instanceId, personaId, content, personaName);
      return;
    }
    
    getDebouncer(instanceId)(personaId, content, personaName);
  }, [updateLocalStorage, getDebouncer, performSave]);
  
  // Method to mark instances as active (called by UI)
  const setActiveInstances = useCallback((instanceIds: string[]) => {
    const newActiveSet = new Set(instanceIds);
    
    // Clean up refs for instances that are no longer active
    const currentInstances = Array.from(activeInstancesRef.current);
    currentInstances.forEach(instanceId => {
      if (!newActiveSet.has(instanceId)) {
        // Instance is no longer active, clean up its refs
        delete contentRefs.current[instanceId];
        delete personaIdsRef.current[instanceId];
        delete sectionIdsRef.current[instanceId];
        
        // Cancel any pending debounced saves
        if (debouncersRef.current[instanceId]) {
          debouncersRef.current[instanceId].cancel();
          delete debouncersRef.current[instanceId];
        }
      }
    });
    
    activeInstancesRef.current = newActiveSet;
    
    // Safety check: if no active instances and no pending saves, reset status
    if (newActiveSet.size === 0 && pendingSavesRef.current.size === 0) {
      setStatus((prev) => prev === 'saving' ? 'idle' : prev);
    }
  }, []);

  const getDraftContent = useCallback((instanceId: string) => {
      return contentRefs.current[instanceId] || initialDrafts[instanceId]?.content || [];
  }, [initialDrafts]);

  const commitDraft = useCallback(async () => {
    // Cancel all pending debounced calls (flushing them might be better if we want to save latest?)
    // Actually flush executes them.
    Object.values(debouncersRef.current).forEach((d) => d.flush());
    
    // Wait for all pending saves to complete
    if (pendingSavesRef.current.size > 0) {
        await Promise.all(Array.from(pendingSavesRef.current));
    }
    
    // Wait for creation if any
    if (creationPromiseRef.current) {
        await creationPromiseRef.current;
    }

    // Get active instances with content
    // IMPORTANT: Only check instances that are explicitly in activeInstancesRef
    // to prevent stale instances from being committed
    const activeInstancesWithContent = Array.from(activeInstancesRef.current).filter(
      instanceId => {
        const content = contentRefs.current[instanceId];
        const hasContent = content && content.length > 0;
        const hasPersona = personaIdsRef.current[instanceId];
        return hasContent && hasPersona;
      }
    );
    
    // Check if we have anything to commit
    if (activeInstancesWithContent.length === 0) {
      console.warn("No active instances with content to commit");
      return;
    }

    try {
        if (activeEntryIdRef.current) {
            const entryId = activeEntryIdRef.current;
            
            // Get all section IDs for active instances
            const activeSectionIds = activeInstancesWithContent
              .map(id => sectionIdsRef.current[id])
              .filter((id): id is string => !!id);
            
            // Delete any sections that are NOT in the active list
            const { data: allSections } = await supabase
              .from('sections')
              .select('id')
              .eq('entry_id', entryId);
            
            if (allSections) {
              const sectionsToDelete = allSections
                .map(s => s.id)
                .filter(id => !activeSectionIds.includes(id));
              
              if (sectionsToDelete.length > 0) {
                await supabase
                  .from('sections')
                  .delete()
                  .in('id', sectionsToDelete);
              }
            }
            
            // Validate that we have at least one section to commit
            if (activeSectionIds.length === 0) {
              console.warn("No sections to commit");
              return;
            }
            
            // Update entry to not draft
            const { error } = await supabase
                .from('entries')
                .update({ is_draft: false })
                .eq('id', entryId);
            
            if (error) throw error;
        } else {
            // Should be handled by waiting for creationPromiseRef above
            console.warn("Attempted to commit but no entry ID found");
        }

        // Cleanup all refs and state
        localStorage.removeItem(`${STORAGE_PREFIX}${streamId}`);
        setActiveEntryId(null);
        setInitialDrafts({});
        
        // Clean up all refs
        sectionIdsRef.current = {};
        contentRefs.current = {};
        personaIdsRef.current = {};
        activeInstancesRef.current.clear();
        
        // Cancel and clear all debouncers
        Object.values(debouncersRef.current).forEach(d => d.cancel());
        debouncersRef.current = {};
        
        // Clear creation promises
        creationPromiseRef.current = null;
        sectionCreationPromisesRef.current = {};
        
        setStatus('idle');
        
        queryClient.invalidateQueries({ queryKey: ['entries', streamId] });

    } catch (error) {
        console.error("Commit failed", error);
        setStatus('error');
        throw error;
    }
  }, [streamId, supabase, queryClient]);

  const discardRecovery = useCallback(() => {
    localStorage.removeItem(`${STORAGE_PREFIX}${streamId}`);
    setActiveEntryId(null);
    setInitialDrafts({});
    sectionIdsRef.current = {};
    contentRefs.current = {};
    personaIdsRef.current = {};
    activeInstancesRef.current.clear();
    Object.values(debouncersRef.current).forEach((d) => d.cancel());
    debouncersRef.current = {};
    creationPromiseRef.current = null;
    sectionCreationPromisesRef.current = {};
    setStatus('idle');
    setRecoveryAvailable(false);
  }, [streamId]);

  return {
    status,
    lastSavedAt,
    saveDraft,
    commitDraft,
    initialDrafts,
    getDraftContent,
    isLoading,
    activeEntryId,
    setActiveInstances,
    flushPendingSaves,
    recoveryAvailable,
    discardRecovery,
  };
}
