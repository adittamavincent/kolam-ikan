import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Stream } from '@/lib/types';

export function useStream(streamId: string) {
  const supabase = createClient();

  const { data: stream, isLoading, error } = useQuery({
    queryKey: ['stream', streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streams')
        .select('*')
        .eq('id', streamId)
        .single();

      if (error) throw error;
      return data as Stream;
    },
    enabled: !!streamId,
  });

  return { stream, isLoading, error };
}
