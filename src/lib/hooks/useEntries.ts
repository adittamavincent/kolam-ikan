import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { EntryWithSections } from '@/lib/types';

export function useEntries(streamId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['entries', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('entries')
        .select(`
          *,
          sections (
            *,
            persona:personas (*)
          )
        `)
        .eq('stream_id', streamId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as EntryWithSections[];
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

  return {
    entries: query.data,
    isLoading: query.isLoading,
    createEntry,
  };
}
