"use client";

import React, {
  useState,
  useRef,
  Fragment,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { BlockNoteEditor } from "@/components/shared/BlockNoteEditor";
import {
  BlockNoteEditor as BlockNoteEditorType,
  PartialBlock,
} from "@blocknote/core";
import type { WhatsAppInjectPayload } from "./WhatsAppImportModal";
import {
  Loader2,
  Send,
  Check,
  Plus,
  X,
  ChevronDown,
  FileText,
  Upload,
  GripVertical,
  Settings,
  Paperclip,
  Type,
} from "lucide-react";
import { usePersonas } from "@/lib/hooks/usePersonas";
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
import { DynamicIcon } from "@/components/shared/DynamicIcon";
import { PdfAttachmentItem } from "./PdfAttachmentItem";
import { DocumentImportModal } from "@/components/features/documents/DocumentImportModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { DocumentWithLatestJob } from "@/lib/types";
import { useDraftSystem } from "@/lib/hooks/useDraftSystem";
import { calculateFileHash } from "@/lib/utils/hash";
import { PersonaManager } from "@/components/features/persona/PersonaManager";
import { useKeyboard } from "@/lib/hooks/useKeyboard";
import { NavigationGuard } from "@/components/features/log/NavigationGuard";
import { PdfAttachmentPreviewDialog } from "./PdfAttachmentPreviewDialog";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function isShadowPersona(persona: { is_shadow?: boolean | null }): boolean {
  return persona.is_shadow === true;
}

function isAiPersona(persona: { type?: string | null }): boolean {
  return persona.type === "AI";
}

function textToBlockContent(text: string) {
  const value = text.trim();
  if (!value) return [];
  return [{ type: "text" as const, text: value, styles: {} }];
}

function parseMarkdownishMessageToBlocks(message: string): PartialBlock[] {
  const normalized = message.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const blocks: PartialBlock[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;

    const paragraphText = paragraphBuffer
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join(" ");

    if (paragraphText.length > 0) {
      blocks.push({
        type: "paragraph",
        content: textToBlockContent(paragraphText),
      });
    }

    paragraphBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: "heading",
        props: { level: Math.min(3, headingMatch[1].length) },
        content: textToBlockContent(headingMatch[2]),
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({
        type: "bulletListItem",
        content: textToBlockContent(bulletMatch[1]),
      });
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      blocks.push({
        type: "numberedListItem",
        content: textToBlockContent(numberedMatch[1]),
      });
      continue;
    }

    paragraphBuffer.push(rawLine);
  }

  flushParagraph();

  if (blocks.length > 0) return blocks;

  const fallback = normalized.trim();
  if (!fallback) return [];

  return [
    {
      type: "paragraph",
      content: textToBlockContent(fallback),
    },
  ];
}

