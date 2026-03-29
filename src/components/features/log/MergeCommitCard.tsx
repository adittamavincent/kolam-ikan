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
          <GitMerge className="h-3.5 w-3.5 text-action-primary-bg" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-action-primary-bg">
            Merge Commit
          </span>
        </div>
        <span className="text-[10px] font-medium text-text-subtle font-mono">
          {createdAtText}
        </span>
      </div>

      <div className="px-2.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-400">
            <GitBranch className="h-3 w-3" />
            {sourceBranchName}
          </span>
          <span className="text-[10px] font-mono text-text-muted">{sourceHash}</span>
          <span className="text-[10px] font-mono text-text-muted">into</span>
          <span className="inline-flex items-center gap-1 border border-primary-800 bg-primary-950 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-action-primary-bg">
            <GitBranch className="h-3 w-3" />
            {targetBranchName}
          </span>
          <span className="text-[10px] font-mono text-text-muted">{targetHash}</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <Info className="h-3.5 w-3.5" />
            This merge keeps merged content in history and tracks the source branch join.
          </div>
          {onOpenInGraph ? (
            <button
              onClick={onOpenInGraph}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted transition-colors hover:text-text-default"
            >
              <GitCommitHorizontal className="h-3.5 w-3.5" />
              View in graph
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
