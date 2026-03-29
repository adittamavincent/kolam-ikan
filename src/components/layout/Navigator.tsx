"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter, usePathname } from "next/navigation";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  Trash2,
  Pencil,
  Copy,
  Move,
  Info,
  X,
  FilePlus,
  FolderPlus,
  PanelLeftClose,
} from "lucide-react";
import {
  Fragment,
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  Cabinet,
  CabinetInsert,
  CabinetUpdate,
  Canvas,
  CanvasInsert,
  DocumentEntryLinkInsert,
  DocumentInsert,
  Entry,
  EntryInsert,
  Section,
  SectionFileAttachmentInsert,
  SectionInsert,
  Stream,
  StreamInsert,
  StreamKind,
  StreamUpdate,
  STREAM_KIND,
} from "@/lib/types";
import { cloneStoredContentFields } from "@/lib/content-protocol";
import { useSidebar } from "@/lib/hooks/useSidebar";
import { useAuth } from "@/lib/hooks/useAuth";
import { useNavigatorPreferences } from "@/lib/hooks/useNavigatorPreferences";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import {
  applyOptimisticCabinetCreation,
  applyOptimisticStreamCreation,
  getNextSortOrder,
  getVisibleActiveNodeId,
  resolveCreationTarget,
  isCreationAllowed,
} from "@/lib/utils/navigation";
import { useKeyboard } from "@/lib/hooks/useKeyboard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";

type CreationItem = {
  type: "cabinet" | "stream";
  parentId: string | null;
};

type NavItemType = "cabinet" | "stream";

type Disambiguation = {
  index: number;
  total: number;
};

function buildDisambiguationMap<
  T extends { id: string; name: string; sort_order: number },
>(items: T[] | undefined, getParentId: (item: T) => string | null) {
  const map = new Map<string, Disambiguation>();
  if (!items?.length) return map;

  const groups = new Map<string, T[]>();
  items.forEach((item) => {
    const key = `${getParentId(item) ?? "root"}::${item.name}`;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  });

  groups.forEach((group) => {
    if (group.length < 2) return;
    const sorted = [...group].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id.localeCompare(b.id);
    });
    sorted.forEach((item, index) => {
      map.set(item.id, { index: index + 1, total: sorted.length });
    });
  });

  return map;
}

const ALIGNMENT_COLUMN_REM = 1.5;
const POSITION_GROUP_CENTER_REM = [
  0.75, 2.25, 3.75, 5.25, 6.75, 8.25, 9.75, 11.25,
];
const getPositionGroupCenterRem = (groupIndex: number) =>
  POSITION_GROUP_CENTER_REM[groupIndex - 1] ??
  (groupIndex - 0.5) * ALIGNMENT_COLUMN_REM;
const getCabinetPaddingRem = (depth: number) => depth * ALIGNMENT_COLUMN_REM;
const getStreamPaddingRem = (depth: number) =>
  (depth + 1) * ALIGNMENT_COLUMN_REM;
const getBorderCenterRem = (depth: number) =>
  getPositionGroupCenterRem(depth + 1);
const LEGACY_GLOBAL_STREAM_SORT_ORDER = -100;

const getStreamKind = (stream: Stream): StreamKind =>
  (stream.stream_kind as StreamKind) === STREAM_KIND.GLOBAL
    ? STREAM_KIND.GLOBAL
    : STREAM_KIND.REGULAR;

const isGlobalStream = (stream: Stream) =>
  getStreamKind(stream) === STREAM_KIND.GLOBAL;
const canDeleteStream = (stream: Stream) => !isGlobalStream(stream);

const ENTRY_CREATOR_DRAFT_STORAGE_PREFIX = "kolam_draft_v2_";
const ENTRY_CREATOR_STASH_STORAGE_PREFIX = "kolam_entry_creator_stash_v1_";
const CANVAS_PREVIEW_STASH_STORAGE_PREFIX = "kolam_canvas_preview_stash_v1_";

type PersistedCanvasDraftState = {
  state?: {
    liveContentByStream?: Record<string, unknown>;
    liveMarkdownByStream?: Record<string, string>;
    dbSyncStatusByStream?: Record<string, unknown>;
    localSaveStatusByStream?: Record<string, unknown>;
    _dirtyStreamsArr?: string[];
  };
  version?: number;
};

function copyLocalEntryCreatorDraftState(
  oldStreamId: string,
  newStreamId: string,
) {
  if (typeof window === "undefined") return;

  const sourceKey = `${ENTRY_CREATOR_DRAFT_STORAGE_PREFIX}${oldStreamId}`;
  const targetKey = `${ENTRY_CREATOR_DRAFT_STORAGE_PREFIX}${newStreamId}`;
  const sourceDraft = window.localStorage.getItem(sourceKey);
  if (sourceDraft) {
    window.localStorage.setItem(targetKey, sourceDraft);
  }

  const sourceStashKey = `${ENTRY_CREATOR_STASH_STORAGE_PREFIX}${oldStreamId}`;
  const targetStashKey = `${ENTRY_CREATOR_STASH_STORAGE_PREFIX}${newStreamId}`;
  const sourceStash = window.localStorage.getItem(sourceStashKey);
  if (sourceStash) {
    window.localStorage.setItem(targetStashKey, sourceStash);
  }
}

function copyLocalCanvasDraftState(oldStreamId: string, newStreamId: string) {
  if (typeof window === "undefined") return;

  const raw = window.localStorage.getItem("kolam-canvas-drafts");
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw) as PersistedCanvasDraftState;
    const state = parsed.state ?? {};

    const nextLive = { ...(state.liveContentByStream ?? {}) };
    const nextMarkdown = { ...(state.liveMarkdownByStream ?? {}) };
    const nextDbSync = { ...(state.dbSyncStatusByStream ?? {}) };
    const nextLocalSave = { ...(state.localSaveStatusByStream ?? {}) };
    const dirtySet = new Set(state._dirtyStreamsArr ?? []);

    if (oldStreamId in nextLive) {
      nextLive[newStreamId] = nextLive[oldStreamId];
    }
    if (oldStreamId in nextMarkdown) {
      nextMarkdown[newStreamId] = nextMarkdown[oldStreamId];
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

    const nextState: PersistedCanvasDraftState = {
      ...parsed,
      state: {
        ...state,
        liveContentByStream: nextLive,
        liveMarkdownByStream: nextMarkdown,
        dbSyncStatusByStream: nextDbSync,
        localSaveStatusByStream: nextLocalSave,
        _dirtyStreamsArr: Array.from(dirtySet),
      },
    };

    window.localStorage.setItem(
      "kolam-canvas-drafts",
      JSON.stringify(nextState),
    );

    useCanvasDraft.setState((current) => {
      const nextDirty = new Set(current.dirtyStreams);
      if (dirtySet.has(newStreamId)) {
        nextDirty.add(newStreamId);
      }

      return {
        ...current,
        dirtyStreams: nextDirty,
        liveContentByStream: {
          ...current.liveContentByStream,
          ...(newStreamId in nextLive
            ? { [newStreamId]: nextLive[newStreamId] as typeof current.liveContentByStream[string] }
            : {}),
        },
        liveMarkdownByStream: {
          ...current.liveMarkdownByStream,
          ...(newStreamId in nextMarkdown
            ? { [newStreamId]: nextMarkdown[newStreamId] ?? "" }
            : {}),
        },
        dbSyncStatusByStream: {
          ...current.dbSyncStatusByStream,
          ...(newStreamId in nextDbSync
            ? {
                [newStreamId]:
                  nextDbSync[newStreamId] as typeof current.dbSyncStatusByStream[string],
              }
            : {}),
        },
        localSaveStatusByStream: {
          ...current.localSaveStatusByStream,
          ...(newStreamId in nextLocalSave
            ? {
                [newStreamId]:
                  nextLocalSave[
                    newStreamId
                  ] as typeof current.localSaveStatusByStream[string],
              }
            : {}),
        },
      };
    });
  } catch {
    // Best effort only.
  }

  const sourcePreviewStashKey = `${CANVAS_PREVIEW_STASH_STORAGE_PREFIX}${oldStreamId}`;
  const targetPreviewStashKey = `${CANVAS_PREVIEW_STASH_STORAGE_PREFIX}${newStreamId}`;
  const sourcePreviewStash = window.localStorage.getItem(sourcePreviewStashKey);
  if (sourcePreviewStash) {
    window.localStorage.setItem(targetPreviewStashKey, sourcePreviewStash);
  }
}

