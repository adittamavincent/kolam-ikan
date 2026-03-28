import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { EntryWithSections } from "@/lib/types";
import type { PartialBlock } from "@/lib/types/editor";
import { SectionFileAttachmentInsert } from "@/lib/types";
import {
  buildStoredContentPayload,
  cloneStoredContentFields,
} from "@/lib/content-protocol";

interface UseEntriesOptions {
  branchId?: string | null;
  parentEntryId?: string | null;
  search?: string;
  personaId?: string | null;
  sortOrder?: "newest" | "oldest";
}

interface AmendEntryInput {
  entryId: string;
  sections: Array<{
    sectionId: string;
    content: PartialBlock[];
    rawMarkdown?: string;
  }>;
}

const ENTRIES_SELECT_FULL = `
 id, stream_id, is_draft, created_at, updated_at, deleted_at,
 entry_kind, merge_source_commit_id, merge_source_branch_name, merge_target_branch_name,
 sections!inner (
 id, entry_id, persona_id, persona_name_snapshot, content_json, raw_markdown, content_format,
 section_type, file_display_mode, sort_order, updated_at,
 persona:personas (id, name, icon, color, is_shadow, shadow_stream_id, shadow_document_id),
 section_attachments (
 id, section_id, document_id, sort_order, title_snapshot,
 annotation_text, referenced_persona_id, referenced_page,
 created_at, updated_at,
 document:documents (id, title, storage_path, thumbnail_path, thumbnail_status, import_status)
 )
 )
`;

const ENTRIES_SELECT_LEGACY=`
 id, stream_id, is_draft, created_at, updated_at, deleted_at,
 entry_kind, merge_source_commit_id, merge_source_branch_name, merge_target_branch_name,
 sections!inner (
 id, entry_id, persona_id, persona_name_snapshot, content_json, raw_markdown, content_format,
 sort_order, updated_at,
 persona:personas (id, name, icon, color, is_shadow, shadow_stream_id, shadow_document_id)
 )
`;

function isMissingColumnError(
  error: { message?: string; code?: string } | null,
): boolean {
  if (!error?.message) return false;
  const msg = error.message.toLowerCase();
  return (
    (msg.includes("column") ||
      msg.includes("relation") ||
      msg.includes("does not exist")) &&
    (msg.includes("section_type") ||
      msg.includes("file_display_mode") ||
      msg.includes("section_attachments") ||
      msg.includes("raw_markdown") ||
      msg.includes("content_format"))
  );
}

function orderBySortOrder<T extends { sort_order?: number | null }>(
  items: T[] | undefined,
): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aOrder = a.item.sort_order;
      const bOrder = b.item.sort_order;

      if (typeof aOrder === "number" && typeof bOrder === "number") {
        return aOrder - bOrder;
      }
      if (typeof aOrder === "number") return -1;
      if (typeof bOrder === "number") return 1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function normalizeEntryOrder(entries: EntryWithSections[]): EntryWithSections[] {
  return entries.map((entry) => ({
    ...entry,
    sections: orderBySortOrder(entry.sections).map((section) => ({
      ...section,
      section_attachments: orderBySortOrder(section.section_attachments),
    })),
  }));
}

