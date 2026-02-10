import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Cabinet, CabinetInsert, CabinetUpdate } from '@/lib/types';

export function useCabinets(domainId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['cabinets', domainId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('cabinets')
        .select('*')
        .eq('domain_id', domainId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .abortSignal(signal);

      if (error) throw error;
      return data as Cabinet[];
    },
    enabled: !!domainId,
  });

  const createCabinet = useMutation({
    mutationFn: async (cabinet: CabinetInsert) => {
      const { data, error } = await supabase
        .from('cabinets')
        .insert(cabinet)
        .select()
        .single();

      if (error) throw error;
      return data as Cabinet;
    },
    onMutate: async (newCabinet) => {
      await queryClient.cancelQueries({ queryKey: ['cabinets', domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>(['cabinets', domainId]);

      if (previousCabinets) {
        queryClient.setQueryData<Cabinet[]>(['cabinets', domainId], (old) => [
          ...(old || []),
          {
            ...newCabinet,
            id: 'temp-' + Date.now(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          } as Cabinet,
        ]);
      }

      return { previousCabinets };
    },
    onError: (err, newCabinet, context) => {
      if (context?.previousCabinets) {
        queryClient.setQueryData(['cabinets', domainId], context.previousCabinets);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cabinets', domainId] });
    },
  });

  const updateCabinet = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: CabinetUpdate }) => {
      const { data, error } = await supabase
        .from('cabinets')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Cabinet;
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['cabinets', domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>(['cabinets', domainId]);

      if (previousCabinets) {
        queryClient.setQueryData<Cabinet[]>(['cabinets', domainId], (old) =>
          old?.map((cabinet) => (cabinet.id === id ? { ...cabinet, ...updates } : cabinet))
        );
      }

      return { previousCabinets };
    },
    onError: (err, variables, context) => {
      if (context?.previousCabinets) {
        queryClient.setQueryData(['cabinets', domainId], context.previousCabinets);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cabinets', domainId] });
    },
  });

  const deleteCabinet = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('cabinets')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['cabinets', domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>(['cabinets', domainId]);

      if (previousCabinets) {
        queryClient.setQueryData<Cabinet[]>(['cabinets', domainId], (old) =>
          old?.filter((cabinet) => cabinet.id !== id)
        );
      }

      return { previousCabinets };
    },
    onError: (err, id, context) => {
      if (context?.previousCabinets) {
        queryClient.setQueryData(['cabinets', domainId], context.previousCabinets);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cabinets', domainId] });
    },
  });

  return {
    cabinets: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createCabinet,
    updateCabinet,
    deleteCabinet,
  };
}