interface CreationInputProps {
  type: "cabinet" | "stream";
  depth: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

const CreationInput = ({
  type,
  depth,
  onConfirm,
  onCancel,
}: CreationInputProps) => {
  const [name, setName] = useState(
    type === "cabinet" ? "New Cabinet" : "New Stream",
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (name.trim()) {
        onConfirm(name.trim());
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const paddingLeftRem =
    type === "cabinet"
      ? getCabinetPaddingRem(depth)
      : getStreamPaddingRem(depth);

  return (
    <div className="mb-0.5">
      <div
        className="flex items-center gap-2 pr-2 py-0 text-sm"
        style={{ paddingLeft: `calc(${paddingLeftRem}rem + 0.5rem)` }}
      >
        {type === "cabinet" ? (
          <div
            className="grid shrink-0"
            style={{
              gridTemplateColumns: `${ALIGNMENT_COLUMN_REM}rem ${ALIGNMENT_COLUMN_REM}rem`,
            }}
          >
            <div className="flex items-center justify-center">
              <div className="h-4 w-4" />
            </div>
            <div className="flex items-center justify-center">
              <Folder className="h-4 w-4 text-text-muted" />
            </div>
          </div>
        ) : (
          <div
            className="flex shrink-0 items-center justify-center"
            style={{ width: `${ALIGNMENT_COLUMN_REM}rem` }}
          >
            <FileText className="h-4 w-4 text-text-muted" />
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (name.trim()) onConfirm(name.trim());
            else onCancel();
          }}
          className="min-w-0 flex-1 bg-surface-default px-1 py-0.5 "
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
};

interface NavigatorProps {
  userId?: string;
}

interface CabinetNodeProps {
  cabinet: Cabinet;
  depth?: number;
  cabinetTree: {
    roots: Cabinet[];
    getChildren: (parentId: string) => Cabinet[];
  };
  streams: Stream[] | undefined;
  cabinetDisambiguation: Map<string, Disambiguation>;
  streamDisambiguation: Map<string, Disambiguation>;
  expandedCabinets: Set<string>;
  activeNode: { id: string; type: "cabinet" | "stream" } | null;
  editingItemId: string | null;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  setEditingName: (name: string) => void;
  handleKeyDown: (
    e: React.KeyboardEvent,
    id: string,
    type: "cabinet" | "stream",
  ) => void;
  handleRename: (
    id: string,
    newName: string,
    type: "cabinet" | "stream",
  ) => void;
  handleItemClick: (
    id: string,
    type: "cabinet" | "stream",
    name: string,
  ) => void;
  toggleCabinet: (id: string) => void;
  router: ReturnType<typeof useRouter>;
  domainId: string;
  handleCreateStream: (id: string) => void;
  handleCreateCabinet: (id: string) => void;
  handleContextMenu: (
    event: React.MouseEvent,
    id: string,
    type: NavItemType,
  ) => void;
  isStreamNewlyCreated: (id: string) => boolean;
  setEditingItemId: (id: string | null) => void;
  creatingItem: CreationItem | null;
  handleCreationConfirm: (name: string) => void;
  handleCreationCancel: () => void;
  onDragStart: (e: React.DragEvent, id: string, type: NavItemType) => void;
  onDragOver: (e: React.DragEvent, id: string | null) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, id: string | null) => void;
  onDragEnd: () => void;
  draggedItem: { id: string; type: NavItemType } | null;
  dragOverId: string | null;
  stripeIndices: Map<string, number>;
}

interface StreamNodeProps {
  stream: Stream;
  depth: number;
  displayName: string;
  kindBadge?: string;
  disambiguation?: Disambiguation;
  stripeIndex?: number;
  activeNode: { id: string; type: "cabinet" | "stream" } | null;
  editingItemId: string | null;
  editingName: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  setEditingName: (name: string) => void;
  handleKeyDown: (
    e: React.KeyboardEvent,
    id: string,
    type: "cabinet" | "stream",
  ) => void;
  handleRename: (
    id: string,
    newName: string,
    type: "cabinet" | "stream",
  ) => void;
  handleItemClick: (
    id: string,
    type: "cabinet" | "stream",
    name: string,
  ) => void;
  handleContextMenu: (
    event: React.MouseEvent,
    id: string,
    type: NavItemType,
  ) => void;
  isNewlyCreated: boolean;
  onDragStart: (e: React.DragEvent, id: string, type: NavItemType) => void;
  onDragOver: (e: React.DragEvent, id: string | null) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, id: string | null) => void;
  onDragEnd: () => void;
  draggedItem: { id: string; type: NavItemType } | null;
  dragOverId: string | null;
}

const StreamNode = ({
  stream,
  depth,
  displayName,
  kindBadge,
  disambiguation,
  stripeIndex,
  activeNode,
  editingItemId,
  editingName,
  editInputRef,
  setEditingName,
  handleKeyDown,
  handleRename,
  handleItemClick,
  handleContextMenu,
  isNewlyCreated,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  draggedItem,
  dragOverId,
}: StreamNodeProps) => {
  const isStreamActive =
    activeNode?.type === "stream" && activeNode.id === stream.id;
  const isStreamEditing = editingItemId === stream.id;
  const isDragged =
    draggedItem?.type === "stream" && draggedItem.id === stream.id;
  const isDragOver = dragOverId === stream.id;
  const disambiguationLabel = disambiguation
    ? `#${disambiguation.index}`
    : null;
  const ariaLabel = disambiguation
    ? `${displayName} (${disambiguation.index} of ${disambiguation.total})`
    : displayName;

  return (
    <div
      className={`group relative flex items-center transition-opacity duration-200 ${isDragged ? "opacity-40" : "opacity-100"}`}
      role="treeitem"
      aria-selected={isStreamActive}
      aria-label={ariaLabel}
      onDragOver={(e) => {
        e.stopPropagation();
        onDragOver(e, stream.id);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        onDragLeave(e);
      }}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop(e, stream.id);
      }}
    >
      <div
        className={`flex min-w-0 flex-1 items-center gap-2 pr-2 py-0.5 text-sm cursor-pointer
            ${
              isStreamActive
                ? "text-action-primary-bg font-semibold  "
                : "text-text-subtle hover:text-text-default"
            } ${!isStreamActive && isNewlyCreated ? " " : ""}
            ${stripeIndex !== undefined && stripeIndex % 2 === 1 ? "bg-slate-100/30 dark:bg-slate-800/30" : "bg-transparent"}
            ${isDragOver ? "  " : ""}`}
        style={{
          paddingLeft: `calc(${getStreamPaddingRem(depth)}rem + 0.5rem)`,
        }}
        draggable={!isStreamEditing}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(e, stream.id, "stream");
        }}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          if (!isStreamEditing) {
            handleItemClick(stream.id, "stream", stream.name);
          }
        }}
        onContextMenu={(event) => handleContextMenu(event, stream.id, "stream")}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleItemClick(stream.id, "stream", stream.name);
          }
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center"
          style={{ width: `${ALIGNMENT_COLUMN_REM}rem` }}
        >
          <FileText
            className={`h-4 w-4 ${
              isStreamActive
                ? "text-action-primary-bg"
                : "text-text-muted group-hover:text-text-subtle"
            }`}
          />
        </div>

        {isStreamEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, stream.id, "stream")}
            onBlur={() => handleRename(stream.id, editingName, "stream")}
            className="min-w-0 flex-1 bg-surface-default px-1 py-0.5 "
            onClick={(e) => e.stopPropagation()}
            autoFocus
            aria-label="Edit stream name"
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate flex-1 select-none">{displayName}</span>
            {kindBadge && (
              <span className="shrink-0 border border-border-subtle bg-primary-950 px-1.5 py-0.5 text-[10px] font-semibold text-action-primary-bg">
                {kindBadge}
              </span>
            )}
            {disambiguationLabel && (
              <span className="shrink-0 border border-border-default px-1.5 py-0.5 text-[10px] text-text-muted">
                {disambiguationLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const CabinetNode = ({
  cabinet,
  depth = 0,
  cabinetTree,
  streams,
  cabinetDisambiguation,
  streamDisambiguation,
  expandedCabinets,
  stripeIndices,
  activeNode,
  editingItemId,
  editingName,
  editInputRef,
  setEditingName,
  handleKeyDown,
  handleRename,
  handleItemClick,
  toggleCabinet,
  router,
  domainId,
  handleCreateStream,
  handleCreateCabinet,
  handleContextMenu,
  isStreamNewlyCreated,
  setEditingItemId,
  creatingItem,
  handleCreationConfirm,
  handleCreationCancel,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  draggedItem,
  dragOverId,
}: CabinetNodeProps) => {
  const children = cabinetTree.getChildren(cabinet.id);
  const cabinetStreams =
    streams?.filter((s) => s.cabinet_id === cabinet.id) || [];
  const isExpanded = expandedCabinets.has(cabinet.id);

  const isActive =
    activeNode?.type === "cabinet" && activeNode.id === cabinet.id;
  const isEditing = editingItemId === cabinet.id;
  const isDragged =
    draggedItem?.type === "cabinet" && draggedItem.id === cabinet.id;
  const isDragOver = dragOverId === cabinet.id;
  const disambiguation = cabinetDisambiguation.get(cabinet.id);
  const disambiguationLabel = disambiguation
    ? `#${disambiguation.index}`
    : null;
  const ariaLabel = disambiguation
    ? `${cabinet.name} (${disambiguation.index} of ${disambiguation.total})`
    : cabinet.name;

  const stripeIndex = stripeIndices?.get(cabinet.id);

  return (
    <div
      className={`mb-0.5 transition-opacity duration-200 ${isDragged ? "opacity-40" : "opacity-100"}`}
      role="treeitem"
      aria-expanded={isExpanded}
      aria-selected={isActive}
      aria-label={ariaLabel}
      onDragOver={(e) => {
        e.stopPropagation();
        onDragOver(e, cabinet.id);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        onDragLeave(e);
      }}
      onDrop={(e) => {
        e.stopPropagation();
        onDrop(e, cabinet.id);
      }}
    >
      <div
        className={`flex items-center gap-2 pr-2 py-0.5 text-sm group cursor-pointer
            ${
              isActive
                ? "text-action-primary-bg   font-medium"
                : "text-text-subtle"
            } ${stripeIndex !== undefined && stripeIndex % 2 === 1 ? "bg-slate-100/30 dark:bg-slate-800/30" : "bg-transparent"}
            ${isDragOver ? "  " : ""}`}
        style={{
          paddingLeft: `calc(${getCabinetPaddingRem(depth)}rem + 0.5rem)`,
        }}
        draggable={!isEditing}
        onDragStart={(e) => {
          e.stopPropagation();
          onDragStart(e, cabinet.id, "cabinet");
        }}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          e.stopPropagation();
          handleItemClick(cabinet.id, "cabinet", cabinet.name);
        }}
        onContextMenu={(event) =>
          handleContextMenu(event, cabinet.id, "cabinet")
        }
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleItemClick(cabinet.id, "cabinet", cabinet.name);
          }
          if (e.key === "ArrowRight" && !isExpanded) {
            e.preventDefault();
            toggleCabinet(cabinet.id);
          }
          if (e.key === "ArrowLeft" && isExpanded) {
            e.preventDefault();
            toggleCabinet(cabinet.id);
          }
        }}
      >
        <div
          className="grid shrink-0"
          style={{
            gridTemplateColumns: `${ALIGNMENT_COLUMN_REM}rem ${ALIGNMENT_COLUMN_REM}rem`,
          }}
        >
          <div className="flex items-center justify-center">
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleCabinet(cabinet.id);
              }}
              className="text-text-muted hover:text-text-subtle p-0.5 focus: focus: focus:"
              aria-label={isExpanded ? "Collapse cabinet" : "Expand cabinet"}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>
          <div className="flex items-center justify-center">
            <Folder
              className={`h-4 w-4 ${isActive ? "text-action-primary-bg" : "text-text-muted"}`}
            />
          </div>
        </div>

        {isEditing ? (
          <input
            ref={editInputRef}
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, cabinet.id, "cabinet")}
            onBlur={() => handleRename(cabinet.id, editingName, "cabinet")}
            className="min-w-0 flex-1 bg-surface-default px-1 py-0.5 "
            onClick={(e) => e.stopPropagation()}
            autoFocus
            aria-label="Edit cabinet name"
          />
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate flex-1 select-none">{cabinet.name}</span>
            {disambiguationLabel && (
              <span className="shrink-0 border border-border-default px-1.5 py-0.5 text-[10px] text-text-muted">
                {disambiguationLabel}
              </span>
            )}
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="relative" role="group">
          <div
            className="pointer-events-none absolute inset-y-0 w-0 border-border-default"
            style={{
              left: `${getBorderCenterRem(depth) + 0.5}rem`,
              borderLeftWidth: "0.0625rem",
              borderLeftStyle: "solid",
            }}
          />
          {/* Render Sub-Cabinets */}
          {children.map((child) => (
            <CabinetNode
              key={child.id}
              cabinet={child}
              depth={depth + 1}
              cabinetTree={cabinetTree}
              streams={streams}
              cabinetDisambiguation={cabinetDisambiguation}
              streamDisambiguation={streamDisambiguation}
              expandedCabinets={expandedCabinets}
              stripeIndices={stripeIndices}
              activeNode={activeNode}
              editingItemId={editingItemId}
              editingName={editingName}
              editInputRef={editInputRef}
              setEditingName={setEditingName}
              handleKeyDown={handleKeyDown}
              handleRename={handleRename}
              handleItemClick={handleItemClick}
              toggleCabinet={toggleCabinet}
              router={router}
              domainId={domainId}
              handleCreateStream={handleCreateStream}
              handleCreateCabinet={handleCreateCabinet}
              handleContextMenu={handleContextMenu}
              isStreamNewlyCreated={isStreamNewlyCreated}
              setEditingItemId={setEditingItemId}
              creatingItem={creatingItem}
              handleCreationConfirm={handleCreationConfirm}
              handleCreationCancel={handleCreationCancel}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              draggedItem={draggedItem}
              dragOverId={dragOverId}
            />
          ))}

          {creatingItem?.parentId === cabinet.id &&
            creatingItem.type === "cabinet" && (
              <CreationInput
                type="cabinet"
                depth={depth + 1}
                onConfirm={handleCreationConfirm}
                onCancel={handleCreationCancel}
              />
            )}

          {/* Render Streams */}
          {cabinetStreams.map((stream) => (
            <StreamNode
              key={stream.id}
              stream={stream}
              depth={depth + 1}
              displayName={stream.name}
              disambiguation={streamDisambiguation.get(stream.id)}
              stripeIndex={stripeIndices?.get(stream.id)}
              activeNode={activeNode}
              editingItemId={editingItemId}
              editingName={editingName}
              editInputRef={editInputRef}
              setEditingName={setEditingName}
              handleKeyDown={handleKeyDown}
              handleRename={handleRename}
              handleItemClick={handleItemClick}
              handleContextMenu={handleContextMenu}
              isNewlyCreated={isStreamNewlyCreated(stream.id)}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              draggedItem={draggedItem}
              dragOverId={dragOverId}
            />
          ))}

          {creatingItem?.parentId === cabinet.id &&
            creatingItem.type === "stream" && (
              <CreationInput
                type="stream"
                depth={depth + 1}
                onConfirm={handleCreationConfirm}
                onCancel={handleCreationCancel}
              />
            )}
        </div>
      )}
    </div>
  );
};

