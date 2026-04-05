"use client";

import {
  Archive,
  ArchiveRestore,
  Copy,
  GitBranch,
  RotateCcw,
  Trash2,
} from "lucide-react";
import {
  CONTEXT_MENU_ACTION_ICON_CLASS,
  CONTEXT_MENU_BASE_CONTAINER_CLASS,
  CONTEXT_MENU_HEADER_CLASS,
  CONTEXT_MENU_SUBTITLE_DIVIDER_CLASS,
  ContextMenuActionButton,
  ContextMenuDivider,
  ContextMenuPortal,
} from "./context-menu/ContextMenuPrimitives";

interface EntryCreatorContextMenuProps {
  isOpen: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  position: {
    left: number;
    top: number;
  } | null;
  selectedBranch: string;
  sectionCount: number;
  stashCount: number;
  hasCommitableContent: boolean;
  onClose: () => void;
  onStashChanges: () => void;
  onApplyLatestStash: () => void;
  onPopLatestStash: () => void;
  onDropLatestStash: () => void;
  onClearStashStack: () => void;
  onCopyLatestStashPayload: () => Promise<void>;
}

export function EntryCreatorContextMenu({
  isOpen,
  menuRef,
  position,
  selectedBranch,
  sectionCount,
  stashCount,
  hasCommitableContent,
  onClose,
  onStashChanges,
  onApplyLatestStash,
  onPopLatestStash,
  onDropLatestStash,
  onClearStashStack,
  onCopyLatestStashPayload,
}: EntryCreatorContextMenuProps) {
  if (!isOpen || !position) return null;

  return (
    <ContextMenuPortal
      menuRef={menuRef}
      position={position}
      className={`${CONTEXT_MENU_BASE_CONTAINER_CLASS} w-64 shadow-lg`}
      ariaLabel="Entry creator stash menu"
    >
      <div className="px-2 py-1">
        <div className="uppercase tracking-[0.16em] text-text-muted">
          working tree
        </div>
        <div
          className={`${CONTEXT_MENU_HEADER_CLASS} mt-1 px-0 py-0 text-text-default`}
        >
          <GitBranch className={CONTEXT_MENU_ACTION_ICON_CLASS} />
          <span className="truncate">{selectedBranch}</span>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted">
            {sectionCount} section{sectionCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className={CONTEXT_MENU_SUBTITLE_DIVIDER_CLASS} />

      <ContextMenuActionButton
        onClick={() => {
          onStashChanges();
          onClose();
        }}
        disabled={!hasCommitableContent}
      >
        <Archive className={CONTEXT_MENU_ACTION_ICON_CLASS} />
        Stash changes
      </ContextMenuActionButton>
      <ContextMenuActionButton
        onClick={() => {
          onApplyLatestStash();
          onClose();
        }}
        disabled={stashCount === 0}
      >
        <ArchiveRestore className={CONTEXT_MENU_ACTION_ICON_CLASS} />
        Apply latest stash
      </ContextMenuActionButton>
      <ContextMenuActionButton
        onClick={() => {
          onPopLatestStash();
          onClose();
        }}
        disabled={stashCount === 0}
      >
        <RotateCcw className={CONTEXT_MENU_ACTION_ICON_CLASS} />
        Pop latest stash
      </ContextMenuActionButton>

      <ContextMenuDivider />

      <div className="px-2 py-1 text-text-muted">
        {stashCount === 0
          ? "No stashed drafts"
          : `${stashCount} stashed draft${stashCount === 1 ? "" : "s"} available`}
      </div>

      <ContextMenuActionButton
        onClick={() => {
          onDropLatestStash();
          onClose();
        }}
        disabled={stashCount === 0}
      >
        <Trash2 className={CONTEXT_MENU_ACTION_ICON_CLASS} />
        Drop latest stash
      </ContextMenuActionButton>
      <ContextMenuActionButton
        onClick={() => {
          onClearStashStack();
          onClose();
        }}
        disabled={stashCount === 0}
      >
        <Trash2 className={CONTEXT_MENU_ACTION_ICON_CLASS} />
        Clear stash stack
      </ContextMenuActionButton>
      <ContextMenuActionButton
        onClick={async () => {
          await onCopyLatestStashPayload();
          onClose();
        }}
        disabled={stashCount === 0}
      >
        <Copy className={CONTEXT_MENU_ACTION_ICON_CLASS} />
        Copy latest stash payload
      </ContextMenuActionButton>
    </ContextMenuPortal>
  );
}
