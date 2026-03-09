import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { PartialBlock } from '@blocknote/core';
import { Json } from '@/lib/types/database.types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface UseDraftSystemProps {
  streamId: string;
}

interface SectionDraft {
  personaId: string;
  personaName?: string;
  content: PartialBlock[];
  updatedAt: number;
}

interface DraftState {
  sections: Record<string, SectionDraft>; // instanceId -> draft
  updatedAt: number;
}

export interface DraftContent {
  personaId: string;
  content: PartialBlock[];
}

const STORAGE_PREFIX = 'kolam_draft_v2_';

// ─── Content Helpers ──────────────────────────────────────────────────────────

const hasTextValue = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

const hasMeaningfulBlockPayload = (value: unknown): boolean => {
  if (hasTextValue(value)) return true;
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulBlockPayload(item));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (hasTextValue(record.text) || hasTextValue(record.url) || hasTextValue(record.src) || hasTextValue(record.href)) {
    return true;
  }

  if (hasMeaningfulBlockPayload(record.content) || hasMeaningfulBlockPayload(record.children)) {
    return true;
  }

  const blockType = typeof record.type === 'string' ? record.type : null;
  if (blockType && blockType !== 'paragraph') {
    return true;
  }

  return false;
};

const hasMeaningfulDraftContent = (content: PartialBlock[] | undefined): boolean => {
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }
  return content.some((block) => hasMeaningfulBlockPayload(block));
};

// ─── Local Storage Helpers ───────────────────────────────────────────────────

function readLocalDraft(streamId: string): DraftState | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${streamId}`);
    if (!raw) return null;
    return JSON.parse(raw) as DraftState;
  } catch {
    return null;
  }
}

function writeLocalDraft(streamId: string, state: DraftState): void {
  try {
    // Keep every section that has a personaId — even if content is empty.
    // Only drop sections with no persona at all.
    const active = Object.entries(state.sections).filter(
      ([, s]) => !!s.personaId
    );
    if (active.length === 0) {
      localStorage.removeItem(`${STORAGE_PREFIX}${streamId}`);
      return;
    }
    const clean: DraftState = {
      sections: Object.fromEntries(active),
      updatedAt: Date.now(),
    };
    localStorage.setItem(`${STORAGE_PREFIX}${streamId}`, JSON.stringify(clean));
  } catch {
    // Ignore storage errors
  }
}

function removeLocalDraft(streamId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${streamId}`);
  } catch {
    // Ignore storage errors
  }
}

// ──────────────────────────────────────────────────────────────────────────────

