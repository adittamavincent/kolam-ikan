"use client";

import {
  Archive,
  ArchiveRestore,
  Clock3,
  GitBranch,
  GitCommitHorizontal,
  Layers3,
  PencilLine,
  Trash2,
} from "lucide-react";
import { ModalHeader, ModalShell } from "@/components/shared/ModalShell";
import type {
  CommittedEntryStashItem,
  EntryCreatorStashItem,
} from "@/lib/utils/stash";

type StashDialogProps = {
  open: boolean;
  committedStashes: CommittedEntryStashItem[];
  draftStashes: EntryCreatorStashItem[];
  onClose: () => void;
  onApplyDraftStash: (stashId: string) => void;
  onPopDraftStash: (stashId: string) => void;
  onDropDraftStash: (stashId: string) => void;
  onUnstashCommittedEntry: (stashId: string) => void;
  onOpenCommittedStashInGraph: (stashId: string) => void;
};

function shortHash(id: string): string {
  return id.replace(/-/g, "").slice(0, 7);
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function EmptyState() {
  return (
    <div className="border border-dashed border-border-default bg-surface-subtle px-4 py-8 text-center">
      <div className="text-text-default">No stashes yet</div>
      <p className="mt-1 text-text-muted">
        Stashed commits and composer drafts will show up here.
      </p>
    </div>
  );
}

export function StashDialog({
  open,
  committedStashes,
  draftStashes,
  onClose,
  onApplyDraftStash,
  onPopDraftStash,
  onDropDraftStash,
  onUnstashCommittedEntry,
  onOpenCommittedStashInGraph,
}: StashDialogProps) {
  const totalCount = committedStashes.length + draftStashes.length;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      viewportClassName="fixed inset-0 overflow-y-auto p-3 lg:p-4"
      contentClassName="flex min-h-full items-start justify-center"
      panelClassName="my-auto flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden"
    >
      <ModalHeader
        title="Stash"
        description={`${totalCount} item${totalCount === 1 ? "" : "s"} stored across commits and drafts.`}
        icon={<Archive className="h-4 w-4" />}
        onClose={onClose}
      />

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {totalCount === 0 ? <EmptyState /> : null}

        {committedStashes.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="uppercase tracking-[0.18em] text-text-muted">
                Stashed Commits
              </div>
              <div className="text-text-muted">
                Hidden from the log list, visible in the commit graph.
              </div>
            </div>

            {committedStashes.map((stash) => (
              <div
                key={stash.id}
                className="border border-border-default bg-surface-subtle px-4 py-3"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 border border-status-warning-border bg-status-warning-bg px-1.5 py-0.5 uppercase tracking-[0.14em] text-status-warning-text">
                        <Archive className="h-4 w-4" />
                        commit stash
                      </span>
                      <code className="bg-surface-default px-1.5 py-0.5 text-text-default">
                        {shortHash(stash.entryId)}
                      </code>
                      <span className="inline-flex items-center gap-1 text-text-muted">
                        <GitBranch className="h-4 w-4" />
                        {stash.branchName}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Layers3 className="h-4 w-4" />
                        {stash.sectionCount} section
                        {stash.sectionCount === 1 ? "" : "s"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-4 w-4" />
                        stashed {formatTimestamp(stash.createdAt)}
                      </span>
                      {stash.originalCreatedAt && (
                        <span className="inline-flex items-center gap-1">
                          <GitCommitHorizontal className="h-4 w-4" />
                          original commit{" "}
                          {formatTimestamp(stash.originalCreatedAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenCommittedStashInGraph(stash.id)}
                      className="inline-flex items-center gap-2 border border-border-default px-3 py-1.5 text-text-default hover:bg-surface-hover"
                    >
                      <GitCommitHorizontal className="h-4 w-4" />
                      Open in graph
                    </button>
                    <button
                      type="button"
                      onClick={() => onUnstashCommittedEntry(stash.id)}
                      className="inline-flex items-center gap-2 bg-status-warning-bg px-3 py-1.5 text-status-warning-text hover:bg-status-warning-border"
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      Unstash
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {draftStashes.length > 0 && (
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="uppercase tracking-[0.18em] text-text-muted">
                Stashed Drafts
              </div>
              <div className="text-text-muted">
                Saved composer workspaces you can apply or pop back in.
              </div>
            </div>

            {draftStashes.map((stash) => (
              <div
                key={stash.id}
                className="border border-border-default bg-surface-subtle px-4 py-3"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 border border-status-info-border bg-status-info-bg px-1.5 py-0.5 uppercase tracking-[0.14em] text-status-info-text">
                        <PencilLine className="h-4 w-4" />
                        draft stash
                      </span>
                      <code className="bg-surface-default px-1.5 py-0.5 text-text-default">
                        {shortHash(stash.id)}
                      </code>
                      <span className="inline-flex items-center gap-1 text-text-muted">
                        <GitBranch className="h-4 w-4" />
                        {stash.branchName}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-text-muted">
                      <span className="inline-flex items-center gap-1">
                        <Layers3 className="h-4 w-4" />
                        {stash.sections.length} section
                        {stash.sections.length === 1 ? "" : "s"}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-4 w-4" />
                        saved {formatTimestamp(stash.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onApplyDraftStash(stash.id)}
                      className="inline-flex items-center gap-2 border border-border-default px-3 py-1.5 text-text-default hover:bg-surface-hover"
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => onPopDraftStash(stash.id)}
                      className="inline-flex items-center gap-2 bg-action-primary-bg px-3 py-1.5 text-action-primary-text hover:bg-action-primary-hover"
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      Pop
                    </button>
                    <button
                      type="button"
                      onClick={() => onDropDraftStash(stash.id)}
                      className="inline-flex items-center gap-2 border border-border-default px-3 py-1.5 text-text-muted hover:text-text-default"
                    >
                      <Trash2 className="h-4 w-4" />
                      Drop
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </ModalShell>
  );
}
