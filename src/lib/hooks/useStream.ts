import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { StreamWithCabinetAndDomain } from '@/lib/types';

export function useStream(streamId: string) {
  const supabase = createClient();

  const { data: stream, isLoading, error } = useQuery({
    queryKey: ['stream', streamId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('streams')
        .select('*, cabinet:cabinets(*, domain:domains(*))')
        .eq('id', streamId)
        .abortSignal(signal)
        .single();

      if (error) throw error;
      return data as StreamWithCabinetAndDomain;
    },
    enabled: !!streamId,
  });

  return { stream, isLoading, error };
}
