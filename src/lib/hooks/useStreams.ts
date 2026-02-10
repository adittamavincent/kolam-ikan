import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Stream, StreamInsert, StreamUpdate } from '@/lib/types';

export function useStreams(cabinetId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['streams', cabinetId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from('streams')
        .select('*')
        .eq('cabinet_id', cabinetId)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true })
        .abortSignal(signal);

      if (error) throw error;
      return data as Stream[];
    },
    enabled: !!cabinetId,
  });

  const createStream = useMutation({
    mutationFn: async (stream: StreamInsert) => {
      const { data, error } = await supabase
        .from('streams')
        .insert(stream)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async (newStream) => {
      await queryClient.cancelQueries({ queryKey: ['streams', cabinetId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', cabinetId]);

      if (previousStreams) {
        queryClient.setQueryData<Stream[]>(['streams', cabinetId], (old) => [
          ...(old || []),
          {
            ...newStream,
            id: 'temp-' + Date.now(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          } as Stream,
        ]);
      }

      return { previousStreams };
    },
    onError: (err, newStream, context) => {
      if (context?.previousStreams) {
        queryClient.setQueryData(['streams', cabinetId], context.previousStreams);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', cabinetId] });
    },
  });

  const updateStream = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: StreamUpdate }) => {
      const { data, error } = await supabase
        .from('streams')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['streams', cabinetId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', cabinetId]);

      if (previousStreams) {
        queryClient.setQueryData<Stream[]>(['streams', cabinetId], (old) =>
          old?.map((stream) => (stream.id === id ? { ...stream, ...updates } : stream))
        );
      }

      return { previousStreams };
    },
    onError: (err, variables, context) => {
      if (context?.previousStreams) {
        queryClient.setQueryData(['streams', cabinetId], context.previousStreams);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', cabinetId] });
    },
  });

  const deleteStream = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('streams')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['streams', cabinetId] });
      const previousStreams = queryClient.getQueryData<Stream[]>(['streams', cabinetId]);

      if (previousStreams) {
        queryClient.setQueryData<Stream[]>(['streams', cabinetId], (old) =>
          old?.filter((stream) => stream.id !== id)
        );
      }

      return { previousStreams };
    },
    onError: (err, id, context) => {
      if (context?.previousStreams) {
        queryClient.setQueryData(['streams', cabinetId], context.previousStreams);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['streams', cabinetId] });
    },
  });

  return {
    streams: query.data,
    isLoading: query.isLoading,
    error: query.error,
    createStream,
    updateStream,
    deleteStream,
  };
}
