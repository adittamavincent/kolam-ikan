import { RotateCcw, Zap } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { encode } from "gpt-tokenizer";
import { MarkdownBlock, EntryWithSections } from "@/lib/types";

function blocksToText(blocks: MarkdownBlock[]): string {
  return blocks
    .map((block) => {
      const content = Array.isArray(block.content) ? block.content : [];
      return content
        .map((item) =>
          typeof (item as { text?: unknown }).text === "string"
            ? (item as { text: string }).text
            : "",
        )
        .join("");
    })
    .filter(Boolean)
    .join("\n");
}

export function InteractionSwitcher({
  value,
  onChange,
  // Token props
  selectedEntries,
  includeCanvas,
  streamId,
  includeGlobalStream,
  globalStreamIds,
  tokenLimit = 8000,
  onTokenUpdate,
  onReduceSelection,
  onAutoSummarize,
}: {
  value: "ASK" | "GO" | "BOTH";
  onChange: (value: "ASK" | "GO" | "BOTH") => void;
  // Token counter props
  selectedEntries: string[];
  includeCanvas: boolean;
  streamId: string;
  includeGlobalStream: boolean;
  globalStreamIds: string[];
  tokenLimit?: number;
  onTokenUpdate?: (tokens: number, overLimit: boolean) => void;
  onReduceSelection?: () => void;
  onAutoSummarize?: () => void;
}) {
  const supabase = createClient();
  const additionalGlobalStreamIds = (globalStreamIds ?? []).filter(
    (id) => id !== streamId,
  );

  // Fetching data for token calculation (mirrored from TokenCounter)
  const { data: entries } = useQuery({
    queryKey: ["bridge-token-entries", streamId, selectedEntries],
    queryFn: async () => {
      if (selectedEntries.length === 0) return [];
      const { data, error } = await supabase
        .from("entries")
        .select("id, created_at, sections(content_json, persona_name_snapshot)")
        .in("id", selectedEntries)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as EntryWithSections[];
    },
    enabled: selectedEntries.length > 0,
  });

  const { data: canvas } = useQuery({
    queryKey: ["bridge-token-canvas", streamId, includeCanvas],
    queryFn: async () => {
      if (!includeCanvas) return null;
      const { data, error } = await supabase
        .from("canvases")
        .select("content_json")
        .eq("stream_id", streamId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: includeCanvas,
  });

  const { data: globalEntries } = useQuery({
    queryKey: [
      "bridge-token-global-entries",
      additionalGlobalStreamIds,
      includeGlobalStream,
    ],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0)
        return [];
      const { data, error } = await supabase
        .from("entries")
        .select("id, created_at, sections(content_json, persona_name_snapshot)")
        .in("stream_id", additionalGlobalStreamIds)
        .eq("is_draft", false)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as EntryWithSections[];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const { data: globalCanvases } = useQuery({
    queryKey: [
      "bridge-token-global-canvas",
      additionalGlobalStreamIds,
      includeGlobalStream,
    ],
    queryFn: async () => {
      if (!includeGlobalStream || additionalGlobalStreamIds.length === 0)
        return [];
      const { data, error } = await supabase
        .from("canvases")
        .select("content_json")
        .in("stream_id", additionalGlobalStreamIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: includeGlobalStream && additionalGlobalStreamIds.length > 0,
  });

  const tokens = useMemo(() => {
    const entryText =
      entries?.map(
        (entry) =>
          entry.sections
            ?.map((section) =>
              blocksToText(section.content_json as unknown as MarkdownBlock[]),
            )
            .join("\n") ?? "",
      ) ?? [];
    const canvasText = includeCanvas
      ? blocksToText(
          (canvas?.content_json as unknown as MarkdownBlock[]) ?? [],
        )
      : "";
    const globalEntryText =
      includeGlobalStream && additionalGlobalStreamIds.length > 0
        ? (globalEntries?.map(
            (entry) =>
              entry.sections
                ?.map((section) =>
                  blocksToText(
                    section.content_json as unknown as MarkdownBlock[],
                  ),
                )
                .join("\n") ?? "",
          ) ?? [])
        : [];
    const globalCanvasText =
      includeGlobalStream && additionalGlobalStreamIds.length > 0
        ? (globalCanvases?.map((canvasItem) =>
            blocksToText(
              (canvasItem.content_json as unknown as MarkdownBlock[]) ?? [],
            ),
          ) ?? [])
        : [];

    const combined = [
      ...entryText,
      canvasText,
      ...globalEntryText,
      ...globalCanvasText,
    ]
      .filter(Boolean)
      .join("\n");
    return encode(combined).length;
  }, [
    entries,
    canvas,
    globalEntries,
    globalCanvases,
    includeCanvas,
    includeGlobalStream,
    additionalGlobalStreamIds.length,
  ]);

  const overLimit = tokens > tokenLimit;

  useEffect(() => {
    onTokenUpdate?.(tokens, overLimit);
  }, [tokens, overLimit, onTokenUpdate]);

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Interaction Mode Toggle */}
      <div className="flex w-full max-w-sm border border-border-subtle bg-surface-hover p-1">
        {(["ASK", "GO", "BOTH"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={`relative flex-1  py-2.5 text-xs font-bold tracking-widest transition-all duration-300 ease-out ${
              value === mode
                ? "bg-surface-elevated text-action-primary-bg   z-10"
                : "text-text-muted hover:text-text-default hover:bg-surface-hover"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Token Indicator */}
      <div
        className={`flex items-center gap-3 border border-border-subtle px-3 py-1.5 transition-all ${overLimit ? "bg-status-error-bg" : "bg-surface-subtle"}`}
      >
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-text-muted uppercase leading-none tracking-tight">
            Tokens
          </span>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`text-sm font-bold tabular-nums ${overLimit ? "text-status-error-text" : "text-action-primary-bg"}`}
            >
              {tokens.toLocaleString()}
            </span>
            <span className="text-[10px] text-text-muted">
              / {tokenLimit.toLocaleString()}
            </span>
          </div>
        </div>

        {overLimit && (
          <div className="flex items-center gap-1.5 ml-1 animate-pulse">
            <div className="h-2 w-2 bg-status-error-text" />
            <span className="text-[10px] font-bold text-status-error-text uppercase">
              Limit
            </span>
          </div>
        )}
      </div>

      {/* Recommendations */}
      {overLimit && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="border border-border-subtle bg-status-error-bg px-3 py-2 text-[11px] font-semibold text-status-error-text">
            This payload is over the recommended token budget.
          </div>
          <button
            onClick={onReduceSelection}
            title="Use recent entries only"
            className="flex items-center gap-1.5 border border-border-subtle bg-status-error-bg px-2.5 py-1.5 text-[10px] font-bold text-status-error-text transition-all"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Use recent entries only</span>
          </button>
          <button
            onClick={onAutoSummarize}
            title="Exclude canvas for this run"
            className="flex items-center gap-1.5 border border-border-subtle bg-status-error-bg px-2.5 py-1.5 text-[10px] font-bold text-status-error-text transition-all"
          >
            <Zap className="h-3 w-3" />
            <span>Exclude canvas for this run</span>
          </button>
        </div>
      )}
    </div>
  );
}
