import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { EntryWithSections, CanvasVersion } from "@/lib/types";

export type TimelineItem =
  | { type: "entry"; data: EntryWithSections; created_at: string }
  | { type: "canvas_snapshot"; data: CanvasVersion; created_at: string };

interface UseTimelineItemsOptions {
  sortOrder?: "newest" | "oldest";
}

function parseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

export function useTimelineItems(
  streamId: string,
  entries: EntryWithSections[],
  options: UseTimelineItemsOptions = {},
) {
  const supabase = createClient();
  const { sortOrder = "newest" } = options;

  const { data: canvasVersions, isLoading: isVersionsLoading } = useQuery({
    queryKey: ["canvas-versions", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("canvas_versions")
        .select("*")
        .eq("stream_id", streamId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!streamId,
  });

  const timelineItems = useMemo(() => {
    const entryItems: TimelineItem[] = entries.map((entry) => ({
      type: "entry" as const,
      data: entry,
      created_at: entry.created_at ?? "",
    }));

    const snapshotItems: TimelineItem[] = (canvasVersions ?? []).map(
      (version) => ({
        type: "canvas_snapshot" as const,
        data: version as CanvasVersion,
        created_at: version.created_at ?? "",
      }),
    );

    const merged = [...entryItems, ...snapshotItems];

    merged.sort((a, b) => {
      const dateA = parseTimestamp(a.created_at);
      const dateB = parseTimestamp(b.created_at);

      if (dateA !== dateB) {
        return sortOrder === "newest" ? dateB - dateA : dateA - dateB;
      }

      const idA = a.data.id;
      const idB = b.data.id;
      return sortOrder === "newest"
        ? idB.localeCompare(idA)
        : idA.localeCompare(idB);
    });

    return merged;
  }, [entries, canvasVersions, sortOrder]);

  return {
    timelineItems,
    isVersionsLoading,
  };
}
