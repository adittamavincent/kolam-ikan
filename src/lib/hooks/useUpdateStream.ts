import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Stream } from "@/lib/types";

export function useUpdateStream(streamId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("streams")
        .update({ name })
        .eq("id", streamId)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onSuccess: (updatedStream) => {
      queryClient.setQueryData(["stream", streamId], updatedStream);
      queryClient.invalidateQueries({ queryKey: ["streams"] });
    },
  });
}
