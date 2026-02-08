import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { EntryWithSections } from '@/lib/types';

export function useEntries(streamId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['entries', streamId],
    queryFn: async () => {
      const start = performance.now();
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
        .eq('is_draft', false)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50); // Limit to 50 entries for performance

      if (error) {
        console.error('Error fetching entries:', error);
        throw error;
      }
      
      const end = performance.now();
      console.log(`Fetched ${data.length} entries in ${Math.round(end - start)}ms`);
      
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
    error: query.error,
    createEntry,
  };
}
