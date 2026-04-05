"use client";

import type { MouseEventHandler, ReactNode } from "react";
import type {
  TimelineFeatureFlags,
  TimelineStyleVariant,
} from "@/lib/types/timeline";

interface TimelineItemShellProps {
  itemId: string;
  collapseKey: string;
  styleVariant: TimelineStyleVariant;
  features: TimelineFeatureFlags;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  className?: string;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onRef?: (node: HTMLDivElement | null) => void;
  children: ReactNode;
}

function styleVariantClassName(styleVariant: TimelineStyleVariant): string {
  if (styleVariant === "draft") return "timeline-item--draft";
  if (styleVariant === "snapshot") return "timeline-item--snapshot";
  if (styleVariant === "merge") return "timeline-item--merge";
  return "timeline-item--entry";
}

export function TimelineItemShell({
  itemId,
  collapseKey,
  styleVariant,
  features,
  isHighlighted = false,
  isDimmed = false,
  className,
  onContextMenu,
  onRef,
  children,
}: TimelineItemShellProps) {
  return (
    <div
      ref={onRef}
      onContextMenu={features.contextMenu ? onContextMenu : undefined}
      data-timeline-item-id={itemId}
      data-timeline-item-collapse-key={collapseKey}
      data-timeline-variant={styleVariant}
      data-feature-collapsible={features.collapsible}
      data-feature-amendable={features.amendable}
      data-feature-diffable={features.diffable}
      data-feature-previewable={features.previewable}
      data-feature-stasheable={features.stasheable}
      className={[
        "timeline-item",
        styleVariantClassName(styleVariant),
        isHighlighted ? "kolam-search-reveal" : "",
        isDimmed ? "opacity-50" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
