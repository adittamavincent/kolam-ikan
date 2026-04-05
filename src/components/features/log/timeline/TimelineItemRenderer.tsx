"use client";

import type { MouseEventHandler, ReactNode } from "react";
import type { TimelineItemKind } from "@/lib/types/timeline";
import { getTimelineItemSpec } from "./TimelineItemRegistry";
import { TimelineItemShell } from "./TimelineItemShell";

interface TimelineItemRendererProps {
  kind: TimelineItemKind;
  itemId: string;
  collapseKey: string;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  className?: string;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onRef?: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}

export function TimelineItemRenderer({
  kind,
  itemId,
  collapseKey,
  isHighlighted = false,
  isDimmed = false,
  className,
  onContextMenu,
  onRef,
  children,
}: TimelineItemRendererProps) {
  const spec = getTimelineItemSpec(kind);

  return (
    <TimelineItemShell
      itemId={itemId}
      collapseKey={collapseKey}
      styleVariant={spec.styleVariant}
      features={spec.features}
      isHighlighted={isHighlighted}
      isDimmed={isDimmed}
      className={className}
      onContextMenu={onContextMenu}
      onRef={onRef}
    >
      {children}
    </TimelineItemShell>
  );
}
