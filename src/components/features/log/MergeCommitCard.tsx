"use client";

import { GitBranch, GitCommitHorizontal, GitMerge, Info } from "lucide-react";
import { EntryWithSections } from "@/lib/types";

interface MergeCommitCardProps {
  entry: EntryWithSections;
  sourceHash: string;
  targetHash: string;
  createdAtText: string;
  onOpenInGraph?: () => void;
}

export function MergeCommitCard({
  entry,
  sourceHash,
  targetHash,
  createdAtText,
  onOpenInGraph,
}: MergeCommitCardProps) {
  const sourceBranchName = entry.merge_source_branch_name ?? "source";
  const targetBranchName = entry.merge_target_branch_name ?? "current";

  return (
    <div className="group relative overflow-hidden border border-border-default bg-primary-950 transition-all">
      <div className="flex h-8 items-center justify-between border-b border-border-default bg-primary-950 px-2.5">
        <div className="flex items-center gap-1.5">
          <GitMerge className="h-4 w-4 text-action-primary-bg" />
          <span className="uppercase tracking-[0.14em] text-action-primary-bg">
            Merge Commit
          </span>
        </div>
        <span className="text-text-subtle font-mono">
          {createdAtText}
        </span>
      </div>

      <div className="px-2.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 uppercase tracking-[0.14em] text-emerald-400">
            <GitBranch className="h-4 w-4" />
            {sourceBranchName}
          </span>
          <span className="font-mono text-text-muted">{sourceHash}</span>
          <span className="font-mono text-text-muted">into</span>
          <span className="inline-flex items-center gap-1 border border-primary-800 bg-primary-950 px-1.5 py-0.5 uppercase tracking-[0.14em] text-action-primary-bg">
            <GitBranch className="h-4 w-4" />
            {targetBranchName}
          </span>
          <span className="font-mono text-text-muted">{targetHash}</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-text-muted">
            <Info className="h-4 w-4" />
            This merge keeps merged content in history and tracks the source branch join.
          </div>
          {onOpenInGraph ? (
            <button
              onClick={onOpenInGraph}
              className="inline-flex items-center gap-1 text-text-muted transition-colors hover:text-text-default"
            >
              <GitCommitHorizontal className="h-4 w-4" />
              View in graph
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
