"use client";

import React, {
  useState,
  useRef,
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from "@/components/shared/MarkdownEditor";

import type { PartialBlock } from "@/lib/types/editor";
import type { WhatsAppInjectPayload } from "./WhatsAppImportModal";
import {
  Loader2,
  Send,
  Plus,
  X,
  GripVertical,
  Settings,
  Paperclip,
  Type,
  Expand,
  GitBranch,
  GitCommitHorizontal,
  Info,
  Minimize2,
  Archive,
  ArchiveRestore,
  Copy,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { usePersonas } from "@/lib/hooks/usePersonas";
import { useAuth } from "@/lib/hooks/useAuth";
import {
  Dialog,
  DialogPanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from "@headlessui/react";
// DynamicIcon removed from this file (unused import)
import { PersonaItem } from "../../shared/PersonaItem";
import { SectionPreset, ThreadFrame } from "@/components/shared/SectionPreset";
import { getPersonaHoverClass } from "@/components/shared/getPersonaHoverClass";

import { FileAttachmentsSection } from "./FileAttachmentsSection";
import { DocumentImportModal } from "@/components/features/documents/DocumentImportModal";
import AttachmentsManager from "@/components/layout/AttachmentsManager";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { DocumentWithLatestJob } from "@/lib/types";
import {
  useDraftSystem,
  FileDraftAttachment,
} from "@/lib/hooks/useDraftSystem";
import debounce from "lodash/debounce";
import { calculateFileHash } from "@/lib/utils/hash";
import { PersonaManager } from "@/components/features/persona/PersonaManager";
import { useKeyboard } from "@/lib/hooks/useKeyboard";
import { NavigationGuard } from "@/components/features/log/NavigationGuard";
import { FileAttachmentPreviewDialog } from "./FileAttachmentPreviewDialog";
import { getPersonaTintStyle } from "@/lib/personas";
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
import {
  EntryCreatorStashItem,
  readEntryCreatorStash,
  writeEntryCreatorStash,
} from "@/lib/utils/stash";

function isLocalPersona(persona: { is_shadow?: boolean | null }): boolean {
  return persona.is_shadow === true;
}

function shortHash(id: string): string {
  return id.replace(/-/g, "").slice(0, 7);
}

function comparePersonaNames(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name);
}

function comparePersonaCreatedAt(
  a: { created_at: string | null; name: string },
  b: { created_at: string | null; name: string },
) {
  const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
  const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;

  if (timeA !== timeB) return timeA - timeB;
  return a.name.localeCompare(b.name);
}

const MAX_ENTRY_CREATOR_STASH_ITEMS = 20;

function textToBlockContent(text: string) {
  const value = text.trim();
  if (!value) return [];
  return [{ type: "text" as const, text: value, styles: {} }];
}

function blocksToPlainText(blocks: PartialBlock[] | undefined): string {
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

const hasMeaningfulDraftContent = (content: PartialBlock[] | undefined): boolean => {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((block) => hasMeaningfulBlockPayload(block));
};

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
  externalStashAction?:
    | {
        nonce: string;
        stashId: string;
        kind: "apply" | "pop" | "drop";
      }
    | null;
  onExternalStashActionHandled?: (nonce: string) => void;
}

export function EntryCreator({
  streamId,
  currentBranch,
  externalStashAction = null,
  onExternalStashActionHandled,
}: EntryCreatorProps) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { personas } = usePersonas({
    streamId,
    includeLocal: true,
  });
  const personaUsageStorageKey = `entry-creator:persona-usage:${user?.id ?? "anonymous"}:${streamId}`;

  const getPersonaUsageFromStorage = useCallback(() => {
    if (typeof window === "undefined") return {} as Record<string, number>;
    try {
      const stored = window.localStorage.getItem(personaUsageStorageKey);
      if (!stored) return {} as Record<string, number>;
      return JSON.parse(stored) as Record<string, number>;
    } catch {
      return {} as Record<string, number>;
    }
  }, [personaUsageStorageKey]);

  interface FileAttachmentState {
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

  interface AttachmentSectionMemory {
    displayMode: "inline" | "download" | "external";
    attachments: FileAttachmentState[];
    personaId?: string | null;
    personaName?: string | null;
  }

  type SectionState =
    | {
        instanceId: string;
        kind: "PERSONA";
        personaId: string;
      }
    | {
        instanceId: string;
        kind: "FILE_ATTACHMENT";
        displayMode: "inline" | "download" | "external";
        attachments: FileAttachmentState[];
        personaId?: string | null;
        personaName?: string | null;
        isUploading: boolean;
      };

  const [sections, setSections] = useState<SectionState[]>([]);
  const [personaUsageCounts, setPersonaUsageCounts] = useState<
    Record<string, number>
  >(getPersonaUsageFromStorage);
  const [visibleQuickPersonaCount, setVisibleQuickPersonaCount] = useState(0);
  const [filePickerTargetInstanceId, setFilePickerTargetInstanceId] = useState<
    string | null
  >(null);
  const [attachmentManagerTargetInstanceId, setAttachmentManagerTargetInstanceId] =
    useState<string | null>(null);
  const [importModalFiles, setImportModalFiles] = useState<
    Array<{ file: File; hash?: string }>
  >([]);
  const [dragOverAttachmentInstanceId, setDragOverAttachmentInstanceId] =
    useState<string | null>(null);
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
  const [isAttachmentPreviewOpen, setIsAttachmentPreviewOpen] = useState(false);
  const attachmentSectionMemoryRef = useRef<
    Record<string, AttachmentSectionMemory>
  >({});
  const [activePreviewTab, setActivePreviewTab] = useState<"file" | "parsed">(
    "file",
  );
  const [parsedPreviewLoading, setParsedPreviewLoading] = useState(false);
  const [parsedPreviewError, setParsedPreviewError] = useState<string | null>(
    null,
  );
  const [personaManagerOpen, setPersonaManagerOpen] = useState(false);
  const [clearSectionsDialogOpen, setClearSectionsDialogOpen] = useState(false);
  const [sectionToRemove, setSectionToRemove] = useState<string | null>(null);
  const [focusedPersonaInstanceId, setFocusedPersonaInstanceId] = useState<
    string | null
  >(null);
  const [lastFocusedPersonaInstanceId, setLastFocusedPersonaInstanceId] =
    useState<string | null>(null);
  const [fullscreenSectionId, setFullscreenSectionId] = useState<string | null>(
    null,
  );
  const [headerCloudStatus, setHeaderCloudStatus] = useState<
    "idle" | "syncing" | "synced" | "error"
  >("idle");
  const [headerDirty, setHeaderDirty] = useState(false);
  const [stashItems, setStashItems] = useState<EntryCreatorStashItem[]>([]);
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const cloudSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const quickPersonaStripRef = useRef<HTMLDivElement | null>(null);
  const quickPersonaMeasureRefs = useRef<Record<string, HTMLDivElement | null>>(
    {},
  );
  const quickPersonaOverflowMeasureRef = useRef<HTMLDivElement | null>(null);

  const selectedBranch = currentBranch ?? "main";

  const attachedDocumentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of sections) {
      if (section.kind !== "FILE_ATTACHMENT") continue;
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
  const commitBlockedByFileAttachmentStatus =
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

  const currentBranchRecord =
    branches?.find((branch) => branch.name === selectedBranch) ?? null;
  const currentBranchHeadId = currentBranchRecord?.head_commit_id ?? null;

  // Refs for editors to clear them
  const editorRefs = useRef<Record<string, MarkdownEditorHandle>>({});
  const pendingFocusInstanceIdRef = useRef<string | null>(null);
  const editorReadyAtRef = useRef<Record<string, number>>({});
  const userEditedRef = useRef<Record<string, boolean>>({});

  const focusEditorForInstance = useCallback((instanceId: string) => {
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
  }, []);

  // Draft System Hook
  const {
    status,
    localStatus,
    saveDraft,
    saveFileAttachmentDraft,
    commitDraft,
    initialDrafts,
    getDraftContent,
    getDraftMarkdown,
    getFileAttachmentDraft,
    isLoading,
    setActiveInstances,
    flushPendingSaves,
    clearDraft,
  } = useDraftSystem({
    streamId,
    parentEntryId: currentBranchHeadId,
  });

  const sectionHasItems = useCallback(
    (section: SectionState): boolean => {
      if (section.kind === "FILE_ATTACHMENT") {
        const attachmentDraft = getFileAttachmentDraft(section.instanceId);
        return (
          section.attachments.length > 0 ||
          (attachmentDraft?.attachments?.length ?? 0) > 0
        );
      }

      return hasMeaningfulDraftContent(getDraftContent(section.instanceId));
    },
    [getDraftContent, getFileAttachmentDraft],
  );

  const hasCommitableContent = sections.some((section) => {
    return sectionHasItems(section);
  });

  const isCommitDisabled =
    status === "saving" ||
    commitBlockedByFileAttachmentStatus ||
    !hasCommitableContent;

  const debouncedSave = useMemo(
    () =>
      debounce(() => {
        setHeaderDirty(false);
        setHeaderCloudStatus("syncing");
        if (cloudSyncTimeoutRef.current) {
          clearTimeout(cloudSyncTimeoutRef.current);
        }
        cloudSyncTimeoutRef.current = setTimeout(() => {
          setHeaderCloudStatus("synced");
          cloudSyncTimeoutRef.current = null;
        }, 1200);
      }, 1000),
    [],
  );

  useEffect(() => {
    return () => {
      debouncedSave.cancel();
      if (cloudSyncTimeoutRef.current) {
        clearTimeout(cloudSyncTimeoutRef.current);
      }
    };
  }, [debouncedSave]);

  useEffect(() => {
    console.log(`[EntryCreator] mount streamId=${streamId}`);
    setHeaderDirty(false);
    setHeaderCloudStatus("idle");
    return () => {
      console.log(`[EntryCreator] unmount streamId=${streamId}`);
    };
  }, [streamId]);

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

  useEffect(() => {
    setPersonaUsageCounts(getPersonaUsageFromStorage());
  }, [getPersonaUsageFromStorage]);

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

  const quickPersonas = useMemo(() => {
    if (!personas?.length) return [];

    return [...personas].sort((a, b) => {
      const countA = personaUsageCounts[a.id] ?? 0;
      const countB = personaUsageCounts[b.id] ?? 0;

      if (countA !== countB) return countB - countA;
      return comparePersonaCreatedAt(a, b);
    });
  }, [personas, personaUsageCounts]);

  const globalPersonas = useMemo(
    () =>
      (personas ?? [])
        .filter((p) => !isLocalPersona(p))
        .sort(comparePersonaNames),
    [personas],
  );
  const localPersonas = useMemo(
    () =>
      (personas ?? [])
        .filter((p) => isLocalPersona(p))
        .sort(comparePersonaNames),
    [personas],
  );
  const fullscreenPersonaSections = useMemo(
    () =>
      sections.flatMap((section, sectionIndex) => {
        if (section.kind !== "PERSONA") return [];

        return [
          {
            instanceId: section.instanceId,
            persona: personas?.find((p) => p.id === section.personaId) ?? null,
            personaId: section.personaId,
            sectionIndex,
          },
        ];
      }),
    [personas, sections],
  );
  const activeFullscreenSection = useMemo(
    () =>
      fullscreenPersonaSections.find(
        (section) => section.instanceId === fullscreenSectionId,
      ) ?? null,
    [fullscreenPersonaSections, fullscreenSectionId],
  );

  const updateVisibleQuickPersonas = useCallback(() => {
    const strip = quickPersonaStripRef.current;

    if (!strip || quickPersonas.length === 0) {
      setVisibleQuickPersonaCount(0);
      return;
    }

    const availableWidth = strip.clientWidth;
    const gapWidth = 6;
    const overflowWidth = quickPersonaOverflowMeasureRef.current?.offsetWidth ?? 0;
    const itemWidths = quickPersonas.map(
      (persona) => quickPersonaMeasureRefs.current[persona.id]?.offsetWidth ?? 0,
    );

    if (availableWidth <= 0 || itemWidths.some((width) => width <= 0)) {
      setVisibleQuickPersonaCount(quickPersonas.length);
      return;
    }

    const widthForFirstItems = (count: number) =>
      itemWidths.slice(0, count).reduce((total, width, index) => {
        return total + width + (index > 0 ? gapWidth : 0);
      }, 0);

    let nextVisibleCount = 0;

    for (let count = quickPersonas.length; count >= 0; count -= 1) {
      const hiddenCount = quickPersonas.length - count;
      const itemsWidth = widthForFirstItems(count);
      const counterWidth =
        hiddenCount > 0 ? overflowWidth + (count > 0 ? gapWidth : 0) : 0;

      if (itemsWidth + counterWidth <= availableWidth) {
        nextVisibleCount = count;
        break;
      }
    }

    setVisibleQuickPersonaCount(nextVisibleCount);
  }, [quickPersonas]);

  useLayoutEffect(() => {
    updateVisibleQuickPersonas();

    const strip = quickPersonaStripRef.current;
    if (!strip || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      updateVisibleQuickPersonas();
    });

    observer.observe(strip);

    return () => {
      observer.disconnect();
    };
  }, [updateVisibleQuickPersonas]);

  const visibleQuickPersonas = quickPersonas.slice(0, visibleQuickPersonaCount);
  const hiddenQuickPersonaCount = Math.max(
    quickPersonas.length - visibleQuickPersonaCount,
    0,
  );

  useEffect(() => {
    setStashItems(readEntryCreatorStash(streamId));
  }, [streamId]);

  const persistStashItems = useCallback(
    (updater: (current: EntryCreatorStashItem[]) => EntryCreatorStashItem[]) => {
      setStashItems((current) => {
        const next = updater(current);
        writeEntryCreatorStash(streamId, next);
        return next;
      });
    },
    [streamId],
  );

  useEffect(() => {
    if (!fullscreenSectionId) return;

    const fullscreenSectionStillExists = fullscreenPersonaSections.some(
      (section) => section.instanceId === fullscreenSectionId,
    );

    if (!fullscreenSectionStillExists) {
      setFullscreenSectionId(fullscreenPersonaSections[0]?.instanceId ?? null);
      return;
    }

    const focusTimeout = window.setTimeout(() => {
      focusEditorForInstance(fullscreenSectionId);
    }, 0);

    return () => {
      window.clearTimeout(focusTimeout);
    };
  }, [focusEditorForInstance, fullscreenPersonaSections, fullscreenSectionId]);

  const trackPersonaUsage = (personaId: string) => {
    setPersonaUsageCounts((prev) => ({
      ...prev,
      [personaId]: (prev[personaId] ?? 0) + 1,
    }));
  };

  // Initialize selection with existing drafts only
  useEffect(() => {
    if (sections.length === 0 && !isLoading) {
      // If we have initial drafts, use them
      if (initialDrafts && Object.keys(initialDrafts).length > 0) {
        const loadedSections = Object.entries(initialDrafts).map(
          ([instanceId, draft]) => ({
            instanceId,
            ...(draft.sectionType === "FILE_ATTACHMENT"
              ? {
                  kind: "FILE_ATTACHMENT" as const,
                  personaId: draft.personaId ?? null,
                  personaName: draft.personaName,
                  displayMode: draft.fileDisplayMode ?? "inline",
                  attachments: (draft.fileAttachments ?? []).map(
                    (attachment: FileDraftAttachment) => ({
                      documentId: attachment.documentId ?? "",
                      titleSnapshot: attachment.titleSnapshot,
                      pageCount: 0,
                      author: null,
                      creationDate: null,
                      storagePath: attachment.storagePath ?? "",
                      thumbnailPath: attachment.thumbnailPath ?? null,
                      previewUrl: attachment.previewUrl ?? null,
                      annotationText: attachment.annotationText ?? null,
                      referencedPersonaId:
                        attachment.referencedPersonaId ?? null,
                      referencedPage: attachment.referencedPage ?? null,
                      fileHash: attachment.fileHash,
                    }),
                  ),
                  isUploading: false,
                }
              : {
                  kind: "PERSONA" as const,
                  personaId: draft.personaId ?? "",
                }),
          }),
        );
        // Restore all loaded sections (including persona-less sections
        // that contain meaningful content). The draft system already
        // filtered out empty/irrelevant sections during load.
        setSections(loadedSections);
      }
      // Don't auto-initialize with a default persona
      // Let the user explicitly select a persona or add a section
    }
  }, [initialDrafts, isLoading, sections.length]);

  const persistFileAttachmentSection = useCallback(
    (
      instanceId: string,
      draft: Extract<SectionState, { kind: "FILE_ATTACHMENT" }>,
    ) => {
      if (!draft || draft.kind !== "FILE_ATTACHMENT") return;

      attachmentSectionMemoryRef.current[instanceId] = {
        displayMode: draft.displayMode,
        attachments: draft.attachments.map((attachment) => ({ ...attachment })),
        personaId: draft.personaId ?? null,
        personaName: draft.personaName ?? null,
      };

      saveFileAttachmentDraft(instanceId, {
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
          previewUrl: attachment.previewUrl ?? null,
        })),
        content: getDraftContent(instanceId),
        rawMarkdown: getDraftMarkdown(instanceId),
      });
    },
    [getDraftContent, getDraftMarkdown, saveFileAttachmentDraft],
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
        if (section.kind !== "FILE_ATTACHMENT") continue;

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
          persistFileAttachmentSection(
            section.instanceId,
            nextSections[i] as Extract<SectionState, { kind: "FILE_ATTACHMENT" }>,
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
    saveFileAttachmentDraft,
    sections,
    persistFileAttachmentSection,
  ]);

  // Sync active instances with draft system whenever sections change
  useEffect(() => {
    if (isLoading) return;
    const ids = sections.map((section) => section.instanceId);
    console.log(`[EntryCreator] syncing active instances for ${streamId}:`, ids);
    setActiveInstances(ids);
    const syncStatus = status === "error" ? "error" : headerCloudStatus;
    
    window.dispatchEvent(
      new CustomEvent("kolam_log_state", {
        detail: {
          streamId,
          status,
          localStatus,
          syncStatus,
          isDirty: headerDirty,
        },
      }),
    );
  }, [
    sections,
    setActiveInstances,
    isLoading,
    streamId,
    status,
    localStatus,
    headerDirty,
    headerCloudStatus,
  ]);

  // WhatsApp chat inject listener
  useEffect(() => {
    const onInject = (event: Event) => {
      const payload = (event as CustomEvent<WhatsAppInjectPayload>).detail;
      if (payload.streamId !== streamId) return;

      clearDraft();
      editorRefs.current = {};

      const newSections: SectionState[] = [];

      for (const turn of payload.turns) {
        const instanceId = crypto.randomUUID();

        if (turn.type === "text") {
          const blocks: PartialBlock[] = turn.messages.flatMap((msg, i) => {
            const parsed = parseMarkdownishMessageToBlocks(msg);
            if (i === 0) return parsed;
            return [{ type: "paragraph", content: [] } as PartialBlock, ...parsed];
          });
          saveDraft(
            instanceId,
            turn.personaId,
            blocks,
            turn.personaName,
            false,
            turn.messages.join("\n\n"),
          );
          newSections.push({
            instanceId,
            kind: "PERSONA" as const,
            personaId: turn.personaId,
          });
        } else {
          // File attachment turn — create one attachment section bound to sender persona
          const attachments = turn.attachments;

          if (!attachments || attachments.length === 0) {
            continue;
          }

          saveFileAttachmentDraft(instanceId, {
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
            kind: "FILE_ATTACHMENT" as const,
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
  }, [streamId, clearDraft, saveDraft, saveFileAttachmentDraft]);

  const openFullscreenEditor = useCallback((instanceId: string) => {
    setLastFocusedPersonaInstanceId(instanceId);
    setFullscreenSectionId(instanceId);
  }, []);

  const closeFullscreenEditor = useCallback(() => {
    const targetInstanceId = fullscreenSectionId ?? lastFocusedPersonaInstanceId;
    setFullscreenSectionId(null);
    if (!targetInstanceId) return;
    window.setTimeout(() => {
      focusEditorForInstance(targetInstanceId);
    }, 0);
  }, [focusEditorForInstance, fullscreenSectionId, lastFocusedPersonaInstanceId]);

  const handlePersonaEditorFocusChange = useCallback(
    (instanceId: string, isFocused: boolean) => {
      if (isFocused) {
        setFocusedPersonaInstanceId(instanceId);
        setLastFocusedPersonaInstanceId(instanceId);
        return;
      }

      setFocusedPersonaInstanceId((current) =>
        current === instanceId ? null : current,
      );
    },
    [],
  );

  const handlePersonaEditorReady = useCallback(
    (instanceId: string, editor: MarkdownEditorHandle) => {
      editorReadyAtRef.current[instanceId] = Date.now();
      editorRefs.current[instanceId] = editor;
      userEditedRef.current[instanceId] = false;
      if (pendingFocusInstanceIdRef.current === instanceId) {
        pendingFocusInstanceIdRef.current = null;
        focusEditorForInstance(instanceId);
      }
    },
    [focusEditorForInstance],
  );

  const handlePersonaEditorChange = useCallback(
    (
      instanceId: string,
      personaId: string,
      personaName: string | null | undefined,
      content: PartialBlock[],
      markdown: string,
    ) => {
      const existingContent = getDraftContent(instanceId);
      const existingMarkdown = getDraftMarkdown(instanceId);
      const readyAt = editorReadyAtRef.current[instanceId];
      const withinHydrationWindow =
        readyAt === undefined || Date.now() - readyAt < 500;
      hasMeaningfulDraftContent(content);
      hasMeaningfulDraftContent(existingContent);
      const editorFocused = focusedPersonaInstanceId === instanceId;
      const incomingText = blocksToPlainText(content);
      const existingText = blocksToPlainText(existingContent);
      const contentChanged =
        JSON.stringify(content) !== JSON.stringify(existingContent);
      const markdownChanged = markdown !== existingMarkdown;

      if (
        editorFocused &&
        !withinHydrationWindow &&
        (contentChanged || markdownChanged)
      ) {
        userEditedRef.current[instanceId] = true;
        setHeaderDirty(true);
        setHeaderCloudStatus("idle");
      }

      try {
        const incomingTextLen = incomingText.length;
        const existingTextLen = existingText.length;
        console.log(
          `[EntryCreator] saveDraft -> instance=${instanceId} stream=${streamId}`,
          {
            personaId,
            incomingTextLen,
            existingTextLen,
            editorFocused,
          },
        );
      } catch {
        // swallow logging errors
      }

      if (!contentChanged && !markdownChanged) return;
      saveDraft(
        instanceId,
        personaId,
        content,
        personaName ?? "",
        false,
        markdown,
      );
      debouncedSave();
    },
    [
      debouncedSave,
      focusedPersonaInstanceId,
      getDraftContent,
      getDraftMarkdown,
      saveDraft,
      streamId,
    ],
  );

  const renderPersonaEditor = useCallback(
    (instanceId: string, personaId: string, personaName: string | null) => (
      <div className="section-editor-surface">
        <MarkdownEditor
          initialContent={getDraftContent(instanceId)}
          initialMarkdown={getDraftMarkdown(instanceId)}
          viewStateKey={`entry-creator:${instanceId}`}
          onChange={(content, markdown) => {
            handlePersonaEditorChange(
              instanceId,
              personaId,
              personaName,
              content,
              markdown,
            );
          }}
          placeholder={`What would ${personaName || "they"} say?`}
          onEditorReady={(editor) => {
            handlePersonaEditorReady(instanceId, editor);
          }}
          onFocusChange={(isFocused) => {
            handlePersonaEditorFocusChange(instanceId, isFocused);
          }}
        />
      </div>
    ),
    [
      getDraftContent,
      getDraftMarkdown,
      handlePersonaEditorChange,
      handlePersonaEditorFocusChange,
      handlePersonaEditorReady,
    ],
  );

  const handleAttachmentNotesChange = useCallback(
    (instanceId: string, content: PartialBlock[], markdown: string) => {
      const section = sections.find(
        (candidate) =>
          candidate.instanceId === instanceId &&
          candidate.kind === "FILE_ATTACHMENT",
      ) as Extract<SectionState, { kind: "FILE_ATTACHMENT" }> | undefined;

      if (!section) return;

      saveFileAttachmentDraft(instanceId, {
        displayMode: section.displayMode,
        personaId: section.personaId ?? null,
        personaName: section.personaName ?? undefined,
        attachments: section.attachments.map((attachment) => ({
          documentId: attachment.documentId,
          storagePath: attachment.storagePath,
          titleSnapshot: attachment.titleSnapshot,
          annotationText: attachment.annotationText ?? null,
          referencedPersonaId: attachment.referencedPersonaId ?? null,
          referencedPage: attachment.referencedPage ?? null,
          fileHash: attachment.fileHash,
          previewUrl: attachment.previewUrl ?? null,
        })),
        content,
        rawMarkdown: markdown,
      });
      debouncedSave();
    },
    [debouncedSave, saveFileAttachmentDraft, sections],
  );

  function renderAddPersonaMenu({
    wrapperClassName,
    buttonClassName,
    buttonTitle,
    compact = false,
  }: {
    wrapperClassName: string;
    buttonClassName: string;
    buttonTitle: string;
    compact?: boolean;
  }) {
    return (
      <Menu as="div" className={wrapperClassName}>
        <MenuButton className={buttonClassName} title={buttonTitle}>
          <Plus className="h-3 w-3 text-text-subtle" />
          {!compact && <span className="text-text-default">Add Persona</span>}
        </MenuButton>

        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition ease-in duration-75"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <MenuItems
            anchor={{ to: "bottom start", gap: 4 }}
            portal
            className="z-9999 w-fit min-w-56 max-w-[calc(100vw-2rem)] max-h-60 overflow-x-hidden overflow-y-auto border border-border-default bg-surface-elevated p-1 focus:"
          >
            <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Add Author Section
            </div>
            {globalPersonas.length > 0 && (
              <div className="px-2 py-1 text-[10px] font-semibold text-text-muted">
                Available Everywhere
              </div>
            )}
            {globalPersonas.map((persona) => (
              <MenuItem key={persona.id}>
                {({ active }) => (
                  <PersonaItem
                    persona={persona}
                    role="global"
                    focus={active}
                    showMeta={false}
                    onClick={() => addPersona(persona.id)}
                  />
                )}
              </MenuItem>
            ))}
            {localPersonas.length > 0 && (
              <div className="mt-1 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                Local To This Stream
              </div>
            )}
            {localPersonas.map((persona) => (
              <MenuItem key={persona.id}>
                {({ active }) => (
                  <PersonaItem
                    persona={persona}
                    role="local"
                    focus={active}
                    showMeta={false}
                    onClick={() => addPersona(persona.id)}
                  />
                )}
              </MenuItem>
            ))}
            <MenuItem>
              <div className="my-1 border-t border-border-default" />
            </MenuItem>
            <MenuItem>
              {({ active }) => (
                <button
                  onClick={() => setPersonaManagerOpen(true)}
                  className={`${
                    active
                      ? "bg-surface-subtle text-text-default"
                      : "text-text-subtle"
                  } group flex w-full items-center px-2 py-1.5 text-xs transition-colors`}
                >
                  <Settings className="mr-2 h-3 w-3" />
                  Manage Personas
                </button>
              )}
            </MenuItem>
          </MenuItems>
        </Transition>
      </Menu>
    );
  }

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
    {
      key: "Enter",
      metaKey: true,
      shiftKey: true,
      description: "Toggle Fullscreen Editor",
      handler: (e) => {
        const activeEditorInstanceId =
          focusedPersonaInstanceId &&
          sections.some(
            (section) =>
              section.kind === "PERSONA" &&
              section.instanceId === focusedPersonaInstanceId,
          )
            ? focusedPersonaInstanceId
            : null;

        if (!activeEditorInstanceId) return;

        e.preventDefault();

        if (fullscreenSectionId) {
          closeFullscreenEditor();
          return;
        }

        openFullscreenEditor(activeEditorInstanceId);
      },
    },
  ]);

  const handleCommit = async () => {
    if (commitBlockedByFileAttachmentStatus) {
      console.warn(
        "Commit blocked: one or more attached documents are still queued/processing or failed.",
      );
      return;
    }

    if (!hasCommitableContent) {
      console.warn("Commit skipped: no meaningful content to persist.");
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
        const { error } = await supabase
          .from("branches")
          .update({ head_commit_id: committedEntryId })
          .eq("id", targetBranch.id);
        if (error) throw error;
      }

      await refetchBranches();
      queryClient.invalidateQueries({ queryKey: ["branches", streamId] });
      queryClient.invalidateQueries({ queryKey: ["entries-lineage", streamId] });

      // Reset to empty state (no auto-default persona)
      resetComposerState();
    } catch (e) {
      console.error("Failed to commit", e);
    }
  };

  const resetComposerState = useCallback(() => {
    setSections([]);
    setFullscreenSectionId(null);
    setFocusedPersonaInstanceId(null);
    setLastFocusedPersonaInstanceId(null);
    setHeaderDirty(false);
    setHeaderCloudStatus("idle");
    setContextMenuPosition(null);
    attachmentSectionMemoryRef.current = {};
    editorRefs.current = {};
    pendingFocusInstanceIdRef.current = null;
    userEditedRef.current = {};
    editorReadyAtRef.current = {};
  }, []);

  const buildCurrentDraftSnapshot = useCallback((): EntryCreatorStashItem | null => {
    const snapshotSections: EntryCreatorStashItem["sections"] = [];

    for (const section of sections) {
      if (section.kind === "PERSONA") {
        const content = getDraftContent(section.instanceId);
        const rawMarkdown = getDraftMarkdown(section.instanceId);
        const personaName =
          personas?.find((persona) => persona.id === section.personaId)?.name;

        if (!section.personaId && !hasMeaningfulDraftContent(content)) {
          continue;
        }

        snapshotSections.push({
          instanceId: section.instanceId,
          draft: {
            sectionType: "PERSONA" as const,
            personaId: section.personaId,
            personaName,
            content,
            rawMarkdown,
          },
        });
        continue;
      }

      const content = getDraftContent(section.instanceId);
      const rawMarkdown = getDraftMarkdown(section.instanceId);

      if (
        section.attachments.length === 0 &&
        !hasMeaningfulDraftContent(content)
      ) {
        continue;
      }

      snapshotSections.push({
        instanceId: section.instanceId,
        draft: {
          sectionType: "FILE_ATTACHMENT" as const,
          personaId: section.personaId ?? null,
          personaName: section.personaName ?? undefined,
          content,
          rawMarkdown,
          fileDisplayMode: section.displayMode,
          fileAttachments: section.attachments.map((attachment) => ({
            documentId: attachment.documentId,
            storagePath: attachment.storagePath,
            thumbnailPath: attachment.thumbnailPath ?? null,
            previewUrl: attachment.previewUrl ?? null,
            titleSnapshot: attachment.titleSnapshot,
            annotationText: attachment.annotationText ?? null,
            referencedPersonaId: attachment.referencedPersonaId ?? null,
            referencedPage: attachment.referencedPage ?? null,
            fileHash: attachment.fileHash,
          })),
        },
      });
    }

    if (snapshotSections.length === 0) return null;

    return {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      branchName: selectedBranch,
      headCommitId: currentBranchHeadId,
      sections: snapshotSections,
    };
  }, [
    currentBranchHeadId,
    getDraftContent,
    getDraftMarkdown,
    personas,
    sections,
    selectedBranch,
  ]);

  const restoreStashIntoComposer = useCallback(
    (stashItem: EntryCreatorStashItem) => {
      resetComposerState();
      void clearDraft();

      const restoredSections: SectionState[] = stashItem.sections.map(
        ({ instanceId, draft }) => {
          if (draft.sectionType === "FILE_ATTACHMENT") {
            const attachments = (draft.fileAttachments ?? []).map((attachment) => ({
              documentId: attachment.documentId ?? "",
              titleSnapshot: attachment.titleSnapshot,
              pageCount: 0,
              author: null,
              creationDate: null,
              storagePath: attachment.storagePath,
              thumbnailPath: attachment.thumbnailPath ?? null,
              previewUrl: attachment.previewUrl ?? null,
              annotationText: attachment.annotationText ?? null,
              referencedPersonaId: attachment.referencedPersonaId ?? null,
              referencedPage: attachment.referencedPage ?? null,
              fileHash: attachment.fileHash,
            }));

            attachmentSectionMemoryRef.current[instanceId] = {
              displayMode: draft.fileDisplayMode ?? "inline",
              attachments: attachments.map((attachment) => ({ ...attachment })),
              personaId: draft.personaId ?? null,
              personaName: draft.personaName ?? null,
            };

            saveFileAttachmentDraft(instanceId, {
              displayMode: draft.fileDisplayMode ?? "inline",
              personaId: draft.personaId ?? null,
              personaName: draft.personaName,
              attachments: draft.fileAttachments ?? [],
              content: draft.content ?? [],
              rawMarkdown: draft.rawMarkdown,
            });

            return {
              instanceId,
              kind: "FILE_ATTACHMENT" as const,
              displayMode: draft.fileDisplayMode ?? "inline",
              attachments,
              personaId: draft.personaId ?? null,
              personaName: draft.personaName ?? undefined,
              isUploading: false,
            };
          }

          saveDraft(
            instanceId,
            draft.personaId ?? "",
            draft.content ?? [],
            draft.personaName,
            false,
            draft.rawMarkdown,
          );

          return {
            instanceId,
            kind: "PERSONA" as const,
            personaId: draft.personaId ?? "",
          };
        },
      );

      setSections(restoredSections);
    },
    [clearDraft, resetComposerState, saveDraft, saveFileAttachmentDraft],
  );

  const stashCurrentDraft = useCallback(() => {
    const snapshot = buildCurrentDraftSnapshot();
    if (!snapshot) return;

    persistStashItems((current) =>
      [snapshot, ...current].slice(0, MAX_ENTRY_CREATOR_STASH_ITEMS),
    );
    resetComposerState();
    void clearDraft();
  }, [buildCurrentDraftSnapshot, clearDraft, persistStashItems, resetComposerState]);

  const applyLatestStash = useCallback(
    (removeFromStack: boolean) => {
      const latestStash = stashItems[0];
      if (!latestStash) return;

      restoreStashIntoComposer(latestStash);

      if (removeFromStack) {
        persistStashItems((current) => current.slice(1));
      }
    },
    [persistStashItems, restoreStashIntoComposer, stashItems],
  );

  const dropLatestStash = useCallback(() => {
    if (stashItems.length === 0) return;
    persistStashItems((current) => current.slice(1));
  }, [persistStashItems, stashItems.length]);

  const clearAllStashes = useCallback(() => {
    if (stashItems.length === 0) return;
    persistStashItems(() => []);
  }, [persistStashItems, stashItems.length]);

  useEffect(() => {
    if (!externalStashAction) return;

    const targetStash = stashItems.find(
      (stashItem) => stashItem.id === externalStashAction.stashId,
    );

    if (!targetStash) {
      onExternalStashActionHandled?.(externalStashAction.nonce);
      return;
    }

    if (externalStashAction.kind === "apply") {
      restoreStashIntoComposer(targetStash);
    } else if (externalStashAction.kind === "pop") {
      restoreStashIntoComposer(targetStash);
      persistStashItems((current) =>
        current.filter((stashItem) => stashItem.id !== externalStashAction.stashId),
      );
    } else if (externalStashAction.kind === "drop") {
      persistStashItems((current) =>
        current.filter((stashItem) => stashItem.id !== externalStashAction.stashId),
      );
    }

    onExternalStashActionHandled?.(externalStashAction.nonce);
  }, [
    externalStashAction,
    onExternalStashActionHandled,
    persistStashItems,
    restoreStashIntoComposer,
    stashItems,
  ]);

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
        saveFileAttachmentDraft(
          instanceId,
          {
            content: [],
            displayMode: section.displayMode,
            attachments: [],
            personaId: section.personaId ?? null,
            personaName: section.personaName ?? undefined,
          },
          true,
        );
      }
    }

    delete attachmentSectionMemoryRef.current[instanceId];

    if (remaining.length === 0) {
      // Clear immediately when the last section is removed so clearing flags
      // are written before a fast page unload can interrupt async cleanup.
      void clearDraft();
    }

    if (pendingFocusInstanceIdRef.current === instanceId) {
      pendingFocusInstanceIdRef.current = null;
    }
  };

  const requestRemoveSection = (instanceId: string) => {
    const section = sections.find((s) => s.instanceId === instanceId);
    if (!section) return;

    if (!sectionHasItems(section)) {
      removeSection(instanceId);
      return;
    }

    setSectionToRemove(instanceId);
  };

  const confirmRemoveSection = () => {
    if (!sectionToRemove) return;
    removeSection(sectionToRemove);
    setSectionToRemove(null);
  };

  const toggleSectionKind = (instanceId: string) => {
    const section = sections.find((s) => s.instanceId === instanceId);
    if (!section) return;

    if (section.kind === "PERSONA") {
      const personaName =
        personas?.find((p) => p.id === section.personaId)?.name || null;
      const rememberedAttachmentSection =
        attachmentSectionMemoryRef.current[instanceId];
      const persistedAttachmentDraft = getFileAttachmentDraft(instanceId) ?? {
        displayMode: "inline" as const,
        attachments: [],
      };
      const restoredAttachments =
        rememberedAttachmentSection?.attachments.length
          ? rememberedAttachmentSection.attachments
          : (persistedAttachmentDraft.attachments ?? []).map((attachment) => ({
              documentId: attachment.documentId ?? "",
              storagePath: attachment.storagePath ?? "",
              titleSnapshot: attachment.titleSnapshot,
              pageCount: 0,
              author: null,
              creationDate: null,
              thumbnailPath: attachment.thumbnailPath ?? null,
              previewUrl: attachment.previewUrl ?? null,
              annotationText: attachment.annotationText ?? null,
              referencedPersonaId: attachment.referencedPersonaId ?? null,
              referencedPage: attachment.referencedPage ?? null,
              fileHash: attachment.fileHash,
            }));
      const restoredDisplayMode =
        rememberedAttachmentSection?.displayMode ??
        persistedAttachmentDraft.displayMode ??
        "inline";
      const restoredPersonaName =
        rememberedAttachmentSection?.personaName ?? personaName;

      setSections((prev) =>
        prev.map((s) =>
          s.instanceId !== instanceId
            ? s
            : {
                instanceId,
                kind: "FILE_ATTACHMENT" as const,
                displayMode: restoredDisplayMode,
                attachments: restoredAttachments,
                personaId: section.personaId,
                personaName: restoredPersonaName,
                isUploading: false,
              },
        ),
      );
      // Persist section type change so reload shows the correct kind
      saveFileAttachmentDraft(instanceId, {
        displayMode: restoredDisplayMode,
        personaId: section.personaId,
        personaName: restoredPersonaName ?? undefined,
        attachments: restoredAttachments.map((attachment) => ({
          documentId: attachment.documentId,
          storagePath: attachment.storagePath,
          thumbnailPath: attachment.thumbnailPath ?? null,
          titleSnapshot: attachment.titleSnapshot ?? "Document",
          annotationText: attachment.annotationText ?? null,
          referencedPersonaId: attachment.referencedPersonaId ?? null,
          referencedPage: attachment.referencedPage ?? null,
          fileHash: attachment.fileHash,
          previewUrl: attachment.previewUrl ?? null,
        })),
        content: getDraftContent(instanceId),
        rawMarkdown: getDraftMarkdown(instanceId),
      });
    } else {
      const personaId = section.personaId || "";
      attachmentSectionMemoryRef.current[instanceId] = {
        displayMode: section.displayMode,
        attachments: section.attachments.map((attachment) => ({ ...attachment })),
        personaId: section.personaId ?? null,
        personaName: section.personaName ?? null,
      };
      setSections((prev) =>
        prev.map((s) =>
          s.instanceId !== instanceId
            ? s
            : { instanceId, kind: "PERSONA" as const, personaId },
        ),
      );
      // Persist section type change; only save if we have a valid persona
      if (personaId) {
        const personaName = personas?.find((p) => p.id === personaId)?.name;
        saveDraft(
          instanceId,
          personaId,
          getDraftContent(instanceId),
          personaName,
          false,
          getDraftMarkdown(instanceId),
        );
      }
    }
  };

  const requestClearSections = () => {
    if (sections.length === 0) return;
    setClearSectionsDialogOpen(true);
  };

  const confirmClearSections = () => {
    resetComposerState();
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
    saveDraft(
      instanceId,
      newPersonaId,
      content,
      newPersona?.name,
      false,
      getDraftMarkdown(instanceId),
    );
    trackPersonaUsage(newPersonaId);

    // Keep typing context active on the currently selected persona section.
    focusEditorForInstance(instanceId);
  };

  const updateFileAttachmentSection = (
    instanceId: string,
    updater: (
      section: Extract<SectionState, { kind: "FILE_ATTACHMENT" }>,
    ) => Extract<SectionState, { kind: "FILE_ATTACHMENT" }>,
  ) => {
    setSections((prev) =>
      prev.map((section) => {
        if (
          section.instanceId !== instanceId ||
          section.kind !== "FILE_ATTACHMENT"
        )
          return section;
        return updater(section);
      }),
    );
  };

  const attachDocumentToFileAttachmentSection = async (
    instanceId: string,
    document: DocumentWithLatestJob,
  ) => {
    updateFileAttachmentSection(instanceId, (section) => ({
      ...section,
      isUploading: true,
    }));

    const existing = sections.find(
      (section) =>
        section.instanceId === instanceId &&
        section.kind === "FILE_ATTACHMENT",
    ) as Extract<SectionState, { kind: "FILE_ATTACHMENT" }> | undefined;
    if (
      existing?.attachments.some(
        (attachment: FileAttachmentState) =>
          attachment.documentId === document.id,
      )
    ) {
      updateFileAttachmentSection(instanceId, (section) => ({
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

    const nextAttachment: FileAttachmentState = {
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
        (s) => s.instanceId === instanceId && s.kind === "FILE_ATTACHMENT",
      ) as Extract<SectionState, { kind: "FILE_ATTACHMENT" }> | undefined;

      if (draftToPersist) {
        const updated: Extract<SectionState, { kind: "FILE_ATTACHMENT" }> = {
          ...draftToPersist,
          isUploading: false,
          attachments: [...draftToPersist.attachments, nextAttachment],
        };
        Promise.resolve().then(() =>
          persistFileAttachmentSection(instanceId, updated),
        );
        return prev.map((s) =>
          s.instanceId === instanceId && s.kind === "FILE_ATTACHMENT"
            ? updated
            : s,
        );
      }
      return prev;
    });
  };

  const queueFilesForAttachmentSection = useCallback(
    async (instanceId: string, fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((file) => file instanceof File);
      if (files.length === 0) return;

      const queuedFiles = await Promise.all(
        files.map(async (file) => {
          try {
            const hash = await calculateFileHash(file);
            return { file, hash };
          } catch (error) {
            console.error("Hash error:", error);
            return { file };
          }
        }),
      );

      setImportModalFiles(queuedFiles);
      setFilePickerTargetInstanceId(instanceId);
    },
    [],
  );

  const removeFileAttachment = (
    instanceId: string,
    attachmentToRemove: FileAttachmentState,
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
      (s) => s.instanceId === instanceId && s.kind === "FILE_ATTACHMENT",
    ) as Extract<SectionState, { kind: "FILE_ATTACHMENT" }> | undefined;
    const draft = getFileAttachmentDraft(instanceId) ?? {
      displayMode: "inline" as const,
      attachments: [],
    };

    const nextDraftAttachments = (draft?.attachments ?? []).filter(
      (attachment, index) =>
        source === "draft"
          ? index !== attachmentIndex
          : !matchesAttachment(attachment, attachmentToRemove),
    );

    saveFileAttachmentDraft(instanceId, {
      displayMode: section?.displayMode ?? draft?.displayMode ?? "inline",
      personaId: section?.personaId ?? null,
      personaName: section?.personaName ?? undefined,
      attachments: nextDraftAttachments,
      content: getDraftContent(instanceId),
      rawMarkdown: getDraftMarkdown(instanceId),
    });

    attachmentSectionMemoryRef.current[instanceId] = {
      displayMode: section?.displayMode ?? draft?.displayMode ?? "inline",
      personaId: section?.personaId ?? null,
      personaName: section?.personaName ?? null,
      attachments:
        source === "draft"
          ? nextDraftAttachments.map((attachment) => ({
              documentId: attachment.documentId ?? "",
              storagePath: attachment.storagePath ?? "",
              titleSnapshot: attachment.titleSnapshot,
              pageCount: 0,
              author: null,
              creationDate: null,
              thumbnailPath: attachment.thumbnailPath ?? null,
              previewUrl: attachment.previewUrl ?? null,
              annotationText: attachment.annotationText ?? null,
              referencedPersonaId: attachment.referencedPersonaId ?? null,
              referencedPage: attachment.referencedPage ?? null,
              fileHash: attachment.fileHash,
            }))
          : (section?.attachments ?? []).filter((_, index) => index !== attachmentIndex),
    };

    setSections((prev) =>
      prev.map((s) => {
        if (s.instanceId !== instanceId || s.kind !== "FILE_ATTACHMENT")
          return s;
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
    attachment: FileAttachmentState,
    importStatus?: string,
    preferredTab?: "file" | "parsed",
  ) => {
    const nextTab =
      preferredTab ??
      (importStatus === "completed" && attachment.documentId
        ? "parsed"
        : "file");

    setAttachmentPreview({
      documentId: attachment.documentId,
      title: attachment.titleSnapshot,
      previewUrl: attachment.previewUrl,
      importStatus,
    });
    setIsAttachmentPreviewOpen(true);
    setActivePreviewTab(nextTab);

    setParsedPreview(null);
    setParsedPreviewError(null);

    if (nextTab === "parsed" && attachment.documentId) {
      void openParsedPreview(attachment.documentId, attachment.titleSnapshot);
    }
  };

  const closeAttachmentPreview = () => {
    if (parsedPreviewLoading) return;
    setIsAttachmentPreviewOpen(false);
  };

  const resetAttachmentPreview = () => {
    setAttachmentPreview(null);
    setParsedPreview(null);
    setParsedPreviewError(null);
    setActivePreviewTab("file");
  };

  useEffect(() => {
    if (!contextMenuPosition) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!contextMenuRef.current) return;
      const targetNode = event.target as Node | null;
      if (targetNode && !contextMenuRef.current.contains(targetNode)) {
        setContextMenuPosition(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenuPosition(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenuPosition]);

  const handleEntryCreatorContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();

      const estimatedWidth = 248;
      const estimatedHeight = 220;
      const padding = 8;
      const maxLeft = Math.max(window.innerWidth - estimatedWidth - padding, padding);
      const maxTop = Math.max(window.innerHeight - estimatedHeight - padding, padding);

      setContextMenuPosition({
        left: Math.min(event.clientX, maxLeft),
        top: Math.min(event.clientY, maxTop),
      });
    },
    [],
  );

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
      <div className="relative border border-border-default bg-surface-default p-4 min-h-25 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <>
      <div
        className="entry-creator relative group"
        onContextMenu={handleEntryCreatorContextMenu}
      >
        {(status === "saving" || status === "error") && (
          <NavigationGuard onFlush={flushPendingSaves} />
        )}
        <ThreadFrame
          frameClassName="border-border-default bg-surface-default"
          bodyClassName="bg-surface-default"
        >
          <div className="flex flex-col">
          {/* Persona picker */}
          <div className="entry-creator__topbar flex items-center gap-1.5 p-1">
            <div
              ref={quickPersonaStripRef}
              className="relative flex min-w-0 flex-1 items-center overflow-hidden"
            >
              <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                {visibleQuickPersonas.map((persona) => (
                  <PersonaItem
                    key={`quick-persona-${persona.id}`}
                    persona={persona}
                    compact
                    showTypeBadge={false}
                    title={`Quick add ${persona.name}`}
                    className="shrink-0 border text-text-default hover:brightness-[0.98]"
                    style={getPersonaTintStyle(persona, {
                      backgroundAlpha: isLocalPersona(persona) ? 0.16 : 0.1,
                      borderAlpha: 0.24,
                    })}
                    onClick={() => addPersona(persona.id)}
                  />
                ))}
                {hiddenQuickPersonaCount > 0 && (
                  <div className="shrink-0 border border-border-subtle bg-surface-subtle px-2 py-1 text-[11px] font-semibold text-text-muted">
                    +{hiddenQuickPersonaCount}
                  </div>
                )}
              </div>

              <div className="pointer-events-none absolute left-0 top-0 -z-10 flex items-center gap-1.5 opacity-0">
                {quickPersonas.map((persona) => (
                  <div
                    key={`quick-persona-measure-${persona.id}`}
                    ref={(node) => {
                      quickPersonaMeasureRefs.current[persona.id] = node;
                    }}
                    className="shrink-0"
                  >
                    <PersonaItem
                      persona={persona}
                      compact
                      showTypeBadge={false}
                      className="border text-text-default"
                      style={getPersonaTintStyle(persona, {
                        backgroundAlpha: isLocalPersona(persona) ? 0.16 : 0.1,
                        borderAlpha: 0.24,
                      })}
                    />
                  </div>
                ))}
                <div
                  ref={quickPersonaOverflowMeasureRef}
                  className="shrink-0 border border-border-subtle bg-surface-subtle px-2 py-1 text-[11px] font-semibold text-text-muted"
                >
                  +{quickPersonas.length}
                </div>
              </div>
            </div>

            {renderAddPersonaMenu({
              wrapperClassName: "relative z-30 shrink-0",
              buttonClassName:
                "entry-creator__topbar-button flex items-center gap-1 border px-1.5 py-1 text-[11px] font-medium transition-colors focus:",
              buttonTitle: "Add Persona",
            })}

            {sections.length > 0 && (
              <button
                onClick={requestClearSections}
                className="entry-creator__topbar-button entry-creator__topbar-button--icon ml-auto border p-1 text-text-muted transition-colors"
                title="Delete all sections"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {sections.length === 0 && (
            <div className="bg-surface-default px-2 py-8 text-center text-xs text-text-muted">
              Add a persona or attach a file to start building this entry.
            </div>
          )}

          {/* Editor sections */}
          {!fullscreenSectionId && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sections.map((s) => s.instanceId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {sections.map((section, sectionIndex) => {
                    const { instanceId } = section;
                    const isAttachment = section.kind === "FILE_ATTACHMENT";
                    const isPersona = section.kind === "PERSONA";
                    const persona = section.personaId
                      ? personas?.find((p) => p.id === section.personaId)
                      : null;

                  let attachmentDraft:
                    | ReturnType<typeof getFileAttachmentDraft>
                    | undefined;
                  let effectiveAttachments: FileAttachmentState[] = [];
                  let attachmentsSource: "section" | "draft" = "section";
                  let attachmentSection:
                    | Extract<SectionState, { kind: "FILE_ATTACHMENT" }>
                    | undefined;

                  if (isAttachment) {
                    attachmentSection = section;
                    attachmentDraft = getFileAttachmentDraft(instanceId);
                    attachmentsSource =
                      attachmentSection.attachments.length > 0
                        ? "section"
                        : "draft";
                    effectiveAttachments =
                      attachmentsSource === "section"
                        ? attachmentSection.attachments
                        : (attachmentDraft?.attachments ?? []).map(
                            (attachment) => ({
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
                            }),
                          );
                  }

                  // Allow persona-less PERSONA sections to render so recovered
                  // drafts without an assigned persona are visible to the user.

                    return (
                      <SortableSection key={instanceId} id={instanceId}>
                        {(dragHandleProps) => (
                          <SectionPreset
                            persona={persona || null}
                            isAttachment={isAttachment}
                            nestedConnector={
                              sections.length === 1
                                ? "single"
                                : sectionIndex === 0
                                  ? "first"
                                  : sectionIndex === sections.length - 1
                                    ? "last"
                                    : "middle"
                            }
                            className="flex flex-col"
                            headerClassName="entry-creator__section-header"
                            bodyClassName="bg-surface-default"
                            leftHeader={
                              <div className="flex items-center gap-2">
                                <button
                                  className={`entry-creator__icon-button cursor-grab p-0.5 text-text-muted transition-colors ${getPersonaHoverClass(persona || null, isAttachment)} active:cursor-grabbing`}
                                  aria-label="Drag to reorder"
                                  {...dragHandleProps}
                                >
                                  <GripVertical className="h-3 w-3" />
                                </button>
                                <div className="entry-creator__section-label inline-flex items-center gap-1 border px-1 py-px text-[9px] font-semibold uppercase tracking-[0.16em]">
                                  <span className="entry-creator__section-label-index">
                                    S{sectionIndex + 1}
                                  </span>
                                  <span className="entry-creator__section-label-divider h-px w-1.5" />
                                  <span>{isAttachment ? "Attachment" : "Message"}</span>
                                </div>
                              </div>
                            }
                            centerHeader={
                              <PersonaItem
                                persona={persona ?? null}
                                menuProps={{
                                  currentPersona: persona || null,
                                  isAttachment: isAttachment,
                                  filePersonaName: attachmentSection?.personaName ?? undefined,
                                  globalPersonas: globalPersonas,
                                  localPersonas: localPersonas,
                                  onSelect: (pId: string) => changePersona(instanceId, pId),
                                }}
                              />
                            }
                            rightHeader={
                              <>
                                {isPersona && (
                                  <button
                                    onClick={() => openFullscreenEditor(instanceId)}
                                    className="entry-creator__icon-button mr-1 p-0.5 text-text-muted transition-colors"
                                    title="Open fullscreen editor"
                                  >
                                    <Expand className="h-3.5 w-3.5" />
                                  </button>
                                )}

                                {persona && !isLocalPersona(persona) && (
                                  <button
                                    onClick={() => toggleSectionKind(instanceId)}
                                    className="entry-creator__icon-button mr-1 p-0.5 text-text-muted transition-colors"
                                    title={
                                      isAttachment
                                        ? "Switch to Text Editor"
                                        : "Switch to Attachments"
                                    }
                                  >
                                    {isAttachment ? (
                                      <Type className="h-3.5 w-3.5" />
                                    ) : (
                                      <Paperclip className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                )}

                                <button
                                  onClick={() => requestRemoveSection(instanceId)}
                                  className="entry-creator__icon-button entry-creator__icon-button--danger p-0.5 text-text-muted transition-colors"
                                  title="Remove this section"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </>
                            }
                            contentClassName="space-y-1"
                          >
                            {/* BODY CONTENT */}
                            {isPersona ? (
                              renderPersonaEditor(
                                instanceId,
                                section.personaId,
                                persona?.name ?? null,
                              )
                            ) : (
                              /* FILE ATTACHMENTS BLOCK */
                              <div className="p-2">
                                <FileAttachmentsSection
                                  items={effectiveAttachments.map(
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
                                      const thumbnailStatus =
                                        docDetail?.thumbnail_status ?? null;
                                      const canOpenParsed =
                                        importStatus === "completed" &&
                                        !!attachment.documentId;
                                      const progressPercent =
                                        latestJob?.progress_percent ?? 0;

                                      return {
                                        keyId:
                                          attachment.documentId ||
                                          attachment.fileHash ||
                                          attachment.titleSnapshot,
                                        variant: "log" as const,
                                        title: attachment.titleSnapshot,
                                        subtitle: `${
                                          attachment.pageCount > 0
                                            ? `${attachment.pageCount} pages`
                                            : "File"
                                        }${attachment.author ? ` • ${attachment.author}` : ""}`,
                                        documentId:
                                          attachment.documentId ??
                                          docDetail?.id ??
                                          null,
                                        storagePath: attachment.storagePath,
                                        thumbnailPath:
                                          attachment.thumbnailPath ??
                                          docDetail?.thumbnail_path ??
                                          null,
                                        thumbnailStatus,
                                        importStatus: importStatus ?? null,
                                        progressPercent,
                                        progressMessage:
                                          latestJob?.progress_message,
                                        previewUrl: attachment.previewUrl,
                                        canOpenParsed,
                                        displayMode:
                                          attachmentSection?.displayMode,
                                        onPreviewFile: () =>
                                          openAttachmentPreview(
                                            attachment,
                                            importStatus,
                                            "file",
                                          ),
                                        onPreviewParsed: () =>
                                          openAttachmentPreview(
                                            attachment,
                                            importStatus,
                                            "parsed",
                                          ),
                                        onRemove: () =>
                                          removeFileAttachment(
                                            instanceId,
                                            attachment,
                                            attachmentIndex,
                                            attachmentsSource,
                                          ),
                                      };
                                    },
                                  )}
                                  canUpload
                                  isUploading={section.isUploading}
                                  isDragOver={
                                    dragOverAttachmentInstanceId === instanceId
                                  }
                                  emptyStateMessage="Drop or attach one or more files to start building this section."
                                  onUploadFiles={(files) =>
                                    queueFilesForAttachmentSection(
                                      instanceId,
                                      files,
                                    )
                                  }
                                  onOpenLibrary={() => {
                                    setAttachmentManagerTargetInstanceId(
                                      instanceId,
                                    );
                                  }}
                                  onDragEnter={(event) => {
                                    if (event.dataTransfer.types.includes("Files")) {
                                      setDragOverAttachmentInstanceId(instanceId);
                                    }
                                  }}
                                  onDragOver={(event) => {
                                    if (!event.dataTransfer.types.includes("Files")) {
                                      return;
                                    }
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "copy";
                                    if (dragOverAttachmentInstanceId !== instanceId) {
                                      setDragOverAttachmentInstanceId(instanceId);
                                    }
                                  }}
                                  onDragLeave={(event) => {
                                    if (
                                      event.currentTarget.contains(
                                        event.relatedTarget as Node | null,
                                      )
                                    ) {
                                      return;
                                    }
                                    setDragOverAttachmentInstanceId((current) =>
                                      current === instanceId ? null : current,
                                    );
                                  }}
                                  onDrop={async (event) => {
                                    if (!event.dataTransfer.files.length) return;
                                    event.preventDefault();
                                    setDragOverAttachmentInstanceId((current) =>
                                      current === instanceId ? null : current,
                                    );
                                    await queueFilesForAttachmentSection(
                                      instanceId,
                                      event.dataTransfer.files,
                                    );
                                  }}
                                  notes={
                                    <div className="pt-2">
                                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                                        Attachment Notes
                                      </div>
                                      <div className="section-editor-surface">
                                        <MarkdownEditor
                                          initialContent={getDraftContent(instanceId)}
                                          initialMarkdown={getDraftMarkdown(instanceId)}
                                          onChange={(content, markdown) => {
                                            handleAttachmentNotesChange(
                                              instanceId,
                                              content,
                                              markdown,
                                            );
                                          }}
                                          placeholder="Add one note for all attached files..."
                                        />
                                      </div>
                                    </div>
                                  }
                                />
                              </div>
                            )}
                          </SectionPreset>
                        )}
                      </SortableSection>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {/* Footer — commit action */}
          {sections.length > 0 && !fullscreenSectionId && (
            <div className="entry-creator__footer flex items-center justify-between p-1">
              <div className="flex min-w-0 items-center gap-2 text-[10px] text-text-muted">
                  <kbd className="entry-creator__shortcut border px-1 py-0.5 text-[9px] font-mono">
                  ⌘+Enter
                </kbd>
                <span className="text-text-muted">→</span>
                <span className="entry-creator__branch-pill inline-flex min-w-0 items-center gap-1 border px-1.5 py-0.5">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="truncate font-medium">
                    {selectedBranch || "main"}
                  </span>
                </span>
                <span className="hidden items-center gap-1 text-text-muted sm:inline-flex">
                  <GitCommitHorizontal className="h-3 w-3 shrink-0" />
                  {currentBranchHeadId
                    ? `tip ${shortHash(currentBranchHeadId)}`
                    : currentBranchRecord
                      ? "no commits yet"
                      : "creates branch on commit"}
                </span>
              </div>
              {commitBlockedByFileAttachmentStatus && (
                <div className="entry-creator__warning inline-flex items-center gap-2 ml-3 border px-2 py-0.5 text-[11px]">
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
                      ? "Checking Attachments"
                      : `${unparsedAttachedCount} attachment${unparsedAttachedCount === 1 ? "" : "s"} not ready`}
                  </span>
                </div>
              )}
              <button
                onClick={handleCommit}
                disabled={isCommitDisabled}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
                  !isCommitDisabled
                    ? "bg-action-primary-bg text-white hover:bg-action-primary-hover"
                    : "bg-surface-subtle text-text-muted cursor-not-allowed"
                }`}
              >
                <Send className="h-3 w-3" />
                Commit Entry
              </button>
            </div>
          )}
          </div>
        </ThreadFrame>

        <Dialog
          open={Boolean(activeFullscreenSection)}
          onClose={closeFullscreenEditor}
          className="relative z-120"
        >
          <div className="fixed inset-0 bg-surface-overlay" />
          <div className="fixed inset-0">
            <DialogPanel className="entry-creator-fullscreen flex h-full w-full flex-col overflow-hidden bg-surface-dark text-text-default">
              <div className="entry-creator-fullscreen__chrome flex items-center gap-2 px-3 pt-2">
                <div className="entry-creator-fullscreen__tabs scrollbar-hide flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
                  {fullscreenPersonaSections.map((section) => {
                    const isActive = section.instanceId === activeFullscreenSection?.instanceId;
                    return (
                      <button
                        key={section.instanceId}
                        type="button"
                        onClick={() => setFullscreenSectionId(section.instanceId)}
                        className={`entry-creator-fullscreen__tab group min-w-36 border border-b-0 px-3 py-2 text-left transition-colors ${
                          isActive
                            ? "entry-creator-fullscreen__tab--active border-border-default bg-surface-default text-text-default"
                            : "border-transparent bg-surface-hover text-text-muted hover:bg-surface-subtle hover:text-text-default"
                        }`}
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                          Section {section.sectionIndex + 1}
                        </div>
                        <div className="truncate text-xs font-medium">
                          {section.persona?.name ?? "Untitled"}
                        </div>
                      </button>
                    );
                  })}
                  {renderAddPersonaMenu({
                    wrapperClassName: "relative shrink-0 self-center",
                    buttonClassName:
                      "entry-creator-fullscreen__tab entry-creator-fullscreen__tab--compact flex h-[2.125rem] w-[2.125rem] min-w-[2.125rem] items-center justify-center border border-b-0 border-transparent bg-surface-hover p-0 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default",
                    buttonTitle: "Add section",
                    compact: true,
                  })}
                </div>
                <button
                  type="button"
                  className="entry-creator__topbar-button entry-creator__topbar-button--icon shrink-0 border p-2 text-text-muted transition-colors"
                  title="Toggle fullscreen: Cmd+Shift+Enter"
                >
                  <Info className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={closeFullscreenEditor}
                  className="entry-creator__topbar-button entry-creator__topbar-button--icon shrink-0 border p-2 text-text-muted transition-colors"
                  title="Exit fullscreen editor"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>

              <div className="entry-creator-fullscreen__body min-h-0 flex-1">
                {activeFullscreenSection ? (
                  <div className="entry-creator-fullscreen__editor-shell h-full w-full bg-surface-default p-1">
                    {renderPersonaEditor(
                      activeFullscreenSection.instanceId,
                      activeFullscreenSection.personaId,
                      activeFullscreenSection.persona?.name ?? null,
                    )}
                  </div>
                ) : null}
              </div>
            </DialogPanel>
          </div>
        </Dialog>

        <DocumentImportModal
          isOpen={!!filePickerTargetInstanceId}
          onClose={() => {
            setFilePickerTargetInstanceId(null);
            setImportModalFiles([]);
          }}
          streamId={streamId}
          onSelectDocument={(document) => {
            if (!filePickerTargetInstanceId) return;
            void attachDocumentToFileAttachmentSection(
              filePickerTargetInstanceId,
              document,
            );
          }}
          initialQueuedFiles={importModalFiles}
        />

        <AttachmentsManager
          isOpen={!!attachmentManagerTargetInstanceId}
          onClose={() => setAttachmentManagerTargetInstanceId(null)}
          userId={streamId}
          onSelectDocument={(document) => {
            if (!attachmentManagerTargetInstanceId) return;
            void attachDocumentToFileAttachmentSection(
              attachmentManagerTargetInstanceId,
              document,
            );
            setAttachmentManagerTargetInstanceId(null);
          }}
        />

        <FileAttachmentPreviewDialog
          open={isAttachmentPreviewOpen}
          onClose={closeAttachmentPreview}
          attachmentPreview={attachmentPreview}
          activePreviewTab={activePreviewTab}
          onActivePreviewTabChange={setActivePreviewTab}
          parsedPreview={parsedPreview}
          parsedPreviewLoading={parsedPreviewLoading}
          parsedPreviewError={parsedPreviewError}
          onAfterLeave={resetAttachmentPreview}
          onRequestParsedPreview={(documentId, titleSnapshot) => {
            void openParsedPreview(documentId, titleSnapshot);
          }}
        />

        {contextMenuPosition &&
          typeof window !== "undefined" &&
          createPortal(
            <div
              ref={contextMenuRef}
              className="fixed z-50 w-64 border border-border-default bg-surface-elevated p-1.5 shadow-lg"
              style={{
                top: contextMenuPosition.top,
                left: contextMenuPosition.left,
              }}
              role="menu"
              aria-label="Entry creator stash menu"
            >
              <div className="px-2 py-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted">
                  working tree
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-text-default">
                  <GitBranch className="h-3.5 w-3.5 text-text-muted" />
                  <span className="truncate">{selectedBranch}</span>
                  <span className="text-text-muted">·</span>
                  <span className="text-text-muted">
                    {sections.length} section{sections.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              <div className="my-1 h-px bg-border-subtle" />

              <button
                type="button"
                onClick={() => {
                  stashCurrentDraft();
                  setContextMenuPosition(null);
                }}
                disabled={!hasCommitableContent}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <Archive className="h-3.5 w-3.5 text-text-muted" />
                Stash changes
              </button>
              <button
                type="button"
                onClick={() => {
                  applyLatestStash(false);
                  setContextMenuPosition(null);
                }}
                disabled={stashItems.length === 0}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <ArchiveRestore className="h-3.5 w-3.5 text-text-muted" />
                Apply latest stash
              </button>
              <button
                type="button"
                onClick={() => {
                  applyLatestStash(true);
                  setContextMenuPosition(null);
                }}
                disabled={stashItems.length === 0}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <RotateCcw className="h-3.5 w-3.5 text-text-muted" />
                Pop latest stash
              </button>

              <div className="my-1 h-px bg-border-subtle" />

              <div className="px-2 py-1 text-[10px] text-text-muted">
                {stashItems.length === 0
                  ? "No stashed drafts"
                  : `${stashItems.length} stashed draft${stashItems.length === 1 ? "" : "s"} available`}
              </div>

              <button
                type="button"
                onClick={() => {
                  dropLatestStash();
                  setContextMenuPosition(null);
                }}
                disabled={stashItems.length === 0}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <Trash2 className="h-3.5 w-3.5 text-text-muted" />
                Drop latest stash
              </button>
              <button
                type="button"
                onClick={() => {
                  clearAllStashes();
                  setContextMenuPosition(null);
                }}
                disabled={stashItems.length === 0}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <Trash2 className="h-3.5 w-3.5 text-text-muted" />
                Clear stash stack
              </button>
              <button
                type="button"
                onClick={async () => {
                  const latest = stashItems[0];
                  if (!latest) return;
                  await navigator.clipboard.writeText(JSON.stringify(latest, null, 2));
                  setContextMenuPosition(null);
                }}
                disabled={stashItems.length === 0}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
              >
                <Copy className="h-3.5 w-3.5 text-text-muted" />
                Copy latest stash payload
              </button>
            </div>,
            document.body,
          )}
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
        open={!!sectionToRemove}
        title="Delete this section?"
        description="This removes the current section and cannot be undone."
        confirmLabel="Delete section"
        cancelLabel="Cancel"
        destructive
        onCancel={() => setSectionToRemove(null)}
        onConfirm={confirmRemoveSection}
      />
    </>
  );
}