function SortableSection({
  id,
  children,
}: {
  id: string;
  children: (
    dragHandleProps: React.HTMLAttributes<HTMLElement>,
  ) => React.ReactElement;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

interface EntryCreatorProps {
  streamId: string;
  currentBranch?: string;
  onCurrentBranchChange?: (branchName: string) => void;
}

export function EntryCreator({ streamId, currentBranch }: EntryCreatorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { personas } = usePersonas({
    streamId,
    includeShadow: true,
  });
  const personaUsageStorageKey = `entry-creator:persona-usage:${streamId}`;

  const getInitialPersonaUsage = () => {
    if (typeof window === "undefined") return {} as Record<string, number>;
    try {
      const stored = window.localStorage.getItem(personaUsageStorageKey);
      if (!stored) return {} as Record<string, number>;
      return JSON.parse(stored) as Record<string, number>;
    } catch {
      return {} as Record<string, number>;
    }
  };

  interface PdfAttachmentState {
    documentId?: string;
    titleSnapshot: string;
    pageCount: number;
    author: string | null;
    creationDate: string | null;
    storagePath?: string;
    thumbnailPath?: string | null;
    previewUrl: string | null;
    annotationText?: string | null;
    referencedPersonaId?: string | null;
    referencedPage?: number | null;
    fileHash?: string;
  }

  type SectionState =
    | {
        instanceId: string;
        kind: "PERSONA";
        personaId: string;
      }
    | {
        instanceId: string;
        kind: "PDF";
        displayMode: "inline" | "download" | "external";
        attachments: PdfAttachmentState[];
        personaId?: string | null;
        personaName?: string | null;
        note: string;
        isUploading: boolean;
      };

  const [sections, setSections] = useState<SectionState[]>([]);
  const [personaUsageCounts, setPersonaUsageCounts] = useState<
    Record<string, number>
  >(getInitialPersonaUsage);
  const [pdfPickerTargetInstanceId, setPdfPickerTargetInstanceId] = useState<
    string | null
  >(null);
  const [importModalFiles, setImportModalFiles] = useState<
    Array<{ file: File; hash?: string }>
  >([]);
  const [parsedPreview, setParsedPreview] = useState<{
    documentId: string;
    title: string;
    markdown: string;
  } | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    documentId?: string;
    title: string;
    previewUrl: string | null;
    importStatus?: string;
  } | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<"pdf" | "parsed">(
    "pdf",
  );
  const [parsedPreviewLoading, setParsedPreviewLoading] = useState(false);
  const [parsedPreviewError, setParsedPreviewError] = useState<string | null>(
    null,
  );
  const [personaManagerOpen, setPersonaManagerOpen] = useState(false);
  const [clearSectionsDialogOpen, setClearSectionsDialogOpen] = useState(false);
  const [duplicateCheck, setDuplicateCheck] = useState<{
    file: File;
    hash: string;
    existingDoc: DocumentWithLatestJob;
    instanceId: string;
  } | null>(null);

  const selectedBranch = currentBranch ?? "main";

  const attachedDocumentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of sections) {
      if (section.kind !== "PDF") continue;
      for (const attachment of section.attachments) {
        if (attachment.documentId) {
          ids.add(attachment.documentId);
        }
      }
    }
    return Array.from(ids);
  }, [sections]);

  const { documents: importedDocuments, isLoading: isDocumentsLoading } =
    useDocuments(streamId);

  const attachedDocDetails = useMemo(() => {
    const map = new Map<string, DocumentWithLatestJob>();
    for (const doc of importedDocuments) {
      if (attachedDocumentIds.includes(doc.id)) {
        map.set(doc.id, doc);
      }
    }
    return map;
  }, [importedDocuments, attachedDocumentIds]);

  const unparsedAttachedCount = useMemo(() => {
    if (attachedDocumentIds.length === 0) return 0;

    let count = 0;
    for (const id of attachedDocumentIds) {
      const doc = attachedDocDetails.get(id);
      const status = doc?.latestJob?.status ?? doc?.import_status;
      if (status !== "completed") count += 1;
    }
    return count;
  }, [attachedDocumentIds, attachedDocDetails]);

  const hasUnparsedAttachments = unparsedAttachedCount > 0;
  const commitBlockedByPdfStatus =
    attachedDocumentIds.length > 0 &&
    (isDocumentsLoading || hasUnparsedAttachments);

  const { data: branches, refetch: refetchBranches } = useQuery({
    queryKey: ["branches", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("*")
        .eq("stream_id", streamId);
      if (error) throw error;
      return data;
    },
    enabled: !!streamId,
  });

  // Refs for editors to clear them
  const editorRefs = useRef<Record<string, BlockNoteEditorType>>({});
  const pendingFocusInstanceIdRef = useRef<string | null>(null);

  const focusEditorForInstance = (instanceId: string) => {
    let attempts = 0;
    const maxAttempts = 10;

    const tryFocus = () => {
      const editor = editorRefs.current[instanceId];
      if (editor) {
        editor.focus();
        return;
      }

      attempts += 1;
      if (attempts < maxAttempts) {
        window.setTimeout(tryFocus, 30);
      }
    };

    // Delay one tick so focus wins after menu close/focus restoration.
    window.setTimeout(tryFocus, 0);
  };

  // Draft System Hook
  const {
    status,
    saveDraft,
    savePdfDraft,
    commitDraft,
    initialDrafts,
    getDraftContent,
    getPdfDraft,
    isLoading,
    setActiveInstances,
    flushPendingSaves,
    clearDraft,
  } = useDraftSystem({
    streamId,
  });
  const [discardedRecovery, setDiscardedRecovery] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(
        personaUsageStorageKey,
        JSON.stringify(personaUsageCounts),
      );
    } catch {
      // Ignore write failures (quota/private mode).
    }
  }, [personaUsageCounts, personaUsageStorageKey]);

  // Clean up persona usage counts for deleted personas
  useEffect(() => {
    if (personas) {
      const existingIds = new Set(personas.map((p) => p.id));
      setPersonaUsageCounts((prev) => {
        const filtered = { ...prev };
        Object.keys(filtered).forEach((id) => {
          if (!existingIds.has(id)) {
            delete filtered[id];
          }
        });
        return filtered;
      });
    }
  }, [personas]);

  const quickPersonas = (() => {
    if (!personas?.length) return [];
    return [...personas]
      .sort((a, b) => {
        const countA = personaUsageCounts[a.id] ?? 0;
        const countB = personaUsageCounts[b.id] ?? 0;
        if (countA !== countB) return countB - countA;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 3);
  })();

  const globalPersonas = (personas ?? []).filter((p) => !isShadowPersona(p));
  const shadowPersonas = (personas ?? []).filter((p) => isShadowPersona(p));

  const trackPersonaUsage = (personaId: string) => {
    setPersonaUsageCounts((prev) => ({
      ...prev,
      [personaId]: (prev[personaId] ?? 0) + 1,
    }));
  };

  // Initialize selection with existing drafts only
  useEffect(() => {
    if (sections.length === 0 && !isLoading && !discardedRecovery) {
      // If we have initial drafts, use them
      if (initialDrafts && Object.keys(initialDrafts).length > 0) {
        const loadedSections = Object.entries(initialDrafts).map(
          ([instanceId, draft]) => ({
            instanceId,
            ...(draft.sectionType === "PDF"
              ? {
                  kind: "PDF" as const,
                  personaId: draft.personaId ?? null,
                  personaName: draft.personaName,
                  displayMode: draft.pdfDisplayMode ?? "inline",
                  attachments: (draft.pdfAttachments ?? []).map(
                    (attachment) => ({
                      documentId: attachment.documentId ?? "",
                      titleSnapshot: attachment.titleSnapshot,
                      pageCount: 0,
                      author: null,
                      creationDate: null,
                      storagePath: attachment.storagePath ?? "",
                      thumbnailPath: null,
                      previewUrl: null,
                      annotationText: attachment.annotationText ?? null,
                      referencedPersonaId:
                        attachment.referencedPersonaId ?? null,
                      referencedPage: attachment.referencedPage ?? null,
                      fileHash: attachment.fileHash,
                    }),
                  ),
                  note: "",
                  isUploading: false,
                }
              : {
                  kind: "PERSONA" as const,
                  personaId: draft.personaId ?? "",
                }),
          }),
        );
        setSections(
          loadedSections.filter((section) => {
            if (section.kind === "PDF") return true;
            return !!section.personaId;
          }),
        );
      }
      // Don't auto-initialize with a default persona
      // Let the user explicitly select a persona or add a section
    }
  }, [initialDrafts, isLoading, sections.length, discardedRecovery]);

  const persistPdfSection = useCallback(
    (instanceId: string, draft: Extract<SectionState, { kind: "PDF" }>) => {
      if (!draft || draft.kind !== "PDF") return;

      savePdfDraft(instanceId, {
        displayMode: draft.displayMode,
        personaId: draft.personaId,
        personaName: draft.personaName ?? undefined,
        attachments: draft.attachments.map((attachment) => ({
          documentId: attachment.documentId,
          storagePath: attachment.storagePath,
          titleSnapshot: attachment.titleSnapshot,
          annotationText: attachment.annotationText ?? null,
          referencedPersonaId: attachment.referencedPersonaId ?? null,
          referencedPage: attachment.referencedPage ?? null,
          fileHash: attachment.fileHash,
        })),
        content: [],
      });
    },
    [savePdfDraft],
  );

  // Watch imported documents and automatically update pending attachments.
  useEffect(() => {
    if (!importedDocuments || importedDocuments.length === 0) return;

    let hasChanges = false;
    const nextSections = [...sections];

    for (const doc of importedDocuments) {
      const sourceMeta = (doc.source_metadata ?? {}) as {
        pageCount?: number;
        extractedAuthor?: string;
        extractedCreationDate?: string;
        previewUrl?: string;
        fileHash?: string;
      };

      // 1. Update any pending attachments that match this document's ID or hash
      for (let i = 0; i < nextSections.length; i++) {
        const section = nextSections[i];
        if (section.kind !== "PDF") continue;

        let sectionChanged = false;
        const nextAttachments = section.attachments.map((att) => {
          const isMatchById = att.documentId === doc.id;
          const isMatchByHash =
            !att.documentId &&
            !!att.fileHash &&
            sourceMeta.fileHash === att.fileHash;

          if (isMatchById || isMatchByHash) {
            const nextPreviewUrl =
              sourceMeta.previewUrl ?? att.previewUrl ?? null;
            const nextPageCount = sourceMeta.pageCount ?? att.pageCount ?? 0;
            const nextAuthor = sourceMeta.extractedAuthor ?? att.author ?? null;
            const nextCreationDate =
              sourceMeta.extractedCreationDate ??
              doc.created_at ??
              att.creationDate ??
              null;

            if (
              att.documentId !== doc.id ||
              att.storagePath !== doc.storage_path ||
              att.thumbnailPath !== doc.thumbnail_path ||
              att.pageCount !== nextPageCount ||
              att.author !== nextAuthor ||
              att.creationDate !== nextCreationDate ||
              att.previewUrl !== nextPreviewUrl
            ) {
              sectionChanged = true;
              hasChanges = true;
              return {
                ...att,
                documentId: doc.id,
                storagePath: doc.storage_path,
                thumbnailPath: doc.thumbnail_path,
                pageCount: nextPageCount,
                author: nextAuthor,
                creationDate: nextCreationDate,
                previewUrl: nextPreviewUrl,
              };
            }
          }
          return att;
        });

        if (sectionChanged) {
          nextSections[i] = { ...section, attachments: nextAttachments };
          persistPdfSection(
            section.instanceId,
            nextSections[i] as Extract<SectionState, { kind: "PDF" }>,
          );
        }
      }
    }

    if (hasChanges) {
      setSections(nextSections);
    }
  }, [
    importedDocuments,
    attachedDocumentIds,
    savePdfDraft,
    sections,
    persistPdfSection,
  ]);

  // Sync active instances with draft system whenever sections change
  useEffect(() => {
    setActiveInstances(sections.map((section) => section.instanceId));
  }, [sections, setActiveInstances]);

  // WhatsApp chat inject listener
  useEffect(() => {
    const onInject = (event: Event) => {
      const payload = (event as CustomEvent<WhatsAppInjectPayload>).detail;
      if (payload.streamId !== streamId) return;

      clearDraft();
      editorRefs.current = {};
      setDiscardedRecovery(true);

      const newSections: SectionState[] = [];

      for (const turn of payload.turns) {
        const instanceId = crypto.randomUUID();

        if (turn.type === "text") {
          const blocks: PartialBlock[] = turn.messages.flatMap((msg, i) => {
            const parsed = parseMarkdownishMessageToBlocks(msg);
            if (i === 0) return parsed;
            return [{ type: "paragraph", content: [] } as PartialBlock, ...parsed];
          });
          saveDraft(instanceId, turn.personaId, blocks, turn.personaName);
          newSections.push({
            instanceId,
            kind: "PERSONA" as const,
            personaId: turn.personaId,
          });
        } else {
          // PDF turn — create one attachment section bound to sender persona
          const attachments = turn.attachments;

          if (!attachments || attachments.length === 0) {
            continue;
          }

          savePdfDraft(instanceId, {
            displayMode: "inline",
            personaId: turn.personaId,
            personaName: turn.personaName ?? undefined,
            attachments: attachments.map((attachment) => ({
              documentId: attachment.documentId,
              storagePath: attachment.storagePath,
              titleSnapshot: attachment.titleSnapshot ?? "Document",
              annotationText: null,
              referencedPersonaId: null,
              referencedPage: null,
              fileHash: attachment.fileHash,
              previewUrl: attachment.previewUrl ?? null,
            })),
            content: [],
          });
          newSections.push({
            instanceId,
            kind: "PDF" as const,
            personaId: turn.personaId,
            personaName: turn.personaName,
            displayMode: "inline",
            attachments: attachments.map((attachment) => ({
              documentId: attachment.documentId,
              titleSnapshot: attachment.titleSnapshot ?? "Document",
              pageCount: 0,
              author: null,
              creationDate: null,
              storagePath: attachment.storagePath,
              thumbnailPath: attachment.thumbnailPath ?? null,
              previewUrl: attachment.previewUrl ?? null,
              annotationText: null,
              referencedPersonaId: null,
              referencedPage: null,
              fileHash: attachment.fileHash,
            })),
            note: "",
            isUploading: false,
          });
        }
      }

      setSections(newSections);
    };

    window.addEventListener(
      "kolam_whatsapp_import_inject",
      onInject as EventListener,
    );
    return () => {
      window.removeEventListener(
        "kolam_whatsapp_import_inject",
        onInject as EventListener,
      );
    };
  }, [streamId, clearDraft, saveDraft, savePdfDraft]);

  // Keyboard shortcuts
  useKeyboard([
    {
      key: "n",
      metaKey: true,
      description: "New Entry",
      handler: (e) => {
        e.preventDefault();
        // Focus the first editor
        const firstInstanceId = sections[0]?.instanceId;
        if (firstInstanceId && editorRefs.current[firstInstanceId]) {
          editorRefs.current[firstInstanceId].focus();
        }
      },
    },
    {
      key: "Enter",
      metaKey: true,
      description: "Commit Entry",
      handler: (e) => {
        e.preventDefault();
        handleCommit();
      },
    },
  ]);

  const handleCommit = async () => {
    if (commitBlockedByPdfStatus) {
      console.warn(
        "Commit blocked: one or more attached PDF documents are still queued/processing or failed.",
      );
      return;
    }

    try {
      const committedEntryId = await commitDraft();

      if (!committedEntryId) {
        console.warn("Commit skipped: no meaningful content to persist.");
        return;
      }

      let targetBranch = branches?.find((b) => b.name === selectedBranch);

      if (!targetBranch) {
        const { data: newBranch, error: createBranchError } = await supabase
          .from("branches")
          .insert({ stream_id: streamId, name: selectedBranch })
          .select("*")
          .single();
        if (createBranchError) throw createBranchError;
        targetBranch = newBranch;
      }

      if (targetBranch) {
        const { error: deleteError } = await supabase
          .from("commit_branches")
          .delete()
          .eq("branch_id", targetBranch.id);
        if (deleteError) throw deleteError;

        const { error } = await supabase
          .from("commit_branches")
          .insert({ commit_id: committedEntryId, branch_id: targetBranch.id });
        if (error) throw error;
      }

      await refetchBranches();
      queryClient.invalidateQueries({
        queryKey: ["commit-branches", streamId],
      });
      queryClient.invalidateQueries({
        queryKey: ["branch-head-entry", streamId],
      });

      // Reset to empty state (no auto-default persona)
      setSections([]);
      editorRefs.current = {};
      pendingFocusInstanceIdRef.current = null;
    } catch (e) {
      console.error("Failed to commit", e);
    }
  };

  const addPersona = (pId: string) => {
    const instanceId = crypto.randomUUID();
    const persona = personas?.find((p) => p.id === pId);
    pendingFocusInstanceIdRef.current = instanceId;

    trackPersonaUsage(pId);
    setSections((prev) => [
      ...prev,
      { instanceId, kind: "PERSONA", personaId: pId },
    ]);

    // Persist section creation immediately so empty sections survive reload.
    saveDraft(instanceId, pId, [], persona?.name);

    // Request focus immediately; helper retries until editor instance is ready.
    focusEditorForInstance(instanceId);
  };

  const removeSection = (instanceId: string) => {
    // Find the section and remaining list BEFORE updating state so we can
    // pass them to saveDraft synchronously (outside the updater).
    const section = sections.find((s) => s.instanceId === instanceId);
    const remaining = sections.filter((s) => s.instanceId !== instanceId);

    // Pure state update — no side effects inside the updater.
    setSections(remaining);

    if (section) {
      if (section.kind === "PERSONA") {
        const persona = personas?.find((p) => p.id === section.personaId);
        saveDraft(instanceId, section.personaId, [], persona?.name, true);
      } else {
        savePdfDraft(
          instanceId,
          {
            displayMode: section.displayMode,
            attachments: [],
          },
          true,
        );
      }
    }

    if (remaining.length === 0) {
      // Clear immediately when the last section is removed so clearing flags
      // are written before a fast page unload can interrupt async cleanup.
      void clearDraft();
    }

    if (pendingFocusInstanceIdRef.current === instanceId) {
      pendingFocusInstanceIdRef.current = null;
    }
  };

  const toggleSectionKind = (instanceId: string) => {
    setSections((prev) =>
      prev.map((section) => {
        if (section.instanceId !== instanceId) return section;
        if (section.kind === "PERSONA") {
          return {
            instanceId,
            kind: "PDF",
            displayMode: "inline",
            attachments: [],
            personaId: section.personaId,
            personaName:
              personas?.find((p) => p.id === section.personaId)?.name || null,
            note: "",
            isUploading: false,
          };
        } else {
          return {
            instanceId,
            kind: "PERSONA",
            personaId: section.personaId || "",
          };
        }
      }),
    );
  };

  const requestClearSections = () => {
    if (sections.length === 0) return;
    setClearSectionsDialogOpen(true);
  };

  const confirmClearSections = () => {
    setSections([]);
    void clearDraft();
    setClearSectionsDialogOpen(false);
  };

  const changePersona = (instanceId: string, newPersonaId: string) => {
    const section = sections.find((s) => s.instanceId === instanceId);
    if (
      !section ||
      section.kind !== "PERSONA" ||
      section.personaId === newPersonaId
    )
      return;

    const newPersona = personas?.find((p) => p.id === newPersonaId);

    // Update state
    setSections((prev) =>
      prev.map((s) => {
        if (s.instanceId !== instanceId || s.kind !== "PERSONA") return s;
        return { ...s, personaId: newPersonaId };
      }),
    );

    // Get current content and save with new persona
    // This will update the same section with the new persona
    const content = getDraftContent(instanceId);

    // Force immediate save to ensure refs are updated
    saveDraft(instanceId, newPersonaId, content, newPersona?.name);
    trackPersonaUsage(newPersonaId);

    // Keep typing context active on the currently selected persona section.
    focusEditorForInstance(instanceId);
  };

  const updatePdfSection = (
    instanceId: string,
    updater: (
      section: Extract<SectionState, { kind: "PDF" }>,
    ) => Extract<SectionState, { kind: "PDF" }>,
  ) => {
    setSections((prev) =>
      prev.map((section) => {
        if (section.instanceId !== instanceId || section.kind !== "PDF")
          return section;
        return updater(section);
      }),
    );
  };

  const attachDocumentToPdfSection = async (
    instanceId: string,
    document: DocumentWithLatestJob,
  ) => {
    updatePdfSection(instanceId, (section) => ({
      ...section,
      isUploading: true,
    }));

    const existing = sections.find(
      (section) => section.instanceId === instanceId && section.kind === "PDF",
    ) as Extract<SectionState, { kind: "PDF" }> | undefined;
    if (
      existing?.attachments.some(
        (attachment: PdfAttachmentState) =>
          attachment.documentId === document.id,
      )
    ) {
      updatePdfSection(instanceId, (section) => ({
        ...section,
        isUploading: false,
      }));
      return;
    }

    let previewUrl: string | null = null;

    try {
      if (!document.storage_path) {
        console.warn(`Document ${document.id} has no storage_path`);
      } else {
        const signed = await supabase.storage
          .from("document-files")
          .createSignedUrl(document.storage_path, 60 * 30);

        if (signed.error) {
          console.warn(
            `Failed to create signed URL for ${document.storage_path}:`,
            signed.error,
          );
        } else if (signed.data?.signedUrl) {
          previewUrl = signed.data.signedUrl;
        }
      }
    } catch (error) {
      console.error(
        `Error creating signed URL for document ${document.id}:`,
        error,
      );
    }

    const sourceMetadata = (document.source_metadata ?? {}) as {
      pageCount?: number;
      extractedAuthor?: string;
      extractedCreationDate?: string;
    };

    const nextAttachment: PdfAttachmentState = {
      documentId: document.id,
      titleSnapshot: document.title,
      pageCount: sourceMetadata.pageCount ?? 0,
      author: sourceMetadata.extractedAuthor ?? null,
      creationDate: sourceMetadata.extractedCreationDate ?? null,
      storagePath: document.storage_path,
      thumbnailPath: document.thumbnail_path,
      previewUrl,
      annotationText: null,
      referencedPersonaId: null,
      referencedPage: null,
    };

    setSections((prev) => {
      const draftToPersist = prev.find(
        (s) => s.instanceId === instanceId && s.kind === "PDF",
      ) as Extract<SectionState, { kind: "PDF" }> | undefined;

      if (draftToPersist) {
        const updated: Extract<SectionState, { kind: "PDF" }> = {
          ...draftToPersist,
          isUploading: false,
          attachments: [...draftToPersist.attachments, nextAttachment],
        };
        Promise.resolve().then(() => persistPdfSection(instanceId, updated));
        return prev.map((s) =>
          s.instanceId === instanceId && s.kind === "PDF" ? updated : s,
        );
      }
      return prev;
    });
  };

  const removePdfAttachment = (
    instanceId: string,
    attachmentToRemove: PdfAttachmentState,
    attachmentIndex: number,
    source: "section" | "draft",
  ) => {
    const matchesAttachment = (
      candidate: {
        documentId?: string;
        fileHash?: string;
        storagePath?: string;
        titleSnapshot: string;
      },
      target: {
        documentId?: string;
        fileHash?: string;
        storagePath?: string;
        titleSnapshot: string;
      },
    ) => {
      if (target.documentId && candidate.documentId) {
        return candidate.documentId === target.documentId;
      }
      if (target.fileHash && candidate.fileHash) {
        return candidate.fileHash === target.fileHash;
      }
      if (target.storagePath && candidate.storagePath) {
        return candidate.storagePath === target.storagePath;
      }
      return (
        candidate.titleSnapshot === target.titleSnapshot &&
        (candidate.fileHash ?? "") === (target.fileHash ?? "") &&
        (candidate.documentId ?? "") === (target.documentId ?? "")
      );
    };

    const section = sections.find(
      (s) => s.instanceId === instanceId && s.kind === "PDF",
    ) as Extract<SectionState, { kind: "PDF" }> | undefined;
    const draft = getPdfDraft(instanceId);

    const nextDraftAttachments = draft.attachments.filter(
      (attachment, index) =>
        source === "draft"
          ? index !== attachmentIndex
          : !matchesAttachment(attachment, attachmentToRemove),
    );

    savePdfDraft(instanceId, {
      displayMode: section?.displayMode ?? draft.displayMode,
      personaId: section?.personaId ?? null,
      personaName: section?.personaName ?? undefined,
      attachments: nextDraftAttachments,
      content: [],
    });

    setSections((prev) =>
      prev.map((s) => {
        if (s.instanceId !== instanceId || s.kind !== "PDF") return s;
        return {
          ...s,
          attachments: s.attachments.filter((attachment, index) =>
            source === "section"
              ? index !== attachmentIndex
              : !matchesAttachment(attachment, attachmentToRemove),
          ),
        };
      }),
    );
  };

  const openParsedPreview = async (
    documentId: string,
    titleSnapshot: string,
  ) => {
    setParsedPreviewLoading(true);
    setParsedPreviewError(null);

    const { data, error } = await supabase
      .from("documents")
      .select("id, title, extracted_markdown, import_status")
      .eq("id", documentId)
      .single();

    if (error) {
      setParsedPreviewLoading(false);
      setParsedPreviewError("Failed to load parsed content.");
      return;
    }

    if (!data?.extracted_markdown || data.import_status !== "completed") {
      setParsedPreviewLoading(false);
      setParsedPreviewError(
        "Parsed Docling content is not available yet for this document.",
      );
      return;
    }

    setParsedPreview({
      documentId,
      title: data.title || titleSnapshot,
      markdown: data.extracted_markdown,
    });
    setParsedPreviewLoading(false);
  };

  const openAttachmentPreview = (
    attachment: PdfAttachmentState,
    importStatus?: string,
    preferredTab?: "pdf" | "parsed",
  ) => {
    const nextTab =
      preferredTab ??
      (importStatus === "completed" && attachment.documentId
        ? "parsed"
        : "pdf");

    setAttachmentPreview({
      documentId: attachment.documentId,
      title: attachment.titleSnapshot,
      previewUrl: attachment.previewUrl,
      importStatus,
    });
    setActivePreviewTab(nextTab);

    setParsedPreview(null);
    setParsedPreviewError(null);

    if (nextTab === "parsed" && attachment.documentId) {
      void openParsedPreview(attachment.documentId, attachment.titleSnapshot);
    }
  };

  const closeAttachmentPreview = () => {
    if (parsedPreviewLoading) return;
    setAttachmentPreview(null);
    setParsedPreview(null);
    setParsedPreviewError(null);
    setActivePreviewTab("pdf");
  };

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setSections((prev) => {
        const oldIndex = prev.findIndex((s) => s.instanceId === active.id);
        const newIndex = prev.findIndex((s) => s.instanceId === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  if (isLoading) {
    return (
      <div className="relative  border border-border-default bg-surface-default p-4 min-h-25 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <>
      <div className="relative  border border-border-default bg-surface-default group">
        {(status === "saving" || status === "error") && (
          <NavigationGuard onFlush={flushPendingSaves} />
        )}

        <div className="flex flex-col">
          {/* Persona picker */}
          <div
            className={`flex items-center gap-2 flex-wrap p-1 bg-surface-subtle/50  ${sections.length > 0 ? "border-b border-border-default/50" : ""}`}
          >
            {quickPersonas.map((persona) => (
              <button
                key={`quick-persona-${persona.id}`}
                onClick={() => addPersona(persona.id)}
                className={`flex items-center gap-1.5  border px-2 py-1 text-[11px] font-medium text-text-default transition-colors ${
                  isAiPersona(persona)
                    ? "border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/15"
                    : isShadowPersona(persona)
                      ? "border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15"
                      : "border-border-subtle/70 bg-surface-subtle/40 hover:bg-surface-subtle"
                }`}
                title={`Quick add ${persona.name}`}
              >
                <div
                  className="flex h-4 w-4 items-center justify-center "
                  style={{
                    backgroundColor: `${persona.color}20`,
                    color: persona.color,
                  }}
                >
                  <DynamicIcon name={persona.icon} className="h-2.5 w-2.5" />
                </div>
                <span>{persona.name}</span>
              </button>
            ))}

            <Menu as="div" className="relative z-30">
              <MenuButton className="flex items-center gap-1.5  py-1 px-2 text-xs font-medium transition-colors hover:bg-surface-subtle border border-transparent hover:border-border-subtle focus:outline-none">
                <Plus className="h-3 w-3 text-text-subtle" />
                <span className="text-text-default">Add Persona</span>
              </MenuButton>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <MenuItems
                  anchor={{ to: "bottom start", gap: 4 }}
                  portal
                  className="z-9999 w-56 max-h-60 overflow-y-auto overflow-hidden  border border-border-default bg-surface-elevated p-1 shadow-2xl ring-1 ring-black/10 focus:outline-none"
                >
                  <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    Add Author Section
                  </div>
                  {globalPersonas.length > 0 && (
                    <div className="px-2 py-1 text-[10px] font-semibold text-text-muted">
                      Global Personas
                    </div>
                  )}
                  {globalPersonas.map((persona) => (
                    <MenuItem key={persona.id}>
                      {({ active }) => (
                        <button
                          onClick={() => {
                            addPersona(persona.id);
                          }}
                          className={`${
                            active
                              ? "bg-surface-subtle text-text-default"
                              : "text-text-subtle"
                          } group flex w-full items-center justify-between  px-2 py-1.5 text-xs transition-colors`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-5 w-5 items-center justify-center "
                              style={{
                                backgroundColor: `${persona.color}20`,
                                color: persona.color,
                              }}
                            >
                              <DynamicIcon
                                name={persona.icon}
                                className="h-3 w-3"
                              />
                            </div>
                            <span>{persona.name}</span>
                          </div>
                          <span className=" border border-border-subtle bg-surface-subtle px-1.5 py-0.5 text-[10px] text-text-muted">
                            Global
                          </span>
                        </button>
                      )}
                    </MenuItem>
                  ))}
                  {shadowPersonas.length > 0 && (
                    <div className="mt-1 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      Shadow Personas
                    </div>
                  )}
                  {shadowPersonas.map((persona) => (
                    <MenuItem key={persona.id}>
                      {({ active }) => (
                        <button
                          onClick={() => {
                            addPersona(persona.id);
                          }}
                          className={`${
                            active
                              ? "bg-surface-subtle text-text-default"
                              : "text-text-subtle"
                          } group flex w-full items-center justify-between  px-2 py-1.5 text-xs transition-colors`}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="flex h-5 w-5 items-center justify-center  ring-1 ring-amber-500/40"
                              style={{
                                backgroundColor: `${persona.color}20`,
                                color: persona.color,
                              }}
                            >
                              <DynamicIcon
                                name={persona.icon}
                                className="h-3 w-3"
                              />
                            </div>
                            <span>{persona.name}</span>
                          </div>
                          <span className=" border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                            Shadow
                          </span>
                        </button>
                      )}
                    </MenuItem>
                  ))}
                  <MenuItem>
                    <div className="border-t border-border-subtle my-1" />
                  </MenuItem>
                  <MenuItem>
                    {({ active }) => (
                      <button
                        onClick={() => setPersonaManagerOpen(true)}
                        className={`${
                          active
                            ? "bg-surface-subtle text-text-default"
                            : "text-text-subtle"
                        } group flex w-full items-center  px-2 py-1.5 text-xs transition-colors`}
                      >
                        <Settings className="h-3 w-3 mr-2" />
                        Manage Personas
                      </button>
                    )}
                  </MenuItem>
                </MenuItems>
              </Transition>
            </Menu>

            {sections.length > 0 && (
              <button
                onClick={requestClearSections}
                className="ml-auto  p-1 text-text-muted hover:bg-surface-subtle hover:text-text-default"
                title="Delete all sections"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Editor sections */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sections.map((s) => s.instanceId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col divide-y divide-border-subtle/30">
                {sections.map((section) => {
                  const { instanceId } = section;
                  const isPdf = section.kind === "PDF";
                  const isPersona = section.kind === "PERSONA";
                  const persona = section.personaId
                    ? personas?.find((p) => p.id === section.personaId)
                    : null;

                  let pdfDraft: ReturnType<typeof getPdfDraft> | undefined;
                  let effectiveAttachments: PdfAttachmentState[] = [];
                  let attachmentsSource: "section" | "draft" = "section";
                  let pdfSection:
                    | Extract<SectionState, { kind: "PDF" }>
                    | undefined;

                  if (isPdf) {
                    pdfSection = section;
                    pdfDraft = getPdfDraft(instanceId);
                    attachmentsSource =
                      pdfSection.attachments.length > 0 ? "section" : "draft";
                    effectiveAttachments =
                      attachmentsSource === "section"
                        ? pdfSection.attachments
                        : pdfDraft.attachments.map((attachment) => ({
                            documentId: attachment.documentId ?? "",
                            storagePath: attachment.storagePath ?? "",
                            titleSnapshot: attachment.titleSnapshot,
                            pageCount: 0,
                            author: null,
                            creationDate: null,
                            thumbnailPath: null,
                            previewUrl: null,
                            annotationText: attachment.annotationText ?? null,
                            referencedPersonaId:
                              attachment.referencedPersonaId ?? null,
                            referencedPage: attachment.referencedPage ?? null,
                            fileHash: attachment.fileHash,
                          }));
                  }

                  if (!isPdf && !persona) return null;

                  const bgClass =
                    persona && isAiPersona(persona)
                      ? "bg-sky-500/5"
                      : persona && isShadowPersona(persona)
                        ? "bg-amber-500/5"
                        : isPdf
                          ? "bg-surface-subtle/25"
                          : "";

                  const headerBgClass =
                    persona && isAiPersona(persona)
                      ? "bg-sky-500/10 border-sky-500/20"
                      : persona && isShadowPersona(persona)
                        ? "bg-amber-500/10 border-amber-500/20"
                        : "bg-surface-subtle/50 border-border-subtle/70";

                  return (
                    <SortableSection key={instanceId} id={instanceId}>
                      {(dragHandleProps) => (
                        <div className={`flex flex-col ${bgClass}`}>
                          <div
                            className={`flex items-center justify-between px-4 ${isPdf ? "py-1.5" : "py-1"} border-y ${headerBgClass}`}
                          >
                            <div className="flex items-center gap-2">
                              <button
                                className="cursor-grab p-0.5 text-text-muted hover:bg-surface-subtle active:cursor-grabbing"
                                aria-label="Drag to reorder"
                                {...dragHandleProps}
                              >
                                <GripVertical className="h-3 w-3" />
                              </button>

                              {/* Persona Menu Header */}
                              <Menu as="div" className="relative z-30">
                                <MenuButton className="flex items-center gap-2 hover:bg-surface-subtle/50 px-1 py-0.5 transition-colors focus:outline-none">
                                  {persona ? (
                                    <>
                                      <div
                                        className="flex h-4 w-4 items-center justify-center"
                                        style={{
                                          backgroundColor: `${persona.color}20`,
                                          color: persona.color,
                                        }}
                                      >
                                        <DynamicIcon
                                          name={persona.icon}
                                          className="h-2.5 w-2.5"
                                        />
                                      </div>
                                      <span className="text-[10px] font-medium text-text-subtle">
                                        {persona.name}
                                      </span>
                                      {isShadowPersona(persona) && (
                                        <span className="border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-400">
                                          Shadow
                                        </span>
                                      )}
                                      {isAiPersona(persona) && (
                                        <span className="border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-700 dark:text-sky-400">
                                          AI
                                        </span>
                                      )}
                                      <ChevronDown className="h-3 w-3 text-text-muted opacity-50" />
                                    </>
                                  ) : (
                                    <>
                                      <FileText className="h-3 w-3 text-text-muted" />
                                      <span className="text-[10px] font-medium text-text-subtle uppercase tracking-wider">
                                        {isPdf
                                          ? (pdfSection?.personaName ??
                                            "Attachment")
                                          : "Unknown"}
                                      </span>
                                    </>
                                  )}
                                </MenuButton>

                                {/* Dropdown transition/items */}
                                {persona && (
                                  <Transition
                                    as={Fragment}
                                    enter="transition ease-out duration-100"
                                    enterFrom="transform opacity-0 scale-95"
                                    enterTo="transform opacity-100 scale-100"
                                    leave="transition ease-in duration-75"
                                    leaveFrom="transform opacity-100 scale-100"
                                    leaveTo="transform opacity-0 scale-95"
                                  >
                                    <MenuItems
                                      anchor={{ to: "bottom start", gap: 4 }}
                                      portal
                                      className="z-9999 w-48 max-h-60 overflow-y-auto overflow-hidden border border-border-default bg-surface-elevated p-1 shadow-2xl ring-1 ring-black/10 focus:outline-none"
                                    >
                                      <div className="px-2 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                                        Switch to...
                                      </div>
                                      {globalPersonas.length > 0 && (
                                        <div className="px-2 py-1 text-[10px] font-semibold text-text-muted">
                                          Global Personas
                                        </div>
                                      )}
                                      {globalPersonas.map((p) => (
                                        <MenuItem key={p.id}>
                                          {({ active }) => (
                                            <button
                                              onClick={() =>
                                                changePersona(instanceId, p.id)
                                              }
                                              className={`${
                                                active
                                                  ? "bg-surface-subtle text-text-default"
                                                  : "text-text-subtle"
                                              } group flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors`}
                                            >
                                              <div
                                                className="flex h-4 w-4 items-center justify-center"
                                                style={{
                                                  backgroundColor: `${p.color}20`,
                                                  color: p.color,
                                                }}
                                              >
                                                <DynamicIcon
                                                  name={p.icon}
                                                  className="h-2.5 w-2.5"
                                                />
                                              </div>
                                              <span>{p.name}</span>
                                              <span className="ml-auto border border-border-subtle bg-surface-subtle px-1.5 py-0.5 text-[9px] text-text-muted">
                                                Global
                                              </span>
                                              {p.id === section.personaId && (
                                                <Check className="h-3 w-3" />
                                              )}
                                            </button>
                                          )}
                                        </MenuItem>
                                      ))}

                                      {shadowPersonas.length > 0 && (
                                        <div className="mt-1 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                          Shadow Personas
                                        </div>
                                      )}
                                      {shadowPersonas.map((p) => (
                                        <MenuItem key={p.id}>
                                          {({ active }) => (
                                            <button
                                              onClick={() =>
                                                changePersona(instanceId, p.id)
                                              }
                                              className={`${
                                                active
                                                  ? "bg-surface-subtle text-text-default"
                                                  : "text-text-subtle"
                                              } group flex w-full items-center gap-2 px-2 py-1.5 text-xs transition-colors`}
                                            >
                                              <div
                                                className="flex h-4 w-4 items-center justify-center ring-1 ring-amber-500/40"
                                                style={{
                                                  backgroundColor: `${p.color}20`,
                                                  color: p.color,
                                                }}
                                              >
                                                <DynamicIcon
                                                  name={p.icon}
                                                  className="h-2.5 w-2.5"
                                                />
                                              </div>
                                              <span>{p.name}</span>
                                              <span className="ml-auto border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-400">
                                                Shadow
                                              </span>
                                              {p.id === section.personaId && (
                                                <Check className="h-3 w-3" />
                                              )}
                                            </button>
                                          )}
                                        </MenuItem>
                                      ))}
                                    </MenuItems>
                                  </Transition>
                                )}
                              </Menu>
                            </div>

                            <div className="flex items-center gap-1">
                              {persona && !isShadowPersona(persona) && (
                                <button
                                  onClick={() => toggleSectionKind(instanceId)}
                                  className="text-text-muted hover:text-text-default p-0.5 hover:bg-surface-subtle transition-colors mr-1"
                                  title={
                                    isPdf
                                      ? "Switch to Text Editor"
                                      : "Switch to Attachments"
                                  }
                                >
                                  {isPdf ? (
                                    <Type className="h-3.5 w-3.5" />
                                  ) : (
                                    <Paperclip className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}

                              <button
                                onClick={() => removeSection(instanceId)}
                                className="text-text-muted hover:text-text-default p-0.5 hover:bg-surface-subtle transition-colors"
                                title="Remove this section"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>

                          {/* BODY CONTENT */}
                          {isPersona ? (
                            /* BLOCKNOTE EDITOR */
                            <div className={`px-4 ${bgClass}`}>
                              <BlockNoteEditor
                                initialContent={getDraftContent(instanceId)}
                                onChange={(content) => {
                                  saveDraft(
                                    instanceId,
                                    section.personaId,
                                    content,
                                    persona?.name || "",
                                  );
                                }}
                                placeholder={`What would ${persona?.name || "they"} say?`}
                                onEditorReady={(editor) => {
                                  editorRefs.current[instanceId] = editor;
                                  if (
                                    pendingFocusInstanceIdRef.current ===
                                    instanceId
                                  ) {
                                    pendingFocusInstanceIdRef.current = null;
                                    focusEditorForInstance(instanceId);
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            /* PDF ATTACHMENTS BLOCK */
                            <div className="p-4 space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <label className="inline-flex cursor-pointer items-center gap-2 border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-default transition-colors hover:bg-surface-default">
                                  <Upload className="h-3 w-3" />
                                  Upload PDF
                                  <input
                                    type="file"
                                    accept="application/pdf"
                                    className="hidden"
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;

                                      e.target.value = ""; // Clear file

                                      try {
                                        const hash =
                                          await calculateFileHash(file);
                                        const existingDoc =
                                          importedDocuments.find(
                                            (d) =>
                                              (
                                                d.source_metadata as Record<
                                                  string,
                                                  unknown
                                                >
                                              )?.fileHash === hash,
                                          );

                                        if (existingDoc) {
                                          setDuplicateCheck({
                                            file,
                                            hash,
                                            existingDoc,
                                            instanceId,
                                          });
                                          return;
                                        }

                                        setImportModalFiles([{ file, hash }]);
                                      } catch (error) {
                                        console.error("Hash error:", error);
                                        setImportModalFiles([{ file }]);
                                      }

                                      setPdfPickerTargetInstanceId(instanceId);
                                    }}
                                  />
                                </label>

                                <button
                                  type="button"
                                  className="inline-flex items-center gap-2 border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs font-medium text-text-default transition-colors hover:bg-surface-default"
                                  onClick={() => {
                                    setImportModalFiles([]);
                                    setPdfPickerTargetInstanceId(instanceId);
                                  }}
                                >
                                  <FileText className="h-3 w-3" />
                                  Select from Library
                                </button>

                                {section.isUploading && (
                                  <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Uploading PDFs...
                                  </span>
                                )}
                              </div>
                              {effectiveAttachments.length === 0 ? (
                                <div className="border border-dashed border-border-subtle bg-surface-subtle/30 px-3 py-4 text-center text-xs text-text-muted">
                                  Drop or attach one or more PDFs to start
                                  building this section.
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {effectiveAttachments.map(
                                    (attachment, attachmentIndex) => {
                                      const docDetail = attachment.documentId
                                        ? attachedDocDetails.get(
                                            attachment.documentId,
                                          )
                                        : null;
                                      const latestJob = docDetail?.latestJob;
                                      const importStatus =
                                        docDetail?.import_status ??
                                        latestJob?.status;
                                      const isProcessing =
                                        importStatus === "queued" ||
                                        importStatus === "processing";
                                      const canOpenParsed =
                                        importStatus === "completed" &&
                                        !!attachment.documentId;
                                      const progressPercent =
                                        latestJob?.progress_percent ?? 0;
                                      const progressMessage =
                                        latestJob?.progress_message;

                                      return (
                                        <PdfAttachmentItem
                                          key={
                                            attachment.documentId ||
                                            attachment.fileHash ||
                                            attachment.titleSnapshot
                                          }
                                          keyId={
                                            attachment.documentId ||
                                            attachment.fileHash ||
                                            attachment.titleSnapshot
                                          }
                                          variant="creator"
                                          title={attachment.titleSnapshot}
                                          subtitle={`${attachment.pageCount > 0 ? `${attachment.pageCount} pages` : "PDF"}${attachment.author ? ` • ${attachment.author}` : ""}`}
                                          storagePath={attachment.storagePath}
                                          thumbnailPath={
                                            attachment.thumbnailPath ??
                                            docDetail?.thumbnail_path ??
                                            null
                                          }
                                          importStatus={importStatus ?? null}
                                          progressPercent={progressPercent}
                                          progressMessage={progressMessage}
                                          previewUrl={attachment.previewUrl}
                                          isProcessing={isProcessing}
                                          canOpenParsed={canOpenParsed}
                                          displayMode={pdfSection?.displayMode}
                                          onPreviewPdf={() =>
                                            openAttachmentPreview(
                                              attachment,
                                              importStatus,
                                              "pdf",
                                            )
                                          }
                                          onPreviewParsed={() =>
                                            openAttachmentPreview(
                                              attachment,
                                              importStatus,
                                              "parsed",
                                            )
                                          }
                                          onRemove={() =>
                                            removePdfAttachment(
                                              instanceId,
                                              attachment,
                                              attachmentIndex,
                                              attachmentsSource,
                                            )
                                          }
                                        />
                                      );
                                    },
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </SortableSection>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          {/* Footer — commit action */}
          {sections.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-surface-subtle/50 border-t border-border-default/50 ">
              <div className="text-[10px] text-text-muted">
                <kbd className=" border border-border-subtle bg-surface-subtle px-1 py-0.5 text-[9px] font-mono">
                  ⌘+Enter
                </kbd>
                <span className="mx-1">→</span>
                <span className="font-medium">{selectedBranch || "main"}</span>
              </div>
              {commitBlockedByPdfStatus && (
                <div className="inline-flex items-center gap-2 ml-3  border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3 w-3 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <path d="M12 9v4" />
                    <path d="M12 17h.01" />
                  </svg>
                  <span>
                    {isDocumentsLoading
                      ? "Checking PDFs"
                      : `${unparsedAttachedCount} PDF${unparsedAttachedCount === 1 ? "" : "s"} not ready`}
                  </span>
                </div>
              )}
              <button
                onClick={handleCommit}
                disabled={status === "saving" || commitBlockedByPdfStatus}
                className={`flex items-center gap-1.5  px-3 py-1.5 text-xs font-medium transition-all ${
                  status !== "saving" && !commitBlockedByPdfStatus
                    ? "bg-action-primary-bg text-white hover:bg-action-primary-hover"
                    : "bg-surface-subtle text-text-muted cursor-not-allowed"
                }`}
              >
                <Send className="h-3 w-3" />
                Commit
              </button>
            </div>
          )}
        </div>

        <DocumentImportModal
          isOpen={!!pdfPickerTargetInstanceId}
          onClose={() => {
            setPdfPickerTargetInstanceId(null);
            setImportModalFiles([]);
          }}
          streamId={streamId}
          onSelectDocument={(document) => {
            if (!pdfPickerTargetInstanceId) return;
            void attachDocumentToPdfSection(
              pdfPickerTargetInstanceId,
              document,
            );
          }}
          initialQueuedFiles={importModalFiles}
        />

        <PdfAttachmentPreviewDialog
          open={!!attachmentPreview}
          onClose={closeAttachmentPreview}
          attachmentPreview={attachmentPreview}
          activePreviewTab={activePreviewTab}
          onActivePreviewTabChange={setActivePreviewTab}
          parsedPreview={parsedPreview}
          parsedPreviewLoading={parsedPreviewLoading}
          parsedPreviewError={parsedPreviewError}
          onRequestParsedPreview={(documentId, titleSnapshot) => {
            void openParsedPreview(documentId, titleSnapshot);
          }}
        />
      </div>

      <PersonaManager
        isOpen={personaManagerOpen}
        onClose={() => setPersonaManagerOpen(false)}
      />
      <ConfirmDialog
        open={clearSectionsDialogOpen}
        title="Delete all sections?"
        description="This removes every section from the editor and cannot be undone."
        confirmLabel="Delete sections"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setClearSectionsDialogOpen(false)}
        onConfirm={confirmClearSections}
      />
      <ConfirmDialog
        open={!!duplicateCheck}
        title="File Already Imported"
        description={
          duplicateCheck
            ? `The file "${duplicateCheck.file.name}" has already been processed as "${duplicateCheck.existingDoc.title}". Would you like to use the existing document instead of re-uploading?`
            : ""
        }
        confirmLabel="Use Existing"
        cancelLabel="Upload Anyway"
        onCancel={() => {
          if (!duplicateCheck) return;
          setImportModalFiles([
            { file: duplicateCheck.file, hash: duplicateCheck.hash },
          ]);
          setPdfPickerTargetInstanceId(duplicateCheck.instanceId);
          setDuplicateCheck(null);
        }}
        onConfirm={() => {
          if (!duplicateCheck) return;
          void attachDocumentToPdfSection(
            duplicateCheck.instanceId,
            duplicateCheck.existingDoc,
          );
          setDuplicateCheck(null);
        }}
      />
    </>
  );
}
