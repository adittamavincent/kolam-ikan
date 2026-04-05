"use client";

import type { PartialBlock } from "@/lib/types/editor";
import type {
  EntryWithSections,
  SectionFileAttachmentWithDocument,
} from "@/lib/types";
import {
  Archive,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  PencilLine,
  Tag,
  X,
} from "lucide-react";
import { ThreadFrame } from "@/components/shared/SectionPreset";
import { LogSection } from "../LogSection";
import { TimelineItemRenderer } from "./TimelineItemRenderer";

interface AmendSectionState {
  content?: PartialBlock[];
  markdown?: string;
  attachments?: SectionFileAttachmentWithDocument[];
}

interface LogEntryTimelineItemProps {
  entry: EntryWithSections;
  streamId: string;
  itemCollapseKey: string;
  hash: string;
  tag: string | null;
  entryBranches: string[];
  sectionCount: number;
  createdAtText: string;
  isCollapsed: boolean;
  isAmending: boolean;
  isLatestEntry: boolean;
  isStashed: boolean;
  isHighlighted?: boolean;
  amendError: string | null;
  amendSavePending: boolean;
  normalizedSearchTerm: string;
  highlightTerm: string | null;
  highlightEntryId: string | null;
  highlightSectionId: string | null;
  uploadingAmendSectionIds: Set<string>;
  amendSections?: Record<string, AmendSectionState>;
  onToggleCollapsed: () => void;
  onEntryContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onBindRef: (node: HTMLDivElement | null) => void;
  onStartAmend: () => void;
  onSaveAmend: () => void;
  onCancelAmend: () => void;
  onPreviewAttachment: (
    attachment: NonNullable<
      EntryWithSections["sections"][number]["section_attachments"]
    >[number],
    tab: "file" | "parsed",
  ) => void;
  onRemoveAmendAttachment: (
    sectionId: string,
    currentAttachments: SectionFileAttachmentWithDocument[],
    attachment: SectionFileAttachmentWithDocument,
    attachmentIndex: number,
  ) => void;
  onAddAmendAttachments: (
    sectionId: string,
    currentAttachments: SectionFileAttachmentWithDocument[],
    files: FileList | File[],
  ) => void;
  onAmendSectionChange: (
    sectionId: string,
    content: PartialBlock[],
    markdown: string,
  ) => void;
  onBindSectionRef: (sectionId: string, node: HTMLDivElement | null) => void;
}