export function Navigator({}: NavigatorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const params = useParams();
  const pathname = usePathname();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const domainId = params?.domain as string | undefined;
  const activeStreamId = params?.stream as string | undefined;
  const { hide: hideSidebar } = useSidebar();
  const { user } = useAuth();
  const userId = user?.id;
  const {
    expandedCabinetIds,
    addExpandedCabinet,
    toggleExpandedCabinet,
  } = useNavigatorPreferences(domainId);

  const [draggedItem, setDraggedItem] = useState<{
    id: string;
    type: NavItemType;
  } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const autoExpandTimerRef = useRef<NodeJS.Timeout | null>(null);

  const expandedCabinets = useMemo(
    () => new Set(expandedCabinetIds),
    [expandedCabinetIds],
  );
  const [manualActiveNode, setManualActiveNode] = useState<{
    id: string;
    type: "cabinet" | "stream";
  } | null>(null);
  const [forceNoHighlight, setForceNoHighlight] = useState(false);
  // Track the last stream ID that triggered an auto-expand to prevent re-expanding on refresh/update
  const lastAutoExpandedStreamRef = useRef<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [creatingItem, setCreatingItem] = useState<CreationItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    type: NavItemType;
    x: number;
    y: number;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    type: NavItemType;
  } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{
    id: string;
    type: NavItemType;
  } | null>(null);
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [propertiesTarget, setPropertiesTarget] = useState<{
    id: string;
    type: NavItemType;
  } | null>(null);

  const handleDragStart = (
    e: React.DragEvent,
    id: string,
    type: NavItemType,
  ) => {
    setDraggedItem({ id, type });
    e.dataTransfer.setData("application/kolam-ikan-nav-item", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, id: string | null) => {
    e.preventDefault();
    if (!draggedItem) return;

    // Prevent dropping on self or own descendants
    if (draggedItem.id === id) {
      if (dragOverId !== null) setDragOverId(null);
      return;
    }

    if (draggedItem.type === "cabinet" && id) {
      const descendants = getDescendantIds(draggedItem.id);
      if (descendants.has(id)) {
        if (dragOverId !== null) setDragOverId(null);
        return;
      }
    }

    // Update dragOverId only if it changed to reduce re-renders/flicker
    if (dragOverId !== id) {
      setDragOverId(id);

      if (autoExpandTimerRef.current) {
        clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
      }

      if (id && !expandedCabinets.has(id)) {
        autoExpandTimerRef.current = setTimeout(() => {
          if (domainId) {
            addExpandedCabinet(domainId, id);
          }
          autoExpandTimerRef.current = null;
        }, 200);
      }
    }

    e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const { clientX, clientY } = e;

    // Only clear if we actually left the element's bounding box
    if (
      clientX < rect.left ||
      clientX >= rect.right ||
      clientY < rect.top ||
      clientY >= rect.bottom
    ) {
      setDragOverId(null);
      if (autoExpandTimerRef.current) {
        clearTimeout(autoExpandTimerRef.current);
        autoExpandTimerRef.current = null;
      }
    }
  };

  const handleDrop = (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    setDragOverId(null);
    if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current);
    if (!draggedItem) return;

    const { id, type } = draggedItem;
    if (id === targetId) return;

    if (type === "cabinet" && targetId) {
      const descendants = getDescendantIds(id);
      if (descendants.has(targetId)) return;
    }

    let finalTargetId = targetId;
    const targetStream = streams?.find((s) => s.id === targetId);
    if (targetStream) {
      finalTargetId = targetStream.cabinet_id ?? null;
    }

    if (type === "cabinet") {
      if (id === finalTargetId) return;
      updateCabinetMutation.mutate({
        id,
        updates: { parent_id: finalTargetId || null },
      });
      if (finalTargetId && domainId) {
        addExpandedCabinet(domainId, finalTargetId);
      }
    } else {
      if (isCabinetOnly && finalTargetId === null) return;
      const draggedStream = streams?.find((stream) => stream.id === id);
      if (
        draggedStream &&
        isGlobalStream(draggedStream) &&
        finalTargetId !== null
      )
        return;
      updateStreamMutation.mutate({
        id,
        updates: { cabinet_id: finalTargetId || null },
      });
      if (finalTargetId && domainId) {
        addExpandedCabinet(domainId, finalTargetId);
      }
    }
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverId(null);
    if (autoExpandTimerRef.current) clearTimeout(autoExpandTimerRef.current);
  };

  const [justCreatedStreamId, setJustCreatedStreamId] = useState<string | null>(
    null,
  );

  const handleCreationConfirm = (name: string) => {
    if (!creatingItem || !domainId) return;

    if (creatingItem.type === "cabinet") {
      const siblings =
        cabinets?.filter((c) => c.parent_id === creatingItem.parentId) || [];
      const sortOrder = getNextSortOrder(siblings);

      createCabinetMutation.mutate({
        domain_id: domainId,
        parent_id: creatingItem.parentId,
        name,
        sort_order: sortOrder,
      });
    } else {
      const parentId = creatingItem.parentId ?? null;
      const cabinetStreams =
        streams?.filter((s) => s.cabinet_id === parentId) || [];
      const sortOrder = getNextSortOrder(cabinetStreams);

      createStreamMutation.mutate({
        cabinet_id: parentId,
        domain_id: domainId,
        name,
        sort_order: sortOrder,
      });
    }
    setCreatingItem(null);
  };

  const handleCreationCancel = () => {
    setCreatingItem(null);
  };

  // Focus input when editing starts
  useEffect(() => {
    if (editingItemId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingItemId]);

  useEffect(() => {
    if (!justCreatedStreamId) return;
    const timer = setTimeout(() => setJustCreatedStreamId(null), 2500);
    return () => clearTimeout(timer);
  }, [justCreatedStreamId]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("click", handleClick);
    window.addEventListener("contextmenu", handleClick);
    window.addEventListener("scroll", handleClick, true);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleClick);
      window.removeEventListener("scroll", handleClick, true);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // Fetch current domain details (for settings)
  const { data: domain } = useQuery({
    queryKey: ["domain", domainId],
    queryFn: async () => {
      if (!domainId) return null;
      const { data, error } = await supabase
        .from("domains")
        .select("*")
        .eq("id", domainId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!domainId,
  });

  // Fetch cabinets for current domain
  const { data: cabinets } = useQuery({
    queryKey: ["cabinets", domainId],
    queryFn: async () => {
      if (!domainId) return [];
      const { data, error } = await supabase
        .from("cabinets")
        .select("*")
        .eq("domain_id", domainId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: !!domainId,
  });

  // Fetch streams for current domain
  const { data: streams, isFetched: areStreamsFetched } = useQuery({
    queryKey: ["streams", domainId],
    queryFn: async () => {
      if (!domainId) return [];
      const { data, error } = await supabase
        .from("streams")
        .select("*, cabinet:cabinets(*)")
        .eq("domain_id", domainId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data;
    },
    placeholderData: [],
    enabled: !!domainId,
  });

  const ensuredGlobalRef = useRef<string | null>(null);

  useEffect(() => {
    if (!domainId || !streams || !areStreamsFetched) return;
    if (ensuredGlobalRef.current === domainId) return;

    const hasGlobalStream = streams.some((stream) => isGlobalStream(stream));
    if (hasGlobalStream) {
      ensuredGlobalRef.current = domainId;
      return;
    }

    ensuredGlobalRef.current = domainId;
    void (async () => {
      const { error } = await supabase.from("streams").insert({
        domain_id: domainId,
        cabinet_id: null,
        name: "Global User Entry",
        sort_order: LEGACY_GLOBAL_STREAM_SORT_ORDER,
        stream_kind: STREAM_KIND.GLOBAL,
      });

      if (!error) {
        queryClient.invalidateQueries({ queryKey: ["streams", domainId] });
      }
    })();
  }, [domainId, streams, areStreamsFetched, supabase, queryClient]);

  const settings = domain?.settings as
    | { root_restriction?: string }
    | undefined;
  const isCabinetOnly = settings?.root_restriction === "cabinet-only";
  const currentDomainName = domain?.name?.trim() || "Navigator";

  // Auto-expand cabinet containing the active stream
  useLayoutEffect(() => {
    if (activeStreamId && streams) {
      // Only if we haven't already expanded for this stream ID
      if (lastAutoExpandedStreamRef.current !== activeStreamId) {
        const activeStream = streams.find((s) => s.id === activeStreamId);
        if (activeStream?.cabinet_id) {
          lastAutoExpandedStreamRef.current = activeStreamId;
          const frame = requestAnimationFrame(() => {
            if (domainId && activeStream.cabinet_id) {
              addExpandedCabinet(domainId, activeStream.cabinet_id);
            }
          });
          return () => cancelAnimationFrame(frame);
        }
      }
    }
  }, [activeStreamId, addExpandedCabinet, domainId, streams]);

  const updateCabinetMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: CabinetUpdate;
    }) => {
      const { data, error } = await supabase
        .from("cabinets")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Cabinet;
    },
    onMutate: async ({ id, updates }) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ["cabinets", domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>([
        "cabinets",
        domainId,
      ]);

      queryClient.setQueryData<Cabinet[]>(["cabinets", domainId], (old) =>
        old?.map((c) => (c.id === id ? { ...c, ...updates } : c)),
      );

      return { previousCabinets };
    },
    onError: (error, _, context) => {
      if (context?.previousCabinets && domainId) {
        queryClient.setQueryData(
          ["cabinets", domainId],
          context.previousCabinets,
        );
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ["cabinets", domainId] });
      }
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      }
    },
  });

  const updateStreamMutation = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: StreamUpdate;
    }) => {
      const { data, error } = await supabase
        .from("streams")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async ({ id, updates }) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ["streams", domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>([
        "streams",
        domainId,
      ]);

      queryClient.setQueryData<Stream[]>(["streams", domainId], (old) =>
        old?.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      );

      return { previousStreams };
    },
    onError: (error, _, context) => {
      if (context?.previousStreams && domainId) {
        queryClient.setQueryData(
          ["streams", domainId],
          context.previousStreams,
        );
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ["streams", domainId] });
      }
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      }
    },
  });

  const deleteCabinetMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("cabinets")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ["cabinets", domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>([
        "cabinets",
        domainId,
      ]);

      queryClient.setQueryData<Cabinet[]>(["cabinets", domainId], (old) =>
        old?.filter((cabinet) => cabinet.id !== id),
      );

      return { previousCabinets };
    },
    onError: (error, _, context) => {
      if (context?.previousCabinets && domainId) {
        queryClient.setQueryData(
          ["cabinets", domainId],
          context.previousCabinets,
        );
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ["cabinets", domainId] });
      }
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      }
    },
  });

  const deleteStreamMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("streams")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;
    },
    onMutate: async (id) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ["streams", domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>([
        "streams",
        domainId,
      ]);

      queryClient.setQueryData<Stream[]>(["streams", domainId], (old) =>
        old?.filter((stream) => stream.id !== id),
      );

      return { previousStreams };
    },
    onError: (error, _, context) => {
      if (context?.previousStreams && domainId) {
        queryClient.setQueryData(
          ["streams", domainId],
          context.previousStreams,
        );
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ["streams", domainId] });
      }
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      }
    },
  });

  const createCabinetMutation = useMutation({
    mutationFn: async (cabinet: CabinetInsert) => {
      const { data, error } = await supabase
        .from("cabinets")
        .insert(cabinet)
        .select()
        .single();

      if (error) throw error;
      return data as Cabinet;
    },
    onMutate: async (newCabinet) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ["cabinets", domainId] });
      const previousCabinets = queryClient.getQueryData<Cabinet[]>([
        "cabinets",
        domainId,
      ]);
      const optimisticCabinet: Cabinet = {
        id: `temp-${Date.now()}`,
        name: newCabinet.name,
        domain_id: newCabinet.domain_id,
        parent_id: newCabinet.parent_id ?? null,
        sort_order: newCabinet.sort_order ?? 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      queryClient.setQueryData<Cabinet[]>(["cabinets", domainId], (old) =>
        applyOptimisticCabinetCreation(old, optimisticCabinet),
      );

      return { previousCabinets, optimisticId: optimisticCabinet.id };
    },
    onError: (error, newCabinet, context) => {
      if (context?.previousCabinets && domainId) {
        queryClient.setQueryData(
          ["cabinets", domainId],
          context.previousCabinets,
        );
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ["cabinets", domainId] });
      }
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      }
    },
  });

  const createStreamMutation = useMutation({
    mutationFn: async (stream: StreamInsert) => {
      const { data, error } = await supabase
        .from("streams")
        .insert(stream)
        .select()
        .single();

      if (error) throw error;
      return data as Stream;
    },
    onMutate: async (newStream) => {
      if (!domainId) return;
      await queryClient.cancelQueries({ queryKey: ["streams", domainId] });
      const previousStreams = queryClient.getQueryData<Stream[]>([
        "streams",
        domainId,
      ]);
      const optimisticStream: Stream = {
        id: `temp-${Date.now()}`,
        name: newStream.name,
        cabinet_id: newStream.cabinet_id ?? null,
        description: newStream.description ?? null,
        domain_id: newStream.domain_id,
        sort_order: newStream.sort_order ?? 0,
        stream_kind:
          (newStream.stream_kind as StreamKind) ?? STREAM_KIND.REGULAR,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      };

      queryClient.setQueryData<Stream[]>(["streams", domainId], (old) =>
        applyOptimisticStreamCreation(old, optimisticStream),
      );

      setJustCreatedStreamId(optimisticStream.id);
      if (optimisticStream.cabinet_id && domainId) {
        addExpandedCabinet(domainId, optimisticStream.cabinet_id as string);
      }

      return { previousStreams, optimisticId: optimisticStream.id };
    },
    onSuccess: (data) => {
      if (!domainId || !data) return;
      setJustCreatedStreamId(data.id);
      if (data.cabinet_id) {
        addExpandedCabinet(domainId, data.cabinet_id as string);
      }
      router.push(`/${domainId}/${data.id}`);
    },
    onError: (error, newStream, context) => {
      if (context?.previousStreams && domainId) {
        queryClient.setQueryData(
          ["streams", domainId],
          context.previousStreams,
        );
      }
    },
    onSettled: () => {
      if (domainId) {
        queryClient.invalidateQueries({ queryKey: ["streams", domainId] });
      }
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
        queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      }
    },
  });

  const duplicateStreamMutation = useMutation({
    mutationFn: async (stream: Stream) => {
      const siblingStreams =
        streams?.filter((candidate) => candidate.cabinet_id === stream.cabinet_id) ??
        [];
      const sortOrder = getNextSortOrder(siblingStreams);

      const { data: newStream, error: newStreamError } = await supabase
        .from("streams")
        .insert({
          cabinet_id: stream.cabinet_id,
          domain_id: stream.domain_id,
          name: stream.name,
          description: stream.description,
          sort_order: sortOrder,
          stream_kind: stream.stream_kind,
        } as StreamInsert)
        .select()
        .single();

      if (newStreamError || !newStream) {
        throw newStreamError ?? new Error("Failed to create duplicate stream");
      }

      const duplicatedStream = newStream as Stream;
      const entryMap = new Map<string, string>();
      const sectionMap = new Map<string, string>();
      const documentMap = new Map<string, string>();

      const { data: sourceDocuments, error: sourceDocumentsError } = await supabase
        .from("documents")
        .select(
          "id, title, original_filename, content_type, storage_path, storage_bucket, import_status, file_size_bytes, extracted_markdown, extraction_metadata, source_metadata, created_at, created_by, updated_at, thumbnail_path, thumbnail_status, thumbnail_updated_at, thumbnail_error",
        )
        .eq("stream_id", stream.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (sourceDocumentsError) throw sourceDocumentsError;

      for (const sourceDocument of sourceDocuments ?? []) {
        const { data: insertedDocument, error: insertedDocumentError } =
          await supabase
            .from("documents")
            .insert({
              stream_id: duplicatedStream.id,
              title: sourceDocument.title,
              original_filename: sourceDocument.original_filename,
              content_type: sourceDocument.content_type,
              storage_path: sourceDocument.storage_path,
              storage_bucket: sourceDocument.storage_bucket,
              import_status: sourceDocument.import_status,
              file_size_bytes: sourceDocument.file_size_bytes,
              extracted_markdown: sourceDocument.extracted_markdown,
              extraction_metadata: sourceDocument.extraction_metadata,
              source_metadata: sourceDocument.source_metadata,
              created_at: sourceDocument.created_at,
              created_by: sourceDocument.created_by,
              updated_at: sourceDocument.updated_at,
              thumbnail_path: sourceDocument.thumbnail_path,
              thumbnail_status: sourceDocument.thumbnail_status,
              thumbnail_updated_at: sourceDocument.thumbnail_updated_at,
              thumbnail_error: sourceDocument.thumbnail_error,
            } as DocumentInsert)
            .select("id")
            .single();

        if (insertedDocumentError || !insertedDocument) {
          throw (
            insertedDocumentError ??
            new Error("Failed to duplicate stream documents")
          );
        }

        documentMap.set(sourceDocument.id, insertedDocument.id);
      }

      if (documentMap.size > 0) {
        const sourceDocumentIds = Array.from(documentMap.keys());
        const { data: sourceChunks, error: sourceChunksError } = await supabase
          .from("document_chunks")
          .select(
            "document_id, chunk_index, chunk_markdown, chunk_metadata, heading_path, page_start, page_end, token_count, created_at",
          )
          .in("document_id", sourceDocumentIds)
          .order("chunk_index", { ascending: true });

        if (sourceChunksError) throw sourceChunksError;

        const chunkInserts = (sourceChunks ?? [])
          .map((chunk) => {
            const duplicatedDocumentId = documentMap.get(chunk.document_id);
            if (!duplicatedDocumentId) return null;
            return {
              document_id: duplicatedDocumentId,
              stream_id: duplicatedStream.id,
              chunk_index: chunk.chunk_index,
              chunk_markdown: chunk.chunk_markdown,
              chunk_metadata: chunk.chunk_metadata,
              heading_path: chunk.heading_path,
              page_start: chunk.page_start,
              page_end: chunk.page_end,
              token_count: chunk.token_count,
              created_at: chunk.created_at,
            };
          })
          .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== null);

        if (chunkInserts.length > 0) {
          const { error: insertChunksError } = await supabase
            .from("document_chunks")
            .insert(chunkInserts);

          if (insertChunksError) throw insertChunksError;
        }
      }

      const { data: sourceEntries, error: sourceEntriesError } = await supabase
        .from("entries")
        .select(
          "id, created_at, updated_at, is_draft, entry_kind, parent_commit_id, merge_source_commit_id, merge_source_branch_name, merge_target_branch_name",
        )
        .eq("stream_id", stream.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (sourceEntriesError) throw sourceEntriesError;

      for (const sourceEntry of sourceEntries ?? []) {
        const { data: insertedEntry, error: insertedEntryError } = await supabase
          .from("entries")
          .insert({
            stream_id: duplicatedStream.id,
            created_at: sourceEntry.created_at,
            updated_at: sourceEntry.updated_at,
            is_draft: sourceEntry.is_draft,
            entry_kind: sourceEntry.entry_kind,
            parent_commit_id: null,
            merge_source_commit_id: null,
            merge_source_branch_name: sourceEntry.merge_source_branch_name,
            merge_target_branch_name: sourceEntry.merge_target_branch_name,
          } as EntryInsert)
          .select()
          .single();

        if (insertedEntryError || !insertedEntry) {
          throw insertedEntryError ?? new Error("Failed to duplicate entries");
        }

        entryMap.set(sourceEntry.id, (insertedEntry as Entry).id);
      }

      for (const sourceEntry of sourceEntries ?? []) {
        const duplicatedEntryId = entryMap.get(sourceEntry.id);
        if (!duplicatedEntryId) continue;

        const parentCommitId = sourceEntry.parent_commit_id
          ? (entryMap.get(sourceEntry.parent_commit_id) ?? null)
          : null;
        const mergeSourceCommitId = sourceEntry.merge_source_commit_id
          ? (entryMap.get(sourceEntry.merge_source_commit_id) ?? null)
          : null;

        if (!parentCommitId && !mergeSourceCommitId) continue;

        const { error: updateEntryError } = await supabase
          .from("entries")
          .update({
            parent_commit_id: parentCommitId,
            merge_source_commit_id: mergeSourceCommitId,
          })
          .eq("id", duplicatedEntryId);

        if (updateEntryError) throw updateEntryError;
      }

      const sourceEntryIds = Array.from(entryMap.keys());
      if (sourceEntryIds.length > 0) {
        const { data: sourceSections, error: sourceSectionsError } = await supabase
          .from("sections")
          .select(
            "id, entry_id, persona_id, persona_name_snapshot, content_json, raw_markdown, content_format, sort_order, section_type, file_display_mode, created_at, updated_at",
          )
          .in("entry_id", sourceEntryIds)
          .order("sort_order", { ascending: true });

        if (sourceSectionsError) throw sourceSectionsError;

        for (const sourceSection of sourceSections ?? []) {
          const duplicatedEntryId = entryMap.get(sourceSection.entry_id);
          if (!duplicatedEntryId) continue;

          const { data: insertedSection, error: insertedSectionError } =
            await supabase
              .from("sections")
              .insert({
                entry_id: duplicatedEntryId,
                persona_id: sourceSection.persona_id,
                persona_name_snapshot: sourceSection.persona_name_snapshot,
                ...cloneStoredContentFields(sourceSection),
                sort_order: sourceSection.sort_order,
                section_type: sourceSection.section_type,
                file_display_mode: sourceSection.file_display_mode,
                created_at: sourceSection.created_at,
                updated_at: sourceSection.updated_at,
              } as SectionInsert)
              .select()
              .single();

          if (insertedSectionError || !insertedSection) {
            throw insertedSectionError ?? new Error("Failed to duplicate sections");
          }

          sectionMap.set(sourceSection.id, (insertedSection as Section).id);
        }

        const sourceSectionIds = Array.from(sectionMap.keys());
        if (sourceSectionIds.length > 0) {
          const { data: sourceAttachments, error: sourceAttachmentsError } =
            await supabase
              .from("section_attachments")
              .select(
                "section_id, document_id, sort_order, title_snapshot, annotation_text, referenced_persona_id, referenced_page",
              )
              .in("section_id", sourceSectionIds);

          if (sourceAttachmentsError) throw sourceAttachmentsError;

          const attachmentInserts = (sourceAttachments ?? [])
            .map((attachment) => {
              const duplicatedSectionId = sectionMap.get(attachment.section_id);
              const duplicatedDocumentId = documentMap.get(attachment.document_id);
              if (!duplicatedSectionId || !duplicatedDocumentId) return null;
              return {
                section_id: duplicatedSectionId,
                document_id: duplicatedDocumentId,
                sort_order: attachment.sort_order,
                title_snapshot: attachment.title_snapshot,
                annotation_text: attachment.annotation_text,
                referenced_persona_id: attachment.referenced_persona_id,
                referenced_page: attachment.referenced_page,
              };
            })
            .filter(
              (attachment): attachment is NonNullable<typeof attachment> =>
                attachment !== null,
            );

          if (attachmentInserts.length > 0) {
            const { error: insertAttachmentsError } = await supabase
              .from("section_attachments")
              .insert(attachmentInserts as SectionFileAttachmentInsert[]);

            if (insertAttachmentsError) throw insertAttachmentsError;
          }
        }

        const { data: sourceDocumentEntryLinks, error: sourceDocumentEntryLinksError } =
          await supabase
            .from("document_entry_links")
            .select("document_id, entry_id, relationship_type")
            .in("entry_id", sourceEntryIds);

        if (sourceDocumentEntryLinksError) throw sourceDocumentEntryLinksError;

        const documentEntryLinkInserts = (sourceDocumentEntryLinks ?? [])
          .map((link) => {
            const duplicatedDocumentId = documentMap.get(link.document_id);
            const duplicatedEntryId = entryMap.get(link.entry_id);
            if (!duplicatedDocumentId || !duplicatedEntryId) return null;
            return {
              document_id: duplicatedDocumentId,
              entry_id: duplicatedEntryId,
              relationship_type: link.relationship_type,
            };
          })
          .filter((link): link is NonNullable<typeof link> => link !== null);

        if (documentEntryLinkInserts.length > 0) {
          const { error: insertDocumentEntryLinksError } = await supabase
            .from("document_entry_links")
            .insert(documentEntryLinkInserts as DocumentEntryLinkInsert[]);

          if (insertDocumentEntryLinksError) throw insertDocumentEntryLinksError;
        }
      }

      const { data: sourceCanvas, error: sourceCanvasError } = await supabase
        .from("canvases")
        .select("id, content_json, raw_markdown, content_format, created_at, updated_at")
        .eq("stream_id", stream.id)
        .maybeSingle();

      if (sourceCanvasError) throw sourceCanvasError;

      if (sourceCanvas) {
        const { error: upsertCanvasError } = await supabase
          .from("canvases")
          .upsert(
            {
              stream_id: duplicatedStream.id,
              created_at: sourceCanvas.created_at,
              updated_at: sourceCanvas.updated_at,
              ...cloneStoredContentFields(sourceCanvas),
            } as CanvasInsert,
            { onConflict: "stream_id" },
          );

        if (upsertCanvasError) throw upsertCanvasError;
      }

      const { data: duplicatedCanvas, error: duplicatedCanvasError } = await supabase
        .from("canvases")
        .select("id, stream_id")
        .eq("stream_id", duplicatedStream.id)
        .maybeSingle();

      if (duplicatedCanvasError) throw duplicatedCanvasError;

      if (duplicatedCanvas) {
        const { data: sourceVersions, error: sourceVersionsError } = await supabase
          .from("canvas_versions")
          .select(
            "content_json, raw_markdown, content_format, name, summary, created_by, created_at, branch_name, source_entry_id",
          )
          .eq("stream_id", stream.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: true });

        if (sourceVersionsError) throw sourceVersionsError;

        for (const sourceVersion of sourceVersions ?? []) {
          const { error: insertVersionError } = await supabase
            .from("canvas_versions")
            .insert({
              canvas_id: (duplicatedCanvas as Canvas).id,
              stream_id: duplicatedStream.id,
              ...cloneStoredContentFields(sourceVersion),
              name: sourceVersion.name,
              summary: sourceVersion.summary,
              created_by: sourceVersion.created_by,
              created_at: sourceVersion.created_at,
              branch_name: sourceVersion.branch_name,
              source_entry_id: sourceVersion.source_entry_id
                ? (entryMap.get(sourceVersion.source_entry_id) ?? null)
                : null,
            });

          if (insertVersionError) throw insertVersionError;
        }
      }

      const { data: sourceBranches, error: sourceBranchesError } = await supabase
        .from("branches")
        .select("name, created_at, updated_at, head_commit_id")
        .eq("stream_id", stream.id)
        .order("created_at", { ascending: true });

      if (sourceBranchesError) throw sourceBranchesError;

      for (const sourceBranch of sourceBranches ?? []) {
        const { error: insertBranchError } = await supabase.from("branches").insert({
          stream_id: duplicatedStream.id,
          name: sourceBranch.name,
          created_at: sourceBranch.created_at,
          updated_at: sourceBranch.updated_at,
          head_commit_id: sourceBranch.head_commit_id
            ? (entryMap.get(sourceBranch.head_commit_id) ?? null)
            : null,
        });

        if (insertBranchError) throw insertBranchError;
      }

      return duplicatedStream;
    },
    onSuccess: (duplicatedStream, sourceStream) => {
      if (!domainId || !duplicatedStream) return;
      if (sourceStream?.id) {
        copyLocalEntryCreatorDraftState(sourceStream.id, duplicatedStream.id);
        copyLocalCanvasDraftState(sourceStream.id, duplicatedStream.id);
      }
      setJustCreatedStreamId(duplicatedStream.id);
      if (duplicatedStream.cabinet_id) {
        addExpandedCabinet(domainId, duplicatedStream.cabinet_id);
      }
      queryClient.invalidateQueries({ queryKey: ["streams", domainId] });
      queryClient.invalidateQueries({ queryKey: ["entries", duplicatedStream.id] });
      queryClient.invalidateQueries({
        queryKey: ["entries-xml", duplicatedStream.id],
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["documents", userId] });
      }
      queryClient.invalidateQueries({ queryKey: ["canvas", duplicatedStream.id] });
      queryClient.invalidateQueries({
        queryKey: ["canvas-versions", duplicatedStream.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["canvas-latest-version", duplicatedStream.id],
      });
      queryClient.invalidateQueries({ queryKey: ["branches", duplicatedStream.id] });
      queryClient.invalidateQueries({
        queryKey: ["entries-lineage", duplicatedStream.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["graph-branches", duplicatedStream.id],
      });
      queryClient.invalidateQueries({ queryKey: ["home-domains", userId] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-streams"] });
      queryClient.invalidateQueries({ queryKey: ["home-recent-entries"] });
      router.push(`/${domainId}/${duplicatedStream.id}`);
    },
  });

  const toggleCabinet = (cabinetId: string) => {
    if (domainId) {
      toggleExpandedCabinet(domainId, cabinetId);
    }
  };

  // Organize cabinets into a tree
  const roots = cabinets?.filter((c) => !c.parent_id) ?? [];
  const getChildren = (parentId: string): Cabinet[] =>
    cabinets?.filter((c) => c.parent_id === parentId) ?? [];

  // cabinetTree object will be automatically memoized by the React Compiler
  const cabinetTree = { roots, getChildren };

  const cabinetDisambiguation = buildDisambiguationMap(
    cabinets,
    (cabinet) => cabinet.parent_id ?? null,
  );
  const streamDisambiguation = buildDisambiguationMap(
    streams,
    (stream) => stream.cabinet_id ?? null,
  );
  const cabinetChildrenMap = new Map<string, Cabinet[]>();
  cabinets?.forEach((cabinet) => {
    if (!cabinet.parent_id) return;
    const list = cabinetChildrenMap.get(cabinet.parent_id) ?? [];
    list.push(cabinet);
    cabinetChildrenMap.set(cabinet.parent_id, list);
  });

  // Determine the effective highlight node
  const routeActiveNode = getVisibleActiveNodeId(
    activeStreamId,
    streams,
    cabinets,
    expandedCabinets,
  );
  const validManualActiveNode = manualActiveNode
    ? manualActiveNode.type === "cabinet"
      ? cabinets?.some((cabinet) => cabinet.id === manualActiveNode.id)
        ? manualActiveNode
        : null
      : streams?.some((stream) => stream.id === manualActiveNode.id)
        ? manualActiveNode
        : null
    : null;
  const activeNode = forceNoHighlight
    ? null
    : (validManualActiveNode ?? routeActiveNode);

  const isStreamNewlyCreated = (id: string) => id === justCreatedStreamId;

  const getCabinetById = (id: string) =>
    cabinets?.find((cabinet) => cabinet.id === id);
  const getStreamById = (id: string) =>
    streams?.find((stream) => stream.id === id);
  const getItemById = (id: string, type: NavItemType) =>
    type === "cabinet" ? getCabinetById(id) : getStreamById(id);

  const handleContextMenu = (
    event: React.MouseEvent,
    id: string,
    type: NavItemType,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ id, type, x: event.clientX, y: event.clientY });
  };

  useKeyboard([
    {
      key: "delete",
      handler: () => {
        const active = document.activeElement;
        if (
          active?.tagName === "INPUT" ||
          active?.tagName === "TEXTAREA" ||
          active?.getAttribute("contenteditable") === "true"
        ) {
          return;
        }
        if (!activeNode) return;
        setDeleteTarget({ id: activeNode.id, type: activeNode.type });
      },
      description: "Delete navigation item",
    },
    {
      key: "f2",
      handler: () => {
        const active = document.activeElement;
        if (
          active?.tagName === "INPUT" ||
          active?.tagName === "TEXTAREA" ||
          active?.getAttribute("contenteditable") === "true"
        ) {
          return;
        }
        if (!activeNode) return;
        const item = getItemById(activeNode.id, activeNode.type);
        if (!item) return;
        setEditingItemId(item.id);
        setEditingName(item.name);
      },
      description: "Rename navigation item",
    },
  ]);

  const handleRename = (
    id: string,
    newName: string,
    type: "cabinet" | "stream",
  ) => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setEditingItemId(null);
      return;
    }

    if (type === "cabinet") {
      const cabinet = cabinets?.find((c) => c.id === id);
      if (cabinet && cabinet.name !== trimmedName) {
        updateCabinetMutation.mutate({ id, updates: { name: trimmedName } });
      }
    } else {
      const stream = streams?.find((s) => s.id === id);
      if (stream && stream.name !== trimmedName) {
        updateStreamMutation.mutate({ id, updates: { name: trimmedName } });
      }
    }
    setEditingItemId(null);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    id: string,
    type: "cabinet" | "stream",
  ) => {
    if (e.key === "Enter") {
      handleRename(id, editingName, type);
    } else if (e.key === "Escape") {
      setEditingItemId(null);
    }
  };

  const handleCreateCabinet = (buttonParentId: string | null | undefined) => {
    if (!domainId) return;

    const { parentCabinetId } = resolveCreationTarget({
      kind: "cabinet",
      buttonCabinetId: buttonParentId,
      activeStreamId,
      streams,
    });

    if (
      parentCabinetId &&
      !cabinets?.some((cabinet) => cabinet.id === parentCabinetId)
    ) {
      return;
    }

    if (parentCabinetId) {
      addExpandedCabinet(domainId, parentCabinetId);
    }

    setCreatingItem({ type: "cabinet", parentId: parentCabinetId ?? null });
  };

  const handleCreateStream = (buttonCabinetId: string | null | undefined) => {
    if (!domainId) return;

    const target = resolveCreationTarget({
      kind: "stream",
      buttonCabinetId,
      activeStreamId,
      streams,
    });

    if (target.error) return;

    if (!isCreationAllowed(target, settings)) {
      // Ideally show a toast or error message here.
      // For now, we simply return to block creation.
      console.warn("Root streams are disabled for this domain.");
      return;
    }

    const targetCabinetId = target.targetCabinetId;

    if (targetCabinetId) {
      if (!cabinets?.some((cabinet) => cabinet.id === targetCabinetId)) return;
      addExpandedCabinet(domainId, targetCabinetId);
    }

    setCreatingItem({ type: "stream", parentId: targetCabinetId ?? null });
  };

  const getSelectedCreationCabinetId = () => {
    if (!activeNode) return null;
    if (activeNode.type === "cabinet") return activeNode.id;
    return (
      streams?.find((stream) => stream.id === activeNode.id)?.cabinet_id ?? null
    );
  };

  const handleHeaderCreateStream = () => {
    const selectedCabinetId = getSelectedCreationCabinetId();
    handleCreateStream(selectedCabinetId);
  };

  const handleHeaderCreateCabinet = () => {
    const selectedCabinetId = getSelectedCreationCabinetId();
    handleCreateCabinet(selectedCabinetId);
  };

  const lastClickRef = useRef<{ id: string; time: number } | null>(null);
  const lastNavigatedPathRef = useRef<string | null>(null);
  const pendingStreamNavigationRef = useRef<{
    path: string;
    startedAt: number;
  } | null>(null);

  useEffect(() => {
    lastNavigatedPathRef.current = null;
    pendingStreamNavigationRef.current = null;
    setForceNoHighlight(false);
  }, [pathname]);

  // Click handling logic
  const handleItemClick = (
    id: string,
    type: "cabinet" | "stream",
    name: string,
  ) => {
    const now = Date.now();
    const lastClick = lastClickRef.current;
    const isDoubleClick = lastClick && lastClick.id === id && now - lastClick.time < 300;

    // Block interaction if a navigation is already pending
    // Allow double clicks to punch through and trigger rename
    if (isPending && !isDoubleClick) return;

    setForceNoHighlight(false);

    if (type === "cabinet") {
      setManualActiveNode({ id, type: "cabinet" });
      // Cabinet logic (applied to ALL cabinets, highlighted or not):
      // 1. Rapid successive clicks (< 300ms) -> Rename
      // 2. Single click / Slow click -> Toggle Expand/Collapse
      if (isDoubleClick) {
        setEditingItemId(id);
        setEditingName(name);
        lastClickRef.current = null;
        return;
      } else {
        toggleCabinet(id);
      }
    } else {
      setManualActiveNode({ id, type: "stream" });

      // Block interaction with optimistic (temp) streams — the onSuccess
      // callback will auto-navigate once the real ID is available.
      if (id.startsWith("temp-")) {
        lastClickRef.current = { id, time: now };
        return;
      }

      // Stream logic
      // All streams: Click -> Navigate
      // Double Click -> Rename
      if (isDoubleClick) {
        setEditingItemId(id);
        setEditingName(name);
        lastClickRef.current = null; // Reset
        return;
      }

      if (pendingStreamNavigationRef.current) {
        const elapsed = now - pendingStreamNavigationRef.current.startedAt;
        if (elapsed < 15000) {
          lastClickRef.current = { id, time: now };
          return;
        }
        pendingStreamNavigationRef.current = null;
      }

      const targetPath = `/${domainId}/${id}`;
      if (
        pathname === targetPath ||
        lastNavigatedPathRef.current === targetPath
      ) {
        lastClickRef.current = { id, time: now };
        return;
      }

      startTransition(() => {
        lastNavigatedPathRef.current = targetPath;
        pendingStreamNavigationRef.current = {
          path: targetPath,
          startedAt: now,
        };
        router.push(targetPath);
      });
    }

    lastClickRef.current = { id, time: now };
  };

  const getDescendantIds = (cabinetId: string) => {
    const descendants = new Set<string>();
    const stack = [...(cabinetChildrenMap.get(cabinetId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || descendants.has(current.id)) continue;
      descendants.add(current.id);
      const children = cabinetChildrenMap.get(current.id) ?? [];
      stack.push(...children);
    }
    return descendants;
  };

  const openRename = (id: string, type: NavItemType) => {
    const item = getItemById(id, type);
    if (!item) return;
    setEditingItemId(item.id);
    setEditingName(item.name);
  };

  const closeMoveDialog = () => {
    setMoveTarget(null);
    setMoveDestination(null);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "cabinet") {
      deleteCabinetMutation.mutate(deleteTarget.id);
    } else {
      const stream = getStreamById(deleteTarget.id);
      if (stream && !canDeleteStream(stream)) {
        setDeleteTarget(null);
        return;
      }
      deleteStreamMutation.mutate(deleteTarget.id);
      if (activeStreamId === deleteTarget.id) {
        router.push(`/${domainId}`);
      }
    }
    setDeleteTarget(null);
  };

  const handleMoveConfirm = () => {
    if (!moveTarget) return;
    const normalizedTarget = moveDestination || null;
    if (moveTarget.type === "cabinet") {
      updateCabinetMutation.mutate({
        id: moveTarget.id,
        updates: { parent_id: normalizedTarget },
      });
      if (normalizedTarget && domainId) {
        addExpandedCabinet(domainId, normalizedTarget);
      }
    } else {
      if (isCabinetOnly && normalizedTarget === null) {
        closeMoveDialog();
        return;
      }
      const stream = moveItem as Stream | undefined;
      if (stream && isGlobalStream(stream) && normalizedTarget !== null) {
        closeMoveDialog();
        return;
      }
      updateStreamMutation.mutate({
        id: moveTarget.id,
        updates: { cabinet_id: normalizedTarget },
      });
      if (normalizedTarget && domainId) {
        addExpandedCabinet(domainId, normalizedTarget);
      }
    }
    closeMoveDialog();
  };

  const handleDuplicate = (id: string, type: NavItemType) => {
    if (!domainId) return;
    if (type === "cabinet") {
      const cabinet = getCabinetById(id);
      if (!cabinet) return;
      const siblings =
        cabinets?.filter((c) => c.parent_id === cabinet.parent_id) || [];
      const sortOrder = getNextSortOrder(siblings);
      createCabinetMutation.mutate({
        domain_id: domainId,
        parent_id: cabinet.parent_id,
        name: cabinet.name,
        sort_order: sortOrder,
      });
    } else {
      const stream = getStreamById(id);
      if (!stream) return;
      duplicateStreamMutation.mutate(stream);
    }
  };

  const handleContextAction = (
    action: "rename" | "delete" | "duplicate" | "move" | "properties",
  ) => {
    if (!contextMenu) return;
    const { id, type } = contextMenu;
    const stream = type === "stream" ? getStreamById(id) : null;
    const blockedGlobalActions = stream ? isGlobalStream(stream) : false;
    setContextMenu(null);
    if (action === "rename") {
      openRename(id, type);
    } else if (action === "delete") {
      if (blockedGlobalActions) return;
      setDeleteTarget({ id, type });
    } else if (action === "duplicate") {
      handleDuplicate(id, type);
    } else if (action === "move") {
      if (blockedGlobalActions) return;
      const item = getItemById(id, type);
      const destination =
        type === "cabinet"
          ? ((item as Cabinet | undefined)?.parent_id ?? null)
          : ((item as Stream | undefined)?.cabinet_id ?? null);
      setMoveDestination(destination);
      setMoveTarget({ id, type });
    } else {
      setPropertiesTarget({ id, type });
    }
  };

  const rootGlobalStreams =
    streams?.filter((stream) => !stream.cabinet_id && isGlobalStream(stream)) ||
    [];
  const rootRegularStreams =
    streams?.filter(
      (stream) => !stream.cabinet_id && !isGlobalStream(stream),
    ) || [];
  const hasNonGlobalTreeItems =
    (cabinetTree.roots?.length ?? 0) > 0 || rootRegularStreams.length > 0;
  const selectedCreationCabinetId = getSelectedCreationCabinetId();
  const selectedStreamTarget = resolveCreationTarget({
    kind: "stream",
    buttonCabinetId: selectedCreationCabinetId,
    activeStreamId,
    streams,
  });
  const canCreateStreamFromSelection = isCreationAllowed(
    selectedStreamTarget,
    settings,
  );
  const isCreatingStream = creatingItem?.type === "stream";
  const isCreatingCabinet = creatingItem?.type === "cabinet";
  const isCreateStreamDisabled =
    isPending ||
    createStreamMutation.isPending ||
    createCabinetMutation.isPending ||
    isCreatingStream ||
    !canCreateStreamFromSelection;
  const isCreateCabinetDisabled =
    isPending ||
    createCabinetMutation.isPending ||
    createStreamMutation.isPending ||
    isCreatingCabinet;
  const deleteItem = deleteTarget
    ? getItemById(deleteTarget.id, deleteTarget.type)
    : null;
  const moveItem = moveTarget
    ? getItemById(moveTarget.id, moveTarget.type)
    : null;
  const propertiesItem = propertiesTarget
    ? getItemById(propertiesTarget.id, propertiesTarget.type)
    : null;
  const contextMenuStream =
    contextMenu?.type === "stream" ? getStreamById(contextMenu.id) : null;
  const contextMenuIsGlobal = contextMenuStream
    ? isGlobalStream(contextMenuStream)
    : false;
  const moveExcluded =
    moveTarget?.type === "cabinet"
      ? getDescendantIds(moveTarget.id)
      : new Set<string>();
  const moveCabinetOptions =
    moveTarget?.type === "cabinet"
      ? (cabinets ?? []).filter(
          (cabinet) =>
            cabinet.id !== moveTarget.id && !moveExcluded.has(cabinet.id),
        )
      : (cabinets ?? []);

  // Compute flattened list of visible items dynamically for striping
  const stripeIndices = new Map<string, number>();
  let visibleCount = 0;

  rootGlobalStreams.forEach((stream) => {
    stripeIndices.set(stream.id, visibleCount++);
  });

  // Calculate visible indices recursively
  const traverseVisibleCabinet = (cabinetId: string) => {
    stripeIndices.set(cabinetId, visibleCount++);
    if (expandedCabinets.has(cabinetId)) {
      const children = cabinetTree.getChildren(cabinetId);
      children.forEach((child) => traverseVisibleCabinet(child.id));

      const cStreams = streams?.filter((s) => s.cabinet_id === cabinetId) || [];
      cStreams.forEach((s) => {
        stripeIndices.set(s.id, visibleCount++);
      });
    }
  };

  cabinetTree.roots.forEach((cabinet) => {
    traverseVisibleCabinet(cabinet.id);
  });

  rootRegularStreams.forEach((stream) => {
    stripeIndices.set(stream.id, visibleCount++);
  });

  if (!domainId) {
    return (
      <div className="flex h-full w-full flex-col border-r border-border-default bg-surface-subtle p-4">
        <p className="text-sm text-text-subtle">Select a domain to begin</p>
      </div>
    );
  }

  return (
    <>
      <div
        className={`flex h-full w-full flex-col border-r border-border-default bg-surface-subtle transition-opacity duration-200 ${isPending ? "opacity-70 pointer-events-none" : ""}`}
      >
        {/* Header */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border-default bg-surface-default px-3">
          <h2
            className="truncate text-sm font-semibold text-text-default"
            title={currentDomainName}
          >
            {currentDomainName}
          </h2>
          <div className="flex items-center gap-0.5">
            {!isCabinetOnly && (
              <button
                type="button"
                onClick={handleHeaderCreateStream}
                disabled={isCreateStreamDisabled}
                aria-label="New stream"
                title={
                  canCreateStreamFromSelection
                    ? "New Stream"
                    : "New Stream (Root is restricted)"
                }
                className=" p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
              >
                <FilePlus className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={handleHeaderCreateCabinet}
              disabled={isCreateCabinetDisabled}
              aria-label="New cabinet"
              title="New Cabinet"
              className=" p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
            >
              <FolderPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={hideSidebar}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className=" p-1.5 text-text-muted transition-colors hover:bg-surface-subtle hover:text-text-default"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Tree View */}
        <div
          className={`flex-1 overflow-y-auto transition-colors duration-200 ${dragOverId === null && draggedItem ? "bg-primary-950" : ""}`}
          role="tree"
          onClick={() => {
            setManualActiveNode(null);
            setForceNoHighlight(true);
          }}
          onDragOver={(e) => handleDragOver(e, null)}
          onDrop={(e) => handleDrop(e, null)}
        >
          {rootGlobalStreams.length > 0 &&
            rootGlobalStreams.map((stream) => (
              <StreamNode
                key={stream.id}
                stream={stream}
                depth={0}
                displayName={stream.name}
                kindBadge="Global"
                disambiguation={streamDisambiguation.get(stream.id)}
                stripeIndex={stripeIndices.get(stream.id)}
                activeNode={activeNode}
                editingItemId={editingItemId}
                editingName={editingName}
                editInputRef={editInputRef}
                setEditingName={setEditingName}
                handleKeyDown={handleKeyDown}
                handleRename={handleRename}
                handleItemClick={handleItemClick}
                handleContextMenu={handleContextMenu}
                isNewlyCreated={isStreamNewlyCreated(stream.id)}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                draggedItem={draggedItem}
                dragOverId={dragOverId}
              />
            ))}

          {rootGlobalStreams.length > 0 && hasNonGlobalTreeItems && (
            <div
              className="border-t border-border-default"
              role="separator"
              aria-label="Global stream separator"
            />
          )}

          {cabinetTree.roots.map((cabinet) => (
            <CabinetNode
              key={cabinet.id}
              cabinet={cabinet}
              cabinetTree={cabinetTree}
              streams={streams}
              cabinetDisambiguation={cabinetDisambiguation}
              streamDisambiguation={streamDisambiguation}
              expandedCabinets={expandedCabinets}
              stripeIndices={stripeIndices}
              activeNode={activeNode}
              editingItemId={editingItemId}
              editingName={editingName}
              editInputRef={editInputRef}
              setEditingName={setEditingName}
              handleKeyDown={handleKeyDown}
              handleRename={handleRename}
              handleItemClick={handleItemClick}
              toggleCabinet={toggleCabinet}
              router={router}
              domainId={domainId || ""}
              handleCreateStream={handleCreateStream}
              handleCreateCabinet={handleCreateCabinet}
              handleContextMenu={handleContextMenu}
              isStreamNewlyCreated={isStreamNewlyCreated}
              setEditingItemId={setEditingItemId}
              creatingItem={creatingItem}
              handleCreationConfirm={handleCreationConfirm}
              handleCreationCancel={handleCreationCancel}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              draggedItem={draggedItem}
              dragOverId={dragOverId}
            />
          ))}

          {rootRegularStreams.map((stream) => (
            <StreamNode
              key={stream.id}
              stream={stream}
              depth={0}
              displayName={stream.name}
              disambiguation={streamDisambiguation.get(stream.id)}
              stripeIndex={stripeIndices.get(stream.id)}
              activeNode={activeNode}
              editingItemId={editingItemId}
              editingName={editingName}
              editInputRef={editInputRef}
              setEditingName={setEditingName}
              handleKeyDown={handleKeyDown}
              handleRename={handleRename}
              handleItemClick={handleItemClick}
              handleContextMenu={handleContextMenu}
              isNewlyCreated={isStreamNewlyCreated(stream.id)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              draggedItem={draggedItem}
              dragOverId={dragOverId}
            />
          ))}

          {creatingItem?.type === "cabinet" &&
            creatingItem.parentId === null && (
              <CreationInput
                type="cabinet"
                depth={0}
                onConfirm={handleCreationConfirm}
                onCancel={handleCreationCancel}
              />
            )}

          {creatingItem?.type === "stream" &&
            creatingItem.parentId === null && (
              <CreationInput
                type="stream"
                depth={0}
                onConfirm={handleCreationConfirm}
                onCancel={handleCreationCancel}
              />
            )}
        </div>
      </div>

      {contextMenu &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-100"
            onClick={() => setContextMenu(null)}
          >
            <div
              className="absolute w-48 border border-border-default bg-surface-elevated p-1 z-100"
              style={{
                top: Math.min(
                  contextMenu.y,
                  typeof window !== "undefined"
                    ? window.innerHeight - 200
                    : contextMenu.y,
                ),
                left: Math.min(
                  contextMenu.x,
                  typeof window !== "undefined"
                    ? window.innerWidth - 200
                    : contextMenu.x,
                ),
                backgroundColor: "var(--bg-surface-elevated)",
                opacity: 1,
              }}
              onClick={(event) => event.stopPropagation()}
              role="menu"
            >
              <button
                onClick={() => handleContextAction("rename")}
                className="flex w-full items-center justify-between px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
              >
                <span className="flex items-center gap-2">
                  <Pencil className="h-4 w-4 text-text-muted" />
                  Rename
                </span>
                <span className="text-[10px] text-text-muted">F2</span>
              </button>
              <button
                onClick={() => handleContextAction("duplicate")}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
              >
                <Copy className="h-4 w-4 text-text-muted" />
                Duplicate
              </button>
              <button
                onClick={() => handleContextAction("move")}
                disabled={contextMenuIsGlobal}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
              >
                <Move className="h-4 w-4 text-text-muted" />
                Move
              </button>
              <button
                onClick={() => handleContextAction("properties")}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-text-default hover:bg-surface-subtle"
              >
                <Info className="h-4 w-4 text-text-muted" />
                Properties
              </button>
              <div className="my-1 h-px bg-border-subtle" />
              <button
                onClick={() => handleContextAction("delete")}
                disabled={contextMenuIsGlobal}
                className="flex w-full items-center justify-between px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-950"
              >
                <span className="flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Delete
                </span>
                <span className="text-[10px] text-rose-400">Del</span>
              </button>
            </div>
          </div>,
          document.body,
        )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.type === "cabinet" ? "Cabinet" : "Stream"}`}
        description={
          <>
            This will remove <strong>{deleteItem?.name ?? "this item"}</strong>.
          </>
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        loading={
          deleteTarget?.type === "cabinet"
            ? deleteCabinetMutation.isPending
            : deleteStreamMutation.isPending
        }
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />

      <Transition appear show={!!moveTarget} as={Fragment}>
        <Dialog as="div" className="relative z-100" onClose={closeMoveDialog}>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-surface-dark" />
          </TransitionChild>
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-sm border border-border-default bg-surface-default p-5">
                <div className="flex items-start justify-between">
                  <DialogTitle className="text-sm font-semibold text-text-default">
                    Move {moveTarget?.type === "cabinet" ? "Cabinet" : "Stream"}
                  </DialogTitle>
                  <button
                    onClick={closeMoveDialog}
                    className=" p-1 text-text-muted hover:bg-surface-subtle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-xs text-text-subtle">
                  <div className="flex items-center justify-between">
                    <span>Item</span>
                    <span className="text-text-default">
                      {moveItem?.name ?? "-"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <span>Destination</span>
                    <select
                      value={moveDestination ?? ""}
                      onChange={(event) =>
                        setMoveDestination(event.target.value || null)
                      }
                      className=" border border-border-default bg-surface-default px-2 py-1.5 text-xs text-text-default focus:border-border-default focus: focus: focus:"
                    >
                      <option
                        value=""
                        disabled={
                          moveTarget?.type === "stream" && isCabinetOnly
                        }
                      >
                        Root level
                      </option>
                      {moveCabinetOptions.map((cabinet) => {
                        const disambiguation = cabinetDisambiguation.get(
                          cabinet.id,
                        );
                        const suffix = disambiguation
                          ? ` (#${disambiguation.index})`
                          : "";
                        return (
                          <option key={cabinet.id} value={cabinet.id}>
                            {cabinet.name}
                            {suffix}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={closeMoveDialog}
                    className=" border border-border-default px-3 py-1.5 text-xs font-semibold text-text-default transition hover:bg-surface-subtle"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleMoveConfirm}
                    disabled={
                      moveTarget?.type === "stream"
                        ? ((moveItem as Stream | undefined)
                            ? isGlobalStream(moveItem as Stream)
                            : false) ||
                          (isCabinetOnly &&
                            (moveDestination ?? null) === null) ||
                          (moveDestination ?? null) ===
                            (moveItem as Stream | undefined)?.cabinet_id
                        : (moveDestination ?? null) ===
                          (moveItem as Cabinet | undefined)?.parent_id
                    }
                    className=" bg-action-primary-bg px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-action-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Move
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      <Transition appear show={!!propertiesTarget} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-100"
          onClose={() => setPropertiesTarget(null)}
        >
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-surface-dark" />
          </TransitionChild>
          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <DialogPanel className="w-full max-w-sm border border-border-default bg-surface-default p-5">
                <div className="flex items-start justify-between">
                  <DialogTitle className="text-sm font-semibold text-text-default">
                    Properties
                  </DialogTitle>
                  <button
                    onClick={() => setPropertiesTarget(null)}
                    className=" p-1 text-text-muted hover:bg-surface-subtle"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 space-y-2 text-xs text-text-subtle">
                  <div className="flex items-center justify-between">
                    <span>Name</span>
                    <span className="text-text-default">
                      {propertiesItem?.name ?? "-"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Type</span>
                    <span className="text-text-default">
                      {propertiesTarget?.type === "cabinet"
                        ? "Cabinet"
                        : "Stream"}
                    </span>
                  </div>
                  {propertiesTarget?.type === "stream" && (
                    <div className="flex items-center justify-between">
                      <span>Kind</span>
                      <span className="text-text-default">
                        {(propertiesItem as Stream | undefined)
                          ? isGlobalStream(propertiesItem as Stream)
                            ? "Global"
                            : "Regular"
                          : "-"}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span>Location</span>
                    <span className="text-text-default">
                      {propertiesTarget?.type === "cabinet"
                        ? (propertiesItem as Cabinet | undefined)?.parent_id
                          ? (getCabinetById(
                              (propertiesItem as Cabinet).parent_id as string,
                            )?.name ?? "Unknown")
                          : "Root level"
                        : (propertiesItem as Stream | undefined)?.cabinet_id
                          ? (getCabinetById(
                              (propertiesItem as Stream).cabinet_id as string,
                            )?.name ?? "Unknown")
                          : "Root level"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>ID</span>
                    <span className="truncate text-text-default">
                      {propertiesItem?.id ?? "-"}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => setPropertiesTarget(null)}
                    className=" border border-border-default px-3 py-1.5 text-xs font-semibold text-text-default transition hover:bg-surface-subtle"
                  >
                    Close
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
