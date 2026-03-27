import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PostgrestError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  Domain,
  DomainInsert,
  DomainUpdate,
  Cabinet,
  CabinetInsert,
  Stream,
  StreamInsert,
  Entry,
  EntryInsert,
  Section,
  SectionInsert,
  SectionFileAttachmentInsert,
  DocumentEntryLinkInsert,
  Canvas,
  CanvasInsert,
  STREAM_KIND,
} from "@/lib/types";
import { cloneStoredContentFields } from "@/lib/content-protocol";

function isMissingDuplicateDomainRpcError(error: unknown) {
  const rpcError = error as Partial<PostgrestError> | null;
  const message = (rpcError?.message ?? "").toLowerCase();
  return (
    rpcError?.code === "PGRST202" ||
    message.includes("duplicate_domain") ||
    message.includes("schema cache") ||
    message.includes("could not find the function")
  );
}

export function useDomains(userId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const draftStoragePrefix = "kolam_draft_v2_";

  const copyLocalEntryCreatorDrafts = (streamMap: Map<string, string>) => {
    if (typeof window === "undefined" || streamMap.size === 0) return;

    for (const [oldStreamId, newStreamId] of streamMap.entries()) {
      const sourceKey = `${draftStoragePrefix}${oldStreamId}`;
      const targetKey = `${draftStoragePrefix}${newStreamId}`;
      const sourceDraft = window.localStorage.getItem(sourceKey);
      if (!sourceDraft) continue;
      window.localStorage.setItem(targetKey, sourceDraft);
    }
  };

  const copyLocalCanvasDraftState = (streamMap: Map<string, string>) => {
    if (typeof window === "undefined" || streamMap.size === 0) return;

    const raw = window.localStorage.getItem("kolam-canvas-drafts");
    if (!raw) return;

    type PersistedCanvasDraftState = {
      state?: {
        liveContentByStream?: Record<string, unknown>;
        dbSyncStatusByStream?: Record<string, unknown>;
        localSaveStatusByStream?: Record<string, unknown>;
        _dirtyStreamsArr?: string[];
      };
      version?: number;
    };

    try {
      const parsed = JSON.parse(raw) as PersistedCanvasDraftState;
      const state = parsed.state ?? {};

      const nextLive = { ...(state.liveContentByStream ?? {}) };
      const nextDbSync = { ...(state.dbSyncStatusByStream ?? {}) };
      const nextLocalSave = { ...(state.localSaveStatusByStream ?? {}) };
      const dirtySet = new Set(state._dirtyStreamsArr ?? []);

      for (const [oldStreamId, newStreamId] of streamMap.entries()) {
        if (oldStreamId in nextLive) {
          nextLive[newStreamId] = nextLive[oldStreamId];
        }
        if (oldStreamId in nextDbSync) {
          nextDbSync[newStreamId] = nextDbSync[oldStreamId];
        }
        if (oldStreamId in nextLocalSave) {
          nextLocalSave[newStreamId] = nextLocalSave[oldStreamId];
        }
        if (dirtySet.has(oldStreamId)) {
          dirtySet.add(newStreamId);
        }
      }

      const nextState: PersistedCanvasDraftState = {
        ...parsed,
        state: {
          ...state,
          liveContentByStream: nextLive,
          dbSyncStatusByStream: nextDbSync,
          localSaveStatusByStream: nextLocalSave,
          _dirtyStreamsArr: Array.from(dirtySet),
        },
      };

      window.localStorage.setItem(
        "kolam-canvas-drafts",
        JSON.stringify(nextState),
      );
    } catch {
      // Best effort only.
    }
  };

  const inferDuplicatedStreamMap = async (
    oldDomainId: string,
    newDomainId: string,
  ) => {
    const map = new Map<string, string>();

    const { data: oldCabs } = await supabase
      .from("cabinets")
      .select("id, parent_id, name, sort_order")
      .eq("domain_id", oldDomainId)
      .is("deleted_at", null);
    const { data: newCabs } = await supabase
      .from("cabinets")
      .select("id, parent_id, name, sort_order")
      .eq("domain_id", newDomainId)
      .is("deleted_at", null);

    const oldCabinets = oldCabs ?? [];
    const newCabinets = newCabs ?? [];

    const buildCabinetPathMap = (
      cabinets: Array<{
        id: string;
        parent_id: string | null;
        name: string;
        sort_order: number;
      }>,
    ) => {
      const byId = new Map(cabinets.map((cabinet) => [cabinet.id, cabinet]));
      const cache = new Map<string, string>();

      const resolvePath = (cabinetId: string): string => {
        if (cache.has(cabinetId)) return cache.get(cabinetId) as string;

        const cabinet = byId.get(cabinetId);
        if (!cabinet) return "__missing__";

        const selfSegment = `${cabinet.name}#${cabinet.sort_order}`;
        const parentPath = cabinet.parent_id
          ? resolvePath(cabinet.parent_id)
          : "__root__";
        const path = `${parentPath}/${selfSegment}`;
        cache.set(cabinetId, path);
        return path;
      };

      cabinets.forEach((cabinet) => resolvePath(cabinet.id));
      return cache;
    };

    const oldCabinetPaths = buildCabinetPathMap(oldCabinets);
    const newCabinetPaths = buildCabinetPathMap(newCabinets);

    const { data: oldStreams } = await supabase
      .from("streams")
      .select("id, cabinet_id, name, sort_order, stream_kind")
      .eq("domain_id", oldDomainId)
      .is("deleted_at", null);
    const { data: newStreams } = await supabase
      .from("streams")
      .select("id, cabinet_id, name, sort_order, stream_kind")
      .eq("domain_id", newDomainId)
      .is("deleted_at", null);

    const originalStreams = oldStreams ?? [];
    const duplicatedStreams = newStreams ?? [];

    const streamSignature = (stream: {
      cabinet_id: string | null;
      name: string;
      sort_order: number;
      stream_kind: string;
    }) => {
      const cabinetPath = stream.cabinet_id
        ? "__cab__" +
          (newCabinetPaths.get(stream.cabinet_id) ??
            oldCabinetPaths.get(stream.cabinet_id) ??
            "__missing__")
        : "__root_stream__";
      return [
        stream.stream_kind,
        cabinetPath,
        stream.name,
        String(stream.sort_order),
      ].join("|");
    };

    const newBySignature = new Map<string, string[]>();
    for (const stream of duplicatedStreams) {
      const signature = streamSignature(stream);
      const bucket = newBySignature.get(signature) ?? [];
      bucket.push(stream.id);
      newBySignature.set(signature, bucket);
    }

    const shiftMappedId = (signature: string) => {
      const bucket = newBySignature.get(signature);
      if (!bucket || bucket.length === 0) return null;
      const nextId = bucket.shift() ?? null;
      if (bucket.length === 0) {
        newBySignature.delete(signature);
      } else {
        newBySignature.set(signature, bucket);
      }
      return nextId;
    };

    for (const oldStream of originalStreams) {
      const signature = streamSignature(oldStream);
      let mappedNewId = shiftMappedId(signature);
      if (!mappedNewId && oldStream.stream_kind === STREAM_KIND.GLOBAL) {
        mappedNewId =
          duplicatedStreams.find(
            (stream) => stream.stream_kind === STREAM_KIND.GLOBAL,
          )?.id ??
          null;
      }
      if (mappedNewId) {
        map.set(oldStream.id, mappedNewId);
      }
    }

    return map;
  };

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
    retry: false,
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
      queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
    },
  });

  const updateDomain = useMutation({
    retry: false,
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
      queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
    },
  });

  const deleteDomain = useMutation({
    retry: false,
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
      queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
    },
  });

  const duplicateDomain = useMutation({
    retry: false,
    mutationFn: async ({ id, newName }: { id: string; newName: string }) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc("duplicate_domain", {
          p_orig_domain_id: id,
          p_new_name: newName,
          p_new_user_id: userId,
        });

        if (error) throw error;
        const newDomainId = data as unknown as string;
        try {
          const inferredMap = await inferDuplicatedStreamMap(id, newDomainId);
          copyLocalEntryCreatorDrafts(inferredMap);
          copyLocalCanvasDraftState(inferredMap);
        } catch {
          // Best effort only. Domain duplication should still succeed.
        }
        return newDomainId;
      } catch (rpcErr: unknown) {
        if (!isMissingDuplicateDomainRpcError(rpcErr)) {
          throw rpcErr;
        }

        // Fallback to client-side deep copy when RPC missing
        // Fetch original domain
        const { data: original, error: fetchErr } = await supabase
          .from("domains")
          .select("*")
          .eq("id", id)
          .single();

        if (fetchErr || !original) {
          // rethrow original RPC error to surface problem to caller
          throw rpcErr;
        }

        // Insert new domain row
        const domainPayload: Partial<DomainInsert> = {
          user_id: userId,
          name: newName,
          icon: original.icon ?? "",
          description: original.description ?? null,
          settings: original.settings ?? {},
          sort_order: (original.sort_order ?? 0) + 1,
        };

        const { data: newDomainRow, error: insertDomainErr } = await supabase
          .from("domains")
          .insert(domainPayload as DomainInsert)
          .select()
          .single();

        if (insertDomainErr || !newDomainRow) throw insertDomainErr || rpcErr;
        const newDomainId = (newDomainRow as Domain).id;

        // --- Deep copy child records: cabinets -> streams -> entries -> sections & canvases ---
        // Map old IDs to new IDs
        const cabMap = new Map<string, string>();
        const streamMap = new Map<string, string>();
        const entryMap = new Map<string, string>();

        // 1) Cabinets: insert without parent refs first
        const { data: cabinets } = await supabase
          .from("cabinets")
          .select("id, parent_id, name, sort_order")
          .eq("domain_id", id)
          .is("deleted_at", null);

        if (cabinets && cabinets.length) {
          for (const cab of cabinets) {
            const { data: newCab, error: newCabErr } = await supabase
              .from("cabinets")
              .insert({
                domain_id: newDomainId,
                parent_id: null,
                name: cab.name,
                sort_order: cab.sort_order,
              } as CabinetInsert)
              .select()
              .single();
            if (newCabErr) throw newCabErr;
            cabMap.set(cab.id, (newCab as Cabinet).id);
          }

          // Update parent references
          for (const cab of cabinets) {
            if (cab.parent_id) {
              const newCabId = cabMap.get(cab.id);
              const newParentId = cabMap.get(cab.parent_id as string) ?? null;
              if (newCabId) {
                const { error: updErr } = await supabase
                  .from("cabinets")
                  .update({ parent_id: newParentId })
                  .eq("id", newCabId);
                if (updErr) throw updErr;
              }
            }
          }
        }

        // 2) Streams: insert mapped to new cabinets
        const { data: streams } = await supabase
          .from("streams")
          .select("id, cabinet_id, name, sort_order, stream_kind")
          .eq("domain_id", id)
          .is("deleted_at", null);
        const sourceStreams = streams ?? [];

        if (sourceStreams.length) {
          const sourceGlobalStream = sourceStreams.find(
            (stream) => stream.stream_kind === STREAM_KIND.GLOBAL,
          );
          if (sourceGlobalStream) {
            const { data: targetGlobalStream, error: targetGlobalStreamErr } =
              await supabase
                .from("streams")
                .select("id")
                .eq("domain_id", newDomainId)
                .eq("stream_kind", STREAM_KIND.GLOBAL)
                .is("deleted_at", null)
                .single();

            if (targetGlobalStreamErr || !targetGlobalStream) {
              throw targetGlobalStreamErr || rpcErr;
            }

            const { error: updateGlobalStreamErr } = await supabase
              .from("streams")
              .update({
                name: sourceGlobalStream.name,
                sort_order: sourceGlobalStream.sort_order,
              })
              .eq("id", targetGlobalStream.id);

            if (updateGlobalStreamErr) throw updateGlobalStreamErr;

            streamMap.set(sourceGlobalStream.id, targetGlobalStream.id);
          }

          for (const s of sourceStreams) {
            if (s.stream_kind === STREAM_KIND.GLOBAL) continue;

            const newCabId = s.cabinet_id
              ? (cabMap.get(s.cabinet_id) ?? null)
              : null;
            const { data: newStream, error: newStreamErr } = await supabase
              .from("streams")
              .insert({
                cabinet_id: newCabId,
                name: s.name,
                sort_order: s.sort_order,
                domain_id: newDomainId,
                stream_kind: s.stream_kind,
              } as StreamInsert)
              .select()
              .single();
            if (newStreamErr) throw newStreamErr;
            streamMap.set(s.id, (newStream as Stream).id);
          }
        }

        // 3) Entries: copy entries linked to mapped streams
        if (streamMap.size) {
          const origStreamIds = Array.from(streamMap.keys());
          const { data: entries } = await supabase
            .from("entries")
            .select("id, stream_id, is_draft")
            .in("stream_id", origStreamIds)
            .is("deleted_at", null);

          if (entries && entries.length) {
            for (const e of entries) {
              const newStreamId = streamMap.get(e.stream_id);
              if (!newStreamId) continue;
              const { data: newEntry, error: newEntryErr } = await supabase
                .from("entries")
                .insert({
                  stream_id: newStreamId,
                  is_draft: e.is_draft,
                } as EntryInsert)
                .select()
                .single();
              if (newEntryErr) throw newEntryErr;
              entryMap.set(e.id, (newEntry as Entry).id);
            }
          }
        }

        // 4) Sections: copy sections for mapped entries
        if (entryMap.size) {
          const origEntryIds = Array.from(entryMap.keys());
          const { data: sections } = await supabase
            .from("sections")
            .select("id, entry_id, persona_id, persona_name_snapshot, content_json, raw_markdown, content_format, sort_order, section_type, file_display_mode")
            .in("entry_id", origEntryIds);

          if (sections && sections.length) {
            for (const sec of sections) {
              const newEntryId = entryMap.get(sec.entry_id);
              if (!newEntryId) continue;
              const { data: newSec, error: newSecErr } = await supabase
                .from("sections")
                .insert({
                  entry_id: newEntryId,
                  persona_id: sec.persona_id,
                  persona_name_snapshot: sec.persona_name_snapshot,
                  ...cloneStoredContentFields(sec),
                  sort_order: sec.sort_order,
                  section_type: sec.section_type,
                  file_display_mode: sec.file_display_mode,
                } as SectionInsert)
                .select()
                .single();

              if (newSecErr) throw newSecErr;

              // Copy section file attachments
              const { data: sAtts } = await supabase
                .from("section_attachments")
                .select("*")
                .eq("section_id", sec.id);

              if (sAtts && sAtts.length) {
                const sAttInserts = sAtts.map((sAtt) => ({
                  section_id: (newSec as Section).id,
                  document_id: sAtt.document_id,
                  sort_order: sAtt.sort_order,
                  title_snapshot: sAtt.title_snapshot,
                  annotation_text: sAtt.annotation_text,
                  referenced_persona_id: sAtt.referenced_persona_id,
                  referenced_page: sAtt.referenced_page,
                })) as SectionFileAttachmentInsert[];
                const { error: sAttErr } = await supabase
                  .from("section_attachments")
                  .insert(sAttInserts);
                if (sAttErr) throw sAttErr;
              }
            }
          }

          // Copy document entry links
          const { data: dEntryLinks } = await supabase
            .from("document_entry_links")
            .select("*")
            .in("entry_id", origEntryIds);

          if (dEntryLinks && dEntryLinks.length) {
            const delInserts = dEntryLinks
              .map((del) => {
                const newEntryId = entryMap.get(del.entry_id);
                if (!newEntryId) return null;
                return {
                  document_id: del.document_id,
                  entry_id: newEntryId,
                  relationship_type: del.relationship_type,
                };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);

            if (delInserts.length > 0) {
              const { error: delErr } = await supabase
                .from("document_entry_links")
                .insert(delInserts as DocumentEntryLinkInsert[]);
              if (delErr) throw delErr;
            }
          }
        }

        // 5) Canvases: copy canvases for mapped streams
        if (streamMap.size) {
          const origStreamIds = Array.from(streamMap.keys());
          const { data: canvases } = await supabase
            .from("canvases")
            .select("id, stream_id, content_json, raw_markdown, content_format")
            .in("stream_id", origStreamIds);

          if (canvases && canvases.length) {
            for (const c of canvases) {
              const newStreamId = streamMap.get(c.stream_id);
              if (!newStreamId) continue;

              const canvasPayload: CanvasInsert = {
                stream_id: newStreamId,
                ...cloneStoredContentFields(c),
              };

              const { error: upsertCanvasErr } = await supabase
                .from("canvases")
                .upsert(canvasPayload, { onConflict: "stream_id" });
              if (upsertCanvasErr) throw upsertCanvasErr;
            }
          }
        }

        // 6) Canvas snapshots: copy timeline versions for mapped streams
        if (streamMap.size) {
          const origStreamIds = Array.from(streamMap.keys());
          const newStreamIds = Array.from(streamMap.values());

          const { data: mappedCanvases } = await supabase
            .from("canvases")
            .select("id, stream_id")
            .in("stream_id", newStreamIds);

          const canvasIdByStream = new Map<string, string>();
          for (const canvas of (mappedCanvases ?? []) as Canvas[]) {
            canvasIdByStream.set(canvas.stream_id, canvas.id);
          }

          const { data: versions } = await supabase
            .from("canvas_versions")
            .select(
              "stream_id, content_json, raw_markdown, content_format, name, summary, created_by, created_at",
            )
            .in("stream_id", origStreamIds)
            .order("created_at", { ascending: true });

          if (versions && versions.length) {
            for (const version of versions) {
              const newStreamId = streamMap.get(version.stream_id);
              if (!newStreamId) continue;
              const newCanvasId = canvasIdByStream.get(newStreamId);
              if (!newCanvasId) continue;

              const { error: versionInsertErr } = await supabase
                .from("canvas_versions")
                .insert({
                  canvas_id: newCanvasId,
                  stream_id: newStreamId,
                  ...cloneStoredContentFields(version),
                  name: version.name,
                  summary: version.summary,
                  created_by: version.created_by,
                  created_at: version.created_at,
                });

              if (versionInsertErr) throw versionInsertErr;
            }
          }
        }

        copyLocalEntryCreatorDrafts(streamMap);
        copyLocalCanvasDraftState(streamMap);

        return newDomainId;
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["domains", userId] });
      queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
    },
  });

  return {
    domains: query.data as Domain[] | undefined,
    createDomain,
    updateDomain,
    deleteDomain,
    duplicateDomain,
    refetchDomains: query.refetch,
  };
}