export function LogEntryTimelineItem({
  entry,
  streamId,
  itemCollapseKey,
  hash,
  tag,
  entryBranches,
  sectionCount,
  createdAtText,
  isCollapsed,
  isAmending,
  isLatestEntry,
  isStashed,
  isHighlighted = false,
  amendError,
  amendSavePending,
  normalizedSearchTerm,
  highlightTerm,
  highlightEntryId,
  highlightSectionId,
  uploadingAmendSectionIds,
  amendSections,
  onToggleCollapsed,
  onEntryContextMenu,
  onBindRef,
  onStartAmend,
  onSaveAmend,
  onCancelAmend,
  onPreviewAttachment,
  onRemoveAmendAttachment,
  onAddAmendAttachments,
  onAmendSectionChange,
  onBindSectionRef,
}: LogEntryTimelineItemProps) {
  return (
    <TimelineItemRenderer
      kind="entry"
      itemId={entry.id}
      collapseKey={itemCollapseKey}
      onRef={onBindRef}
      onContextMenu={onEntryContextMenu}
      className={isStashed ? "text-text-muted" : undefined}
      isHighlighted={isHighlighted}
    >
      <ThreadFrame
        hideBody={isCollapsed}
        frameClassName={`group overflow-visible transition-colors hover:z-20 focus-within:z-20 bg-surface-default ${isAmending ? "ring-1 ring-action-primary-bg" : ""}`}
        headerClassName={`entry-creator__topbar hover:brightness-105 ${isAmending ? "cursor-default" : "cursor-pointer"} transition-colors`}
        bodyClassName="bg-surface-default"
        header={
          <div
            role="button"
            tabIndex={isAmending ? -1 : 0}
            aria-expanded={!isCollapsed}
            onClick={onToggleCollapsed}
            onKeyDown={(event) => {
              if (isAmending) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggleCollapsed();
              }
            }}
            className="flex h-6 items-center justify-between"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                aria-hidden="true"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </span>
              <GitCommitHorizontal className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="relative inline-flex shrink-0 items-center group/hash">
                <code className="cursor-help font-mono text-action-primary-bg">
                  {hash}
                </code>
                <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-64 bg-surface-elevated p-2 font-mono text-text-default group-hover/hash:block">
                  <div className="mb-1 uppercase tracking-wider text-text-muted">
                    Commit Metadata
                  </div>
                  <div>hash: {hash}</div>
                  <div className="truncate">id: {entry.id}</div>
                  <div>time: {createdAtText}</div>
                  <div>sections: {sectionCount}</div>
                  <div>tag: {tag || "-"}</div>
                  <div>stashed: {isStashed ? "yes" : "no"}</div>
                  <div>latest: {isLatestEntry ? "HEAD" : "no"}</div>
                  <div className="truncate">
                    branches: {entryBranches.length ? entryBranches.join(", ") : "-"}
                  </div>
                </div>
              </span>
              <span className="shrink-0 leading-4 uppercase tracking-wide">
                {sectionCount} section{sectionCount === 1 ? "" : "s"}
              </span>
              {tag && (
                <span className="shrink-0 flex h-4 items-center bg-amber-950 px-1.5 text-amber-600 dark:text-amber-400">
                  <Tag className="h-4 w-4" />
                  {tag}
                </span>
              )}
              {entryBranches.map((branchName) => (
                <div
                  key={`${entry.id}-${branchName}`}
                  className="log-pane__branch-tag shrink-0"
                  title={`${branchName} points at this commit`}
                >
                  <GitBranch className="h-4 w-4" />
                  {branchName}
                </div>
              ))}
              {isLatestEntry && (
                <span className="log-pane__accent-badge shrink-0 inline-flex h-4 items-center leading-4">
                  HEAD
                </span>
              )}
              {isStashed && (
                <span className="shrink-0 flex h-4 items-center bg-amber-950 px-1.5 text-amber-500">
                  <Archive className="h-4 w-4" />
                  stashed
                </span>
              )}
            </div>

            <div className="flex shrink-0 items-center">
              {isAmending ? (
                <>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onSaveAmend();
                    }}
                    disabled={amendSavePending}
                    className="entry-creator__topbar-button flex h-6 items-center px-1.5 py-0 leading-4 transition-colors focus: disabled:cursor-not-allowed disabled:opacity-60 gap-2"
                  >
                    {amendSavePending ? (
                      <Loader2 className="h-4 w-4 animate-spin text-text-subtle" />
                    ) : (
                      <Check className="h-4 w-4 text-text-subtle" />
                    )}
                    <span className="text-text-default">Save</span>
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelAmend();
                    }}
                    disabled={amendSavePending}
                    className="entry-creator__topbar-button flex h-6 items-center px-1.5 py-0 leading-4 transition-colors focus: disabled:cursor-not-allowed disabled:opacity-60 gap-2"
                  >
                    <X className="h-4 w-4 text-text-subtle" />
                    <span className="text-text-default">Cancel</span>
                  </button>
                </>
              ) : isLatestEntry ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartAmend();
                  }}
                  className="entry-creator__topbar-button flex h-6 w-40 shrink-0 items-center justify-center leading-4 transition-colors gap-2"
                  title="Amend commit"
                >
                  <PencilLine className="h-4 w-4" />
                  <span className="text-text-default">Amend commit</span>
                </button>
              ) : null}
            </div>
          </div>
        }
      >
        {isAmending && amendError && (
          <div className="bg-status-error-bg px-2.5 py-1 text-status-error-text">
            {amendError}
          </div>
        )}
        {!isCollapsed && (
          <div className="flex flex-col">
            {entry.sections?.map((section, sectionIndex) => (
              <div
                key={section.id}
                ref={(node) => {
                  onBindSectionRef(section.id, node);
                }}
              >
                <LogSection
                  section={section}
                  streamId={streamId}
                  sectionIndex={sectionIndex}
                  totalSections={entry.sections.length}
                  onPreviewAttachment={onPreviewAttachment}
                  editable={isAmending}
                  currentEditedContent={
                    isAmending ? amendSections?.[section.id]?.content : undefined
                  }
                  currentEditedMarkdown={
                    isAmending ? amendSections?.[section.id]?.markdown : undefined
                  }
                  attachmentOverrides={
                    isAmending ? amendSections?.[section.id]?.attachments : undefined
                  }
                  onRemoveAttachment={
                    isAmending
                      ? (attachment, attachmentIndex) =>
                          onRemoveAmendAttachment(
                            section.id,
                            amendSections?.[section.id]?.attachments ??
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
                          onAddAmendAttachments(
                            section.id,
                            amendSections?.[section.id]?.attachments ??
                              section.section_attachments ??
                              [],
                            files,
                          )
                      : undefined
                  }
                  isUploadingAttachments={uploadingAmendSectionIds.has(section.id)}
                  isSearchTarget={section.id === highlightSectionId}
                  onContentChange={(content, markdown) => {
                    if (!isAmending) return;
                    onAmendSectionChange(section.id, content, markdown);
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
            ))}
          </div>
        )}
      </ThreadFrame>
    </TimelineItemRenderer>
  );
}
