import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Domain, DomainInsert, DomainUpdate } from "@/lib/types";

export function useDomains(userId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["domains", userId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .from("domains")
        .select("*")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .abortSignal(signal);

      if (error) {
        throw error;
      }
      return data as Domain[];
    },
    refetchOnMount: "always", // Always refetch to ensure fresh data after auth
    enabled: !!userId,
  });

  const createDomain = useMutation({
    mutationFn: async (domain: DomainInsert) => {
      const { data, error } = await supabase
        .from("domains")
        .insert(domain)
        .select()
        .single();

      if (error) throw error;
      return data as Domain;
    },
    onMutate: async (newDomain) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ["domains", userId] });

      // Snapshot previous value
      const previousDomains = queryClient.getQueryData<Domain[]>([
        "domains",
        userId,
      ]);

      // Optimistically update
      if (previousDomains) {
        queryClient.setQueryData<Domain[]>(["domains", userId], (old) => [
          ...(old || []),
          {
            ...newDomain,
            id: "temp-" + Date.now(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          } as Domain,
        ]);
      }

      return { previousDomains };
    },
    onError: (err, newDomain, context) => {
      // Rollback on error
      if (context?.previousDomains) {
        queryClient.setQueryData(["domains", userId], context.previousDomains);
      }
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: ["domains", userId] });
    },
  });

  const updateDomain = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: DomainUpdate;
    }) => {
      const { data, error } = await supabase
        .from("domains")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Domain;
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ["domains", userId] });
      await queryClient.cancelQueries({ queryKey: ["domain", id] });
      const previousDomains = queryClient.getQueryData<Domain[]>([
        "domains",
        userId,
      ]);
      const previousDomain = queryClient.getQueryData<Domain>(["domain", id]);

      if (previousDomains) {
        queryClient.setQueryData<Domain[]>(["domains", userId], (old) =>
          old?.map((domain) =>
            domain.id === id ? { ...domain, ...updates } : domain,
          ),
        );
      }

      if (previousDomain) {
        queryClient.setQueryData<Domain>(["domain", id], {
          ...previousDomain,
          ...updates,
        });
      }

      return { previousDomains, previousDomain };
    },
    onError: (err, variables, context) => {
      if (context?.previousDomains) {
        queryClient.setQueryData(["domains", userId], context.previousDomains);
      }
      if (context?.previousDomain) {
        queryClient.setQueryData(
          ["domain", variables.id],
          context.previousDomain,
        );
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({ queryKey: ["domains", userId] });
      queryClient.invalidateQueries({ queryKey: ["domain", variables.id] });
    },
  });

  const deleteDomain = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete
      const { error } = await supabase
        .from("domains")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["domains", userId] });
      const previousDomains = queryClient.getQueryData<Domain[]>([
        "domains",
        userId,
      ]);

      if (previousDomains) {
        queryClient.setQueryData<Domain[]>(["domains", userId], (old) =>
          old?.filter((domain) => domain.id !== id),
        );
      }

      return { previousDomains };
    },
    onError: (err, id, context) => {
      if (context?.previousDomains) {
        queryClient.setQueryData(["domains", userId], context.previousDomains);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["domains", userId] });
    },
  });

  return {
    domains: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    createDomain,
    updateDomain,
    deleteDomain,
  };
}
