'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PostgrestError } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { DocumentWithLatestJob } from '@/lib/types';

function isMissingDocumentSchemaError(error: PostgrestError | null) {
  const message = (error?.message ?? '').toLowerCase();
  return message.includes("could not find the table 'public.documents'")
    || message.includes("could not find the table 'public.document_import_jobs'")
    || message.includes('schema cache')
    || message.includes('does not exist');
}

interface CreateDocumentImportArgs {
  file: File;
  title?: string;
  flavor: 'lattice' | 'stream';
  enableTableStructure: boolean;
  debugDoclingTables: boolean;
}

export function useDocuments(streamId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();

  const documentsQuery = useQuery({
    queryKey: ['documents', streamId],
    queryFn: async () => {
      const { data: documents, error } = await supabase
        .from('documents')
        .select('*')
        .eq('stream_id', streamId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) {
        if (isMissingDocumentSchemaError(error)) {
          return [] as DocumentWithLatestJob[];
        }
        throw error;
      }

      const { data: jobs, error: jobError } = await supabase
        .from('document_import_jobs')
        .select('*')
        .eq('stream_id', streamId)
        .order('created_at', { ascending: false });

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

      return (documents ?? []).map((document) => ({
        ...document,
        latestJob: latestJobByDocumentId.get(document.id) ?? null,
      })) as DocumentWithLatestJob[];
    },
    enabled: !!streamId,
    refetchInterval: (query) => {
      const documents = (query.state.data as DocumentWithLatestJob[] | undefined) ?? [];
      const hasActiveJob = documents.some((document) => {
        const status = document.latestJob?.status ?? document.import_status;
        return status === 'queued' || status === 'processing';
      });

      return hasActiveJob ? 2000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const createImport = useMutation({
    mutationFn: async ({ file, title, flavor, enableTableStructure, debugDoclingTables }: CreateDocumentImportArgs) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('streamId', streamId);
      if (title?.trim()) {
        formData.append('title', title.trim());
      }
      formData.append('flavor', flavor);
      formData.append('enableTableStructure', String(enableTableStructure));
      formData.append('debugDoclingTables', String(debugDoclingTables));

      const response = await fetch('/api/documents/imports', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to queue document import');
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', streamId] });
    },
  });

  const cancelImport = useMutation({
    mutationFn: async ({ documentId }: { documentId: string }) => {
      const response = await fetch('/api/documents/imports/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ streamId, documentId }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to cancel import');
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', streamId] });
    },
  });

  const cancelAllPendingImports = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/documents/imports/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ streamId, cancelAll: true }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to cancel pending imports');
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', streamId] });
    },
  });

  const deleteCanceledDocument = useMutation({
    mutationFn: async ({ documentId }: { documentId: string }) => {
      const response = await fetch('/api/documents/imports/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ streamId, documentId }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Failed to delete canceled document');
      }

      return payload;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', streamId] });
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
    deleteCanceledDocument,
  };
}