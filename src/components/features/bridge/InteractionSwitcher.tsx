import {
  Copy,
  ClipboardPaste,
  Check,
  RotateCcw,
  Play,
  Zap,
} from "lucide-react";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { encode } from "gpt-tokenizer";
import { BlockNoteBlock, EntryWithSections } from "@/lib/types";

function blocksToText(blocks: BlockNoteBlock[]): string {
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
  onCopy,
  onPaste,
  onParse,
  onApply,
  onReset,
  status = {
    isApplying: false,
    canApply: false,
    canParse: false,
    hasParsed: false,
  },
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
  onCopy?: () => void;
  onPaste?: () => void;
  onParse?: () => void;
  onApply?: () => void;
  onReset?: () => void;
  status?: {
    isApplying: boolean;
    canApply: boolean;
    canParse: boolean;
    hasParsed: boolean;
  };
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
              blocksToText(section.content_json as unknown as BlockNoteBlock[]),
            )
            .join("\n") ?? "",
      ) ?? [];
    const canvasText = includeCanvas
      ? blocksToText(
          (canvas?.content_json as unknown as BlockNoteBlock[]) ?? [],
        )
      : "";
    const globalEntryText =
      includeGlobalStream && additionalGlobalStreamIds.length > 0
        ? (globalEntries?.map(
            (entry) =>
              entry.sections
                ?.map((section) =>
                  blocksToText(
                    section.content_json as unknown as BlockNoteBlock[],
                  ),
                )
                .join("\n") ?? "",
          ) ?? [])
        : [];
    const globalCanvasText =
      includeGlobalStream && additionalGlobalStreamIds.length > 0
        ? (globalCanvases?.map((canvasItem) =>
            blocksToText(
              (canvasItem.content_json as unknown as BlockNoteBlock[]) ?? [],
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
      <div className="flex w-full max-w-sm rounded-[10px] bg-surface-subtle/50 p-1 shadow-inner border border-border-subtle/30 backdrop-blur-sm">
        {(["ASK", "GO", "BOTH"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={`relative flex-1 rounded-md py-2.5 text-xs font-bold tracking-widest transition-all duration-300 ease-out ${
              value === mode
                ? "bg-surface-elevated text-action-primary-bg shadow-sm ring-1 ring-border-subtle/50 z-10"
                : "text-text-muted hover:text-text-default hover:bg-surface-hover/50"
            }`}
          >
            {mode}
          </button>
        ))}
      </div>

      {/* Token Indicator */}
      <div
        className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border shadow-xs transition-all ${overLimit ? "bg-status-error-bg/5 border-status-error-border/30" : "bg-surface-subtle/30 border-border-subtle/30"}`}
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
            <span className="text-[10px] text-text-muted opacity-50">
              / {tokenLimit.toLocaleString()}
            </span>
          </div>
        </div>

        {overLimit && (
          <div className="flex items-center gap-1.5 ml-1 animate-pulse">
            <div className="h-2 w-2 rounded-full bg-status-error-text" />
            <span className="text-[10px] font-bold text-status-error-text uppercase">
              Limit
            </span>
          </div>
        )}
      </div>

      {/* Action Shortcuts */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-surface-subtle/30 p-1 border border-border-subtle/30">
          <button
            onClick={onCopy}
            title="Copy Generated XML"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-text-default hover:bg-surface-hover hover:text-action-primary-bg transition-all group"
          >
            <Copy className="h-3.5 w-3.5 text-text-muted group-hover:text-action-primary-bg transition-colors" />
            <span>Copy XML</span>
          </button>

          <div className="w-px h-4 bg-border-subtle/30 mx-0.5" />

          <button
            onClick={onPaste}
            title="Paste & Fill Response"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-text-default hover:bg-surface-hover hover:text-action-primary-bg transition-all group"
          >
            <ClipboardPaste className="h-3.5 w-3.5 text-text-muted group-hover:text-action-primary-bg transition-colors" />
            <span>Paste</span>
          </button>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-surface-subtle/30 p-1 border border-border-subtle/30">
          <button
            onClick={onParse}
            disabled={!status.canParse}
            title="Parse Response"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-text-default hover:bg-surface-hover hover:text-action-primary-bg transition-all group disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Play
              className={`h-3.5 w-3.5 ${status.canParse ? "text-text-muted group-hover:text-action-primary-bg" : "text-text-muted"} transition-colors`}
            />
            <span>Parse</span>
          </button>

          <button
            onClick={onApply}
            disabled={!status.canApply || status.isApplying}
            title="Apply Changes"
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
              status.canApply
                ? "bg-action-primary-bg/10 text-action-primary-bg hover:bg-action-primary-bg hover:text-white"
                : "text-text-muted hover:bg-surface-hover"
            }`}
          >
            <Check className="h-3.5 w-3.5" />
            <span>{status.isApplying ? "Applying..." : "Apply"}</span>
          </button>

          <div className="w-px h-4 bg-border-subtle/30 mx-0.5" />

          <button
            onClick={onReset}
            title="Clear & Reset"
            className="flex items-center justify-center rounded-md p-1.5 text-text-muted hover:bg-status-error-bg/20 hover:text-status-error-text transition-all"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {overLimit && (
          <div className="flex items-center gap-1 rounded-lg bg-status-error-bg/10 p-1 border border-status-error-border/30">
            <button
              onClick={onReduceSelection}
              title="Select Last 5 Entries"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-status-error-text hover:bg-status-error-bg/20 transition-all"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reduce</span>
            </button>
            <button
              onClick={onAutoSummarize}
              title="Exclude Canvas"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold text-status-error-text hover:bg-status-error-bg/20 transition-all"
            >
              <Zap className="h-3 w-3" />
              <span>Drop Canvas</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
