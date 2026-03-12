import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Canvas, CanvasUpdate } from "@/lib/types";

export function useCanvas(streamId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["canvas", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvases")
        .select("*")
        .eq("stream_id", streamId)
        .single();

      if (error) throw error;
      return data as Canvas;
    },
    enabled: !!streamId,
  });

  const updateCanvas = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: CanvasUpdate;
    }) => {
      const { data, error } = await supabase
        .from("canvases")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Canvas;
    },
    onMutate: async ({ updates }) => {
      await queryClient.cancelQueries({ queryKey: ["canvas", streamId] });
      const previousCanvas = queryClient.getQueryData<Canvas>([
        "canvas",
        streamId,
      ]);

      if (previousCanvas) {
        queryClient.setQueryData<Canvas>(["canvas", streamId], (old) =>
          old ? { ...old, ...updates } : old,
        );
      }

      return { previousCanvas };
    },
    onError: (err, variables, context) => {
      if (context?.previousCanvas) {
        queryClient.setQueryData(["canvas", streamId], context.previousCanvas);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["canvas", streamId] });
    },
  });

  return {
    canvas: query.data,
    isLoading: query.isLoading,
    updateCanvas,
  };
}
