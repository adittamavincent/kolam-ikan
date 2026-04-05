"use client";

import {
  Archive,
  Copy,
  Eye,
  EyeOff,
  GitBranch,
  GitCommitHorizontal,
  GitCompare,
  RotateCcw,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";
import type { CanvasVersion, EntryWithSections } from "@/lib/types";
import {
  CONTEXT_MENU_ACTION_ICON_CLASS,
  CONTEXT_MENU_BASE_CONTAINER_CLASS,
  CONTEXT_MENU_HEADER_CLASS,
  CONTEXT_MENU_SCROLL_CONTAINER_CLASS,
  CONTEXT_MENU_SUBTITLE_DIVIDER_CLASS,
  ContextMenuActionButton,
  ContextMenuDivider,
  ContextMenuPortal,
  ContextMenuSectionLabel,
} from "./context-menu/ContextMenuPrimitives";

export type LogContextMenuState =
  | {
      kind: "entry";
      entry: EntryWithSections;
      x: number;
      y: number;
    }
  | {
      kind: "snapshot";
      snapshot: CanvasVersion;
      x: number;
      y: number;
    };

export type GitAction =
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

export type SnapshotAction = "open" | "copy-content" | "delete";

interface LogPaneContextMenuProps {
  contextMenu: LogContextMenuState | null;
  contextMenuRef: React.RefObject<HTMLDivElement | null>;
  contextMenuPosition: {
    left: number;
    top: number;
  };
  tags: Record<string, string>;
  stashedEntryIds: Set<string>;
  onEntryAction: (action: GitAction) => void;
  onSnapshotAction: (action: SnapshotAction) => void;
}

function shortHash(id: string): string {
  return id.replace(/-/g, "").slice(0, 7);
}

export function LogPaneContextMenu({
  contextMenu,
  contextMenuRef,
  contextMenuPosition,
  tags,
  stashedEntryIds,
  onEntryAction,
  onSnapshotAction,
}: LogPaneContextMenuProps) {
  if (!contextMenu || typeof window === "undefined") return null;

  return (
    <ContextMenuPortal
      menuRef={contextMenuRef}
      position={contextMenuPosition}
      className={`${CONTEXT_MENU_BASE_CONTAINER_CLASS} ${CONTEXT_MENU_SCROLL_CONTAINER_CLASS} w-56`}
      style={{ backgroundColor: "var(--bg-surface-elevated)" }}
    >
      {contextMenu.kind === "entry" ? (
        <>
          <div className={CONTEXT_MENU_HEADER_CLASS}>
            <GitCommitHorizontal className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            <code className="font-mono text-primary-400">
              {shortHash(contextMenu.entry.id)}
            </code>
            <span className="text-text-muted truncate">
              {contextMenu.entry.created_at &&
                new Date(contextMenu.entry.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
            </span>
          </div>
          <div className={CONTEXT_MENU_SUBTITLE_DIVIDER_CLASS} />

          <ContextMenuSectionLabel>inspect</ContextMenuSectionLabel>
          <ContextMenuActionButton onClick={() => onEntryAction("copy-sha")}>
            <Copy className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            Copy commit SHA
          </ContextMenuActionButton>
          <ContextMenuActionButton onClick={() => onEntryAction("copy-content")}>
            <Eye className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            Copy commit content
          </ContextMenuActionButton>
          <ContextMenuActionButton onClick={() => onEntryAction("diff")}>
            <GitCompare className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            Compare with parent
          </ContextMenuActionButton>

          <ContextMenuDivider />

          <ContextMenuSectionLabel>modify</ContextMenuSectionLabel>
          <ContextMenuActionButton onClick={() => onEntryAction("cherry-pick")}>
            <RotateCcw className="h-4 w-4 text-text-muted rotate-180" />
            Cherry-pick commit
          </ContextMenuActionButton>
          <ContextMenuActionButton onClick={() => onEntryAction("branch")}>
            <GitBranch className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            Create branch here
          </ContextMenuActionButton>
          <ContextMenuActionButton onClick={() => onEntryAction("revert")}>
            <Undo2 className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            Revert this commit
          </ContextMenuActionButton>
          <ContextMenuActionButton onClick={() => onEntryAction("tag")}>
            <Tag className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            {tags[contextMenu.entry.id]
              ? `Edit tag (${tags[contextMenu.entry.id]})`
              : "Add tag"}
          </ContextMenuActionButton>
          <ContextMenuActionButton onClick={() => onEntryAction("stash")}>
            {stashedEntryIds.has(contextMenu.entry.id) ? (
              <>
                <EyeOff className="h-4 w-4 text-amber-500" />
                <span className="text-amber-600 dark:text-amber-400">
                  Unstash commit
                </span>
              </>
            ) : (
              <>
                <Archive className={CONTEXT_MENU_ACTION_ICON_CLASS} />
                Stash commit
              </>
            )}
          </ContextMenuActionButton>

          <ContextMenuDivider />

          <ContextMenuSectionLabel>danger</ContextMenuSectionLabel>
          <ContextMenuActionButton onClick={() => onEntryAction("reset")}>
            <RotateCcw className="h-4 w-4 text-amber-500" />
            Reset branch to this commit
          </ContextMenuActionButton>
          <ContextMenuActionButton danger onClick={() => onEntryAction("delete")}>
            <Trash2 className="h-4 w-4" />
            Delete commit
          </ContextMenuActionButton>
        </>
      ) : (
        <>
          <div className={CONTEXT_MENU_HEADER_CLASS}>
            <Eye className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            <code className="font-mono text-primary-400">
              {shortHash(contextMenu.snapshot.id)}
            </code>
            <span className="text-text-muted truncate">
              {contextMenu.snapshot.created_at &&
                new Date(contextMenu.snapshot.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
            </span>
          </div>
          <div className={CONTEXT_MENU_SUBTITLE_DIVIDER_CLASS} />

          <ContextMenuSectionLabel>inspect</ContextMenuSectionLabel>
          <ContextMenuActionButton onClick={() => onSnapshotAction("open")}>
            <RotateCcw className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            Open in canvas preview
          </ContextMenuActionButton>
          <ContextMenuActionButton onClick={() => onSnapshotAction("copy-content")}>
            <Copy className={CONTEXT_MENU_ACTION_ICON_CLASS} />
            Copy snapshot content
          </ContextMenuActionButton>

          <ContextMenuDivider />

          <ContextMenuSectionLabel>danger</ContextMenuSectionLabel>
          <ContextMenuActionButton danger onClick={() => onSnapshotAction("delete")}>
            <Trash2 className="h-4 w-4" />
            Delete canvas snapshot
          </ContextMenuActionButton>
        </>
      )}
    </ContextMenuPortal>
  );
}
