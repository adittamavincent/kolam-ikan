"use client";

import type { CanvasVersion } from "@/lib/types";
import { CanvasSnapshotCard } from "../CanvasSnapshotCard";
import { TimelineItemRenderer } from "./TimelineItemRenderer";

interface LogCanvasSnapshotTimelineItemProps {
  snapshot: CanvasVersion;
  streamId: string;
  collapseKey: string;
  isCollapsed: boolean;
  isHighlighted?: boolean;
  aiModelLabel?: string | null;
  onToggleCollapsed: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onBindRef: (node: HTMLDivElement | null) => void;
}

export function LogCanvasSnapshotTimelineItem({
  snapshot,
  streamId,
  collapseKey,
  isCollapsed,
  isHighlighted = false,
  aiModelLabel = null,
  onToggleCollapsed,
  onContextMenu,
  onBindRef,
}: LogCanvasSnapshotTimelineItemProps) {
  return (
    <TimelineItemRenderer
      kind="canvas_snapshot"
      itemId={snapshot.id}
      collapseKey={collapseKey}
      onRef={onBindRef}
      onContextMenu={onContextMenu}
      isHighlighted={isHighlighted}
    >
      <CanvasSnapshotCard
        version={snapshot}
        streamId={streamId}
        aiModelLabel={aiModelLabel}
        isCollapsed={isCollapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
    </TimelineItemRenderer>
  );
}
