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
    <div className="log-pane__accent-panel group relative overflow-hidden border border-slate-300 transition-all">
      <div className="log-pane__accent-panel-header flex h-8 items-center justify-between border-b px-2.5">
        <div className="flex items-center gap-1.5">
          <GitMerge className="log-pane__accent-label h-4 w-4" />
          <span className="log-pane__accent-label uppercase tracking-[0.14em]">
            Merge Commit
          </span>
        </div>
        <span className="text-slate-600 font-mono">{createdAtText}</span>
      </div>

      <div className="px-2.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="log-pane__accent-badge inline-flex items-center gap-1 px-1.5 py-0.5 uppercase tracking-[0.14em]">
            <GitBranch className="h-4 w-4" />
            {sourceBranchName}
          </span>
          <span className="font-mono text-slate-500">{sourceHash}</span>
          <span className="font-mono text-slate-500">into</span>
          <span className="log-pane__accent-badge inline-flex items-center gap-1 px-1.5 py-0.5 uppercase tracking-[0.14em]">
            <GitBranch className="h-4 w-4" />
            {targetBranchName}
          </span>
          <span className="font-mono text-slate-500">{targetHash}</span>
        </div>

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="log-pane__info-text flex items-center gap-1.5">
            <Info className="h-4 w-4" />
            This merge keeps merged content in history and tracks the source
            branch join.
          </div>
          {onOpenInGraph ? (
            <button
              onClick={onOpenInGraph}
              className="log-pane__action-button inline-flex items-center gap-1 transition-colors"
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
