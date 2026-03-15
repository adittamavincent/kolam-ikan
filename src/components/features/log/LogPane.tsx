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
import { EntryCreator } from "./EntryCreator";
import { LogSection } from "./LogSection";
import {
  PdfAttachmentPreviewData,
  PdfAttachmentPreviewDialog,
  ParsedPreviewData,
} from "./PdfAttachmentPreviewDialog";
import { CanvasSnapshotCard } from "./CanvasSnapshotCard";
import { CanvasDraftCard } from "./CanvasDraftCard";
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
} from "lucide-react";
import { createPortal } from "react-dom";
import { exportEntriesToMarkdown, downloadMarkdown } from "@/lib/utils/export";
import { EntryWithSections, SectionPdfAttachmentWithDocument } from "@/lib/types";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { PartialBlock } from "@blocknote/core";
import { useParams } from "next/navigation";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract plain text from BlockNote content_json for diffing / copying */
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

type EntryConfirmType = "reset" | "delete";

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

const STASH_KEY = (streamId: string) => `kolam_stash_${streamId}`;

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
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] flex flex-col  border border-border-default bg-surface-default shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-text-muted" />
            <span className="text-sm font-semibold text-text-default">
              git diff
            </span>
            <code className="text-[11px] bg-surface-subtle text-text-muted  px-1.5 py-0.5 font-mono">
              {prevEntry ? shortHash(prevEntry.id) : "0000000"}..
              {shortHash(entry.id)}
            </code>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-emerald-500">
              +{additions}
            </span>
            <span className="text-[11px] font-mono text-rose-500">
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
              No previous entry — showing full content as additions
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
                    ? "bg-emerald-500/8 text-emerald-600 dark:text-emerald-400"
                    : line.type === "del"
                      ? "bg-rose-500/8 text-rose-600 dark:text-rose-400 line-through opacity-70"
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
      className="fixed inset-0 z-200 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xs  border border-border-default bg-surface-default p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Tag className="h-4 w-4 text-text-muted" />
          <span className="text-sm font-semibold text-text-default">
            git tag
          </span>
          <code className="text-[11px] bg-surface-subtle text-text-muted  px-1.5 py-0.5 font-mono">
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
          className="w-full  border border-border-default bg-surface-subtle px-3 py-1.5 text-xs text-text-default focus:border-border-default focus: focus: focus: mb-3"
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
  sections: Record<string, PartialBlock[]>;
}

interface LogPaneProps {
  streamId: string;
  logWidth: number;
  forceWidth?: number;
}

// ─── LogPane ─────────────────────────────────────────────────────────────────

