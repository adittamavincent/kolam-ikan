import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { Persona } from '@/lib/types';

export function usePersonaMutations() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const createPersona = useMutation({
    mutationFn: async (newPersona: Omit<Persona, 'id' | 'created_at' | 'updated_at' | 'deleted_at' | 'is_system' | 'user_id'>) => {
      // Need to get current user to assign user_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('personas')
        .insert({
          ...newPersona,
          user_id: user.id,
          is_system: false,
          type: 'HUMAN', // Default to HUMAN for user-created personas
        });

      if (error) throw error;
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });

  const updatePersona = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Persona> }) => {
      const { error } = await supabase
        .from('personas')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });

  const deletePersona = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete
      const { error } = await supabase
        .from('personas')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['personas'] });
    },
  });

  const updateSectionPersona = useMutation({
    mutationFn: async ({ sectionId, personaId }: { sectionId: string; personaId: string }) => {
      const { error } = await supabase
        .from('sections')
        .update({ persona_id: personaId })
        .eq('id', sectionId);

      if (error) throw error;
      return null;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['entries'] });
    },
  });

  return {
    createPersona,
    updatePersona,
    deletePersona,
    updateSectionPersona,
  };
}