export function useEntries(streamId: string, options: UseEntriesOptions = {}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const {
    branchId = null,
    parentEntryId = null,
    search,
    personaId,
    sortOrder = "newest",
  } = options;
  const PAGE_SIZE = 20;

  const cacheKey = useMemo(
    () =>
      `kolam_entries_cache_${streamId}_${search ?? ""}_${personaId ?? ""}_${sortOrder}`,
    [streamId, search, personaId, sortOrder],
  );

  const cachedEntries = useMemo(() => {
    if (typeof window === "undefined" || !streamId) return null;

    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as {
        items?: EntryWithSections[];
        updatedAt?: number;
      };

      const items = Array.isArray(parsed.items)
        ? normalizeEntryOrder(parsed.items)
        : null;
      const updatedAt =
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;

      if (!items || items.length === 0) return null;

      return { items, updatedAt };
    } catch {
      return null;
    }
  }, [cacheKey, streamId]);

  const query = useInfiniteQuery({
    queryKey: ["entries", streamId, search, personaId, sortOrder],
    queryFn: async ({ pageParam = 0, signal }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const buildQuery = (selectStr: string) => {
        let q = supabase
          .from("entries")
          .select(selectStr)
          .eq("stream_id", streamId)
          .eq("is_draft", false)
          .is("deleted_at", null);

        if (search) q = q.ilike("sections.search_text", `%${search}%`);
        if (personaId) q = q.eq("sections.persona_id", personaId);
        q = q.order("created_at", { ascending: sortOrder === "oldest" });
        q = q.abortSignal(signal);
        return q.range(from, to);
      };

      const { data, error } = await buildQuery(ENTRIES_SELECT_FULL);

      if (error && isMissingColumnError(error)) {
        const fallback = await buildQuery(ENTRIES_SELECT_LEGACY);
        if (fallback.error) throw fallback.error;
        return normalizeEntryOrder(
          (fallback.data as unknown as EntryWithSections[]) ?? [],
        );
      }

      if (error) throw error;
      return normalizeEntryOrder((data as unknown as EntryWithSections[]) ?? []);
    },
    initialPageParam: 0,
    initialData: cachedEntries
      ? {
          pages: [cachedEntries.items],
          pageParams: [0],
        }
      : undefined,
    initialDataUpdatedAt: cachedEntries?.updatedAt,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAGE_SIZE ? allPages.length : undefined;
    },
    enabled: !!streamId,
  });

  useEffect(() => {
    if (typeof window === "undefined" || !streamId || !query.data) return;

    const firstPage = query.data.pages[0] ?? [];
    if (!firstPage.length) return;

    const payload = {
      items: firstPage,
      updatedAt: Date.now(),
    };

    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(payload));
    } catch {
      // Ignore cache write failures (quota, privacy mode, etc.)
    }
  }, [cacheKey, streamId, query.data]);

  const createEntry = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("entries")
        .insert({ stream_id: streamId, parent_commit_id: parentEntryId })
        .select()
        .single();

      if (error) throw error;

      if (branchId) {
        const { error: branchError } = await supabase
          .from("branches")
          .update({ head_commit_id: data.id })
          .eq("id", branchId);

        if (branchError) throw branchError;
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["latest-entry-id", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["entries-xml", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["bridge-token-entries", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["graph-entries"] });
      queryClient.invalidateQueries({ queryKey: ["branches", streamId] });
      queryClient.invalidateQueries({ queryKey: ["entries-lineage", streamId] });
      queryClient.invalidateQueries({ queryKey: ["home-domains"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
    },
  });

  const amendEntry = useMutation({
    onMutate: async ({ entryId, sections }) => {
      await queryClient.cancelQueries({ queryKey: ["entries", streamId] });

      const previousQueries = queryClient.getQueriesData<
        InfiniteData<EntryWithSections[]>
      >({
        queryKey: ["entries", streamId],
      });

      const nextUpdatedAt = new Date().toISOString();
      const sectionContentMap = new Map(
        sections.map((section) => [section.sectionId, section]),
      );

      previousQueries.forEach(([queryKey, queryData]) => {
        if (!queryData) return;

        const nextData: InfiniteData<EntryWithSections[]> = {
          ...queryData,
          pages: queryData.pages.map((page) =>
            page.map((entry) => {
              if (entry.id !== entryId) return entry;

              const nextSections = entry.sections.map((section) => {
                const nextSection = sectionContentMap.get(section.id);
                if (!nextSection) return section;

                return {
                  ...section,
                  ...buildStoredContentPayload(
                    nextSection.content,
                    nextSection.rawMarkdown,
                  ),
                  updated_at: nextUpdatedAt,
                };
              });

              return {
                ...entry,
                updated_at: nextUpdatedAt,
                sections: nextSections,
              };
            }),
          ),
        };

        queryClient.setQueryData(queryKey, nextData);
      });

      return { previousQueries };
    },
    mutationFn: async ({ entryId, sections }: AmendEntryInput) => {
      if (!sections.length) {
        throw new Error("No amended sections to save");
      }

      const nowIso = new Date().toISOString();
      const updates = sections.map(({ sectionId, content, rawMarkdown }) =>
        supabase
          .from("sections")
          .update({
            ...buildStoredContentPayload(content, rawMarkdown),
            updated_at: nowIso,
          })
          .eq("id", sectionId),
      );

      const results = await Promise.all(updates);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      const { error: entryError } = await supabase
        .from("entries")
        .update({ updated_at: nowIso })
        .eq("id", entryId);

      if (entryError) throw entryError;
      return { entryId };
    },
    onError: (_error, _variables, context) => {
      context?.previousQueries?.forEach(([queryKey, queryData]) => {
        queryClient.setQueryData(queryKey, queryData);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["latest-entry-id", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["entries-xml", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["bridge-token-entries", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["graph-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-domains"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
    },
  });

  const deleteEntry = useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from("entries")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", entryId);

      if (error) throw error;
      return { entryId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["latest-entry-id", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["entries-xml", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["bridge-token-entries", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["graph-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-domains"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
    },
  });

  const resetToEntry = useMutation({
    mutationFn: async (entry: EntryWithSections) => {
      // Mark all entries newer than this one in the same stream as deleted
      const { error } = await supabase
        .from("entries")
        .update({ deleted_at: new Date().toISOString() })
        .eq("stream_id", streamId)
        .gt("created_at", entry.created_at || "")
        .is("deleted_at", null);

      if (error) throw error;
      return { entryId: entry.id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["latest-entry-id", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["entries-xml", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-entries", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-token-entries", streamId] });
      queryClient.invalidateQueries({ queryKey: ["branches", streamId] });
      queryClient.invalidateQueries({ queryKey: ["entries-lineage", streamId] });
      queryClient.invalidateQueries({ queryKey: ["home-domains"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
    },
  });

  const duplicateEntry = useMutation({
    mutationFn: async (entry: EntryWithSections) => {
      // Create a new entry
      const { data: newEntry, error: entryError } = await supabase
        .from("entries")
        .insert({ stream_id: streamId, parent_commit_id: parentEntryId })
        .select()
        .single();

      if (entryError) throw entryError;

      // Clone all sections into the new entry
      if (entry.sections?.length) {
        const sectionsToInsert = entry.sections.map((section, index) => ({
          entry_id: newEntry.id,
          ...cloneStoredContentFields(section),
          persona_id: section.persona_id,
          persona_name_snapshot: section.persona_name_snapshot,
          section_type: section.section_type,
          file_display_mode: section.file_display_mode,
          sort_order: index,
        }));

        const { data: insertedSections, error: sectionsError } = await supabase
          .from("sections")
          .insert(sectionsToInsert)
          .select("id, sort_order");

        if (sectionsError) throw sectionsError;

        const attachmentInserts: SectionFileAttachmentInsert[] = [];
        insertedSections?.forEach((insertedSection) => {
          const sourceSection = entry.sections?.[insertedSection.sort_order];
          sourceSection?.section_attachments?.forEach((attachment, idx) => {
            attachmentInserts.push({
              section_id: insertedSection.id,
              document_id: attachment.document_id,
              sort_order: idx,
              title_snapshot: attachment.title_snapshot,
              annotation_text: attachment.annotation_text,
              referenced_persona_id: attachment.referenced_persona_id,
              referenced_page: attachment.referenced_page,
            });
          });
        });

        if (attachmentInserts.length > 0) {
          const { error: attachmentsError } = await supabase
            .from("section_attachments")
            .insert(attachmentInserts);
          if (attachmentsError) throw attachmentsError;
        }
      }

      if (branchId) {
        const { error: branchError } = await supabase
          .from("branches")
          .update({ head_commit_id: newEntry.id })
          .eq("id", branchId);

        if (branchError) throw branchError;
      }

      return newEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["latest-entry-id", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["entries-xml", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-entries", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-token-entries", streamId] });
      queryClient.invalidateQueries({ queryKey: ["branches", streamId] });
      queryClient.invalidateQueries({ queryKey: ["entries-lineage", streamId] });
      queryClient.invalidateQueries({ queryKey: ["home-domains"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
    },
  });

  const revertEntry = useMutation({
    mutationFn: async (entry: EntryWithSections) => {
      const { data: newEntry, error: entryError } = await supabase
        .from("entries")
        .insert({ stream_id: streamId, parent_commit_id: parentEntryId })
        .select()
        .single();

      if (entryError) throw entryError;

      if (entry.sections?.length) {
        const revertDate = entry.created_at
          ? new Date(entry.created_at).toLocaleDateString()
          : entry.id.slice(0, 7);
        const sectionsToInsert = entry.sections.map((section, index) => ({
          entry_id: newEntry.id,
          ...cloneStoredContentFields(section),
          persona_id: section.persona_id,
          persona_name_snapshot: `↩ Revert of ${section.persona_name_snapshot || "Unknown"} (${revertDate})`,
          section_type: section.section_type,
          file_display_mode: section.file_display_mode,
          sort_order: index,
        }));

        const { data: insertedSections, error: sectionsError } = await supabase
          .from("sections")
          .insert(sectionsToInsert)
          .select("id, sort_order");

        if (sectionsError) throw sectionsError;

        const attachmentInserts: SectionFileAttachmentInsert[] = [];
        insertedSections?.forEach((insertedSection) => {
          const sourceSection = entry.sections?.[insertedSection.sort_order];
          sourceSection?.section_attachments?.forEach((attachment, idx) => {
            attachmentInserts.push({
              section_id: insertedSection.id,
              document_id: attachment.document_id,
              sort_order: idx,
              title_snapshot: attachment.title_snapshot,
              annotation_text: attachment.annotation_text,
              referenced_persona_id: attachment.referenced_persona_id,
              referenced_page: attachment.referenced_page,
            });
          });
        });

        if (attachmentInserts.length > 0) {
          const { error: attachmentsError } = await supabase
            .from("section_attachments")
            .insert(attachmentInserts);
          if (attachmentsError) throw attachmentsError;
        }
      }

      if (branchId) {
        const { error: branchError } = await supabase
          .from("branches")
          .update({ head_commit_id: newEntry.id })
          .eq("id", branchId);

        if (branchError) throw branchError;
      }

      return newEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
      queryClient.invalidateQueries({
        queryKey: ["latest-entry-id", streamId],
      });
      queryClient.invalidateQueries({ queryKey: ["entries-xml", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-entries", streamId] });
      queryClient.invalidateQueries({ queryKey: ["bridge-token-entries", streamId] });
      queryClient.invalidateQueries({ queryKey: ["home-domains"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
    },
  });

  const fetchAllEntriesForExport = async () => {
    const buildExportQuery = (selectStr: string) => {
      let q = supabase
        .from("entries")
        .select(selectStr)
        .eq("stream_id", streamId)
        .eq("is_draft", false)
        .is("deleted_at", null);

      if (search) q = q.ilike("sections.search_text", `%${search}%`);
      if (personaId) q = q.eq("sections.persona_id", personaId);
      q = q.order("created_at", { ascending: sortOrder === "oldest" });
      return q;
    };

    const { data, error } = await buildExportQuery(ENTRIES_SELECT_FULL);

    if (error && isMissingColumnError(error)) {
      const fallback = await buildExportQuery(ENTRIES_SELECT_LEGACY);
      if (fallback.error) throw fallback.error;
      return normalizeEntryOrder(
        (fallback.data as unknown as EntryWithSections[]) ?? [],
      );
    }

    if (error) throw error;
    return normalizeEntryOrder((data as unknown as EntryWithSections[]) ?? []);
  };

  return {
    items: query.data?.pages.flat() || [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    error: query.error,
    createEntry,
    amendEntry,
    deleteEntry,
    resetToEntry,
    duplicateEntry,
    revertEntry,
    fetchAllEntriesForExport,
  };
}
