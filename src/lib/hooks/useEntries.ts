import { useInfiniteQuery, useMutation, useQueryClient, InfiniteData } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { EntryWithSections } from '@/lib/types';
import { Json } from '@/lib/types/database.types';
import { PartialBlock } from '@blocknote/core';

interface UseEntriesOptions {
  search?: string;
  personaId?: string | null;
  sortOrder?: 'newest' | 'oldest';
}

interface AmendEntryInput {
  entryId: string;
  sections: Array<{
    sectionId: string;
    content: PartialBlock[];
  }>;
}

export function useEntries(streamId: string, options: UseEntriesOptions = {}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { search, personaId, sortOrder = 'newest' } = options;
  const PAGE_SIZE = 50;

  const query = useInfiniteQuery({
    queryKey: ['entries', streamId, search, personaId, sortOrder],
    queryFn: async ({ pageParam = 0, signal }) => {
      let query = supabase
        .from('entries')
        .select(`
          *,
          sections!inner (
            *,
            persona:personas (*)
          )
        `)
        .eq('stream_id', streamId)
        .eq('is_draft', false)
        .is('deleted_at', null);

      if (search) {
        query = query.ilike('sections.search_text', `%${search}%`);
      }

      if (personaId) {
        query = query.eq('sections.persona_id', personaId);
      }

      // Sort
      query = query.order('created_at', { ascending: sortOrder === 'oldest' });
      
      // Abort signal
      query = query.abortSignal(signal);

      // Pagination
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      
      const { data, error } = await query.range(from, to);

      if (error) throw error;
      
      return data as EntryWithSections[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAGE_SIZE ? allPages.length : undefined;
    },
    enabled: !!streamId,
  });

  const createEntry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .insert({ stream_id: streamId })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
      queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['graph-entries'] });
    },
  });

  const amendEntry = useMutation({
    onMutate: async ({ entryId, sections }) => {
      await queryClient.cancelQueries({ queryKey: ['entries', streamId] });

      const previousQueries = queryClient.getQueriesData<InfiniteData<EntryWithSections[]>>({
        queryKey: ['entries', streamId],
      });

      const nextUpdatedAt = new Date().toISOString();
      const sectionContentMap = new Map(sections.map((section) => [section.sectionId, section.content]));

      previousQueries.forEach(([queryKey, queryData]) => {
        if (!queryData) return;

        const nextData: InfiniteData<EntryWithSections[]> = {
          ...queryData,
          pages: queryData.pages.map((page) =>
            page.map((entry) => {
              if (entry.id !== entryId) return entry;

              const nextSections = entry.sections.map((section) => {
                const nextContent = sectionContentMap.get(section.id);
                if (!nextContent) return section;

                return {
                  ...section,
                  content_json: nextContent as unknown as Json,
                  updated_at: nextUpdatedAt,
                };
              });

              return {
                ...entry,
                updated_at: nextUpdatedAt,
                sections: nextSections,
              };
            }),
          ),
        };

        queryClient.setQueryData(queryKey, nextData);
      });

      return { previousQueries };
    },
    mutationFn: async ({ entryId, sections }: AmendEntryInput) => {
      if (!sections.length) {
        throw new Error('No amended sections to save');
      }

      const nowIso = new Date().toISOString();
      const updates = sections.map(({ sectionId, content }) =>
        supabase
          .from('sections')
          .update({
            content_json: content as unknown as Json,
            updated_at: nowIso,
          })
          .eq('id', sectionId),
      );

      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      const { error: entryError } = await supabase
        .from('entries')
        .update({ updated_at: nowIso })
        .eq('id', entryId);

      if (entryError) throw entryError;
      return { entryId };
    },
    onError: (_error, _variables, context) => {
      context?.previousQueries?.forEach(([queryKey, queryData]) => {
        queryClient.setQueryData(queryKey, queryData);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
      queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['graph-entries'] });
    },
  });

  const deleteEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from('entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', entryId);

      if (error) throw error;
      return { entryId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
      queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['graph-entries'] });
    },
  });

  const resetToEntry = useMutation({
    mutationFn: async (entry: EntryWithSections) => {
      // Mark all entries newer than this one in the same stream as deleted
      const { error } = await supabase
        .from('entries')
        .update({ deleted_at: new Date().toISOString() })
        .eq('stream_id', streamId)
        .gt('created_at', entry.created_at || '')
        .is('deleted_at', null);

      if (error) throw error;
      return { entryId: entry.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
      queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });
    },
  });

  const duplicateEntry = useMutation({
    mutationFn: async (entry: EntryWithSections) => {
      // Create a new entry
      const { data: newEntry, error: entryError } = await supabase
        .from('entries')
        .insert({ stream_id: streamId })
        .select()
        .single();

      if (entryError) throw entryError;

      // Clone all sections into the new entry
      if (entry.sections?.length) {
        const sectionsToInsert = entry.sections.map((section, index) => ({
          entry_id: newEntry.id,
          content_json: section.content_json,
          persona_id: section.persona_id,
          persona_name_snapshot: section.persona_name_snapshot,
          sort_order: index,
        }));

        const { error: sectionsError } = await supabase
          .from('sections')
          .insert(sectionsToInsert);

        if (sectionsError) throw sectionsError;
      }

      return newEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
      queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });
    },
  });

  const revertEntry = useMutation({
    mutationFn: async (entry: EntryWithSections) => {
      const { data: newEntry, error: entryError } = await supabase
        .from('entries')
        .insert({ stream_id: streamId })
        .select()
        .single();

      if (entryError) throw entryError;

      if (entry.sections?.length) {
        const revertDate = entry.created_at
          ? new Date(entry.created_at).toLocaleDateString()
          : entry.id.slice(0, 7);
        const sectionsToInsert = entry.sections.map((section, index) => ({
          entry_id: newEntry.id,
          content_json: section.content_json,
          persona_id: section.persona_id,
          persona_name_snapshot: `↩ Revert of ${section.persona_name_snapshot || 'Unknown'} (${revertDate})`,
          sort_order: index,
        }));

        const { error: sectionsError } = await supabase
          .from('sections')
          .insert(sectionsToInsert);

        if (sectionsError) throw sectionsError;
      }

      return newEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['latest-entry-id', streamId] });
      queryClient.invalidateQueries({ queryKey: ['entries-xml', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-entries', streamId] });
      queryClient.invalidateQueries({ queryKey: ['bridge-token-entries', streamId] });
    },
  });

  const fetchAllEntriesForExport = async () => {
    let query = supabase
      .from('entries')
      .select(`
        *,
        sections!inner (
          *,
          persona:personas (*)
        )
      `)
      .eq('stream_id', streamId)
      .eq('is_draft', false)
      .is('deleted_at', null);

    if (search) {
      query = query.ilike('sections.search_text', `%${search}%`);
    }

    if (personaId) {
      query = query.eq('sections.persona_id', personaId);
    }

    query = query.order('created_at', { ascending: sortOrder === 'oldest' });

    const { data, error } = await query;
    if (error) throw error;
    return data as EntryWithSections[];
  };

  return {
    items: query.data?.pages.flat() || [],
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error,
    createEntry,
    amendEntry,
    deleteEntry,
    resetToEntry,
    duplicateEntry,
    revertEntry,
    fetchAllEntriesForExport,
  };
}
