import { useState, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { PartialBlock } from "@blocknote/core";
import { Json } from "@/lib/types/database.types";
import { SectionPdfAttachmentInsert } from "@/lib/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

interface UseDraftSystemProps {
  streamId: string;
}

interface SectionDraft {
  sectionType: "PERSONA" | "PDF";
  personaId: string | null;
  personaName?: string;
  content: PartialBlock[];
  pdfDisplayMode?: "inline" | "download" | "external";
  pdfAttachments?: PdfDraftAttachment[];
  updatedAt: number;
}

export interface PdfDraftAttachment {
  documentId: string;
  titleSnapshot: string;
  annotationText?: string | null;
  referencedPersonaId?: string | null;
  referencedPage?: number | null;
}

interface DraftState {
  sections: Record<string, SectionDraft>; // instanceId -> draft
  sectionOrder: string[];
  updatedAt: number;
}

export interface DraftContent {
  sectionType: "PERSONA" | "PDF";
  personaId: string | null;
  content: PartialBlock[];
  personaName?: string;
  pdfDisplayMode?: "inline" | "download" | "external";
  pdfAttachments?: PdfDraftAttachment[];
}

const STORAGE_PREFIX = "kolam_draft_v2_";

// ─── Content Helpers ──────────────────────────────────────────────────────────

const hasTextValue = (value: unknown): boolean =>
  typeof value === "string" && value.trim().length > 0;

const hasMeaningfulBlockPayload = (value: unknown): boolean => {
  if (hasTextValue(value)) return true;
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulBlockPayload(item));
  }
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;

  if (
    hasTextValue(record.text) ||
    hasTextValue(record.url) ||
    hasTextValue(record.src) ||
    hasTextValue(record.href)
  ) {
    return true;
  }

  if (
    hasMeaningfulBlockPayload(record.content) ||
    hasMeaningfulBlockPayload(record.children)
  ) {
    return true;
  }

  // Some editors store meaningful text in nested properties other than
  // content/children (e.g. props, attributes, metadata). Scan all values as fallback.
  for (const nestedValue of Object.values(record)) {
    if (hasMeaningfulBlockPayload(nestedValue)) {
      return true;
    }
  }

  const blockType = typeof record.type === "string" ? record.type : null;
  if (blockType && blockType !== "paragraph") {
    return true;
  }

  return false;
};

const hasMeaningfulDraftContent = (
  content: PartialBlock[] | undefined,
): boolean => {
  if (!Array.isArray(content) || content.length === 0) {
    return false;
  }
  return content.some((block) => hasMeaningfulBlockPayload(block));
};

function getSupabaseErrorMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Unknown error";

  const maybeError = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  };

  const parts = [
    maybeError.message,
    maybeError.details,
    maybeError.hint,
  ].filter((part): part is string => Boolean(part && part.trim()));

  if (parts.length > 0) return parts.join(" | ");
  return maybeError.code ? `Code ${maybeError.code}` : "Unknown error";
}

function isMissingPdfSchemaError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    (text.includes("section_type") ||
      text.includes("pdf_display_mode") ||
      text.includes("section_pdf_attachments")) &&
    (text.includes("column") ||
      text.includes("relation") ||
      text.includes("does not exist"))
  );
}

// ─── Local Storage Helpers ───────────────────────────────────────────────────

function readLocalDraft(streamId: string): DraftState | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${streamId}`);
    if (!raw) return null;
    return JSON.parse(raw) as DraftState;
  } catch {
    return null;
  }
}

function writeLocalDraft(streamId: string, state: DraftState): void {
  try {
    // Keep every section that has either a persona assignment or is a PDF section.
    const active = Object.entries(state.sections).filter(
      ([, s]) => s.sectionType === "PDF" || !!s.personaId,
    );
    if (active.length === 0) {
      localStorage.removeItem(`${STORAGE_PREFIX}${streamId}`);
      return;
    }
    const clean: DraftState = {
      sections: Object.fromEntries(active),
      sectionOrder: state.sectionOrder.filter((instanceId) =>
        Object.prototype.hasOwnProperty.call(
          Object.fromEntries(active),
          instanceId,
        ),
      ),
      updatedAt: Date.now(),
    };
    localStorage.setItem(`${STORAGE_PREFIX}${streamId}`, JSON.stringify(clean));
  } catch {
    // Ignore storage errors
  }
}

function removeLocalDraft(streamId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${streamId}`);
  } catch {
    // Ignore storage errors
  }
}

