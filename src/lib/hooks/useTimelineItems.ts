import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { EntryWithSections, CanvasVersion } from '@/lib/types';

export type TimelineItem =
    | { type: 'entry'; data: EntryWithSections; created_at: string }
    | { type: 'canvas_snapshot'; data: CanvasVersion; created_at: string };

interface UseTimelineItemsOptions {
    sortOrder?: 'newest' | 'oldest';
}

export function useTimelineItems(
    streamId: string,
    entries: EntryWithSections[],
    options: UseTimelineItemsOptions = {},
) {
    const supabase = createClient();
    const { sortOrder = 'newest' } = options;

    const { data: canvasVersions, isLoading: isVersionsLoading } = useQuery({
        queryKey: ['canvas-versions', streamId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('canvas_versions')
                .select('*')
                .eq('stream_id', streamId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data ?? [];
        },
        enabled: !!streamId,
    });

    const timelineItems = useMemo(() => {
        const entryItems: TimelineItem[] = entries.map((entry) => ({
            type: 'entry' as const,
            data: entry,
            created_at: entry.created_at ?? '',
        }));

        const snapshotItems: TimelineItem[] = (canvasVersions ?? []).map((version) => ({
            type: 'canvas_snapshot' as const,
            data: version as CanvasVersion,
            created_at: version.created_at ?? '',
        }));

        const merged = [...entryItems, ...snapshotItems];

        merged.sort((a, b) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
        });

        return merged;
    }, [entries, canvasVersions, sortOrder]);

    return {
        timelineItems,
        isVersionsLoading,
    };
}
