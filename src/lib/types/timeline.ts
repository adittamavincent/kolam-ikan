import type { CanvasVersion, EntryWithSections } from "@/lib/types";

export type TimelineItemKind =
  | "entry"
  | "canvas_draft"
  | "canvas_snapshot"
  | "merge_commit";

export interface TimelineFeatureFlags {
  collapsible: boolean;
  contextMenu: boolean;
  searchable: boolean;
  amendable: boolean;
  diffable: boolean;
  previewable: boolean;
  stasheable: boolean;
}

export type TimelineStyleVariant =
  | "entry"
  | "draft"
  | "snapshot"
  | "merge";

export interface TimelineItemSpec {
  kind: TimelineItemKind;
  label: string;
  styleVariant: TimelineStyleVariant;
  features: TimelineFeatureFlags;
}

export type TimelineItem =
  | { type: "entry"; data: EntryWithSections; created_at: string }
  | { type: "canvas_snapshot"; data: CanvasVersion; created_at: string };

export type RenderableTimelineItemKind = Exclude<TimelineItemKind, "canvas_draft">;

export function resolveTimelineItemKind(
  item: TimelineItem,
): RenderableTimelineItemKind {
  if (item.type === "canvas_snapshot") return "canvas_snapshot";
  if (item.data.entry_kind === "merge") return "merge_commit";
  return "entry";
}