export function useDraftSystem({ streamId }: UseDraftSystemProps) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [initialDrafts, setInitialDrafts] = useState<Record<string, DraftContent>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);

  const queryClient = useQueryClient();
  const supabase = createClient();

  // Ref keeps canonical state to avoid effect cycles on every keystroke
  const draftStateRef = useRef<DraftState>({ sections: {}, updatedAt: Date.now() });

  // 1. Initial Load and Legacy Cleanup
  useEffect(() => {
    setIsLoading(true);
    setInitialDrafts({});
    setStatus('idle');
    setRecoveryAvailable(false);
    draftStateRef.current = { sections: {}, updatedAt: Date.now() };

    async function initializeDrafts() {
      if (!streamId) return;

      try {
        // Run completely asynchronously; cleanup any DB drafts 
        // that shouldn't exist anymore to fix "Zombie/Ghost" drafts problem.
        supabase
          .from('entries')
          .delete()
          .eq('stream_id', streamId)
          .eq('is_draft', true)
          .then(({ error }) => {
            if (error) console.error("Failed to clean up ghost DB drafts:", error);
          });

        // Cleanup obsolete localStorage schema
        localStorage.removeItem(`kolam_draft_${streamId}`);
      } catch {
        // ignore safety failures
      }

      // Load purely localized drafted sections
      const local = readLocalDraft(streamId);
      if (local && Object.keys(local.sections).length > 0) {
        draftStateRef.current = local;
        const loaded: Record<string, DraftContent> = {};
        Object.entries(local.sections).forEach(([id, s]) => {
          if (!s.personaId) return;
          loaded[id] = { personaId: s.personaId, content: s.content || [] };
        });
        setInitialDrafts(loaded);
        setRecoveryAvailable(true);
      }
      setIsLoading(false);
    }

    initializeDrafts();
  }, [streamId, supabase]);

  // 2. Local save Draft
  const saveDraft = useCallback((instanceId: string, personaId: string, content: PartialBlock[], personaName?: string, forceDelete = false) => {
    setStatus('saving');

    // Only remove the section when explicitly force-deleted (X button).
    // Empty content is fine — the section still exists.
    if (forceDelete) {
      delete draftStateRef.current.sections[instanceId];
      writeLocalDraft(streamId, draftStateRef.current);

      setInitialDrafts(prev => {
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
      setStatus('idle');
      return;
    }

    draftStateRef.current.sections[instanceId] = {
      personaId,
      personaName,
      content: content || [],
      updatedAt: Date.now()
    };
    writeLocalDraft(streamId, draftStateRef.current);
    setStatus('saved');
  }, [streamId]);

  // 3. Clear/Discard whole draft
  const clearDraft = useCallback(() => {
    removeLocalDraft(streamId);
    draftStateRef.current = { sections: {}, updatedAt: Date.now() };
    setInitialDrafts({});
    setRecoveryAvailable(false);
    setStatus('idle');
  }, [streamId]);

  const discardRecovery = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  // 4. Content Retriever
  const getDraftContent = useCallback((instanceId: string) => {
    return draftStateRef.current.sections[instanceId]?.content || initialDrafts[instanceId]?.content || [];
  }, [initialDrafts]);

  // 5. Explicit Commit to Database
  const commitDraft = useCallback(async () => {
    const activeSections = Object.values(draftStateRef.current.sections);
    
    // Safety check - ignore commit if content has zero meaning
    const meaningfulSections = activeSections.filter(s => hasMeaningfulDraftContent(s.content) && s.personaId);
    if (meaningfulSections.length === 0) return;

    setStatus('saving');

    try {
      // 5a. Create permanent single entry
      const { data: entryData, error: entryErr } = await supabase
        .from('entries')
        .insert({
          stream_id: streamId,
          is_draft: false,
        })
        .select('id')
        .single();

      if (entryErr || !entryData) throw entryErr || new Error("Entry insert failed");
      const newEntryId = entryData.id;

      // 5b. Insert strictly ordered sections simultaneously
      const sectionInserts = meaningfulSections.map((s, index) => ({
        entry_id: newEntryId,
        persona_id: s.personaId,
        persona_name_snapshot: s.personaName,
        content_json: s.content as Json,
        sort_order: index
      }));

      const { error: sectionsErr } = await supabase
        .from('sections')
        .insert(sectionInserts);

      if (sectionsErr) throw sectionsErr;

      // 5c. Purge local draft state on Success
      removeLocalDraft(streamId);
      draftStateRef.current = { sections: {}, updatedAt: Date.now() };
      setInitialDrafts({});
      setRecoveryAvailable(false);
      setStatus('idle');

      // Refresh dependent data views
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
      queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });

    } catch (err) {
      console.error("Commit failed", err);
      setStatus('error');
      throw err;
    }
  }, [streamId, supabase, queryClient]);

  // Maintain API compatibility with current component implementation 
  const setActiveInstances = useCallback(() => {}, []);
  const flushPendingSaves = useCallback(async () => {}, []);

  return {
    status,
    saveDraft,
    commitDraft,
    initialDrafts,
    getDraftContent,
    isLoading,
    clearDraft,
    setActiveInstances,
    flushPendingSaves,
    recoveryAvailable,
    discardRecovery,
    activeEntryId: null
  };
}
