"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  Document,
  DocumentImportJob,
  DocumentWithLatestJob,
} from "@/lib/types";
import {
  getDocumentFileUrl,
  getDocumentThumbnailUrl,
} from "@/lib/documents/utils";

function isMissingDocumentSchemaError(error: PostgrestError | null) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("could not find the table 'public.documents'") ||
    message.includes(
      "could not find the table 'public.document_import_jobs'",
    ) ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

function isMissingAttachmentSchemaError(error: PostgrestError | null) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    message.includes("could not find the table 'public.section_attachments'") ||
    message.includes("schema cache") ||
    message.includes("does not exist")
  );
}

interface CreateDocumentImportArgs {
  file: File;
  title?: string;
  flavor: "lattice" | "stream";
  enableTableStructure: boolean;
  debugDoclingTables: boolean;
  fileHash?: string;
}

export function useDocuments(streamId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const queryOwnerId = user?.id ?? "anonymous";
  const documentsQueryKey = ["documents", queryOwnerId] as const;

  const documentsQuery = useQuery({
    queryKey: documentsQueryKey,
    queryFn: async () => {
      if (!user?.id) {
        return [] as DocumentWithLatestJob[];
      }

      const { data: documents, error } = await supabase
        .from("documents")
        .select("*")
        .eq("created_by", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) {
        if (isMissingDocumentSchemaError(error)) {
          return [] as DocumentWithLatestJob[];
        }
        throw error;
      }

      const { data: jobs, error: jobError } = await supabase
        .from("document_import_jobs")
        .select("*")
        .eq("created_by", user.id)
        .order("created_at", { ascending: false });

      if (jobError) {
        if (isMissingDocumentSchemaError(jobError)) {
          return (documents ?? []).map((document) => ({
            ...document,
            latestJob: null,
          })) as DocumentWithLatestJob[];
        }
        throw jobError;
      }

      const latestJobByDocumentId = new Map<string, (typeof jobs)[number]>();
      for (const job of jobs ?? []) {
        if (!latestJobByDocumentId.has(job.document_id)) {
          latestJobByDocumentId.set(job.document_id, job);
        }
      }

      const documentIds = (documents ?? []).map((document) => document.id);
      const usageCountByDocumentId = new Map<string, number>();

      if (documentIds.length > 0) {
        const { data: attachments, error: attachmentError } = await supabase
          .from("section_attachments")
          .select("document_id")
          .in("document_id", documentIds);

        if (attachmentError) {
          if (!isMissingAttachmentSchemaError(attachmentError)) {
            throw attachmentError;
          }
        } else {
          for (const attachment of attachments ?? []) {
            const nextCount =
              (usageCountByDocumentId.get(attachment.document_id) ?? 0) + 1;
            usageCountByDocumentId.set(attachment.document_id, nextCount);
          }
        }
      }

      return (documents ?? []).map((document) => ({
        ...document,
        latestJob: latestJobByDocumentId.get(document.id) ?? null,
        fileUrl: getDocumentFileUrl(document),
        thumbnailUrl: getDocumentThumbnailUrl(document),
        usageCount: usageCountByDocumentId.get(document.id) ?? 0,
      })) as DocumentWithLatestJob[];
    },
    enabled: !!user?.id,
    refetchInterval: (query) => {
      const documents =
        (query.state.data as DocumentWithLatestJob[] | undefined) ?? [];
      const hasActiveJob = documents.some((document) => {
        const status = document.latestJob?.status ?? document.import_status;
        return status === "queued" || status === "processing";
      });

      return hasActiveJob ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (queryOwnerId === "anonymous") {
      return;
    }

    const channel = supabase
      .channel(`documents:${queryOwnerId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `created_by=eq.${queryOwnerId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["documents", queryOwnerId],
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "document_import_jobs",
          filter: `created_by=eq.${queryOwnerId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["documents", queryOwnerId],
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "section_attachments",
        },
        (payload) => {
          const changedDocumentId =
            (payload.new as { document_id?: string } | null)?.document_id ??
            (payload.old as { document_id?: string } | null)?.document_id;
          const documents =
            queryClient.getQueryData<DocumentWithLatestJob[]>([
              "documents",
              queryOwnerId,
            ]) ?? [];
          if (
            changedDocumentId &&
            !documents.some((document) => document.id === changedDocumentId)
          ) {
            return;
          }

          queryClient.invalidateQueries({
            queryKey: ["documents", queryOwnerId],
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, queryOwnerId, supabase]);

  type CreateImportResponse = {
    error?: string;
    document?: Document;
    documentId?: string;
    job?: DocumentImportJob;
    reused?: boolean;
    message?: string;
  } | null;

  const createImport = useMutation<
    CreateImportResponse,
    Error,
    CreateDocumentImportArgs
  >({
    mutationFn: async ({
      file,
      title,
      flavor,
      enableTableStructure,
      debugDoclingTables,
      fileHash,
    }: CreateDocumentImportArgs) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("streamId", streamId);
      if (title?.trim()) {
        formData.append("title", title.trim());
      }
      formData.append("flavor", flavor);
      formData.append("enableTableStructure", String(enableTableStructure));
      formData.append("debugDoclingTables", String(debugDoclingTables));
      if (fileHash) {
        formData.append("fileHash", fileHash);
      }

      const response = await fetch("/api/documents/imports", {
        method: "POST",
        body: formData,
      });

      const payload = (await response
        .json()
        .catch(() => null)) as CreateImportResponse;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to queue document import");
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });

  const cancelImport = useMutation({
    mutationFn: async ({ documentId }: { documentId: string }) => {
      const response = await fetch("/api/documents/imports/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to cancel import");
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });

  const cancelAllPendingImports = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/documents/imports/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ cancelAll: true }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to cancel pending imports");
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });

  const deleteDocument = useMutation({
    mutationFn: async ({ documentId }: { documentId: string }) => {
      const response = await fetch("/api/documents/imports/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId }),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to delete document");
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });

  return {
    documents: documentsQuery.data ?? [],
    isLoading: documentsQuery.isLoading,
    error: documentsQuery.error,
    refetch: documentsQuery.refetch,
    createImport,
    cancelImport,
    cancelAllPendingImports,
    deleteDocument,
    // Backward-compatible alias.
    deleteCanceledDocument: deleteDocument,
  };
}
