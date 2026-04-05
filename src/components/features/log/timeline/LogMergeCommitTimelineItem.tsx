"use client";

import type { EntryWithSections } from "@/lib/types";
import { MergeCommitCard } from "../MergeCommitCard";
import { TimelineItemRenderer } from "./TimelineItemRenderer";

interface LogMergeCommitTimelineItemProps {
  entry: EntryWithSections;
  createdAtText: string;
  collapseKey: string;
  sourceHash: string;
  targetHash: string;
  isDimmed?: boolean;
  onOpenInGraph: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onBindRef: (node: HTMLDivElement | null) => void;
}

export function LogMergeCommitTimelineItem({
  entry,
  createdAtText,
  collapseKey,
  sourceHash,
  targetHash,
  isDimmed = false,
  onOpenInGraph,
  onContextMenu,
  onBindRef,
}: LogMergeCommitTimelineItemProps) {
  return (
    <TimelineItemRenderer
      kind="merge_commit"
      itemId={entry.id}
      collapseKey={collapseKey}
      onRef={onBindRef}
      onContextMenu={onContextMenu}
      isDimmed={isDimmed}
    >
      <MergeCommitCard
        entry={entry}
        sourceHash={sourceHash}
        targetHash={targetHash}
        createdAtText={createdAtText}
        onOpenInGraph={onOpenInGraph}
      />
    </TimelineItemRenderer>
  );
}
