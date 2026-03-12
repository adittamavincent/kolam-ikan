import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Persona } from "@/lib/types";
import { useAuth } from "@/lib/hooks/useAuth";

export function usePersonas({
  includeDeleted = false,
}: { includeDeleted?: boolean } = {}) {
  const supabase = createClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["personas", user?.id],
    queryFn: async ({ signal }) => {
      let query = supabase
        .from("personas")
        .select("*")
        .or(`user_id.eq.${user?.id},is_system.eq.true`);

      if (!includeDeleted) {
        query = query.is("deleted_at", null);
      }

      const { data, error } = await query
        .order("name", { ascending: true })
        .abortSignal(signal);

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
