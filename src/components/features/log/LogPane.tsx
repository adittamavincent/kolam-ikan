"use client";

import {
  useState,
  Fragment,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useLayoutEffect,
} from "react";
import { useEntries } from "@/lib/hooks/useEntries";
import { useDocuments } from "@/lib/hooks/useDocuments";
import { EntryCreator } from "./EntryCreator";
import { LogSection } from "./LogSection";
import {
  FileAttachmentPreviewData,
  FileAttachmentPreviewDialog,
  ParsedPreviewData,
} from "./FileAttachmentPreviewDialog";
import { CanvasSnapshotCard } from "./CanvasSnapshotCard";
import { CanvasDraftCard } from "./CanvasDraftCard";
import { MergeCommitCard } from "./MergeCommitCard";
import { StashDialog } from "./StashDialog";
import { useStream } from "@/lib/hooks/useStream";
import { useTimelineItems } from "@/lib/hooks/useTimelineItems";
import { CommitGraph } from "./CommitGraph";
import {
  Calendar,
  Check,
  X,
  PencilLine,
  Loader2,
  Copy,
  RotateCcw,
  Trash2,
  GitCommitHorizontal,
  Undo2,
  ChevronsDown,
  Archive,
  GitCompare,
  Eye,
  EyeOff,
  Tag,
  GitBranch,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { createPortal } from "react-dom";
import { exportEntriesToMarkdown, downloadMarkdown } from "@/lib/utils/export";
import { EntryWithSections, SectionFileAttachmentWithDocument } from "@/lib/types";
import { calculateFileHash } from "@/lib/utils/hash";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { PartialBlock } from "@/lib/types/editor";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TextInputDialog } from "@/components/shared/TextInputDialog";
import { ThreadFrame } from "@/components/shared/SectionPreset";
import { useUiPreferencesStore } from "@/lib/hooks/useUiPreferencesStore";
import {
  cloneStoredContentFields,
  storedContentToMarkdown,
} from "@/lib/content-protocol";
import {
  buildCommittedEntryStashItem,
  CommittedEntryStashItem,
  EntryCreatorStashItem,
  readCommittedEntryStash,
  readEntryCreatorStash,
  subscribeToStashChanges,
  writeCommittedEntryStash,
} from "@/lib/utils/stash";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract plain text from stored markdown content for diffing / copying. */
function extractText(entry: EntryWithSections): string {
  return (entry.sections ?? [])
    .map((s) => {
      const blocks =
        (s.content_json as unknown as Array<{
          content?: Array<{ text?: string }>;
        }>) ?? [];
      return blocks
        .map((b) => b.content?.map((c) => c.text ?? "").join("") ?? "")
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/** Short hash like git — first 7 chars of the UUID (stripped of dashes) */
function shortHash(id: string): string {
  return id.replace(/-/g, "").slice(0, 7);
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

function compareBranchNames(a: string, b: string): number {
  if (a === "main") return -1;
  if (b === "main") return 1;
  return a.localeCompare(b);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countSearchOccurrences(source: string, term: string): number {
  const normalizedTerm = term.trim();
  if (!normalizedTerm) return 0;
  const matches = source.match(new RegExp(escapeRegExp(normalizedTerm), "gi"));
  return matches?.length ?? 0;
}

function getTimelineItemCollapseKey(item: { type: "entry" | "canvas_snapshot"; data: { id: string } }): string {
  return `${item.type}:${item.data.id}`;
}

type EntryConfirmType = "reset" | "delete";
type BranchRecord = {
  id: string;
  name: string;
  head_commit_id: string | null;
};
type MergeSourceEntry = Pick<EntryWithSections, "id" | "created_at"> & {
  sections: Array<
    Pick<
      EntryWithSections["sections"][number],
      | "id"
      | "persona_id"
      | "persona_name_snapshot"
      | "content_json"
      | "raw_markdown"
      | "content_format"
      | "section_type"
      | "file_display_mode"
      | "sort_order"
      | "section_attachments"
    >
  >;
};
type BranchDialogState =
  | {
      mode: "create";
      title: string;
      description: string;
      confirmLabel: string;
      initialName: string;
      targetHeadCommitId: string | null;
      switchToCreatedBranch?: boolean;
    }
  | {
      mode: "rename";
      title: string;
      description: string;
      confirmLabel: string;
      initialName: string;
      branchId: string;
      currentName: string;
    };

function isParsedReadyStatus(status?: string | null): boolean {
  return status === "completed" || status === "done";
}

/** Compute line-level diff between two strings; returns array of diff lines */
type DiffLine = { type: "eq" | "add" | "del"; text: string };
function lineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = m,
    j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "eq", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: "del", text: oldLines[i - 1] });
      i--;
    }
  }
  return result;
}

const EMPTY_COLLAPSED_ITEM_IDS: string[] = [];

// ─── Git Diff Modal ──────────────────────────────────────────────────────────

interface DiffModalProps {
  entry: EntryWithSections;
  prevEntry: EntryWithSections | null;
  onClose: () => void;
}

function DiffModal({ entry, prevEntry, onClose }: DiffModalProps) {
  const newText = extractText(entry);
  const oldText = prevEntry ? extractText(prevEntry) : "";
  const diffs = lineDiff(oldText, newText);

  const additions = diffs.filter((d) => d.type === "add").length;
  const deletions = diffs.filter((d) => d.type === "del").length;

  return (
    <>
      <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-surface-dark"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col border border-border-default bg-surface-default"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-text-muted" />
            <span className="text-sm font-semibold text-text-default">
              git diff
            </span>
            <code className="text-[11px] bg-surface-subtle text-text-muted px-1.5 py-0.5 font-mono">
              {prevEntry ? shortHash(prevEntry.id) : "0000000"}..
              {shortHash(entry.id)}
            </code>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-diff-add-text">
              +{additions}
            </span>
            <span className="text-[11px] font-mono text-diff-del-text">
              -{deletions}
            </span>
            <button
              onClick={onClose}
              className=" p-1 text-text-muted hover:bg-surface-subtle"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Diff body */}
        <div className="overflow-y-auto flex-1 font-mono text-[11px] ">
          {!prevEntry && (
            <div className="px-4 py-3 text-text-muted text-xs italic border-b border-border-default">
              No parent commit found. Showing the full commit content as additions.
            </div>
          )}
          {diffs.length === 0 ? (
            <div className="px-4 py-6 text-center text-text-muted text-xs">
              No differences
            </div>
          ) : (
            diffs.map((line, i) => (
              <div
                key={i}
                className={`flex gap-3 px-4 py-0.5 leading-5 ${
                  line.type === "add"
                    ? "bg-diff-add-bg text-diff-add-text"
                    : line.type === "del"
                      ? "bg-diff-del-bg text-diff-del-text line-through opacity-70"
                      : "text-text-subtle"
                }`}
              >
                <span className="select-none w-3 shrink-0 text-text-muted opacity-60">
                  {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                </span>
                <span className="whitespace-pre-wrap wrap-break-word">
                  {line.text || " "}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  </>
  );
}

// ─── Tag Modal ───────────────────────────────────────────────────────────────

interface TagModalProps {
  entryId: string;
  currentTag: string | null;
  onSave: (tag: string | null) => void;
  onClose: () => void;
}

function TagModal({ entryId, currentTag, onSave, onClose }: TagModalProps) {
  const [value, setValue] = useState(currentTag ?? "");
  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-surface-dark"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xs border border-border-default bg-surface-default p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Tag className="h-4 w-4 text-text-muted" />
          <span className="text-sm font-semibold text-text-default">
            git tag
          </span>
          <code className="text-[11px] bg-surface-subtle text-text-muted px-1.5 py-0.5 font-mono">
            {shortHash(entryId)}
          </code>
        </div>
        <input
          autoFocus
          type="text"
          placeholder="e.g. v1.0.0, milestone-A"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSave(value.trim() || null);
              onClose();
            }
            if (e.key === "Escape") onClose();
          }}
          className="w-full border border-border-default bg-surface-subtle px-3 py-1.5 text-xs text-text-default focus:border-border-default focus: focus: focus: mb-3"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className=" border border-border-default px-3 py-1.5 text-xs font-semibold text-text-default hover:bg-surface-subtle"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(value.trim() || null);
              onClose();
            }}
            className=" bg-action-primary-bg px-3 py-1.5 text-xs font-semibold text-action-primary-text hover:opacity-90"
          >
            Save Tag
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AmendState {
  entryId: string;
  sections: Record<
    string,
    {
      content?: PartialBlock[];
      markdown?: string;
      attachments?: SectionFileAttachmentWithDocument[];
    }
  >;
}

function serializeAttachments(
  attachments: SectionFileAttachmentWithDocument[] | undefined,
): string {
  return JSON.stringify(
    (attachments ?? []).map((attachment) => ({
      id: attachment.id,
      document_id: attachment.document_id,
      title_snapshot: attachment.title_snapshot,
      annotation_text: attachment.annotation_text,
      referenced_persona_id: attachment.referenced_persona_id,
      referenced_page: attachment.referenced_page,
      sort_order: attachment.sort_order,
    })),
  );
}