// ──────────────────────────────────────────────────────────────────────────────

export function useDraftSystem({ streamId }: UseDraftSystemProps) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [initialDrafts, setInitialDrafts] = useState<
    Record<string, DraftContent>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);

  const queryClient = useQueryClient();
  const supabase = createClient();

  // Ref keeps canonical state to avoid effect cycles on every keystroke
  const draftStateRef = useRef<DraftState>({
    sections: {},
    sectionOrder: [],
    updatedAt: Date.now(),
  });

  // 1. Initial Load and Legacy Cleanup
  useEffect(() => {
    setIsLoading(true);
    setInitialDrafts({});
    setStatus("idle");
    setRecoveryAvailable(false);
    draftStateRef.current = {
      sections: {},
      sectionOrder: [],
      updatedAt: Date.now(),
    };

    async function initializeDrafts() {
      if (!streamId) return;

      try {
        // Run completely asynchronously; cleanup any DB drafts
        // that shouldn't exist anymore to fix "Zombie/Ghost" drafts problem.
        supabase
          .from("entries")
          .delete()
          .eq("stream_id", streamId)
          .eq("is_draft", true)
          .then(({ error }) => {
            if (error)
              console.error("Failed to clean up ghost DB drafts:", error);
          });

        // Cleanup obsolete localStorage schema
        localStorage.removeItem(`kolam_draft_${streamId}`);
      } catch {
        // ignore safety failures
      }

      // Load purely localized drafted sections
      const local = readLocalDraft(streamId);
      if (local && Object.keys(local.sections).length > 0) {
        draftStateRef.current = {
          ...local,
          sectionOrder:
            local.sectionOrder && local.sectionOrder.length > 0
              ? local.sectionOrder
              : Object.keys(local.sections),
        };
        const loaded: Record<string, DraftContent> = {};
        Object.entries(local.sections).forEach(([id, s]) => {
          const sectionType = s.sectionType ?? "PERSONA";
          if (sectionType === "PERSONA" && !s.personaId) return;
          loaded[id] = {
            sectionType,
            personaId: s.personaId,
            personaName: s.personaName,
            content: s.content || [],
            pdfDisplayMode: s.pdfDisplayMode,
            pdfAttachments: s.pdfAttachments ?? [],
          };
        });
        setInitialDrafts(loaded);
        setRecoveryAvailable(true);
      }
      setIsLoading(false);
    }

    initializeDrafts();
  }, [streamId, supabase]);

  // 2. Local save Draft
  const saveDraft = useCallback(
    (
      instanceId: string,
      personaId: string,
      content: PartialBlock[],
      personaName?: string,
      forceDelete = false,
    ) => {
      setStatus("saving");

      // Only remove the section when explicitly force-deleted (X button).
      // Empty content is fine — the section still exists.
      if (forceDelete) {
        delete draftStateRef.current.sections[instanceId];
        draftStateRef.current.sectionOrder =
          draftStateRef.current.sectionOrder.filter((id) => id !== instanceId);
        writeLocalDraft(streamId, draftStateRef.current);

        setInitialDrafts((prev) => {
          const next = { ...prev };
          delete next[instanceId];
          return next;
        });
        setStatus("idle");
        return;
      }

      draftStateRef.current.sections[instanceId] = {
        sectionType: "PERSONA",
        personaId,
        personaName,
        content: content || [],
        updatedAt: Date.now(),
      };
      if (!draftStateRef.current.sectionOrder.includes(instanceId)) {
        draftStateRef.current.sectionOrder.push(instanceId);
      }
      writeLocalDraft(streamId, draftStateRef.current);
      setStatus("saved");
    },
    [streamId],
  );

  const savePdfDraft = useCallback(
    (
      instanceId: string,
      payload: {
        attachments: PdfDraftAttachment[];
        displayMode: "inline" | "download" | "external";
        content?: PartialBlock[];
      },
      forceDelete = false,
    ) => {
      setStatus("saving");

      if (forceDelete) {
        delete draftStateRef.current.sections[instanceId];
        draftStateRef.current.sectionOrder =
          draftStateRef.current.sectionOrder.filter((id) => id !== instanceId);
        writeLocalDraft(streamId, draftStateRef.current);

        setInitialDrafts((prev) => {
          const next = { ...prev };
          delete next[instanceId];
          return next;
        });
        setStatus("idle");
        return;
      }

      draftStateRef.current.sections[instanceId] = {
        sectionType: "PDF",
        personaId: null,
        content: payload.content ?? [],
        pdfDisplayMode: payload.displayMode,
        pdfAttachments: payload.attachments,
        updatedAt: Date.now(),
      };

      if (!draftStateRef.current.sectionOrder.includes(instanceId)) {
        draftStateRef.current.sectionOrder.push(instanceId);
      }

      writeLocalDraft(streamId, draftStateRef.current);
      setStatus("saved");
    },
    [streamId],
  );

  // 3. Clear/Discard whole draft
  const clearDraft = useCallback(() => {
    removeLocalDraft(streamId);
    draftStateRef.current = {
      sections: {},
      sectionOrder: [],
      updatedAt: Date.now(),
    };
    setInitialDrafts({});
    setRecoveryAvailable(false);
    setStatus("idle");
  }, [streamId]);

  const discardRecovery = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  // 4. Content Retriever
  const getDraftContent = useCallback(
    (instanceId: string) => {
      return (
        draftStateRef.current.sections[instanceId]?.content ||
        initialDrafts[instanceId]?.content ||
        []
      );
    },
    [initialDrafts],
  );

  const getPdfDraft = useCallback(
    (instanceId: string) => {
      const current = draftStateRef.current.sections[instanceId];
      const fallback = initialDrafts[instanceId];
      return {
        displayMode:
          current?.pdfDisplayMode ?? fallback?.pdfDisplayMode ?? "inline",
        attachments: current?.pdfAttachments ?? fallback?.pdfAttachments ?? [],
      };
    },
    [initialDrafts],
  );

  // 5. Explicit Commit to Database
  const commitDraft = useCallback(async () => {
    const orderedSections = draftStateRef.current.sectionOrder
      .map((instanceId) => ({
        instanceId,
        draft: draftStateRef.current.sections[instanceId],
      }))
      .filter(
        (value): value is { instanceId: string; draft: SectionDraft } =>
          !!value.draft,
      );

    // Safety check - ignore commit if content has zero meaning and no PDF attachments.
    const meaningfulSections = orderedSections.filter(({ draft }) => {
      if (draft.sectionType === "PDF") {
        return (draft.pdfAttachments?.length ?? 0) > 0;
      }
      return hasMeaningfulDraftContent(draft.content) && !!draft.personaId;
    });

    if (meaningfulSections.length === 0) return null;

    setStatus("saving");

    let newEntryId: string | null = null;

    try {
      // 5a. Create permanent single entry
      const { data: entryData, error: entryErr } = await supabase
        .from("entries")
        .insert({
          stream_id: streamId,
          is_draft: false,
        })
        .select("id")
        .single();

      if (entryErr || !entryData) {
        throw new Error(
          `Entry insert failed: ${getSupabaseErrorMessage(entryErr)}`,
        );
      }
      newEntryId = entryData.id;

      const pdfAttachmentInserts: SectionPdfAttachmentInsert[] = [];

      for (let index = 0; index < meaningfulSections.length; index += 1) {
        const { draft } = meaningfulSections[index];

        let { data: insertedSection, error: sectionError } = await supabase
          .from("sections")
          .insert({
            entry_id: newEntryId,
            persona_id:
              draft.sectionType === "PERSONA" ? draft.personaId : null,
            persona_name_snapshot:
              draft.sectionType === "PERSONA" ? draft.personaName : null,
            content_json: draft.content as Json,
            sort_order: index,
            section_type: draft.sectionType,
            pdf_display_mode: draft.pdfDisplayMode ?? "inline",
          })
          .select("id")
          .single();

        if (sectionError) {
          const sectionErrorMessage = getSupabaseErrorMessage(sectionError);

          if (
            draft.sectionType === "PDF" &&
            isMissingPdfSchemaError(sectionErrorMessage)
          ) {
            throw new Error(
              "PDF sections require the latest database migration. Please apply migrations and retry.",
            );
          }

          if (
            draft.sectionType === "PERSONA" &&
            isMissingPdfSchemaError(sectionErrorMessage)
          ) {
            const legacyInsert = await supabase
              .from("sections")
              .insert({
                entry_id: newEntryId,
                persona_id: draft.personaId,
                persona_name_snapshot: draft.personaName,
                content_json: draft.content as Json,
                sort_order: index,
              })
              .select("id")
              .single();

            insertedSection = legacyInsert.data;
            sectionError = legacyInsert.error;
          }
        }

        if (sectionError || !insertedSection) {
          throw new Error(
            `Failed to insert section: ${getSupabaseErrorMessage(sectionError)}`,
          );
        }

        if (draft.sectionType === "PDF" && draft.pdfAttachments?.length) {
          draft.pdfAttachments.forEach((attachment, attachmentIndex) => {
            pdfAttachmentInserts.push({
              section_id: insertedSection.id,
              document_id: attachment.documentId,
              sort_order: attachmentIndex,
              title_snapshot: attachment.titleSnapshot,
              annotation_text: attachment.annotationText ?? null,
              referenced_persona_id: attachment.referencedPersonaId ?? null,
              referenced_page: attachment.referencedPage ?? null,
            });
          });
        }
      }

      if (pdfAttachmentInserts.length > 0) {
        const { error: attachmentError } = await supabase
          .from("section_pdf_attachments")
          .insert(pdfAttachmentInserts);
        if (attachmentError) {
          const attachmentMessage = getSupabaseErrorMessage(attachmentError);
          if (isMissingPdfSchemaError(attachmentMessage)) {
            throw new Error(
              "PDF attachments require the latest database migration. Please apply migrations and retry.",
            );
          }
          throw new Error(`Failed to attach PDFs: ${attachmentMessage}`);
        }
      }

      // 5c. Purge local draft state on Success
      removeLocalDraft(streamId);
      draftStateRef.current = {
        sections: {},
        sectionOrder: [],
        updatedAt: Date.now(),
      };
      setInitialDrafts({});
      setRecoveryAvailable(false);
      setStatus("idle");

      // Refresh dependent data views
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

      return newEntryId;
    } catch (err) {
      if (newEntryId) {
        // Avoid leaving orphan entries when later inserts fail.
        await supabase.from("entries").delete().eq("id", newEntryId);
      }

      const message =
        err instanceof Error ? err.message : getSupabaseErrorMessage(err);
      console.error("Commit failed", { message, error: err });
      setStatus("error");
      throw new Error(message);
    }
  }, [streamId, supabase, queryClient]);

  // Maintain API compatibility with current component implementation
  const setActiveInstances = useCallback(
    (instanceIds?: string[]) => {
      if (!Array.isArray(instanceIds)) return;
      const deduped = instanceIds.filter(
        (id, idx) => instanceIds.indexOf(id) === idx,
      );
      draftStateRef.current.sectionOrder = deduped;
      writeLocalDraft(streamId, draftStateRef.current);
    },
    [streamId],
  );
  const flushPendingSaves = useCallback(async () => {}, []);

  return {
    status,
    saveDraft,
    savePdfDraft,
    commitDraft,
    initialDrafts,
    getDraftContent,
    getPdfDraft,
    isLoading,
    clearDraft,
    setActiveInstances,
    flushPendingSaves,
    recoveryAvailable,
    discardRecovery,
    activeEntryId: null,
  };
}
