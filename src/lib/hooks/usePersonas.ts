import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Persona } from '@/lib/types';
import { useAuth } from '@/lib/hooks/useAuth';

export function usePersonas() {
  const supabase = createClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['personas', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('personas')
        .select('*')
        .or(`user_id.eq.${user?.id},is_system.eq.true`)
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) throw error;
      return data as Persona[];
    },
    enabled: !!user?.id,
  });

  return {
    personas: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