interface LogPaneProps {
  streamId: string;
  logWidth: number;
  forceWidth?: number;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

// ─── LogPane ─────────────────────────────────────────────────────────────────

export function LogPane({ streamId, logWidth, forceWidth }: LogPaneProps) {
  const queryClient = useQueryClient();
  const supabase = createClient();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterPersonaId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [highlightSectionId, setHighlightSectionId] = useState<string | null>(null);
  const [revealItemKey, setRevealItemKey] = useState<string | null>(null);
  const [animatedItemKey, setAnimatedItemKey] = useState<string | null>(null);
  const [activeOccurrenceIndex, setActiveOccurrenceIndex] = useState<number | null>(null);
  const [amendState, setAmendState] = useState<AmendState | null>(null);
  const [amendError, setAmendError] = useState<string | null>(null);
  const [uploadingAmendSectionIds, setUploadingAmendSectionIds] = useState<
    Set<string>
  >(new Set());
  const [contextMenu, setContextMenu] = useState<{
    entry: EntryWithSections;
    x: number;
    y: number;
  } | null>(null);
  const [diffTarget, setDiffTarget] = useState<{
    entry: EntryWithSections;
    prevEntry: EntryWithSections | null;
  } | null>(null);
  const [tagTarget, setTagTarget] = useState<EntryWithSections | null>(null);
  const [committedStashes, setCommittedStashes] = useState<CommittedEntryStashItem[]>([]);
  const [draftStashes, setDraftStashes] = useState<EntryCreatorStashItem[]>([]);
  const [isStashDialogOpen, setIsStashDialogOpen] = useState(false);
  const [pendingDraftStashAction, setPendingDraftStashAction] = useState<{
    nonce: string;
    stashId: string;
    kind: "apply" | "pop" | "drop";
  } | null>(null);
  const [tags, setTags] = useState<Record<string, string>>({}); // entryId → tag label
  const [currentBranch, setCurrentBranch] = useState("main");
  const [graphView, setGraphView] = useState(false);
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({
    left: 0,
    top: 0,
  });
  const [entryConfirm, setEntryConfirm] = useState<{
    type: EntryConfirmType;
    entry: EntryWithSections;
  } | null>(null);
  const [attachmentPreview, setAttachmentPreview] =
    useState<FileAttachmentPreviewData | null>(null);
  const [isAttachmentPreviewOpen, setIsAttachmentPreviewOpen] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<"file" | "parsed">(
    "file",
  );
  const [parsedPreview, setParsedPreview] = useState<ParsedPreviewData | null>(
    null,
  );
  const [parsedPreviewLoading, setParsedPreviewLoading] = useState(false);
  const [parsedPreviewError, setParsedPreviewError] = useState<string | null>(
    null,
  );
  const [branchDialog, setBranchDialog] = useState<BranchDialogState | null>(null);
  const [branchDialogName, setBranchDialogName] = useState("");
  const [branchDialogError, setBranchDialogError] = useState<string | null>(null);
  const [branchDialogLoading, setBranchDialogLoading] = useState(false);
  const [mergeConfirm, setMergeConfirm] = useState<{
    sourceBranchName: string;
    targetBranchName: string;
    sourceHeadId: string;
    mode: "fast-forward" | "commit";
  } | null>(null);
  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    const syncStashes = () => {
      setCommittedStashes(readCommittedEntryStash(streamId));
      setDraftStashes(readEntryCreatorStash(streamId));
    };

    syncStashes();
    return subscribeToStashChanges(streamId, syncStashes);
  }, [streamId]);

  const stashedEntryIds = useMemo(
    () => new Set(committedStashes.map((stash) => stash.entryId)),
    [committedStashes],
  );

  const applySearchHighlightPayload = useCallback(
    (
      rawPayload:
        | string
        | {
            term: string;
            target: "log" | "canvas";
            itemId?: string | null;
            entryId?: string | null;
            streamId?: string;
          },
    ) => {
      try {
        const payload =
          typeof rawPayload === "string"
            ? (JSON.parse(rawPayload) as {
                term: string;
                target: "log" | "canvas";
                itemId?: string | null;
                entryId?: string | null;
                streamId?: string;
              })
            : rawPayload;

        if (payload.streamId !== streamId) return;

        setSearchTerm(payload.term);
        setHighlightTerm(payload.term);
        setHighlightEntryId(payload.entryId ?? null);
        setHighlightSectionId(
          payload.target === "log" ? (payload.itemId ?? null) : null,
        );

        if (payload.target === "log" && payload.entryId) {
          setRevealItemKey(`entry:${payload.entryId}`);
        } else if (payload.target === "canvas" && payload.itemId) {
          setRevealItemKey(`canvas_snapshot:${payload.itemId}`);
        }
      } finally {
      }
    },
    [streamId],
  );

  useEffect(() => {
    const raw = sessionStorage.getItem("kolam_search_highlight");
    if (!raw) return;
    applySearchHighlightPayload(raw);
    sessionStorage.removeItem("kolam_search_highlight");
  }, [applySearchHighlightPayload]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onSearchHighlight = (
      event: Event,
    ) => {
      const detail = (
        event as CustomEvent<{
          term: string;
          target: "log" | "canvas";
          itemId?: string | null;
          entryId?: string | null;
          streamId?: string;
        }>
      ).detail;
      applySearchHighlightPayload(detail);
    };

    window.addEventListener(
      "kolam_search_highlight",
      onSearchHighlight as EventListener,
    );

    return () => {
      window.removeEventListener(
        "kolam_search_highlight",
        onSearchHighlight as EventListener,
      );
    };
  }, [applySearchHighlightPayload]);

  const scrollToHighlighted = useCallback(() => {
    const sectionRef = highlightSectionId
      ? sectionRefs.current[highlightSectionId]
      : null;
    const targetKey =
      revealItemKey ?? (highlightEntryId ? `entry:${highlightEntryId}` : null);
    const ref = sectionRef ?? (targetKey ? entryRefs.current[targetKey] : null);
    if (ref) ref.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightEntryId, highlightSectionId, revealItemKey]);

  const { data: branchRowsForMutations } = useQuery({
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

  const currentBranchForMutations =
    branchRowsForMutations?.find((branch) => branch.name === currentBranch) ?? null;

  const {
    items: entryList,
    isLoading: isEntriesLoading,
    isFetching: isEntriesFetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    amendEntry,
    deleteEntry,
    resetToEntry,
    duplicateEntry,
    revertEntry,
    fetchAllEntriesForExport,
  } = useEntries(streamId, {
    branchId: currentBranchForMutations?.id ?? null,
    parentEntryId: currentBranchForMutations?.head_commit_id ?? null,
    search: "",
    personaId: filterPersonaId,
    sortOrder,
  });

  const handleConfirmEntryAction = () => {
    if (!entryConfirm) return;
    const { type, entry } = entryConfirm;
    setEntryConfirm(null);
    if (type === "reset") {
      resetToEntry.mutate(entry);
    } else {
      deleteEntry.mutate(entry.id);
    }
  };

  const { stream } = useStream(streamId);
  const { createImport } = useDocuments(streamId);
  const { timelineItems } = useTimelineItems(streamId, entryList, {
    sortOrder,
  });
  const collapsedEntryIdList = useUiPreferencesStore((state) => {
    return state.logCollapsedItemIdsByStream[streamId] ?? EMPTY_COLLAPSED_ITEM_IDS;
  });
  const collapsedEntryIds = useMemo(
    () => new Set(collapsedEntryIdList),
    [collapsedEntryIdList],
  );
  const setCollapsedLogItemsForStream = useUiPreferencesStore(
    (state) => state.setCollapsedLogItemsForStream,
  );
  const removeCollapsedLogItem = useUiPreferencesStore(
    (state) => state.removeCollapsedLogItem,
  );
  const toggleCollapsedLogItem = useUiPreferencesStore(
    (state) => state.toggleCollapsedLogItem,
  );
  const pruneCollapsedLogItemsForStream = useUiPreferencesStore(
    (state) => state.pruneCollapsedLogItemsForStream,
  );

  const { data: latestEntryId } = useQuery({
    queryKey: ["latest-entry-id", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entries")
        .select("id")
        .eq("stream_id", streamId)
        .eq("is_draft", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.id ?? null;
    },
    enabled: !!streamId,
  });

  const handleParsedPreview = useCallback(
    async (documentId: string, titleSnapshot: string) => {
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

      if (!data?.extracted_markdown || !isParsedReadyStatus(data.import_status)) {
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
    },
    [supabase],
  );

  const handleAttachmentPreview = useCallback(
    async (
      attachment: SectionFileAttachmentWithDocument,
      preferredTab?: "file" | "parsed",
    ) => {
      const importStatus =
        attachment.document?.import_status ??
        attachment.document?.latestJob?.status ??
        undefined;
      const documentId = attachment.document_id ?? attachment.document?.id;
      const title =
        attachment.title_snapshot ||
        attachment.document?.title ||
        "Attached File";

      let previewUrl: string | null = null;
      const storagePath = attachment.document?.storage_path;
      if (storagePath) {
        const signed = await supabase.storage
          .from("document-files")
          .createSignedUrl(storagePath, 60 * 30);
        if (!signed.error && signed.data?.signedUrl) {
          previewUrl = signed.data.signedUrl;
        }
      }

      const nextTab =
        preferredTab ??
        (isParsedReadyStatus(importStatus) && documentId ? "parsed" : "file");

      setAttachmentPreview({
        documentId,
        title,
        previewUrl,
        importStatus,
      });
      setIsAttachmentPreviewOpen(true);
      setActivePreviewTab(nextTab);
      setParsedPreview(null);
      setParsedPreviewError(null);

      if (nextTab === "parsed" && documentId) {
        void handleParsedPreview(documentId, title);
      }
    },
    [handleParsedPreview, supabase],
  );

  const closeAttachmentPreview = useCallback(() => {
    if (parsedPreviewLoading) return;
    setIsAttachmentPreviewOpen(false);
  }, [parsedPreviewLoading]);

  const resetAttachmentPreview = useCallback(() => {
    setAttachmentPreview(null);
    setParsedPreview(null);
    setParsedPreviewError(null);
    setActivePreviewTab("file");
  }, []);

  const openAttachmentPreview = useCallback(
    (attachment: SectionFileAttachmentWithDocument, tab: "file" | "parsed") => {
      void handleAttachmentPreview(attachment, tab);
    },
    [handleAttachmentPreview],
  );

  const buildAmendAttachment = useCallback(
    async (
      documentId: string,
      titleSnapshot: string,
    ): Promise<SectionFileAttachmentWithDocument | null> => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("id", documentId)
        .single();

      if (error || !data) {
        throw error ?? new Error("Failed to load uploaded document");
      }

      let previewUrl: string | null = null;
      if (data.storage_path) {
        const signed = await supabase.storage
          .from("document-files")
          .createSignedUrl(data.storage_path, 60 * 30);

        if (!signed.error && signed.data?.signedUrl) {
          previewUrl = signed.data.signedUrl;
        }
      }

      return {
        id: `draft-${documentId}`,
        section_id: "",
        document_id: data.id,
        sort_order: 0,
        title_snapshot: titleSnapshot || data.title || "File Attachment",
        annotation_text: null,
        referenced_persona_id: null,
        referenced_page: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        document: {
          ...data,
          latestJob: null,
          fileUrl: previewUrl,
        },
      };
    },
    [supabase],
  );

  const handleAddAmendAttachments = useCallback(
    async (
      sectionId: string,
      currentAttachments: SectionFileAttachmentWithDocument[],
      fileList: FileList | File[],
    ) => {
      const files = Array.from(fileList).filter((file) => file instanceof File);
      if (files.length === 0) return;

      setUploadingAmendSectionIds((prev) => new Set(prev).add(sectionId));

      try {
        const nextAttachments = [...currentAttachments];

        for (const file of files) {
          const fileHash = await calculateFileHash(file).catch(() => undefined);
          const result = await createImport.mutateAsync({
            file,
            title: file.name,
            flavor: "stream",
            enableTableStructure: true,
            debugDoclingTables: false,
            fileHash,
          });

          const documentId = result?.documentId ?? result?.document?.id;
          if (!documentId) {
            throw new Error(result?.error ?? "Failed to import attachment");
          }

          if (
            nextAttachments.some(
              (attachment) => attachment.document_id === documentId,
            )
          ) {
            continue;
          }

          const nextAttachment = await buildAmendAttachment(documentId, file.name);
          if (nextAttachment) {
            nextAttachments.push(nextAttachment);
          }
        }

        setAmendState((prev) => {
          if (!prev) return prev;

          return {
            ...prev,
            sections: {
              ...prev.sections,
              [sectionId]: {
                ...prev.sections[sectionId],
                attachments: nextAttachments,
              },
            },
          };
        });
      } catch (error) {
        setAmendError(
          error instanceof Error ? error.message : "Failed to add attachments",
        );
      } finally {
        setUploadingAmendSectionIds((prev) => {
          const next = new Set(prev);
          next.delete(sectionId);
          return next;
        });
      }
    },
    [buildAmendAttachment, createImport],
  );

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

  const { data: entryLineage, isLoading: isEntryLineageLoading } = useQuery({
    queryKey: ["entries-lineage", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entries")
        .select("id,parent_commit_id,merge_source_commit_id,created_at")
        .eq("stream_id", streamId)
        .eq("is_draft", false)
        .is("deleted_at", null);
      if (error) throw error;
      return data;
    },
    enabled: !!streamId,
  });

  const currentBranchRecord = useMemo(
    () => branches?.find((branch) => branch.name === currentBranch) ?? null,
    [branches, currentBranch],
  );

  const entryLineageById = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        parent_commit_id: string | null;
        merge_source_commit_id: string | null;
        created_at: string | null;
      }
    >();

    for (const entry of entryLineage ?? []) {
      map.set(entry.id, entry);
    }

    return map;
  }, [entryLineage]);

  const currentBranchHeadId =
    currentBranchRecord?.head_commit_id ??
    (currentBranch === "main" ? latestEntryId ?? null : null);

  const currentBranchHeadEntry = currentBranchHeadId
    ? entryLineageById.get(currentBranchHeadId) ?? null
    : null;

  const isCommitAncestorOf = useCallback(
    (ancestorId: string | null, descendantId: string | null) => {
      if (!ancestorId || !descendantId) return false;

      const visited = new Set<string>();
      const stack: string[] = [descendantId];

      while (stack.length > 0) {
        const cursor = stack.pop() ?? null;
        if (!cursor || visited.has(cursor)) continue;
        if (cursor === ancestorId) return true;

        visited.add(cursor);
        const entry = entryLineageById.get(cursor);
        if (entry?.parent_commit_id) stack.push(entry.parent_commit_id);
        if (entry?.merge_source_commit_id) stack.push(entry.merge_source_commit_id);
      }

      return false;
    },
    [entryLineageById],
  );

  const refreshBranchState = useCallback(async () => {
    await Promise.all([
      refetchBranches(),
      queryClient.invalidateQueries({ queryKey: ["graph-branches", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["entries-lineage", streamId] }),
    ]);
  }, [queryClient, refetchBranches, streamId]);

  const handleCheckoutBranch = useCallback(
    (branchName: string) => {
      setCurrentBranch(branchName);
    },
    [setCurrentBranch],
  );

  const openCreateBranchDialog = useCallback(
    (options?: {
      initialName?: string;
      targetHeadCommitId?: string | null;
      switchToCreatedBranch?: boolean;
    }) => {
      const initialName =
        options?.initialName?.trim() || `${currentBranch || "main"}-new`;
      setBranchDialog({
        mode: "create",
        title: "Create branch",
        description: "Create a new branch pointer from the selected commit.",
        confirmLabel: "Create branch",
        initialName,
        targetHeadCommitId:
          options?.targetHeadCommitId === undefined
            ? currentBranchHeadId
            : options.targetHeadCommitId,
        switchToCreatedBranch: options?.switchToCreatedBranch ?? true,
      });
      setBranchDialogName(initialName);
      setBranchDialogError(null);
    },
    [currentBranch, currentBranchHeadId],
  );

  const openRenameBranchDialog = useCallback((branchId: string, branchName: string) => {
    setBranchDialog({
      mode: "rename",
      title: "Rename branch",
      description: "Update the branch name shown across the log and graph.",
      confirmLabel: "Rename branch",
      initialName: branchName,
      branchId,
      currentName: branchName,
    });
    setBranchDialogName(branchName);
    setBranchDialogError(null);
  }, []);

  const closeBranchDialog = useCallback(() => {
    if (branchDialogLoading) return;
    setBranchDialog(null);
    setBranchDialogName("");
    setBranchDialogError(null);
  }, [branchDialogLoading]);

  const handleSubmitBranchDialog = useCallback(async () => {
    if (!branchDialog) return;

    const nextName = branchDialogName.trim();
    if (!nextName) {
      setBranchDialogError("Branch name is required.");
      return;
    }

    setBranchDialogLoading(true);
    setBranchDialogError(null);

    try {
      if (branchDialog.mode === "create") {
        const existingBranch =
          branches?.find((branch) => branch.name === nextName) ?? null;

        if (existingBranch) {
          if (branchDialog.switchToCreatedBranch !== false) {
            setCurrentBranch(existingBranch.name);
          }
          setBranchDialog(null);
          setBranchDialogName("");
          setBranchDialogError(null);
          return;
        }

        const { error } = await supabase.from("branches").insert({
          stream_id: streamId,
          name: nextName,
          head_commit_id: branchDialog.targetHeadCommitId,
        });

        if (error) throw error;

        await refreshBranchState();
        if (branchDialog.switchToCreatedBranch !== false) {
          setCurrentBranch(nextName);
        }
      } else {
        const existingBranch =
          branches?.find(
            (branch) =>
              branch.name === nextName && branch.id !== branchDialog.branchId,
          ) ?? null;

        if (existingBranch) {
          setBranchDialogError(`Branch "${nextName}" already exists.`);
          return;
        }

        if (nextName !== branchDialog.currentName) {
          const { error } = await supabase
            .from("branches")
            .update({ name: nextName })
            .eq("id", branchDialog.branchId);

          if (error) throw error;

          await refreshBranchState();
          if (currentBranch === branchDialog.currentName) {
            setCurrentBranch(nextName);
          }
        }
      }

      setBranchDialog(null);
      setBranchDialogName("");
      setBranchDialogError(null);
    } catch (error) {
      const message = getSupabaseErrorMessage(error);
      console.error("Failed to save branch dialog:", message, error);
      setBranchDialogError(message);
    } finally {
      setBranchDialogLoading(false);
    }
  }, [
    branchDialog,
    branchDialogName,
    branches,
    currentBranch,
    refreshBranchState,
    streamId,
    supabase,
  ]);

  const handleRenameBranch = useCallback(
    async (branchId: string, branchName: string) => {
      openRenameBranchDialog(branchId, branchName);
    },
    [openRenameBranchDialog],
  );

  const invalidateAfterMergeCommit = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["entries", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["latest-entry-id", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["entries-xml", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["bridge-entries", streamId] }),
      queryClient.invalidateQueries({
        queryKey: ["bridge-token-entries", streamId],
      }),
      queryClient.invalidateQueries({ queryKey: ["graph-entries", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["branches", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["graph-branches", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["entries-lineage", streamId] }),
      queryClient.invalidateQueries({ queryKey: ["home-domains"] }),
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] }),
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] }),
    ]);
  }, [queryClient, streamId]);

  const loadEntryForMerge = useCallback(
    async (entryId: string) => {
      const { data, error } = await supabase
        .from("entries")
        .select(
          `
            id,
            created_at,
            sections (
              id,
              persona_id,
              persona_name_snapshot,
              content_json,
              raw_markdown,
              content_format,
              section_type,
              file_display_mode,
              sort_order,
              section_attachments (
                document_id,
                sort_order,
                title_snapshot,
                annotation_text,
                referenced_persona_id,
                referenced_page
              )
            )
          `,
        )
        .eq("id", entryId)
        .single();

      if (error) throw error;

      const sourceEntry = data as MergeSourceEntry;
      sourceEntry.sections = [...(sourceEntry.sections ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      );

      return sourceEntry;
    },
    [supabase],
  );

  const createMergedCommitFromSource = useCallback(
    async (sourceEntry: MergeSourceEntry, sourceBranchName: string) => {
      const { data: newEntry, error: entryError } = await supabase
        .from("entries")
        .insert({
          stream_id: streamId,
          parent_commit_id: currentBranchHeadId,
          entry_kind: "merge",
          merge_source_commit_id: sourceEntry.id,
          merge_source_branch_name: sourceBranchName,
          merge_target_branch_name: currentBranch,
        })
        .select("id")
        .single();

      if (entryError || !newEntry) {
        throw entryError ?? new Error("Failed to create merge commit entry");
      }

      const sectionsToInsert = (sourceEntry.sections ?? []).map((section, index) => ({
        entry_id: newEntry.id,
        ...cloneStoredContentFields(section),
        persona_id: section.persona_id,
        persona_name_snapshot: section.persona_name_snapshot,
        section_type: section.section_type,
        file_display_mode: section.file_display_mode,
        sort_order: index,
      }));

      let insertedSections: Array<{ id: string; sort_order: number | null }> = [];

      if (sectionsToInsert.length > 0) {
        const { data, error: sectionsError } = await supabase
          .from("sections")
          .insert(sectionsToInsert)
          .select("id, sort_order");

        if (sectionsError) throw sectionsError;
        insertedSections = data ?? [];
      }

      const attachmentInserts = insertedSections.flatMap((insertedSection) => {
        const sourceSection =
          sourceEntry.sections?.[insertedSection.sort_order ?? 0] ?? null;
        return (
          sourceSection?.section_attachments?.map((attachment, idx) => ({
            section_id: insertedSection.id,
            document_id: attachment.document_id,
            sort_order: idx,
            title_snapshot: attachment.title_snapshot,
            annotation_text: attachment.annotation_text,
            referenced_persona_id: attachment.referenced_persona_id,
            referenced_page: attachment.referenced_page,
          })) ?? []
        );
      });

      if (attachmentInserts.length > 0) {
        const { error: attachmentsError } = await supabase
          .from("section_attachments")
          .insert(attachmentInserts);

        if (attachmentsError) throw attachmentsError;
      }

      if (currentBranchRecord) {
        const { error: branchError } = await supabase
          .from("branches")
          .update({ head_commit_id: newEntry.id })
          .eq("id", currentBranchRecord.id);

        if (branchError) throw branchError;
      }

      return newEntry.id;
    },
    [currentBranch, currentBranchHeadId, currentBranchRecord, streamId, supabase],
  );

  const handleConfirmMerge = useCallback(async () => {
    if (!mergeConfirm) return;

    if (mergeConfirm.mode === "fast-forward") {
      const targetBranch = currentBranchRecord as BranchRecord | null;

      try {
        if (targetBranch) {
          const { error } = await supabase
            .from("branches")
            .update({ head_commit_id: mergeConfirm.sourceHeadId })
            .eq("id", targetBranch.id);

          if (error) throw error;
        } else {
          const { error } = await supabase.from("branches").insert({
            stream_id: streamId,
            name: currentBranch,
            head_commit_id: mergeConfirm.sourceHeadId,
          });

          if (error) throw error;
        }

        await refreshBranchState();
        setMergeConfirm(null);
      } catch (error) {
        const message = getSupabaseErrorMessage(error);
        console.error("Failed to fast-forward branch:", message, error);
        window.alert(`Failed to merge branch: ${message}`);
      }

      return;
    }

    try {
      const sourceEntry = await loadEntryForMerge(mergeConfirm.sourceHeadId);
      await createMergedCommitFromSource(
        sourceEntry,
        mergeConfirm.sourceBranchName,
      );
      await invalidateAfterMergeCommit();
      setMergeConfirm(null);
    } catch (error) {
      const message = getSupabaseErrorMessage(error);
      console.error("Failed to create merge commit:", message, error);
      window.alert(`Failed to merge branch: ${message}`);
    }
  }, [
    createMergedCommitFromSource,
    currentBranch,
    currentBranchRecord,
    invalidateAfterMergeCommit,
    loadEntryForMerge,
    mergeConfirm,
    refreshBranchState,
    streamId,
    supabase,
  ]);

  const handleMergeBranchIntoCurrent = useCallback(
    async (sourceBranchName: string) => {
      if (sourceBranchName === currentBranch) return;

      const sourceBranch =
        (branches?.find((branch) => branch.name === sourceBranchName) as
          | BranchRecord
          | undefined) ?? null;

      if (!sourceBranch) {
        window.alert(`Branch "${sourceBranchName}" was not found.`);
        return;
      }

      const sourceHeadId = sourceBranch.head_commit_id;
      if (!sourceHeadId) {
        window.alert(`Branch "${sourceBranchName}" does not have a head commit yet.`);
        return;
      }

      if (currentBranchHeadId === sourceHeadId) {
        window.alert(`${currentBranch} is already up to date with ${sourceBranchName}.`);
        return;
      }

      if (currentBranchHeadId && isCommitAncestorOf(sourceHeadId, currentBranchHeadId)) {
        window.alert(`${currentBranch} already contains ${sourceBranchName}.`);
        return;
      }

      if (currentBranchHeadId && !isCommitAncestorOf(currentBranchHeadId, sourceHeadId)) {
        setMergeConfirm({
          sourceBranchName,
          targetBranchName: currentBranch,
          sourceHeadId,
          mode: "commit",
        });
        return;
      }
      setMergeConfirm({
        sourceBranchName,
        targetBranchName: currentBranch,
        sourceHeadId,
        mode: "fast-forward",
      });
    },
    [
      branches,
      currentBranch,
      currentBranchHeadId,
      isCommitAncestorOf,
    ],
  );

  const reachableCommitIds = useMemo(() => {
    const ids = new Set<string>();
    const stack = currentBranchHeadId ? [currentBranchHeadId] : [];

    while (stack.length > 0) {
      const cursor = stack.pop() ?? null;
      if (!cursor || ids.has(cursor)) continue;

      ids.add(cursor);
      const entry = entryLineageById.get(cursor);
      if (entry?.parent_commit_id) stack.push(entry.parent_commit_id);
      if (entry?.merge_source_commit_id) stack.push(entry.merge_source_commit_id);
    }

    return ids;
  }, [currentBranchHeadId, entryLineageById]);

  useEffect(() => {
    scrollToHighlighted();
  }, [entryList, scrollToHighlighted]);

  // ─── Stash helpers ─────────────────────────────────────────────────────────

  const toggleStash = useCallback(
    (entry: EntryWithSections) => {
      const existing = committedStashes.find(
        (stashItem) => stashItem.entryId === entry.id,
      );

      if (existing) {
        writeCommittedEntryStash(
          streamId,
          committedStashes.filter((stashItem) => stashItem.id !== existing.id),
        );
        return;
      }

      writeCommittedEntryStash(streamId, [
        buildCommittedEntryStashItem({
          entry,
          branchName: currentBranch,
          headCommitId: currentBranchHeadId,
        }),
        ...committedStashes,
      ]);
    },
    [committedStashes, currentBranch, currentBranchHeadId, streamId],
  );

  const unstashCommittedEntry = useCallback(
    (stashId: string) => {
      writeCommittedEntryStash(
        streamId,
        committedStashes.filter((stashItem) => stashItem.id !== stashId),
      );
    },
    [committedStashes, streamId],
  );

  const queueDraftStashAction = useCallback(
    (stashId: string, kind: "apply" | "pop" | "drop") => {
      setGraphView(false);
      setPendingDraftStashAction({
        nonce: crypto.randomUUID(),
        stashId,
        kind,
      });
      setIsStashDialogOpen(false);
    },
    [],
  );

  const openCommittedStashInGraph = useCallback(() => {
    setGraphView(true);
    setIsStashDialogOpen(false);
  }, []);

  const saveTag = (entryId: string, tag: string | null) => {
    setTags((prev) => {
      const next = { ...prev };
      if (tag) next[entryId] = tag;
      else delete next[entryId];
      localStorage.setItem(`kolam_tags_${streamId}`, JSON.stringify(next));
      return next;
    });
  };

  // ─── Context menu ──────────────────────────────────────────────────────────

  const clampContextMenuPosition = useCallback(
    (x: number, y: number, menuWidth: number, menuHeight: number) => {
      if (typeof window === "undefined") return { left: x, top: y };

      const VIEWPORT_PADDING = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let nextLeft = x;
      let nextTop = y;

      if (nextLeft + menuWidth + VIEWPORT_PADDING > viewportWidth) {
        nextLeft = viewportWidth - menuWidth - VIEWPORT_PADDING;
      }

      if (nextTop + menuHeight + VIEWPORT_PADDING > viewportHeight) {
        nextTop = viewportHeight - menuHeight - VIEWPORT_PADDING;
      }

      return {
        left: Math.max(VIEWPORT_PADDING, nextLeft),
        top: Math.max(VIEWPORT_PADDING, nextTop),
      };
    },
    [],
  );

  const recalculateContextMenuPosition = useCallback(() => {
    if (
      !contextMenu ||
      typeof window === "undefined" ||
      !contextMenuRef.current
    )
      return;
    const menuRect = contextMenuRef.current.getBoundingClientRect();
    const { left: nextLeft, top: nextTop } = clampContextMenuPosition(
      contextMenu.x,
      contextMenu.y,
      menuRect.width,
      menuRect.height,
    );

    setContextMenuPosition((prev) =>
      prev.left === nextLeft && prev.top === nextTop
        ? prev
        : { left: nextLeft, top: nextTop },
    );
  }, [clampContextMenuPosition, contextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu) return;
    recalculateContextMenuPosition();
  }, [contextMenu, recalculateContextMenuPosition]);

  useEffect(() => {
    if (!contextMenu || typeof window === "undefined") return;

    const handleViewportChange = () => {
      recalculateContextMenuPosition();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [contextMenu, recalculateContextMenuPosition]);

  useEffect(() => {
    if (!contextMenu || typeof window === "undefined") return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!contextMenuRef.current) return;
      const targetNode = event.target as Node | null;
      if (targetNode && !contextMenuRef.current.contains(targetNode)) {
        setContextMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, entry: EntryWithSections) => {
    e.preventDefault();
    // Use a close initial estimate so the menu starts near-final position before exact measurement.
    const estimated = clampContextMenuPosition(e.clientX, e.clientY, 224, 300);
    setContextMenuPosition(estimated);
    setContextMenu({ entry, x: e.clientX, y: e.clientY });
  };

  type GitAction =
    | "copy-sha"
    | "copy-content"
    | "cherry-pick"
    | "revert"
    | "diff"
    | "tag"
    | "stash"
    | "branch"
    | "reset"
    | "delete";

  const handleContextAction = async (action: GitAction) => {
    if (!contextMenu) return;
    const { entry } = contextMenu;
    setContextMenu(null);

    switch (action) {
      case "copy-sha":
        await navigator.clipboard.writeText(entry.id);
        break;
      case "copy-content": {
        const text = extractText(entry);
        await navigator.clipboard.writeText(text);
        break;
      }
      case "cherry-pick":
        duplicateEntry.mutate(entry);
        break;
      case "branch": {
        const baseBranchName = currentBranch || "main";
        const defaultBranchName = `${baseBranchName}-${shortHash(entry.id)}`;
        openCreateBranchDialog({
          initialName: defaultBranchName,
          targetHeadCommitId: entry.id,
          switchToCreatedBranch: true,
        });
        break;
      }
      case "revert":
        revertEntry.mutate(entry);
        break;
      case "diff": {
        const parentEntryId = entryLineageById.get(entry.id)?.parent_commit_id ?? null;
        const prevEntry = parentEntryId
          ? branchEntries.find((candidate) => candidate.id === parentEntryId) ?? null
          : null;
        setDiffTarget({ entry, prevEntry });
        break;
      }
      case "tag":
        setTagTarget(entry);
        break;
      case "stash":
        toggleStash(entry);
        break;
      case "reset":
        setEntryConfirm({ type: "reset", entry });
        break;
      case "delete":
        setEntryConfirm({ type: "delete", entry });
        break;
    }
  };

  // ─── Amend handlers ────────────────────────────────────────────────────────

  const handleStartAmend = (entry: EntryWithSections) => {
    // Keep draft sections empty initially; each section draft is written only
    // after the user edits it. This avoids overriding initial editor payload
    // when toggling modes in read/edit flows.
    const entryCollapseKey = `entry:${entry.id}`;
    if (collapsedEntryIds.has(entryCollapseKey)) {
      removeCollapsedLogItem(streamId, entryCollapseKey);
    }
    setAmendState({ entryId: entry.id, sections: {} });
    setAmendError(null);
  };

  const handleCancelAmend = () => {
    setAmendState(null);
    setAmendError(null);
  };

  const handleSaveAmend = async (entry: EntryWithSections) => {
    if (!amendState || amendState.entryId !== entry.id) return;
    const changedSections = (entry.sections ?? []).flatMap((section) => {
      const draft = amendState.sections[section.id];
      if (!draft) return [];
      const draftBlocks = draft.content;
      const originalMarkdown = storedContentToMarkdown(section);
      const original = JSON.stringify(
        (section.content_json as unknown as PartialBlock[]) ?? [],
      );
      const updated = draftBlocks ? JSON.stringify(draftBlocks) : original;
      const nextMarkdown = draft.markdown ?? originalMarkdown;
      const originalAttachments = serializeAttachments(section.section_attachments);
      const updatedAttachments = draft.attachments
        ? serializeAttachments(draft.attachments)
        : originalAttachments;
      const contentChanged =
        !!draftBlocks && (original !== updated || nextMarkdown !== originalMarkdown);
      const attachmentsChanged = updatedAttachments !== originalAttachments;

      if (!contentChanged && !attachmentsChanged) return [];

      return [{
        sectionId: section.id,
        ...(draftBlocks
          ? {
              content: draftBlocks,
              rawMarkdown: nextMarkdown,
            }
          : {}),
        ...(draft.attachments ? { attachments: draft.attachments } : {}),
      }];
    });
    if (!changedSections.length) {
      handleCancelAmend();
      return;
    }
    try {
      setAmendError(null);
      await amendEntry.mutateAsync({
        entryId: entry.id,
        sections: changedSections,
      });
      setAmendState(null);
    } catch (error) {
      setAmendError(
        error instanceof Error ? error.message : "Failed to amend entry",
      );
    }
  };

  const handleRemoveAmendAttachment = useCallback(
    (
      sectionId: string,
      currentAttachments: SectionFileAttachmentWithDocument[],
      attachmentToRemove: SectionFileAttachmentWithDocument,
      attachmentIndex: number,
    ) => {
      setAmendState((prev) => {
        if (!prev) return prev;

        const baseAttachments =
          prev.sections[sectionId]?.attachments ?? currentAttachments;
        const nextAttachments = baseAttachments.filter((attachment, index) => {
          if (attachment.id && attachmentToRemove.id) {
            return attachment.id !== attachmentToRemove.id;
          }
          return index !== attachmentIndex;
        });

        return {
          ...prev,
          sections: {
            ...prev.sections,
            [sectionId]: {
              ...prev.sections[sectionId],
              attachments: nextAttachments,
            },
          },
        };
      });
    },
    [],
  );

  const handleExport = useCallback(async () => {
    try {
      const allEntries = await fetchAllEntriesForExport();
      if (!allEntries?.length) return;
      const markdown = exportEntriesToMarkdown(allEntries);
      const filename = `${stream?.name || "log"}-${new Date().toISOString().split("T")[0]}.md`;
      downloadMarkdown(markdown, filename);
    } catch (e) {
      console.error("Export failed:", e);
    }
  }, [fetchAllEntriesForExport, stream?.name]);

  // ─── Layout ────────────────────────────────────────────────────────────────

  const resolvedWidth = forceWidth ?? logWidth;
  const isVisible = resolvedWidth > 0;
  const containerStyle = {
    width: `${resolvedWidth}%`,
    maxWidth: `${resolvedWidth}%`,
    flex: `0 0 ${resolvedWidth}%`,
    minWidth: "0px",
    opacity: isVisible ? 1 : 0,
    transition: "all 400ms cubic-bezier(0.4, 0, 0.2, 1)",
  };
  const contentStyle = {
    transform: isVisible
      ? "translateX(0) scaleX(1)"
      : "translateX(-100%) scaleX(0.95)",
    transformOrigin: "right center",
    transition: "transform 400ms cubic-bezier(0.4, 0, 0.2, 1)",
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const currentBranchCutoffMs = useMemo(
    () => parseTimestamp(currentBranchHeadEntry?.created_at),
    [currentBranchHeadEntry],
  );

  const branchTimelineItems = useMemo(() => {
    if (isEntryLineageLoading) return [];

    return timelineItems.filter((item) => {
      if (item.type === "entry") {
        return currentBranchHeadId ? reachableCommitIds.has(item.data.id) : false;
      }

      const snapshot = item.data;
      if (snapshot.source_entry_id) {
        return reachableCommitIds.has(snapshot.source_entry_id);
      }

      if (snapshot.branch_name) {
        return snapshot.branch_name === currentBranch;
      }

      if (currentBranchCutoffMs === null) return false;
      const itemTs = new Date(item.created_at).getTime();
      return Number.isFinite(itemTs) && itemTs <= currentBranchCutoffMs;
    });
  }, [
    currentBranch,
    currentBranchCutoffMs,
    currentBranchHeadId,
    isEntryLineageLoading,
    reachableCommitIds,
    timelineItems,
  ]);

  const branchEntries = useMemo(
    () =>
      branchTimelineItems
        .filter((item) => item.type === "entry")
        .map((item) => item.data),
    [branchTimelineItems],
  );

  const visibleEntries = useMemo(
    () => branchEntries.filter((entry) => !stashedEntryIds.has(entry.id)),
    [branchEntries, stashedEntryIds],
  );
  const normalizedSearchTerm = searchTerm.trim();
  const branchCanvasCommitCount = useMemo(
    () =>
      branchTimelineItems.filter((item) => item.type === "canvas_snapshot")
        .length,
    [branchTimelineItems],
  );
  const visibleCollapsibleItemIds = useMemo(
    () =>
      branchTimelineItems
        .filter(
          (item) => item.type !== "entry" || !stashedEntryIds.has(item.data.id),
        )
        .map(getTimelineItemCollapseKey),
    [branchTimelineItems, stashedEntryIds],
  );

  const setEntriesCollapsed = useCallback(
    (entryIds: string[], collapsed: boolean) => {
      if (!entryIds.length) return;

      const next = new Set(collapsedEntryIds);

      for (const entryId of entryIds) {
        if (collapsed) next.add(entryId);
        else next.delete(entryId);
      }

      setCollapsedLogItemsForStream(streamId, next);
    },
    [collapsedEntryIds, setCollapsedLogItemsForStream, streamId],
  );

  const toggleEntryCollapsed = useCallback(
    (entryId: string) => {
      if (amendState?.entryId && `entry:${amendState.entryId}` === entryId) return;

      toggleCollapsedLogItem(streamId, entryId);
    },
    [amendState?.entryId, streamId, toggleCollapsedLogItem],
  );

  const setVisibleEntriesCollapsed = useCallback(
    (collapsed: boolean) => {
      const targetIds = visibleCollapsibleItemIds.filter(
        (id) => id !== (amendState?.entryId ? `entry:${amendState.entryId}` : null),
      );
      setEntriesCollapsed(targetIds, collapsed);
    },
    [amendState?.entryId, setEntriesCollapsed, visibleCollapsibleItemIds],
  );

  const occurrenceTargets = useMemo(() => {
    if (!normalizedSearchTerm) return [];

    const targets: Array<{
      itemKey: string;
      entryId: string;
      sectionId: string;
      occurrenceIndexInSection: number;
    }> = [];

    for (const entry of visibleEntries) {
      for (const section of entry.sections ?? []) {
        const markdown = storedContentToMarkdown(section);
        const count = countSearchOccurrences(markdown, normalizedSearchTerm);
        for (let index = 0; index < count; index += 1) {
          targets.push({
            itemKey: `entry:${entry.id}`,
            entryId: entry.id,
            sectionId: section.id,
            occurrenceIndexInSection: index,
          });
        }
      }
    }

    return targets;
  }, [normalizedSearchTerm, visibleEntries]);

  useEffect(() => {
    if (!normalizedSearchTerm) {
      setActiveOccurrenceIndex(null);
      return;
    }

    if (occurrenceTargets.length === 0) {
      setActiveOccurrenceIndex(null);
      return;
    }

    const highlightedIndex = highlightSectionId
      ? occurrenceTargets.findIndex((target) => target.sectionId === highlightSectionId)
      : -1;

    setActiveOccurrenceIndex((current) => {
      if (
        current !== null &&
        current >= 0 &&
        current < occurrenceTargets.length
      ) {
        return current;
      }
      if (highlightedIndex >= 0) return highlightedIndex;
      return 0;
    });
  }, [highlightSectionId, normalizedSearchTerm, occurrenceTargets]);

  useEffect(() => {
    if (normalizedSearchTerm) return;
    document
      .querySelectorAll(".kolam-search-hit-active")
      .forEach((node) => node.classList.remove("kolam-search-hit-active"));
  }, [normalizedSearchTerm]);

  useEffect(() => {
    if (!normalizedSearchTerm) return;
    if (activeOccurrenceIndex === null) return;

    const target = occurrenceTargets[activeOccurrenceIndex];
    if (!target) return;

    setHighlightEntryId(target.entryId);
    setHighlightSectionId(target.sectionId);
    setRevealItemKey(target.itemKey);
  }, [activeOccurrenceIndex, normalizedSearchTerm, occurrenceTargets]);

  useEffect(() => {
    if (!revealItemKey) return;
    if (!hasHydrated) return;
    if (isEntriesLoading || isEntriesFetching) return;
    if (branchTimelineItems.length === 0) return;

    const itemExists = branchTimelineItems.some(
      (item) => getTimelineItemCollapseKey(item) === revealItemKey,
    );
    if (!itemExists) return;

    if (collapsedEntryIds.has(revealItemKey)) {
      removeCollapsedLogItem(streamId, revealItemKey);
    }

    const rafId = window.requestAnimationFrame(() => {
      scrollToHighlighted();
      setAnimatedItemKey(revealItemKey);
    });

    const timer = window.setTimeout(() => {
      setAnimatedItemKey((current) =>
        current === revealItemKey ? null : current,
      );
      setRevealItemKey((current) => (current === revealItemKey ? null : current));
    }, 2200);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [
    branchTimelineItems,
    collapsedEntryIds,
    hasHydrated,
    isEntriesFetching,
    isEntriesLoading,
    removeCollapsedLogItem,
    revealItemKey,
    scrollToHighlighted,
    streamId,
  ]);

  useEffect(() => {
    if (!normalizedSearchTerm) return;
    if (activeOccurrenceIndex === null) return;

    const target = occurrenceTargets[activeOccurrenceIndex];
    if (!target) return;

    const rafId = window.requestAnimationFrame(() => {
      document
        .querySelectorAll(".kolam-search-hit-active")
        .forEach((node) => node.classList.remove("kolam-search-hit-active"));

      const sectionNode = sectionRefs.current[target.sectionId];
      if (!sectionNode) return;

      const marks = sectionNode.querySelectorAll<HTMLElement>(".kolam-search-hit");
      const activeMark = marks[target.occurrenceIndexInSection] ?? null;
      if (!activeMark) return;

      activeMark.classList.add("kolam-search-hit-active");
      activeMark.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [activeOccurrenceIndex, normalizedSearchTerm, occurrenceTargets]);

  const stashCount = committedStashes.length + draftStashes.length;
  const showLoadingState =
    !hasHydrated ||
    ((isEntriesLoading || isEntriesFetching) &&
      branchTimelineItems.length === 0);
  const showEmptyState =
    hasHydrated &&
    branchTimelineItems.length === 0 &&
    !isEntriesLoading &&
    !isEntriesFetching;

  const headEntryId = useMemo(() => {
    if (!branchEntries.length) return null;
    let latest = branchEntries[0];
    for (const entry of branchEntries) {
      if (
        new Date(entry.created_at || 0).getTime() >
        new Date(latest.created_at || 0).getTime()
      ) {
        latest = entry;
      }
    }
    return latest.id;
  }, [branchEntries]);

  const branchesByEntryId = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!branches) return map;

    for (const branch of branches) {
      if (!branch.head_commit_id) continue;
      const existing = map.get(branch.head_commit_id) ?? [];
      existing.push(branch.name);
      map.set(branch.head_commit_id, existing);
    }

    for (const refs of map.values()) {
      refs.sort(compareBranchNames);
    }

    if (!currentBranchRecord?.head_commit_id && currentBranch === "main" && latestEntryId) {
      const existing = map.get(latestEntryId) ?? [];
      if (!existing.includes("main")) {
        existing.unshift("main");
        map.set(latestEntryId, existing);
      }
    }

    return map;
  }, [branches, currentBranch, currentBranchRecord?.head_commit_id, latestEntryId]);

  const branchNames = useMemo(() => {
    const names = (branches ?? []).map((branch) => branch.name);
    if (!names.includes("main")) names.unshift("main");
    return [...new Set(names)];
  }, [branches]);

  const collapsedVisibleCount = useMemo(
    () =>
      visibleCollapsibleItemIds.reduce(
        (count, entryId) => count + (collapsedEntryIds.has(entryId) ? 1 : 0),
        0,
      ),
    [collapsedEntryIds, visibleCollapsibleItemIds],
  );
  const allVisibleCollapsed =
    visibleCollapsibleItemIds.length > 0 &&
    collapsedVisibleCount === visibleCollapsibleItemIds.length;

  useEffect(() => {
    if (!hasHydrated) return;
    if (isEntriesLoading || isEntriesFetching) return;
    if (branchTimelineItems.length === 0) return;

    pruneCollapsedLogItemsForStream(
      streamId,
      branchTimelineItems.map(getTimelineItemCollapseKey),
    );
  }, [
    branchTimelineItems,
    hasHydrated,
    isEntriesFetching,
    isEntriesLoading,
    pruneCollapsedLogItemsForStream,
    streamId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onExport = () => {
      void handleExport();
    };

    const onToggleGraph = () => {
      setGraphView((prev) => !prev);
    };

    const onToggleStash = () => {
      setIsStashDialogOpen((prev) => !prev);
    };

    const onToggleSort = () => {
      setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"));
    };

    const onToggleCompactAll = (event: Event) => {
      const detail = (event as CustomEvent<{ collapsed?: boolean }>).detail;
      const nextCollapsed =
        typeof detail?.collapsed === "boolean"
          ? detail.collapsed
          : !allVisibleCollapsed;
      setVisibleEntriesCollapsed(nextCollapsed);
    };

    const onSetBranch = (event: Event) => {
      const detail = (event as CustomEvent<{ branchName?: string }>).detail;
      if (typeof detail?.branchName === "string" && detail.branchName.trim()) {
        setCurrentBranch(detail.branchName.trim());
      }
    };

    const onOpenCreateBranch = (event: Event) => {
      const detail = (
        event as CustomEvent<{ defaultBranchName?: string; targetHeadCommitId?: string | null }>
      ).detail;

      openCreateBranchDialog({
        initialName: detail?.defaultBranchName,
        targetHeadCommitId: detail?.targetHeadCommitId,
        switchToCreatedBranch: true,
      });
    };

    const onSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ term?: string }>).detail;
      if (typeof detail?.term === "string") {
        setSearchTerm(detail.term);
      }
    };

    const onNextOccurrence = () => {
      if (!occurrenceTargets.length) return;
      setActiveOccurrenceIndex((prev) => {
        if (prev === null) return 0;
        return (prev + 1) % occurrenceTargets.length;
      });
    };

    const onPrevOccurrence = () => {
      if (!occurrenceTargets.length) return;
      setActiveOccurrenceIndex((prev) => {
        if (prev === null) return occurrenceTargets.length - 1;
        return (prev - 1 + occurrenceTargets.length) % occurrenceTargets.length;
      });
    };

    window.addEventListener("kolam_header_log_export", onExport);
    window.addEventListener("kolam_header_log_toggle_graph", onToggleGraph);
    window.addEventListener("kolam_header_log_toggle_stash", onToggleStash);
    window.addEventListener("kolam_header_log_toggle_sort", onToggleSort);
    window.addEventListener(
      "kolam_header_log_toggle_compact_all",
      onToggleCompactAll as EventListener,
    );
    window.addEventListener(
      "kolam_header_log_set_branch",
      onSetBranch as EventListener,
    );
    window.addEventListener(
      "kolam_header_log_open_create_branch",
      onOpenCreateBranch as EventListener,
    );
    window.addEventListener(
      "kolam_header_log_search_term",
      onSearch as EventListener,
    );
    window.addEventListener(
      "kolam_header_log_next_occurrence",
      onNextOccurrence,
    );
    window.addEventListener(
      "kolam_header_log_prev_occurrence",
      onPrevOccurrence,
    );

    return () => {
      window.removeEventListener("kolam_header_log_export", onExport);
      window.removeEventListener(
        "kolam_header_log_toggle_graph",
        onToggleGraph,
      );
      window.removeEventListener(
        "kolam_header_log_toggle_stash",
        onToggleStash,
      );
      window.removeEventListener("kolam_header_log_toggle_sort", onToggleSort);
      window.removeEventListener(
        "kolam_header_log_toggle_compact_all",
        onToggleCompactAll as EventListener,
      );
      window.removeEventListener(
        "kolam_header_log_set_branch",
        onSetBranch as EventListener,
      );
      window.removeEventListener(
        "kolam_header_log_open_create_branch",
        onOpenCreateBranch as EventListener,
      );
      window.removeEventListener(
        "kolam_header_log_search_term",
        onSearch as EventListener,
      );
      window.removeEventListener(
        "kolam_header_log_next_occurrence",
        onNextOccurrence,
      );
      window.removeEventListener(
        "kolam_header_log_prev_occurrence",
        onPrevOccurrence,
      );
    };
  }, [
    handleExport,
    openCreateBranchDialog,
    allVisibleCollapsed,
    occurrenceTargets.length,
    setVisibleEntriesCollapsed,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("kolam_log_state", {
        detail: {
          streamId,
          currentBranch,
          commitCount: visibleEntries.length,
          canvasCommitCount: branchCanvasCommitCount,
          collapsedEntryCount: collapsedVisibleCount,
          allEntriesCollapsed: allVisibleCollapsed,
          showStash: isStashDialogOpen,
          stashCount,
          graphView,
          sortOrder,
          searchTerm,
          occurrenceCount: occurrenceTargets.length,
          activeOccurrenceIndex:
            activeOccurrenceIndex !== null ? activeOccurrenceIndex + 1 : 0,
          branchNames,
          currentBranchHeadId,
        },
      }),
    );
  }, [
    streamId,
    currentBranch,
    visibleEntries.length,
    branchCanvasCommitCount,
    collapsedVisibleCount,
    allVisibleCollapsed,
    isStashDialogOpen,
    stashCount,
    graphView,
    sortOrder,
    searchTerm,
    occurrenceTargets.length,
    activeOccurrenceIndex,
    branchNames,
    currentBranchHeadId,
  ]);

  return (
    <>
      <div
        className={`log-pane border-r border-border-default bg-surface-default relative overflow-hidden z-30 flex flex-col ${isVisible ? "" : "pointer-events-none"}`}
        style={containerStyle}
      >
      <div className="flex h-full flex-col" style={contentStyle}>
        {/* Content: Graph View OR Commit List */}
        {graphView ? (
          <div className="flex-1 overflow-hidden">
            <CommitGraph
              currentStreamId={streamId}
              currentBranch={currentBranch}
              tags={tags}
              latestEntryId={latestEntryId ?? null}
              committedStashEntryIds={Array.from(stashedEntryIds)}
              onEntryClick={(_streamId, entryId) => {
                setGraphView(false);
                // After switching back to list, scroll to the entry
                setTimeout(() => {
                  const ref = entryRefs.current[entryId];
                  if (ref)
                    ref.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 150);
              }}
              onBranchCheckout={handleCheckoutBranch}
              onBranchMergeIntoCurrent={handleMergeBranchIntoCurrent}
              onBranchRename={handleRenameBranch}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-20">
            <div className="py-2">
              {sortOrder === "newest" && (
                <div className="mb-2 space-y-1.5">
                  <EntryCreator
                    key={streamId}
                    streamId={streamId}
                    currentBranch={currentBranch}
                    onCurrentBranchChange={setCurrentBranch}
                    externalStashAction={pendingDraftStashAction}
                    onExternalStashActionHandled={(nonce) => {
                      setPendingDraftStashAction((current) =>
                        current?.nonce === nonce ? null : current,
                      );
                    }}
                  />
                  <CanvasDraftCard streamId={streamId} />
                </div>
              )}
              {showLoadingState ? (
                <div className="space-y-4 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-28 bg-surface-hover"
                    />
                  ))}
                </div>
              ) : showEmptyState ? (
                <div className="text-center py-10 text-text-muted text-sm">
                  No commits found.
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    {branchTimelineItems.map((item) => {
                      if (item.type === "canvas_snapshot") {
                        const itemCollapseKey = getTimelineItemCollapseKey(item);
                        return (
                          <div
                            key={`snapshot-${item.data.id}`}
                            ref={(node) => {
                              entryRefs.current[itemCollapseKey] = node;
                            }}
                            className={
                              animatedItemKey === itemCollapseKey
                                ? "kolam-search-reveal"
                                : undefined
                            }
                          >
                            <CanvasSnapshotCard
                              version={item.data}
                              streamId={streamId}
                              isCollapsed={collapsedEntryIds.has(itemCollapseKey)}
                              onToggleCollapsed={() =>
                                toggleEntryCollapsed(itemCollapseKey)
                              }
                            />
                          </div>
                        );
                      }

                      const entry = item.data;

                      if (stashedEntryIds.has(entry.id)) return null;

                      const isLatestEntry = headEntryId === entry.id;
                      const isAmending = amendState?.entryId === entry.id;
                      const isStashed = stashedEntryIds.has(entry.id);
                      const itemCollapseKey = getTimelineItemCollapseKey(item);
                      const isCollapsed = collapsedEntryIds.has(itemCollapseKey);
                      const tag = tags[entry.id];
                      const hash = shortHash(entry.id);
                      const entryBranches =
                        branchesByEntryId.get(entry.id) ?? [];
                      const sectionCount = entry.sections?.length ?? 0;
                      const createdAtText = new Date(
                        entry.created_at || "",
                      ).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      });

                      if (entry.entry_kind === "merge") {
                        return (
                          <div
                            key={entry.id}
                            ref={(node) => {
                              entryRefs.current[entry.id] = node;
                              entryRefs.current[itemCollapseKey] = node;
                            }}
                            className={isStashed ? "opacity-50" : undefined}
                          >
                            <MergeCommitCard
                              entry={entry}
                              sourceHash={shortHash(entry.merge_source_commit_id ?? entry.id)}
                              targetHash={shortHash(entry.parent_commit_id ?? entry.id)}
                              createdAtText={createdAtText}
                              onOpenInGraph={() => setGraphView(true)}
                            />
                          </div>
                        );
                      }

                      return (
                        <div
                          key={entry.id}
                          ref={(node) => {
                            entryRefs.current[entry.id] = node;
                            entryRefs.current[itemCollapseKey] = node;
                          }}
                          onContextMenu={(e) => handleContextMenu(e, entry)}
                          className={[
                            isStashed ? "text-text-muted" : "",
                            animatedItemKey === itemCollapseKey
                              ? "kolam-search-reveal"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ") || undefined}
                        >
                          <ThreadFrame
                            hideBody={isCollapsed}
                            frameClassName={`group overflow-visible transition-colors hover:z-20 focus-within:z-20 ${
                              isCollapsed
                                ? "border-border-strong bg-surface-default"
                                : "border-border-default bg-surface-default"
                            } ${isAmending ? "ring-1 ring-action-primary-bg" : ""}`}
                            headerClassName={`${
                              isCollapsed
                                ? "bg-surface-hover hover:bg-surface-subtle"
                                : "bg-primary-950 hover:bg-primary-950"
                            } ${isAmending ? "cursor-default" : "cursor-pointer"} transition-colors`}
                            bodyClassName="bg-surface-default"
                            header={
                              <div
                                role="button"
                                tabIndex={isAmending ? -1 : 0}
                                aria-expanded={!isCollapsed}
                                onClick={() => toggleEntryCollapsed(itemCollapseKey)}
                                onKeyDown={(event) => {
                                  if (isAmending) return;
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    toggleEntryCollapsed(itemCollapseKey);
                                  }
                                }}
                                className="flex h-8 items-center justify-between gap-2"
                              >
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span
                                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center border ${
                                      isCollapsed
                                        ? "border-border-default bg-surface-default text-text-muted"
                                        : "border-action-primary-bg bg-surface-default text-action-primary-bg"
                                    }`}
                                    aria-hidden="true"
                                  >
                                    {isCollapsed ? (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                  </span>
                                  <GitCommitHorizontal className="h-3 w-3 shrink-0 text-text-muted" />
                                  <span className="relative shrink-0 group/hash">
                                    <code className="cursor-help text-[10px] font-mono text-primary-400">
                                      {hash}
                                    </code>
                                    <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-64 border border-border-default bg-surface-elevated p-2 text-[10px] font-mono text-text-default group-hover/hash:block">
                                      <div className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">
                                        Commit Metadata
                                      </div>
                                      <div>hash: {hash}</div>
                                      <div className="truncate">
                                        id: {entry.id}
                                      </div>
                                      <div>time: {createdAtText}</div>
                                      <div>sections: {entry.sections?.length ?? 0}</div>
                                      <div>tag: {tag || "-"}</div>
                                      <div>stashed: {isStashed ? "yes" : "no"}</div>
                                      <div>
                                        latest: {isLatestEntry ? "HEAD" : "no"}
                                      </div>
                                      <div className="truncate">
                                        branches:{" "}
                                        {entryBranches.length
                                          ? entryBranches.join(", ")
                                          : "-"}
                                      </div>
                                    </div>
                                  </span>
                                  <span className="text-border-default">·</span>
                                  <Calendar className="h-3 w-3 shrink-0 text-text-muted" />
                                  <span className="truncate font-mono text-[10px] font-medium text-text-subtle">
                                    {createdAtText}
                                  </span>
                                  <span
                                    className={`shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                                      isCollapsed
                                        ? "border-border-default bg-surface-default text-text-muted"
                                        : "bg-surface-default text-text-subtle"
                                    }`}
                                  >
                                    {sectionCount} section{sectionCount === 1 ? "" : "s"}
                                  </span>
                                  {tag && (
                                    <span className="shrink-0 flex items-center gap-0.5 bg-amber-950 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                                      <Tag className="h-2.5 w-2.5" />
                                      {tag}
                                    </span>
                                  )}
                                  {entryBranches.map((branchName) => (
                                    <span
                                      key={`${entry.id}-${branchName}`}
                                      className="relative inline-flex h-4.5 shrink-0 items-center px-1.5 pr-3 text-[9px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300"
                                      title={`${branchName} points at this commit`}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className="absolute inset-0 bg-sky-800"
                                        style={{
                                          clipPath:
                                            "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)",
                                        }}
                                      />
                                      <span
                                        aria-hidden="true"
                                        className="absolute inset-px bg-sky-950"
                                        style={{
                                          clipPath:
                                            "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)",
                                        }}
                                      />
                                      <span className="relative z-10 inline-flex items-center gap-1">
                                        <GitBranch className="h-2.5 w-2.5" />
                                        {branchName}
                                      </span>
                                    </span>
                                  ))}
                                  {isLatestEntry && (
                                    <span className="shrink-0 inline-flex items-center bg-primary-950 px-2 py-0.5 text-[10px] font-semibold text-action-primary-bg">
                                      HEAD
                                    </span>
                                  )}
                                  {isStashed && (
                                    <span className="shrink-0 flex items-center gap-0.5 bg-amber-950 px-1.5 py-0.5 text-[9px] font-semibold text-amber-500">
                                      <Archive className="h-2.5 w-2.5" />
                                      stashed
                                    </span>
                                  )}
                                </div>

                                <div className="flex shrink-0 items-center gap-1">
                                  {isAmending ? (
                                    <>
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleSaveAmend(entry);
                                        }}
                                        disabled={amendEntry.isPending}
                                        className="inline-flex items-center gap-1 bg-action-primary-bg px-2 py-1 text-[10px] font-semibold text-action-primary-text transition-colors hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:bg-action-primary-disabled"
                                      >
                                        {amendEntry.isPending ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Check className="h-3 w-3" />
                                        )}
                                        Save
                                      </button>
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleCancelAmend();
                                        }}
                                        disabled={amendEntry.isPending}
                                        className="inline-flex items-center gap-1 border border-border-default px-2 py-1 text-[10px] font-semibold text-text-subtle transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-text-muted"
                                      >
                                        <X className="h-3 w-3" />
                                        Cancel
                                      </button>
                                    </>
                                  ) : isLatestEntry ? (
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleStartAmend(entry);
                                      }}
                                      className="inline-flex items-center gap-1 px-1 py-px text-[10px] font-semibold text-text-subtle transition-colors hover:bg-surface-subtle"
                                      title="Amend commit"
                                    >
                                      <PencilLine className="h-3 w-3" />
                                      Amend commit
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            }
                          >
                            {/* Commit header — mimics git log --oneline */}
                            {isAmending && amendError && (
                              <div className="border border-status-error-border bg-status-error-bg px-2.5 py-1 text-[11px] text-status-error-text">
                                {amendError}
                              </div>
                            )}
                            {!isCollapsed && (
                              <div className="flex flex-col gap-2">
                                {entry.sections?.map(
                                  (
                                    section: EntryWithSections["sections"][number],
                                    sectionIndex,
                                  ) => (
                                    <div
                                      key={section.id}
                                      ref={(node) => {
                                        sectionRefs.current[section.id] = node;
                                      }}
                                    >
                                      <LogSection
                                        section={section}
                                        streamId={streamId}
                                        sectionIndex={sectionIndex}
                                        totalSections={entry.sections.length}
                                        onPreviewAttachment={openAttachmentPreview}
                                        editable={isAmending}
                                        currentEditedContent={
                                          isAmending
                                            ? amendState.sections[section.id]?.content
                                            : undefined
                                        }
                                        currentEditedMarkdown={
                                          isAmending
                                            ? amendState.sections[section.id]?.markdown
                                            : undefined
                                        }
                                        attachmentOverrides={
                                          isAmending
                                            ? amendState.sections[section.id]?.attachments
                                            : undefined
                                        }
                                        onRemoveAttachment={
                                          isAmending
                                            ? (attachment, attachmentIndex) =>
                                                handleRemoveAmendAttachment(
                                                  section.id,
                                                  amendState.sections[section.id]?.attachments ??
                                                    section.section_attachments ??
                                                    [],
                                                  attachment,
                                                  attachmentIndex,
                                                )
                                            : undefined
                                        }
                                        onAddAttachments={
                                          isAmending
                                            ? (files) =>
                                                handleAddAmendAttachments(
                                                  section.id,
                                                  amendState.sections[section.id]
                                                    ?.attachments ??
                                                    section.section_attachments ??
                                                    [],
                                                  files,
                                                )
                                            : undefined
                                        }
                                        isUploadingAttachments={
                                          uploadingAmendSectionIds.has(section.id)
                                        }
                                        isSearchTarget={
                                          section.id === highlightSectionId
                                        }
                                        onContentChange={(content, markdown) => {
                                          if (!isAmending) return;
                                          setAmendState((prev) => {
                                            if (!prev || prev.entryId !== entry.id)
                                              return prev;
                                            return {
                                              ...prev,
                                              sections: {
                                                ...prev.sections,
                                                [section.id]: { content, markdown },
                                              },
                                            };
                                          });
                                        }}
                                        highlightTerm={
                                          normalizedSearchTerm
                                            ? normalizedSearchTerm
                                            : entry.id === highlightEntryId
                                              ? (highlightTerm ?? undefined)
                                              : undefined
                                        }
                                      />
                                    </div>
                                  ),
                                )}
                              </div>
                            )}
                          </ThreadFrame>
                        </div>
                      );
                    })}
                  </div>

                  {sortOrder === "oldest" && (
                    <div className="mt-2 space-y-1.5">
                      <CanvasDraftCard streamId={streamId} />
                      <EntryCreator
                        key={streamId}
                        streamId={streamId}
                        currentBranch={currentBranch}
                        onCurrentBranchChange={setCurrentBranch}
                        externalStashAction={pendingDraftStashAction}
                        onExternalStashActionHandled={(nonce) => {
                          setPendingDraftStashAction((current) =>
                            current?.nonce === nonce ? null : current,
                          );
                        }}
                      />
                    </div>
                  )}

                  {hasNextPage && (
                    <div className="flex justify-center pt-2 pb-1">
                      <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-text-muted hover:text-text-default bg-surface-subtle hover:bg-surface-hover transition-colors disabled:opacity-50"
                      >
                        <ChevronsDown className="h-3.5 w-3.5" />
                        {isFetchingNextPage
                          ? "Loading..."
                          : "Load more commits"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Context Menu Portal ─────────────────────────────────────────────── */}
      <StashDialog
        open={isStashDialogOpen}
        committedStashes={committedStashes}
        draftStashes={draftStashes}
        onClose={() => setIsStashDialogOpen(false)}
        onApplyDraftStash={(stashId) => queueDraftStashAction(stashId, "apply")}
        onPopDraftStash={(stashId) => queueDraftStashAction(stashId, "pop")}
        onDropDraftStash={(stashId) => queueDraftStashAction(stashId, "drop")}
        onUnstashCommittedEntry={unstashCommittedEntry}
        onOpenCommittedStashInGraph={openCommittedStashInGraph}
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
          void handleParsedPreview(documentId, titleSnapshot);
        }}
      />

      {contextMenu &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-50 w-56 max-h-[calc(100vh-16px)] overflow-y-auto border border-border-default bg-surface-elevated p-1.5 "
            style={{
              top: contextMenuPosition.top,
              left: contextMenuPosition.left,
              backgroundColor: "var(--bg-surface-elevated)",
            }}
            role="menu"
          >
            {/* Hash label */}
            <div className="px-2 py-1 mb-0.5 flex items-center gap-1.5">
              <GitCommitHorizontal className="h-3.5 w-3.5 text-text-muted" />
              <code className="text-[11px] font-mono text-primary-400">
                {shortHash(contextMenu.entry.id)}
              </code>
              <span className="text-[10px] text-text-muted truncate">
                {contextMenu.entry.created_at &&
                  new Date(contextMenu.entry.created_at).toLocaleString(
                    undefined,
                    {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    },
                  )}
              </span>
            </div>
            <div className="h-px bg-border-subtle mb-0.5" />

            {/* Inspect / Copy */}
            <div className="mb-0.5 px-1.5 pt-0.5 pb-0.5 text-[9px] uppercase tracking-widest text-text-muted font-semibold">
              inspect
            </div>
            <button
              onClick={() => handleContextAction("copy-sha")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Copy className="h-3.5 w-3.5 text-text-muted" />
              Copy commit SHA
            </button>
            <button
              onClick={() => handleContextAction("copy-content")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Eye className="h-3.5 w-3.5 text-text-muted" />
              Copy commit content
            </button>
            <button
              onClick={() => handleContextAction("diff")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <GitCompare className="h-3.5 w-3.5 text-text-muted" />
              Compare with parent
            </button>

            <div className="my-1 h-px bg-border-subtle" />

            {/* Modify */}
            <div className="mb-0.5 px-1.5 pt-0.5 pb-0.5 text-[9px] uppercase tracking-widest text-text-muted font-semibold">
              modify
            </div>
            <button
              onClick={() => handleContextAction("cherry-pick")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <RotateCcw className="h-3.5 w-3.5 text-text-muted rotate-180" />
              Cherry-pick commit
            </button>
            <button
              onClick={() => handleContextAction("branch")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <GitBranch className="h-3.5 w-3.5 text-text-muted" />
              Create branch here
            </button>
            <button
              onClick={() => handleContextAction("revert")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Undo2 className="h-3.5 w-3.5 text-text-muted" />
              Revert this commit
            </button>
            <button
              onClick={() => handleContextAction("tag")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Tag className="h-3.5 w-3.5 text-text-muted" />
              {tags[contextMenu.entry.id]
                ? `Edit tag (${tags[contextMenu.entry.id]})`
                : "Add tag"}
            </button>
            <button
              onClick={() => handleContextAction("stash")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              {stashedEntryIds.has(contextMenu.entry.id) ? (
                <>
                  <EyeOff className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">
                    Unstash commit
                  </span>
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5 text-text-muted" />
                  Stash commit
                </>
              )}
            </button>

            <div className="my-1 h-px bg-border-subtle" />

            {/* Danger */}
            <div className="mb-0.5 px-1.5 pt-0.5 pb-0.5 text-[9px] uppercase tracking-widest text-text-muted font-semibold">
              danger
            </div>
            <button
              onClick={() => handleContextAction("reset")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
              Reset branch to this commit
            </button>
            <button
              onClick={() => handleContextAction("delete")}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete commit
            </button>
          </div>,
          document.body,
        )}

      {/* ─── Diff Modal ───────────────────────────────────────────────────────── */}
      {diffTarget &&
        createPortal(
          <DiffModal
            entry={diffTarget.entry}
            prevEntry={diffTarget.prevEntry}
            onClose={() => setDiffTarget(null)}
          />,
          document.body,
        )}

      {/* ─── Tag Modal ────────────────────────────────────────────────────────── */}
      {tagTarget &&
        createPortal(
          <TagModal
            entryId={tagTarget.id}
            currentTag={tags[tagTarget.id] ?? null}
            onSave={(tag) => saveTag(tagTarget.id, tag)}
            onClose={() => setTagTarget(null)}
          />,
          document.body,
        )}
    </div>
      <ConfirmDialog
        open={Boolean(mergeConfirm)}
        title={
          mergeConfirm
            ? mergeConfirm.mode === "fast-forward"
              ? `Fast-forward ${mergeConfirm.targetBranchName}?`
              : `Merge ${mergeConfirm.sourceBranchName} into ${mergeConfirm.targetBranchName}?`
            : ""
        }
        description={
          mergeConfirm ? (
            mergeConfirm.mode === "fast-forward" ? (
              <div className="space-y-1">
                <p className="text-xs font-mono text-text-default">
                  {mergeConfirm.targetBranchName} {"->"} {shortHash(mergeConfirm.sourceHeadId)}
                </p>
                <p className="text-sm text-text-muted">
                  This will move the current branch pointer forward without creating a new commit.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-mono text-text-default">
                  merge {mergeConfirm.sourceBranchName} into {mergeConfirm.targetBranchName}
                </p>
                <p className="text-sm text-text-muted">
                  This app will create a new commit on {mergeConfirm.targetBranchName} using the source branch head content.
                </p>
              </div>
            )
          ) : null
        }
        confirmLabel={
          mergeConfirm?.mode === "fast-forward" ? "Fast-forward" : "Create merge commit"
        }
        cancelLabel="Cancel"
        onCancel={() => setMergeConfirm(null)}
        onConfirm={() => void handleConfirmMerge()}
      />
      <TextInputDialog
        open={Boolean(branchDialog)}
        title={branchDialog?.title ?? ""}
        description={branchDialog?.description}
        value={branchDialogName}
        label="Branch name"
        placeholder="feature/new-branch"
        confirmLabel={branchDialog?.confirmLabel ?? "Save"}
        cancelLabel="Cancel"
        loading={branchDialogLoading}
        error={branchDialogError}
        onChange={(value) => {
          setBranchDialogName(value);
          if (branchDialogError) setBranchDialogError(null);
        }}
        onCancel={closeBranchDialog}
        onConfirm={() => void handleSubmitBranchDialog()}
      />
      <ConfirmDialog
        open={Boolean(entryConfirm)}
        title={
          entryConfirm
            ? entryConfirm.type === "reset"
              ? `Reset entry ${shortHash(entryConfirm.entry.id)}?`
              : `Delete entry ${shortHash(entryConfirm.entry.id)}?`
            : ""
        }
        description={
          entryConfirm ? (
            entryConfirm.type === "reset" ? (
              <div className="space-y-1">
                <p className="text-xs font-mono text-text-default">
                  git reset --hard {shortHash(entryConfirm.entry.id)}
                </p>
                <p className="text-sm text-text-muted">
                  This will delete all entries newer than this one.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-mono text-text-default">
                  git rm -- entry {shortHash(entryConfirm.entry.id)}
                </p>
                <p className="text-sm text-text-muted">
                  Delete this entry from history.
                </p>
              </div>
            )
          ) : null
        }
        confirmLabel={
          entryConfirm?.type === "reset" ? "Reset entry" : "Delete entry"
        }
        cancelLabel="Cancel"
        destructive={entryConfirm?.type === "delete"}
        loading={
          entryConfirm?.type === "reset"
            ? resetToEntry.isPending
            : deleteEntry.isPending
        }
        onCancel={() => setEntryConfirm(null)}
        onConfirm={handleConfirmEntryAction}
      />
    </>
  );
}
