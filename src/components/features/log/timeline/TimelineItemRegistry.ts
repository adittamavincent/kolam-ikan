import type { TimelineItemKind, TimelineItemSpec } from "@/lib/types/timeline";

export const TIMELINE_ITEM_REGISTRY: Record<
  TimelineItemKind,
  TimelineItemSpec
> = {
  entry: {
    kind: "entry",
    label: "Entry",
    styleVariant: "entry",
    features: {
      collapsible: true,
      contextMenu: true,
      searchable: true,
      amendable: true,
      diffable: false,
      previewable: false,
      stasheable: true,
    },
  },
  canvas_draft: {
    kind: "canvas_draft",
    label: "Canvas Draft",
    styleVariant: "draft",
    features: {
      collapsible: false,
      contextMenu: false,
      searchable: false,
      amendable: false,
      diffable: true,
      previewable: false,
      stasheable: false,
    },
  },
  canvas_snapshot: {
    kind: "canvas_snapshot",
    label: "Canvas Snapshot",
    styleVariant: "snapshot",
    features: {
      collapsible: true,
      contextMenu: true,
      searchable: false,
      amendable: false,
      diffable: true,
      previewable: true,
      stasheable: false,
    },
  },
  merge_commit: {
    kind: "merge_commit",
    label: "Merge Commit",
    styleVariant: "merge",
    features: {
      collapsible: false,
      contextMenu: true,
      searchable: true,
      amendable: false,
      diffable: false,
      previewable: false,
      stasheable: true,
    },
  },
};

export function getTimelineItemSpec(kind: TimelineItemKind): TimelineItemSpec {
  return TIMELINE_ITEM_REGISTRY[kind];
}
