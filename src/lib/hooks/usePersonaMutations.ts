import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Persona, PersonaInsert } from "@/lib/types";

export function usePersonaMutations() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  type DeletePersonaParams = {
    id: string;
    transferToId?: string | null;
    transferToName?: string | null;
  };

  const createPersona = useMutation({
    mutationFn: async (newPersona: PersonaInsert) => {
      // Need to get current user to assign user_id
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("personas").insert({
        ...newPersona,
        user_id: user.id,
        is_system: false,
        type: newPersona.type ?? "HUMAN", // Default to HUMAN for user-created personas
      });

      if (error) throw error;
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === "personas",
      });
    },
  });

  const updatePersona = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Persona>;
    }) => {
      const { error } = await supabase
        .from("personas")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === "personas",
      });
    },
  });

  const deletePersona = useMutation({
    mutationFn: async ({
      id,
      transferToId,
      transferToName,
    }: DeletePersonaParams) => {
      if (transferToId) {
        const { error: transferError } = await supabase
          .from("sections")
          .update({
            persona_id: transferToId,
            persona_name_snapshot: transferToName ?? null,
          })
          .eq("persona_id", id);

        if (transferError) throw transferError;
      }

      // Soft delete
      const { error } = await supabase
        .from("personas")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === "personas",
      });
      queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  const hardDeletePersona = useMutation({
    mutationFn: async ({
      id,
      transferToId,
      transferToName,
    }: DeletePersonaParams) => {
      if (transferToId) {
        const { error: transferError } = await supabase
          .from("sections")
          .update({
            persona_id: transferToId,
            persona_name_snapshot: transferToName ?? null,
          })
          .eq("persona_id", id);

        if (transferError) throw transferError;
      }

      const { error } = await supabase.from("personas").delete().eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) && query.queryKey[0] === "personas",
      });
      queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  const updateSectionPersona = useMutation({
    mutationFn: async ({
      sectionId,
      personaId,
    }: {
      sectionId: string;
      personaId: string;
    }) => {
      const { error } = await supabase
        .from("sections")
        .update({ persona_id: personaId })
        .eq("id", sectionId);

      if (error) throw error;
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries"] });
    },
  });

  return {
    createPersona,
    updatePersona,
    deletePersona,
    hardDeletePersona,
    updateSectionPersona,
  };
}
