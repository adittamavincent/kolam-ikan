"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Globe } from "lucide-react";

export function ContextBag({
  streamId,
  selectedEntries,
  onSelectionChange,
  includeCanvas,
  onIncludeCanvasChange,
  includeGlobalStream,
  onIncludeGlobalStreamChange,
  globalStreamName,
  globalStreamDisabled,
  globalStreamLoading,
  currentStreamIsGlobal,
  disableSelectAll,
}: {
  streamId: string;
  selectedEntries: string[];
  onSelectionChange: (ids: string[]) => void;
  includeCanvas: boolean;
  onIncludeCanvasChange: (include: boolean) => void;
  includeGlobalStream: boolean;
  onIncludeGlobalStreamChange: (include: boolean) => void;
  globalStreamName: string | null;
  globalStreamDisabled: boolean;
  globalStreamLoading?: boolean;
  currentStreamIsGlobal: boolean;
  disableSelectAll?: boolean;
}) {
  const supabase = createClient();
  const isGlobalToggleDisabled = globalStreamDisabled || !!globalStreamLoading;

  const { data: entries, isLoading: isEntriesLoading } = useQuery({
    queryKey: ["bridge-entries", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entries")
        .select(
          "id, created_at, sections(id, persona_name_snapshot, search_text)",
        )
        .eq("stream_id", streamId)
        .eq("is_draft", false)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!streamId,
    staleTime: 1000 * 60 * 5, // 5 minutes cache
  });

  const groupedEntries = (() => {
    const groups: Record<string, typeof entries> = {};
    (entries ?? []).forEach((entry) => {
      const dateKey = entry.created_at
        ? new Date(entry.created_at).toDateString()
        : "Unknown Date";
      groups[dateKey] = groups[dateKey] || [];
      // Avoid duplicates if any
      if (!groups[dateKey]?.some((e) => e.id === entry.id)) {
        groups[dateKey]?.push(entry);
      }
    });

    // Sort groups by date descending
    return Object.entries(groups).sort(
      (a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime(),
    );
  })();

  const toggleEntry = (entryId: string) => {
    if (selectedEntries.includes(entryId)) {
      onSelectionChange(selectedEntries.filter((id) => id !== entryId));
    } else {
      onSelectionChange([...selectedEntries, entryId]);
    }
  };

  const selectAll = () => {
    if (disableSelectAll) return;
    const allIds = groupedEntries.flatMap(([, group]) =>
      (group ?? []).map((entry) => entry.id),
    );
    onSelectionChange(Array.from(new Set(allIds)));
  };

  const selectLastFive = () => {
    const ids = groupedEntries
      .flatMap(([, group]) => group ?? [])
      .slice(0, 5)
      .map((entry) => entry.id);
    onSelectionChange(ids);
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  const isLoadingEntries = isEntriesLoading;

  return (
    <div className="mb-6 border border-border-default bg-surface-subtle p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-text-default">Context Bag</h3>
        <span className=" bg-surface-subtle px-2.5 py-1 text-[10px] font-bold tracking-wider text-text-muted">
          {selectedEntries.length} SELECTED
        </span>
      </div>
      <div className="space-y-4">
        <label className="flex items-center gap-2.5 text-text-default text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeCanvas}
            onChange={(e) => onIncludeCanvasChange(e.target.checked)}
          />
          Include Current Canvas
        </label>
        <div className="space-y-1">
          <label
            className={`flex items-center gap-2 text-sm select-none ${
              isGlobalToggleDisabled
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={includeGlobalStream}
              onChange={(e) => onIncludeGlobalStreamChange(e.target.checked)}
              disabled={isGlobalToggleDisabled}
              className="accent-action-primary-bg"
            />
            <span className="flex items-center gap-1.5 text-text-default">
              <Globe
                className={`h-3.5 w-3.5 ${
                  includeGlobalStream && !isGlobalToggleDisabled
                    ? "text-action-primary-bg"
                    : "text-text-muted"
                }`}
              />
              Include Domain Global Stream
            </span>
            {globalStreamLoading && (
              <span className="ml-1 inline-block h-3 w-3 animate-spin border-2 border-border-default border-t-transparent" />
            )}
          </label>
          {!globalStreamLoading &&
            globalStreamName &&
            !globalStreamDisabled && (
              <p className="ml-7 text-[11px] text-text-muted">
                {globalStreamName}
              </p>
            )}
          <p className="ml-7 text-[11px] text-text-muted">
            {globalStreamLoading
              ? "Checking global stream for this domain..."
              : currentStreamIsGlobal
                ? "Current stream is already global — its context is included by default."
                : globalStreamDisabled
                  ? "No global stream found in this domain."
                  : "Carries domain-wide backstory into bridge prompts."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs mt-1">
          <button
            onClick={selectAll}
            disabled={disableSelectAll || isLoadingEntries}
            className=" border border-border-default bg-surface-default px-3 py-1.5 font-medium text-text-default hover:bg-surface-elevated disabled:opacity-50 transition-all"
          >
            Select All
          </button>
          <button
            onClick={selectLastFive}
            disabled={isLoadingEntries}
            className=" border border-border-default bg-surface-default px-3 py-1.5 font-medium text-text-default hover:bg-surface-elevated disabled:opacity-50 transition-all"
          >
            Last 5
          </button>
          <button
            onClick={clearAll}
            className=" border border-border-default bg-surface-default px-3 py-1.5 font-medium text-text-default hover:bg-surface-elevated transition-all"
          >
            Clear
          </button>
        </div>
        <div className="max-h-56 space-y-3 overflow-y-auto border border-border-default bg-surface-default p-3 text-xs">
          {isLoadingEntries ? (
            <div className="text-text-muted animate-pulse">
              Loading entries...
            </div>
          ) : groupedEntries.length === 0 ? (
            <div className="text-text-muted">No entries yet.</div>
          ) : (
            groupedEntries.map(([dateKey, group]) => (
              <div key={dateKey} className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {dateKey}
                </div>
                {group?.map((entry) => {
                  const preview =
                    entry.sections?.[0]?.search_text ||
                    entry.sections?.[0]?.persona_name_snapshot ||
                    "Empty entry";
                  return (
                    <label
                      key={entry.id}
                      className="flex items-start gap-3 p-1.5 hover:bg-surface-subtle transition-colors cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-action-primary-bg"
                        checked={selectedEntries.includes(entry.id)}
                        onChange={() => toggleEntry(entry.id)}
                      />
                      <div>
                        <div className="text-[12px] font-medium text-text-default leading-snug">
                          {preview.slice(0, 80)}
                        </div>
                        <div className="text-[10px] text-text-muted mt-0.5">
                          {entry.created_at
                            ? new Date(entry.created_at).toLocaleString()
                            : "Unknown time"}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
