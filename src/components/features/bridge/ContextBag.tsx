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
  sentEntryIds,
  lastUsedAt,
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
  sentEntryIds?: string[];
  lastUsedAt?: string | null;
}) {
  const supabase = createClient();
  const isGlobalToggleDisabled = globalStreamDisabled || !!globalStreamLoading;

  const { data: entries, isLoading: isEntriesLoading } = useQuery({
    queryKey: ["bridge-entries", streamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("entries")
        .select(
          "id, created_at, updated_at, sections(id, persona_name_snapshot, search_text)",
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-bold tracking-wider text-slate-500 text-nowrap">
          {selectedEntries.length} SELECTED
        </span>
      </div>
      <div className="space-y-3">
        <label className="flex items-center gap-2.5 text-slate-800 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeCanvas}
            onChange={(e) => onIncludeCanvasChange(e.target.checked)}
            className="accent-blue-500"
          />
          Include current canvas
        </label>
        <div className="space-y-1">
          <label
            className={`flex items-center gap-2 select-none ${
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
              className="accent-blue-500"
            />
            <span className="flex items-center gap-1.5 text-slate-800">
              <Globe
                className={`h-3.5 w-3.5 ${
                  includeGlobalStream && !isGlobalToggleDisabled
                    ? "text-blue-500"
                    : "text-slate-500"
                }`}
              />
              Include Domain Global Stream
            </span>
            {globalStreamLoading && (
              <span className="ml-1 inline-block h-3 w-3 animate-spin border-2 border-slate-300 border-t-blue-500" />
            )}
          </label>
          {!globalStreamLoading &&
            globalStreamName &&
            !globalStreamDisabled && (
              <p className="ml-7 text-slate-500">{globalStreamName}</p>
            )}
          <p className="ml-7 text-slate-500 leading-relaxed">
            {globalStreamLoading
              ? "Checking global stream..."
              : currentStreamIsGlobal
                ? "Current stream is global — context included by default."
                : globalStreamDisabled
                  ? "No global stream found."
                  : "Carries domain-wide backstory."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 mt-1">
          <button
            onClick={selectAll}
            disabled={disableSelectAll || isLoadingEntries}
            className="border border-slate-300 bg-white px-3 py-1.5 text-slate-800 transition-all hover:bg-slate-100 disabled:text-slate-500 uppercase font-bold"
          >
            All
          </button>
          <button
            onClick={selectLastFive}
            disabled={isLoadingEntries}
            className="border border-slate-300 bg-white px-3 py-1.5 text-slate-800 transition-all hover:bg-slate-100 disabled:text-slate-500 uppercase font-bold"
          >
            Last 5
          </button>
          <button
            onClick={clearAll}
            className="border border-slate-300 bg-white px-3 py-1.5 text-slate-800 hover:bg-slate-100 transition-all uppercase font-bold"
          >
            Clear
          </button>
        </div>
        <div className="space-y-3 border border-slate-300 bg-white p-3">
          {isLoadingEntries ? (
            <div className="text-slate-500 animate-pulse">
              Loading entries...
            </div>
          ) : groupedEntries.length === 0 ? (
            <div className="text-slate-500">No entries yet.</div>
          ) : (
            groupedEntries.map(([dateKey, group]) => (
              <div key={dateKey} className="space-y-2">
                <div className="font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 pb-1">
                  {dateKey}
                </div>
                {group?.map((entry) => {
                  const preview =
                    entry.sections?.[0]?.search_text ||
                    entry.sections?.[0]?.persona_name_snapshot ||
                    "Empty entry";

                  const isAlreadySent = sentEntryIds?.includes(entry.id);
                  const hasModifications =
                    !!entry.updated_at &&
                    !!lastUsedAt &&
                    new Date(entry.updated_at).getTime() >
                      new Date(lastUsedAt).getTime();
                  const isDisabled = isAlreadySent && !hasModifications;

                  return (
                    <label
                      key={entry.id}
                      className={`flex items-start gap-3 p-1.5 transition-colors select-none ${
                        isDisabled
                          ? "opacity-50 cursor-default"
                          : "hover:bg-slate-50 cursor-pointer"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-blue-500 disabled:opacity-50"
                        checked={selectedEntries.includes(entry.id)}
                        onChange={() => !isDisabled && toggleEntry(entry.id)}
                        disabled={isDisabled}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 leading-snug truncate">
                          {preview.slice(0, 80)}
                        </div>
                        <div className="text-slate-500 mt-0.5 uppercase flex items-center justify-between">
                          <span>
                            {entry.created_at
                              ? new Date(entry.created_at).toLocaleTimeString()
                              : "Unknown time"}
                          </span>
                          {isAlreadySent && (
                            <span
                              className={`font-bold ml-2 ${hasModifications ? "text-blue-500" : "text-slate-500"}`}
                            >
                              {hasModifications ? "AMENDED" : "SENT"}
                            </span>
                          )}
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
