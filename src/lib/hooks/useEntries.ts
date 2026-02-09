import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { EntryWithSections } from '@/lib/types';

interface UseEntriesOptions {
  search?: string;
  personaId?: string | null;
  sortOrder?: 'newest' | 'oldest';
}

export function useEntries(streamId: string, options: UseEntriesOptions = {}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { search, personaId, sortOrder = 'newest' } = options;
  const PAGE_SIZE = 50;

  const query = useInfiniteQuery({
    queryKey: ['entries', streamId, search, personaId, sortOrder],
    queryFn: async ({ pageParam = 0 }) => {
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

      // Pagination
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      
      const { data, error } = await query.range(from, to);

      if (error) {
        console.error('Error fetching entries:', error);
        throw error;
      }
      
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
    entries: query.data?.pages.flat() || [],
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error,
    createEntry,
    fetchAllEntriesForExport,
  };
}
