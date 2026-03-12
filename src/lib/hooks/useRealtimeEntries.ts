import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useRealtimeEntries(streamId: string) {
  const queryClient = useQueryClient();
  const supabase = createClient();

  useEffect(() => {
    if (!streamId) return;

    const channel = supabase
      .channel(`entries:${streamId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "entries",
          filter: `stream_id=eq.${streamId}`,
        },
        () => {
          // Invalidate queries on changes
          queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
          queryClient.invalidateQueries({
            queryKey: ["latest-entry-id", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["entries-xml", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["bridge-entries", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["bridge-token-entries", streamId],
          });
          queryClient.invalidateQueries({ queryKey: ["graph-entries"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [streamId, queryClient, supabase]);
}
