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
  contentTextSnapshot?: string;
  pdfDisplayMode?: "inline" | "download" | "external";
  fileAttachments?: FileDraftAttachment[];
  updatedAt: number;
}

export interface FileDraftAttachment {
  documentId?: string;
  storagePath?: string;
  thumbnailPath?: string | null;
  previewUrl?: string | null;
  titleSnapshot: string;
  annotationText?: string | null;
  referencedPersonaId?: string | null;
  referencedPage?: number | null;
  fileHash?: string;
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
  contentTextSnapshot?: string;
  pdfDisplayMode?: "inline" | "download" | "external";
  fileAttachments?: FileDraftAttachment[];
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

const blocksToPlainText = (blocks: PartialBlock[] | undefined): string => {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";

  const extractInlineText = (content: unknown): string => {
    if (!Array.isArray(content)) return "";
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const record = item as { text?: unknown };
        return typeof record.text === "string" ? record.text : "";
      })
      .join("");
  };

  const extractBlockText = (block: PartialBlock): string => {
    const contentText = extractInlineText(block.content);
    const childText = Array.isArray(block.children)
      ? block.children.map(extractBlockText).join("\n")
      : "";
    return [contentText, childText].filter(Boolean).join("\n");
  };

  return blocks.map(extractBlockText).filter(Boolean).join("\n");
};

const textToBlocks = (text: string): PartialBlock[] => {
  const normalized = text.replace(/\r\n?/g, "\n");
  if (!normalized.trim()) {
    return [{ type: "paragraph", content: [] }];
  }
  return normalized.split("\n").map((line) => ({
    type: "paragraph",
    content: line
      ? [{ type: "text", text: line, styles: {} }]
      : [],
  }));
};

function deepClone<T>(value: T): T {
  try {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }
  } catch {
    // fall through
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

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
    const key = `${STORAGE_PREFIX}${streamId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftState;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalDraft(streamId: string, state: DraftState): void {
  try {
    const key = `${STORAGE_PREFIX}${streamId}`;
    const json = JSON.stringify(state);
    localStorage.setItem(key, json);
  } catch {
    // Ignore storage errors
  }
}

function removeLocalDraft(streamId: string): void {
  try {
    const key = `${STORAGE_PREFIX}${streamId}`;
    localStorage.removeItem(key);
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
    draftStateRef.current = {
      sections: {},
      sectionOrder: [],
      updatedAt: Date.now(),
    };

    async function initializeDrafts() {
      if (!streamId) return;

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
          if (
            sectionType === "PERSONA" &&
            !s.personaId &&
            !hasMeaningfulDraftContent(s.content)
          )
            return;
          loaded[id] = {
            sectionType,
            personaId: s.personaId,
            personaName: s.personaName,
            content:
              s.content && s.content.length > 0
                ? s.content
                : s.contentTextSnapshot
                ? textToBlocks(s.contentTextSnapshot)
                : [],
            contentTextSnapshot: s.contentTextSnapshot,
            pdfDisplayMode: s.pdfDisplayMode,
            fileAttachments: s.fileAttachments ?? [],
          };
        });
        setInitialDrafts(loaded);
      }
      setIsLoading(false);
    }

    initializeDrafts();
  }, [streamId]);

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
        content,
        contentTextSnapshot: blocksToPlainText(content),
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
        attachments: FileDraftAttachment[];
        displayMode: "inline" | "download" | "external";
        content?: PartialBlock[];
        personaId?: string | null;
        personaName?: string;
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
        personaId: payload.personaId ?? null,
        personaName: payload.personaName,
        content: payload.content ?? [],
        contentTextSnapshot: blocksToPlainText(payload.content ?? []),
        pdfDisplayMode: payload.displayMode,
        fileAttachments: payload.attachments,
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
    setStatus("idle");
  }, [streamId]);

  // 4. Content Retriever
  const getDraftContent = useCallback(
    (instanceId: string) => {
      const section = draftStateRef.current.sections[instanceId];
      const fallback = initialDrafts[instanceId];
      const content = section?.content || fallback?.content || [];
      if (Array.isArray(content) && content.length > 0) {
        return deepClone(content);
      }
      const snapshot = section?.contentTextSnapshot || fallback?.contentTextSnapshot;
      if (snapshot && snapshot.trim().length > 0) {
        return deepClone(textToBlocks(snapshot));
      }
      return [];
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
        attachments: deepClone(
          current?.fileAttachments ?? fallback?.fileAttachments ?? [],
        ),
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
        return (draft.fileAttachments?.length ?? 0) > 0;
      }
      return hasMeaningfulDraftContent(draft.content);
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
            persona_id: draft.personaId,
            persona_name_snapshot: draft.personaName ?? null,
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

        if (draft.sectionType === "PDF" && draft.fileAttachments?.length) {
          draft.fileAttachments.forEach((attachment, attachmentIndex) => {
            if (!attachment.documentId) return;

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
    activeEntryId: null,
  };
}
