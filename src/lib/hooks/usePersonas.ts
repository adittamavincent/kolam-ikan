import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Persona } from "@/lib/types";
import { useAuth } from "@/lib/hooks/useAuth";

export function usePersonas({
  includeDeleted = false,
  streamId,
  includeShadow = false,
}: { includeDeleted?: boolean; streamId?: string; includeShadow?: boolean } = {}) {
  const supabase = createClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["personas", user?.id, includeDeleted, includeShadow, streamId],
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

      // Keep backward compatibility for databases that have not applied
      // shadow persona columns yet while still honoring new scoping rules.
      const rows = (data ?? []) as Persona[];

      return rows.filter((persona) => {
        const isShadow =
          "is_shadow" in persona &&
          typeof persona.is_shadow === "boolean" &&
          persona.is_shadow;

        if (!isShadow) return true;
        if (!includeShadow) return false;

        if (!streamId) return true;

        const hasShadowStreamId =
          "shadow_stream_id" in persona &&
          typeof persona.shadow_stream_id === "string" &&
          persona.shadow_stream_id.length > 0;

        if (hasShadowStreamId) {
          return persona.shadow_stream_id === streamId;
        }

        return false;
      });
    },
    enabled: !!user?.id,
  });

  return {
    personas: query.data,
    isLoading: query.isLoading,
    error: query.error,
  };
}