export function LogPane({ streamId, logWidth, forceWidth }: LogPaneProps) {
  const supabase = createClient();
  const [hasHydrated, setHasHydrated] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterPersonaId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [highlightTerm, setHighlightTerm] = useState<string | null>(null);
  const [highlightEntryId, setHighlightEntryId] = useState<string | null>(null);
  const [amendState, setAmendState] = useState<AmendState | null>(null);
  const [amendError, setAmendError] = useState<string | null>(null);
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
  const [stashedIds, setStashedIds] = useState<Set<string>>(new Set());
  const [showStash, setShowStash] = useState(false);
  const [tags, setTags] = useState<Record<string, string>>({}); // entryId → tag label
  const [currentBranch, setCurrentBranch] = useState("main");
  const [graphView, setGraphView] = useState(false);
  const entryRefs = useRef<Record<string, HTMLDivElement | null>>({});
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
    useState<PdfAttachmentPreviewData | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<"pdf" | "parsed">(
    "pdf",
  );
  const [parsedPreview, setParsedPreview] = useState<ParsedPreviewData | null>(
    null,
  );
  const [parsedPreviewLoading, setParsedPreviewLoading] = useState(false);
  const [parsedPreviewError, setParsedPreviewError] = useState<string | null>(
    null,
  );
  const params = useParams();
  const domainId = (params?.domain as string | undefined) ?? "";

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    const raw = sessionStorage.getItem("kolam_search_highlight");
    if (!raw) return;
    try {
      const payload = JSON.parse(raw) as {
        term: string;
        target: "log" | "canvas";
        entryId?: string | null;
        streamId?: string;
      };
      if (payload.target === "log" && payload.streamId === streamId) {
        setSearchTerm(payload.term);
        setHighlightTerm(payload.term);
        setHighlightEntryId(payload.entryId ?? null);
        sessionStorage.removeItem("kolam_search_highlight");
      }
    } finally {
    }
  }, [streamId]);

  const scrollToHighlighted = useCallback(() => {
    if (!highlightEntryId) return;
    const ref = entryRefs.current[highlightEntryId];
    if (ref) ref.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightEntryId]);

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
    search: debouncedSearch,
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
  const { timelineItems } = useTimelineItems(streamId, entryList, {
    sortOrder,
  });

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

  const openLogParsedPreview = useCallback(
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

  const openLogAttachmentPreview = useCallback(
    async (
      attachment: SectionPdfAttachmentWithDocument,
      preferredTab?: "pdf" | "parsed",
    ) => {
      const importStatus =
        attachment.document?.import_status ??
        attachment.document?.latestJob?.status ??
        undefined;
      const documentId = attachment.document_id ?? attachment.document?.id;
      const title =
        attachment.title_snapshot ||
        attachment.document?.title ||
        "Attached PDF";

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
        (isParsedReadyStatus(importStatus) && documentId ? "parsed" : "pdf");

      setAttachmentPreview({
        documentId,
        title,
        previewUrl,
        importStatus,
      });
      setActivePreviewTab(nextTab);
      setParsedPreview(null);
      setParsedPreviewError(null);

      if (nextTab === "parsed" && documentId) {
        void openLogParsedPreview(documentId, title);
      }
    },
    [openLogParsedPreview, supabase],
  );

  const closeLogAttachmentPreview = useCallback(() => {
    if (parsedPreviewLoading) return;
    setAttachmentPreview(null);
    setParsedPreview(null);
    setParsedPreviewError(null);
    setActivePreviewTab("pdf");
  }, [parsedPreviewLoading]);

  const handleLogAttachmentPreview = useCallback(
    (attachment: SectionPdfAttachmentWithDocument, tab: "pdf" | "parsed") => {
      void openLogAttachmentPreview(attachment, tab);
    },
    [openLogAttachmentPreview],
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

  const { data: commitBranches, refetch: refetchCommitBranches } = useQuery({
    queryKey: ["commit-branches", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commit_branches")
        .select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!streamId,
  });

  const { data: currentBranchHeadEntry } = useQuery({
    queryKey: [
      "branch-head-entry",
      streamId,
      currentBranch,
      branches,
      commitBranches,
    ],
    queryFn: async () => {
      const branch = branches?.find((b) => b.name === currentBranch);
      if (!branch) return null;

      const { data: branchLinks, error: branchLinksError } = await supabase
        .from("commit_branches")
        .select("commit_id")
        .eq("branch_id", branch.id);

      if (branchLinksError) throw branchLinksError;
      if (!branchLinks || branchLinks.length === 0) return null;

      const commitIds = branchLinks.map((link) => link.commit_id);

      const { data: headEntry, error: headEntryError } = await supabase
        .from("entries")
        .select("id,created_at")
        .in("id", commitIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (headEntryError) throw headEntryError;
      return headEntry;
    },
    enabled: !!streamId && !!currentBranch,
  });

  useEffect(() => {
    scrollToHighlighted();
  }, [entryList, scrollToHighlighted]);

  // ─── Stash helpers ─────────────────────────────────────────────────────────

  const toggleStash = (entryId: string) => {
    setStashedIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      localStorage.setItem(STASH_KEY(streamId), JSON.stringify([...next]));
      return next;
    });
  };

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
        await navigator.clipboard.writeText(shortHash(entry.id));
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
        const requestedName = window.prompt("Branch name", defaultBranchName);
        if (requestedName === null) break;

        const branchName = requestedName.trim();
        if (!branchName) {
          window.alert("Branch name is required.");
          break;
        }

        let targetBranch =
          branches?.find((branch) => branch.name === branchName) ?? null;

        if (!targetBranch) {
          const { data, error } = await supabase
            .from("branches")
            .insert({ stream_id: streamId, name: branchName })
            .select("id,name,stream_id,created_at,updated_at")
            .single();

          if (error) {
            const message = getSupabaseErrorMessage(error);
            console.error("Failed to create branch:", message, error);
            window.alert(`Failed to create branch: ${message}`);
            break;
          }

          targetBranch = data;
        }

        if (targetBranch) {
          const { error: resetBranchError } = await supabase
            .from("commit_branches")
            .delete()
            .eq("branch_id", targetBranch.id);

          if (resetBranchError) {
            const message = getSupabaseErrorMessage(resetBranchError);
            console.error(
              "Failed to move branch pointer:",
              message,
              resetBranchError,
            );
            window.alert(`Failed to move branch pointer: ${message}`);
            break;
          }

          const { error: commitError } = await supabase
            .from("commit_branches")
            .insert({ commit_id: entry.id, branch_id: targetBranch.id });

          if (commitError) {
            const message = getSupabaseErrorMessage(commitError);
            console.error(
              "Failed to associate commit with branch:",
              message,
              commitError,
            );
            window.alert(`Failed to associate commit with branch: ${message}`);
            break;
          }

          refetchBranches();
          refetchCommitBranches();
          setCurrentBranch(branchName);
        }

        break;
      }
      case "revert":
        revertEntry.mutate(entry);
        break;
      case "diff": {
        // find the previous entry in the flat sorted list
        const flatEntries = branchEntries.filter((e) => !e.is_draft);
        const idx = flatEntries.findIndex((e) => e.id === entry.id);
        const prevEntry =
          idx < flatEntries.length - 1 ? flatEntries[idx + 1] : null;
        setDiffTarget({ entry, prevEntry });
        break;
      }
      case "tag":
        setTagTarget(entry);
        break;
      case "stash":
        toggleStash(entry.id);
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
    const sections = Object.fromEntries(
      (entry.sections ?? []).map((section) => [
        section.id,
        ((section.content_json as unknown as PartialBlock[]) ??
          []) as PartialBlock[],
      ]),
    );
    setAmendState({ entryId: entry.id, sections });
    setAmendError(null);
  };

  const handleCancelAmend = () => {
    setAmendState(null);
    setAmendError(null);
  };

  const handleSaveAmend = async (entry: EntryWithSections) => {
    if (!amendState || amendState.entryId !== entry.id) return;
    const changedSections = (entry.sections ?? []).flatMap((section) => {
      const draftBlocks = amendState.sections[section.id];
      if (!draftBlocks) return [];
      const original = JSON.stringify(
        (section.content_json as unknown as PartialBlock[]) ?? [],
      );
      const updated = JSON.stringify(draftBlocks);
      if (original === updated) return [];
      return [{ sectionId: section.id, content: draftBlocks }];
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

  const currentBranchCutoffMs = useMemo(() => {
    if (!currentBranchHeadEntry?.created_at) return null;
    const ts = new Date(currentBranchHeadEntry.created_at).getTime();
    return Number.isFinite(ts) ? ts : null;
  }, [currentBranchHeadEntry]);

  const branchTimelineItems = useMemo(() => {
    if (currentBranchCutoffMs === null) return timelineItems;
    return timelineItems.filter((item) => {
      const itemTs = new Date(item.created_at).getTime();
      return Number.isFinite(itemTs) && itemTs <= currentBranchCutoffMs;
    });
  }, [timelineItems, currentBranchCutoffMs]);

  const branchEntries = useMemo(
    () =>
      branchTimelineItems
        .filter((item) => item.type === "entry")
        .map((item) => item.data),
    [branchTimelineItems],
  );

  const visibleEntries = showStash
    ? branchEntries
    : branchEntries.filter((e) => !stashedIds.has(e.id));

  const stashCount = stashedIds.size;
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
    if (!branches || !commitBranches) return map;

    for (const commitBranch of commitBranches) {
      const branch = branches.find((b) => b.id === commitBranch.branch_id);
      if (branch) {
        const existing = map.get(commitBranch.commit_id) ?? [];
        existing.push(branch.name);
        map.set(commitBranch.commit_id, existing);
      }
    }
    return map;
  }, [branches, commitBranches]);

  const branchNames = useMemo(() => {
    const names = (branches ?? []).map((branch) => branch.name);
    if (!names.includes("main")) names.unshift("main");
    return [...new Set(names)];
  }, [branches]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onExport = () => {
      void handleExport();
    };

    const onToggleGraph = () => {
      setGraphView((prev) => !prev);
    };

    const onToggleStash = () => {
      setShowStash((prev) => !prev);
    };

    const onToggleSort = () => {
      setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"));
    };

    const onSetBranch = (event: Event) => {
      const detail = (event as CustomEvent<{ branchName?: string }>).detail;
      if (typeof detail?.branchName === "string" && detail.branchName.trim()) {
        setCurrentBranch(detail.branchName.trim());
      }
    };

    const onCreateBranch = async (event: Event) => {
      const detail = (event as CustomEvent<{ branchName?: string }>).detail;
      const branchName = detail?.branchName?.trim();
      if (!branchName) return;

      const existingBranch = branches?.find(
        (branch) => branch.name === branchName,
      );
      if (existingBranch) {
        setCurrentBranch(existingBranch.name);
        return;
      }

      const { data: createdBranch, error: createError } = await supabase
        .from("branches")
        .insert({ stream_id: streamId, name: branchName })
        .select("id,name,stream_id,created_at,updated_at")
        .single();

      if (createError || !createdBranch) {
        console.error("Failed to create branch:", createError);
        window.alert("Failed to create branch. Please try another name.");
        return;
      }

      const branchHeadCommitId = currentBranchHeadEntry?.id ?? headEntryId;

      if (branchHeadCommitId) {
        const { error: linkError } = await supabase
          .from("commit_branches")
          .insert({
            commit_id: branchHeadCommitId,
            branch_id: createdBranch.id,
          });

        if (linkError) {
          console.error(
            "Failed to point new branch at current head:",
            linkError,
          );
          window.alert(
            "Branch created, but failed to point it to the current head.",
          );
        }
      }

      await refetchBranches();
      await refetchCommitBranches();
      setCurrentBranch(branchName);
    };

    const onSearch = (event: Event) => {
      const detail = (event as CustomEvent<{ term?: string }>).detail;
      if (typeof detail?.term === "string") {
        setSearchTerm(detail.term);
      }
    };

    window.addEventListener("kolam_header_log_export", onExport);
    window.addEventListener("kolam_header_log_toggle_graph", onToggleGraph);
    window.addEventListener("kolam_header_log_toggle_stash", onToggleStash);
    window.addEventListener("kolam_header_log_toggle_sort", onToggleSort);
    window.addEventListener(
      "kolam_header_log_set_branch",
      onSetBranch as EventListener,
    );
    window.addEventListener(
      "kolam_header_log_create_branch",
      onCreateBranch as EventListener,
    );
    window.addEventListener(
      "kolam_header_log_search_term",
      onSearch as EventListener,
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
        "kolam_header_log_set_branch",
        onSetBranch as EventListener,
      );
      window.removeEventListener(
        "kolam_header_log_create_branch",
        onCreateBranch as EventListener,
      );
      window.removeEventListener(
        "kolam_header_log_search_term",
        onSearch as EventListener,
      );
    };
  }, [
    handleExport,
    branches,
    currentBranchHeadEntry?.id,
    headEntryId,
    supabase,
    streamId,
    refetchBranches,
    refetchCommitBranches,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("kolam_log_state", {
        detail: {
          streamId,
          currentBranch,
          commitCount: visibleEntries.length,
          showStash,
          stashCount,
          graphView,
          sortOrder,
          searchTerm,
          branchNames,
        },
      }),
    );
  }, [
    streamId,
    currentBranch,
    visibleEntries.length,
    showStash,
    stashCount,
    graphView,
    sortOrder,
    searchTerm,
    branchNames,
  ]);

  return (
    <>
      <div
        className={`border-r border-border-default bg-surface-default relative overflow-hidden z-30 flex flex-col ${isVisible ? "" : "pointer-events-none"}`}
        style={containerStyle}
      >
      <div className="flex h-full flex-col" style={contentStyle}>
        {/* Content: Graph View OR Commit List */}
        {graphView ? (
          <div className="flex-1 overflow-hidden">
            <CommitGraph
              currentStreamId={streamId}
              domainId={domainId}
              tags={tags}
              latestEntryId={latestEntryId ?? null}
              onEntryClick={(_streamId, entryId) => {
                setGraphView(false);
                // After switching back to list, scroll to the entry
                setTimeout(() => {
                  const ref = entryRefs.current[entryId];
                  if (ref)
                    ref.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 150);
              }}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overscroll-contain px-2">
            <div className="py-2">
              {sortOrder === "newest" && (
                <div className="mb-2 space-y-1.5">
                  <EntryCreator
                    key={streamId}
                    streamId={streamId}
                    currentBranch={currentBranch}
                    onCurrentBranchChange={setCurrentBranch}
                  />
                  <CanvasDraftCard streamId={streamId} />
                </div>
              )}
              {showLoadingState ? (
                <div className="space-y-4 animate-pulse">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-28  bg-surface-subtle/50"
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
                        return (
                          <CanvasSnapshotCard
                            key={`snapshot-${item.data.id}`}
                            version={item.data}
                            streamId={streamId}
                          />
                        );
                      }

                      const entry = item.data;

                      // Hide stashed (unless showStash is on)
                      if (!showStash && stashedIds.has(entry.id)) return null;

                      const isLatestEntry = headEntryId === entry.id;
                      const isAmending = amendState?.entryId === entry.id;
                      const isStashed = stashedIds.has(entry.id);
                      const tag = tags[entry.id];
                      const hash = shortHash(entry.id);
                      const entryBranches =
                        branchesByEntryId.get(entry.id) ?? [];
                      const createdAtText = new Date(
                        entry.created_at || "",
                      ).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      });

                      return (
                        <div
                          key={entry.id}
                          ref={(node) => {
                            entryRefs.current[entry.id] = node;
                          }}
                          onContextMenu={(e) => handleContextMenu(e, entry)}
                          className={isStashed ? "opacity-50" : undefined}
                        >
                          <div
                            className={`relative group  border bg-surface-default transition-all ${isAmending ? "border-border-default/50  " : "border-border-default/50 "}`}
                          >
                            {/* Commit header — mimics git log --oneline */}
                            <div
                              className={`flex items-center px-2.5 py-0.5 bg-action-primary-bg/10 ${
                                (entry.sections?.length ?? 0) > 0
                                  ? "border-t border-l border-r border-border-default/30"
                                  : "border border-border-default/30"
                              }`}
                            >
                              <div className="flex w-full items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <GitCommitHorizontal className="h-3 w-3 text-text-muted shrink-0" />
                                  {/* Short hash */}
                                  <span className="relative shrink-0 group/hash">
                                    <code className="text-[10px] font-mono text-action-primary-bg/80 cursor-help">
                                      {hash}
                                    </code>
                                    <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-64  border border-border-default bg-surface-elevated p-2 text-[10px] font-mono text-text-default shadow-xl group-hover/hash:block">
                                      <div className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">
                                        Commit Metadata
                                      </div>
                                      <div>hash: {hash}</div>
                                      <div className="truncate">
                                        id: {entry.id}
                                      </div>
                                      <div>time: {createdAtText}</div>
                                      <div>
                                        sections: {entry.sections?.length ?? 0}
                                      </div>
                                      <div>tag: {tag || "-"}</div>
                                      <div>
                                        stashed: {isStashed ? "yes" : "no"}
                                      </div>
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
                                  <Calendar className="h-3 w-3 text-text-muted shrink-0" />
                                  <span className="text-[10px] font-medium text-text-subtle font-mono truncate">
                                    {createdAtText}
                                  </span>
                                  {/* Tag badge */}
                                  {tag && (
                                    <span className="shrink-0 flex items-center gap-0.5  border border-border-default/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                                      <Tag className="h-2.5 w-2.5" />
                                      {tag}
                                    </span>
                                  )}
                                  {isLatestEntry && (
                                    <span className="shrink-0 inline-flex items-center  border border-border-default/30 bg-action-primary-bg/10 px-2 py-0.5 text-[10px] font-semibold text-action-primary-bg">
                                      HEAD
                                    </span>
                                  )}
                                  {isStashed && (
                                    <span className="shrink-0 flex items-center gap-0.5  border border-border-default/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-500">
                                      <Archive className="h-2.5 w-2.5" />
                                      stashed
                                    </span>
                                  )}
                                </div>

                                {/* Action buttons on latest / amending */}
                                <div className="flex items-center gap-1 shrink-0">
                                  {isAmending ? (
                                    <>
                                      <button
                                        onClick={() => handleSaveAmend(entry)}
                                        disabled={amendEntry.isPending}
                                        className="inline-flex items-center gap-1  bg-action-primary-bg px-2 py-1 text-[10px] font-semibold text-action-primary-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                                      >
                                        {amendEntry.isPending ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Check className="h-3 w-3" />
                                        )}
                                        Save
                                      </button>
                                      <button
                                        onClick={handleCancelAmend}
                                        disabled={amendEntry.isPending}
                                        className="inline-flex items-center gap-1  border border-border-default px-2 py-1 text-[10px] font-semibold text-text-subtle transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-70"
                                      >
                                        <X className="h-3 w-3" />
                                        Cancel
                                      </button>
                                    </>
                                  ) : isLatestEntry ? (
                                    <button
                                      onClick={() => handleStartAmend(entry)}
                                      className="inline-flex items-center gap-1  border border-border-default px-1 py-px text-[10px] font-semibold text-text-subtle transition-colors hover:bg-surface-subtle"
                                      title="git commit --amend"
                                    >
                                      <PencilLine className="h-3 w-3" />
                                      --amend
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            {isAmending && amendError && (
                              <div className="px-2.5 py-1 text-[11px] text-danger-text bg-danger-bg/15 border-b border-danger-border/30">
                                {amendError}
                              </div>
                            )}

                            <div className="flex flex-col divide-y divide-border-subtle/30">
                              {entry.sections?.map(
                                (
                                  section: EntryWithSections["sections"][number],
                                ) => (
                                  <LogSection
                                    key={section.id}
                                    section={section}
                                    streamId={streamId}
                                    onPreviewAttachment={handleLogAttachmentPreview}
                                    editable={isAmending}
                                    onContentChange={(content) => {
                                      if (!isAmending) return;
                                      setAmendState((prev) => {
                                        if (!prev || prev.entryId !== entry.id)
                                          return prev;
                                        return {
                                          ...prev,
                                          sections: {
                                            ...prev.sections,
                                            [section.id]: content,
                                          },
                                        };
                                      });
                                    }}
                                    highlightTerm={
                                      entry.id === highlightEntryId
                                        ? (highlightTerm ?? undefined)
                                        : undefined
                                    }
                                  />
                                ),
                              )}
                            </div>
                          </div>
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
                      />
                    </div>
                  )}

                  {hasNextPage && (
                    <div className="flex justify-center pt-2 pb-1">
                      <button
                        onClick={() => fetchNextPage()}
                        disabled={isFetchingNextPage}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-text-muted hover:text-text-default bg-surface-subtle hover:bg-surface-subtle/80  transition-colors disabled:opacity-50"
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
      <PdfAttachmentPreviewDialog
        open={!!attachmentPreview}
        onClose={closeLogAttachmentPreview}
        attachmentPreview={attachmentPreview}
        activePreviewTab={activePreviewTab}
        onActivePreviewTabChange={setActivePreviewTab}
        parsedPreview={parsedPreview}
        parsedPreviewLoading={parsedPreviewLoading}
        parsedPreviewError={parsedPreviewError}
        onRequestParsedPreview={(documentId, titleSnapshot) => {
          void openLogParsedPreview(documentId, titleSnapshot);
        }}
      />

      {contextMenu &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-50 w-56 max-h-[calc(100vh-16px)] overflow-y-auto  border border-border-default bg-surface-elevated p-1.5 shadow-2xl  "
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
              <code className="text-[11px] font-mono text-action-primary-bg/80">
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
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Copy className="h-3.5 w-3.5 text-text-muted" />
              Copy SHA
            </button>
            <button
              onClick={() => handleContextAction("copy-content")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Eye className="h-3.5 w-3.5 text-text-muted" />
              Copy content
            </button>
            <button
              onClick={() => handleContextAction("diff")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <GitCompare className="h-3.5 w-3.5 text-text-muted" />
              Diff with previous
            </button>

            <div className="my-1 h-px bg-border-subtle" />

            {/* Modify */}
            <div className="mb-0.5 px-1.5 pt-0.5 pb-0.5 text-[9px] uppercase tracking-widest text-text-muted font-semibold">
              modify
            </div>
            <button
              onClick={() => handleContextAction("cherry-pick")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <RotateCcw className="h-3.5 w-3.5 text-text-muted rotate-180" />
              cherry-pick
            </button>
            <button
              onClick={() => handleContextAction("branch")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <GitBranch className="h-3.5 w-3.5 text-text-muted" />
              branch from here
            </button>
            <button
              onClick={() => handleContextAction("revert")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Undo2 className="h-3.5 w-3.5 text-text-muted" />
              revert
            </button>
            <button
              onClick={() => handleContextAction("tag")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <Tag className="h-3.5 w-3.5 text-text-muted" />
              {tags[contextMenu.entry.id]
                ? `tag: ${tags[contextMenu.entry.id]}`
                : "tag"}
            </button>
            <button
              onClick={() => handleContextAction("stash")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              {stashedIds.has(contextMenu.entry.id) ? (
                <>
                  <EyeOff className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">
                    stash pop
                  </span>
                </>
              ) : (
                <>
                  <Archive className="h-3.5 w-3.5 text-text-muted" />
                  stash
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
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
              reset --hard
            </button>
            <button
              onClick={() => handleContextAction("delete")}
              className="flex w-full items-center gap-2  px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              rm (delete)
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
