"use client";

import {
  useMemo,
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createClient } from "@/lib/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { MarkdownBlock } from "@/lib/types";
import { z } from "zod";
import { BlockSchema } from "@/lib/validation/entry";
import { Json } from "@/lib/types/database.types";
import {
  blocksToStoredMarkdown,
  buildStoredContentPayload,
} from "@/lib/content-protocol";
import { useLogBranchContext } from "@/lib/hooks/useLogBranchContext";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import type { PartialBlock } from "@/lib/types/editor";

interface ResponseParserProps {
  streamId?: string;
  interactionMode?: "ASK" | "GO" | "BOTH";
  pastedXML: string;
  onPastedXMLChange: (value: string) => void;
  onApplySuccess?: () => void;
  onStatusChange?: (status: {
    isApplying: boolean;
    canApply: boolean;
    canParse: boolean;
    hasParsed: boolean;
  }) => void;
}

export interface ResponseParserHandle {
  parse: () => void;
  apply: () => void;
  quickApply: () => Promise<boolean>;
  reset: () => void;
}

type ChangeDecision = "accept" | "reject" | "both";

interface BlockChange {
  id: string;
  type: "add" | "modify";
  incoming: MarkdownBlock;
  current?: MarkdownBlock;
  decision: ChangeDecision;
  originalId?: string;
}

interface ParsedBridgeResponse {
  ignoredTags: string[];
  thoughtLog: string | null;
  incomingBlocks: MarkdownBlock[] | null;
  changes: BlockChange[];
  conflictWarning: string | null;
  canvasParseError: string | null;
  warnings: string[];
  usePlainText: boolean;
  canvasApplyMode: "merge" | "replace";
  mergedBlocks: MarkdownBlock[] | null;
}

const BlockArraySchema = z.array(BlockSchema);

function extractBlockText(block: MarkdownBlock): string {
  return block.content?.map((c) => c.text).join("") || "";
}

function toParagraphBlocks(text: string): MarkdownBlock[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: "" }],
      },
    ];
  }

  const lines = normalized.split("\n").map((line) => line.trimEnd());

  const blocks: MarkdownBlock[] = [];
  let paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;

    const paragraphText = paragraphBuffer.join("\n").trim();

    if (paragraphText.length > 0) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: paragraphText }],
        children: [],
      });
    }

    paragraphBuffer = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        id: crypto.randomUUID(),
        type: "heading",
        props: { level: headingMatch[1].length as unknown as Json },
        content: [{ type: "text", text: headingMatch[2] }],
        children: [],
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      blocks.push({
        id: crypto.randomUUID(),
        type: "bulletListItem",
        content: [{ type: "text", text: bulletMatch[1] }],
        children: [],
      });
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      flushParagraph();
      blocks.push({
        id: crypto.randomUUID(),
        type: "numberedListItem",
        content: [{ type: "text", text: numberedMatch[1] }],
        children: [],
      });
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      const quoteLines = [rawLine];
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1]?.trim();
        if (!nextLine?.startsWith(">")) break;
        index += 1;
        quoteLines.push(lines[index]);
      }
      blocks.push({
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: quoteLines.join("\n") }],
        children: [],
      });
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      flushParagraph();
      blocks.push({
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: line }],
        children: [],
      });
      continue;
    }

    paragraphBuffer.push(rawLine);
  }

  flushParagraph();

  if (blocks.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        content: [{ type: "text", text: normalized }],
        children: [],
      },
    ];
  }

  return blocks;
}

function resolveIncomingBlocks(raw: string): {
  blocks: MarkdownBlock[];
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { blocks: [] };
  }
  try {
    const parsed = JSON.parse(trimmed) as MarkdownBlock[];
    const validated = BlockArraySchema.safeParse(parsed);
    if (!validated.success) {
      return { blocks: [], error: "Invalid markdown block JSON" };
    }
    return { blocks: validated.data };
  } catch {
    return { blocks: [], error: "Canvas update is not valid JSON" };
  }
}

function applyDiffToBlocks(
  currentBlocks: MarkdownBlock[],
  diffText: string,
): MarkdownBlock[] {
  const lines = diffText.split("\n");
  const result = [...currentBlocks];
  let additionsBuffer: string[] = [];

  const stripDiffPrefix = (line: string) => {
    const normalized = line.trimStart();
    if (normalized === "+" || normalized === "+ ") return "";
    if (normalized === "-" || normalized === "- ") return "";
    if (normalized.startsWith("+ ")) return normalized.slice(2);
    if (normalized.startsWith("- ")) return normalized.slice(2);
    if (normalized.startsWith(" ")) return normalized.slice(1);
    if (normalized.startsWith("+")) return normalized.slice(1).trimStart();
    if (normalized.startsWith("-")) return normalized.slice(1).trimStart();
    return normalized;
  };

  const flushAdditions = () => {
    if (additionsBuffer.length === 0) return;
    const contentToAdd = additionsBuffer.join("\n");
    const newBlocks = toParagraphBlocks(contentToAdd);
    result.push(...newBlocks);
    additionsBuffer = [];
  };

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (/^-{3,}$/.test(trimmedLine)) {
      additionsBuffer.push(trimmedLine);
    } else if (trimmedLine.startsWith("-")) {
      flushAdditions();
      const contentToRemove = stripDiffPrefix(line).trim();
      if (!contentToRemove) return;

      const index = result.findIndex(
        (b) => extractBlockText(b).trim() === contentToRemove,
      );
      if (index !== -1) {
        result.splice(index, 1);
      }
    } else if (trimmedLine.startsWith("+")) {
      additionsBuffer.push(stripDiffPrefix(line));
    } else {
      flushAdditions();
    }
  });

  flushAdditions();
  return result;
}

export function resolveCanvasBlocks(
  raw: string,
  currentBlocks: MarkdownBlock[] = [],
): {
  blocks: MarkdownBlock[];
  format: "json" | "markdown" | "diff";
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { blocks: [], format: "markdown" };
  }

  const looksLikeJson = trimmed.startsWith("[") || trimmed.startsWith("{");
  if (looksLikeJson) {
    const jsonResult = resolveIncomingBlocks(trimmed);
    if (!jsonResult.error) {
      return { blocks: jsonResult.blocks, format: "json" };
    }
    return {
      blocks: [],
      format: "json",
      error:
        "Canvas update looks like JSON but is invalid. Use valid JSON or compact markdown.",
    };
  }

  // Check if it looks like a diff
  const lines = trimmed.split("\n");

  // Normalize * prefix to + (common LLM mistake)
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  const allStarPrefixed =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((l) => l.trim().startsWith("*"));
  const normalizedText = allStarPrefixed
    ? lines
        .map((l) => {
          const t = l.trim();
          if (t.startsWith("* ")) return "+ " + t.slice(2);
          if (t === "*") return "+ ";
          return l;
        })
        .join("\n")
    : trimmed;

  const normalizedLines = normalizedText.split("\n");
  const loosenedDiffText = normalizedLines
    .map((line, index, allLines) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return line;
      if (
        trimmedLine === "+" ||
        trimmedLine === "+ " ||
        trimmedLine.startsWith("+ ") ||
        trimmedLine === "-" ||
        trimmedLine === "- " ||
        trimmedLine.startsWith("- ") ||
        line.startsWith(" ")
      ) {
        return line;
      }

      const previousNonEmpty = [...allLines.slice(0, index)]
        .reverse()
        .find((candidate) => candidate.trim().length > 0)
        ?.trim();
      const nextNonEmpty = allLines
        .slice(index + 1)
        .find((candidate) => candidate.trim().length > 0)
        ?.trim();
      const nearAddition =
        previousNonEmpty?.startsWith("+") || nextNonEmpty?.startsWith("+");

      if (!nearAddition) return line;
      return `+ ${trimmedLine}`;
    })
    .join("\n");

  const hasDiffMarkers = loosenedDiffText.split("\n").some((l) => {
    const t = l.trim();
    return t.startsWith("+") || t.startsWith("-");
  });

  if (hasDiffMarkers) {
    return {
      blocks: applyDiffToBlocks(currentBlocks, loosenedDiffText),
      format: "diff",
    };
  }

  return { blocks: toParagraphBlocks(trimmed), format: "markdown" };
}

function extractTagContent(text: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i");
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  return match[1].trim();
}

export function normalizeBridgeResponseText(text: string) {
  return text
    .trim()
    .replace(/^```(?:xml|html|txt)?\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/\\([<>_/])/g, "$1")
    .replace(/\\([.#()[\]\-!*_`])/g, "$1")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

export function extractTagContentByAliases(text: string, tagNames: string[]) {
  for (const tagName of tagNames) {
    const content = extractTagContent(text, tagName);
    if (content) return content;
  }
  return null;
}

function mergeChangesIntoBlocks(
  currentBlocks: MarkdownBlock[],
  incomingBlocks: MarkdownBlock[] | null,
  changes: BlockChange[],
  previewMode: "current" | "incoming" | "merged" = "merged",
) {
  if (!incomingBlocks) return null;
  if (previewMode === "current") return currentBlocks;
  if (previewMode === "incoming") return incomingBlocks;

  const next = [...currentBlocks];
  const indexById = new Map<string, number>();
  next.forEach((block, index) => indexById.set(block.id, index));

  changes.forEach((change) => {
    if (change.type === "modify" && change.current) {
      if (change.decision === "accept") {
        const idx = indexById.get(change.current.id);
        if (idx !== undefined) {
          next[idx] = { ...change.incoming, id: change.current.id };
        }
      } else if (change.decision === "both") {
        const idx = indexById.get(change.current.id);
        if (idx !== undefined) {
          next.splice(idx + 1, 0, change.incoming);
        }
      }
    }
    if (change.type === "add" && change.decision !== "reject") {
      next.push(change.incoming);
    }
  });

  return next;
}

export const ResponseParser = forwardRef<
  ResponseParserHandle,
  ResponseParserProps
>(
  (
    {
      streamId,
      interactionMode = "ASK",
      pastedXML,
      onPastedXMLChange,
      onApplySuccess,
      onStatusChange,
    },
    ref,
  ) => {
    const [parseError, setParseError] = useState<string | null>(null);
    const [ignoredTags, setIgnoredTags] = useState<string[]>([]);
    const [thoughtLog, setThoughtLog] = useState<string | null>(null);
    const [incomingBlocks, setIncomingBlocks] = useState<
      MarkdownBlock[] | null
    >(null);
    const [changes, setChanges] = useState<BlockChange[]>([]);
    const [conflictWarning, setConflictWarning] = useState<string | null>(null);
    const [applyError, setApplyError] = useState<string | null>(null);
    const [isApplying, setIsApplying] = useState(false);
    const [, setParseWarnings] = useState<string[]>([]);
    const [canvasParseError, setCanvasParseError] = useState<string | null>(
      null,
    );
    const [previewMode, setPreviewMode] = useState<
      "current" | "incoming" | "merged"
    >("merged");
    const [usePlainText, setUsePlainText] = useState(false);
    const [canvasApplyMode, setCanvasApplyMode] = useState<"merge" | "replace">(
      "merge",
    );

    const supabase = createClient();
    const { currentBranch, currentBranchHeadId } = useLogBranchContext(streamId ?? "");
    const queryClient = useQueryClient();
    const setLiveContent = useCanvasDraft((state) => state.setLiveContent);
    const setLiveMarkdown = useCanvasDraft((state) => state.setLiveMarkdown);
    const markClean = useCanvasDraft((state) => state.markClean);
    const setSyncStatus = useCanvasDraft((state) => state.setSyncStatus);
    const setLocalStatus = useCanvasDraft((state) => state.setLocalStatus);
    const latestParsedRef = useRef<ParsedBridgeResponse | null>(null);

    const reset = () => {
      setParseError(null);
      setApplyError(null);
      setIgnoredTags([]);
      setThoughtLog(null);
      setIncomingBlocks(null);
      setChanges([]);
      setConflictWarning(null);
      setParseWarnings([]);
      setCanvasParseError(null);
      setUsePlainText(false);
      setCanvasApplyMode("merge");
      latestParsedRef.current = null;
      onPastedXMLChange("");
    };

    useImperativeHandle(ref, () => ({
      parse: parseResponse,
      apply: handleApply,
      quickApply: quickApplyResponse,
      reset,
    }));

    const canProcessCanvas =
      interactionMode === "GO" || interactionMode === "BOTH";
    const canProcessLog =
      interactionMode === "ASK" || interactionMode === "BOTH";

    const mergedBlocks = useMemo(() => {
      const current = queryClient.getQueryData<{ content_json: Json }>([
        "canvas",
        streamId,
      ])?.content_json as unknown as MarkdownBlock[] | undefined;
      const currentBlocks = Array.isArray(current) ? current : [];
      if (canvasApplyMode === "replace") {
        if (!incomingBlocks) return null;
        return previewMode === "current" ? currentBlocks : incomingBlocks;
      }
      return mergeChangesIntoBlocks(
        currentBlocks,
        incomingBlocks,
        changes,
        previewMode,
      );
    }, [
      canvasApplyMode,
      changes,
      incomingBlocks,
      previewMode,
      queryClient,
      streamId,
    ]);

    const canApply = !isApplying && (!!thoughtLog || !!mergedBlocks);
    const canParse = !!pastedXML.trim();
    const hasParsed = !!thoughtLog || !!incomingBlocks;

    useEffect(() => {
      onStatusChange?.({
        isApplying,
        canApply,
        canParse,
        hasParsed,
      });
    }, [isApplying, canApply, canParse, hasParsed, onStatusChange]);

    const parseCurrentResponse = async (): Promise<ParsedBridgeResponse> => {
      if (!streamId) {
        throw new Error("Stream not available");
      }

      const raw = normalizeBridgeResponseText(pastedXML);
      if (!raw) {
        throw new Error("No response to parse");
      }

      const nextIgnored: string[] = [];
      const warnings: string[] = [];
      let nextThoughtLog: string | null = null;
      let nextIncomingBlocks: MarkdownBlock[] | null = null;
      let nextConflictWarning: string | null = null;
      let nextCanvasParseError: string | null = null;
      const nextUsePlainText = false;
      let nextCanvasApplyMode: "merge" | "replace" = "merge";

      const thoughtContent = extractTagContentByAliases(raw, [
        "log",
        "thought_log",
      ]);
      const canvasJsonContent = extractTagContentByAliases(raw, [
        "canvas_json",
        "canvas_update_json",
      ]);
      const canvasMarkdownContent = extractTagContentByAliases(raw, [
        "canvas_md",
        "canvas_update_md",
      ]);
      const canvasDefaultContent = extractTagContentByAliases(raw, [
        "canvas",
        "canvas_update",
      ]);
      const canvasContent =
        canvasJsonContent ?? canvasMarkdownContent ?? canvasDefaultContent;
      const baseUpdatedAt = extractTagContentByAliases(raw, [
        "base",
        "canvas_base_updated_at",
      ]);
      let currentCanvasRecord:
        | {
            id: string;
            content_json: Json | null;
            updated_at: string | null;
          }
        | null
        | undefined;

      if (!thoughtContent && !canvasContent) {
        throw new Error(
          "Could not find log/canvas tags in the response. Use <log>...</log> and/or <canvas>...</canvas> (legacy <thought_log>/<canvas_update> also works). " +
            "Make sure the LLM response contains the expected XML structure.",
        );
      }

      if (thoughtContent) {
        nextThoughtLog = thoughtContent;
      }

      if (canProcessLog && !thoughtContent) {
        warnings.push(
          "No <thought_log> found — expected for this interaction mode.",
        );
      }

      let resolvedBlocks: MarkdownBlock[] | null = null;
      if (canvasContent) {
        const { data: fetchedCanvas, error: currentCanvasError } = await supabase
          .from("canvases")
          .select("id, content_json, updated_at")
          .eq("stream_id", streamId)
          .maybeSingle();
        if (currentCanvasError) throw currentCanvasError;
        currentCanvasRecord = fetchedCanvas;
        if (fetchedCanvas) {
          queryClient.setQueryData(["canvas", streamId], fetchedCanvas);
        }
        const currentBlocks =
          (fetchedCanvas?.content_json as unknown as MarkdownBlock[]) || [];

        const result = (() => {
          if (canvasJsonContent) {
            const jsonResult = resolveIncomingBlocks(canvasJsonContent);
            return {
              blocks: jsonResult.blocks,
              error: jsonResult.error,
              format: "json" as const,
            };
          }
          return resolveCanvasBlocks(canvasContent, currentBlocks);
        })();

        if (result.error) {
          nextCanvasParseError = result.error;
          warnings.push("Canvas update could not be parsed");
        } else {
          resolvedBlocks = result.blocks;
          nextIncomingBlocks = result.blocks;
          if (result.format === "diff") {
            nextCanvasApplyMode = "replace";
          }
          if (result.format === "markdown") {
            warnings.push("Canvas update parsed in compact markdown mode.");
          } else if (result.format === "diff") {
            warnings.push("Canvas update applied via git-diff mode.");
          }
        }
      }

      if (canProcessCanvas && !canvasContent) {
        warnings.push(
          "No canvas update tag found — expected <canvas_update>, <canvas_update_md>, or <canvas_update_json>.",
        );
      }

      if (baseUpdatedAt) {
        if (currentCanvasRecord === undefined) {
          const { data: fetchedCanvas, error: currentCanvasError } = await supabase
            .from("canvases")
            .select("id, content_json, updated_at")
            .eq("stream_id", streamId)
            .maybeSingle();
          if (currentCanvasError) throw currentCanvasError;
          currentCanvasRecord = fetchedCanvas;
          if (fetchedCanvas) {
            queryClient.setQueryData(["canvas", streamId], fetchedCanvas);
          }
        }
        if (
          currentCanvasRecord?.updated_at &&
          currentCanvasRecord.updated_at !== baseUpdatedAt
        ) {
          nextConflictWarning =
            "Canvas was edited after the AI response was generated.";
        }
      }

      let nextChanges: BlockChange[] = [];
      let merged: MarkdownBlock[] | null = null;
      if (canProcessCanvas && resolvedBlocks) {
        if (currentCanvasRecord === undefined) {
          const { data: fetchedCanvas, error: currentCanvasError } = await supabase
            .from("canvases")
            .select("id, content_json, updated_at")
            .eq("stream_id", streamId)
            .maybeSingle();
          if (currentCanvasError) throw currentCanvasError;
          currentCanvasRecord = fetchedCanvas;
          if (fetchedCanvas) {
            queryClient.setQueryData(["canvas", streamId], fetchedCanvas);
          }
        }
        const currentBlocks =
          (currentCanvasRecord?.content_json as unknown as MarkdownBlock[]) || [];
        const currentMap = new Map(
          currentBlocks.map((block) => [block.id, block]),
        );
        nextChanges = [];
        resolvedBlocks.forEach((block) => {
          const existing = currentMap.get(block.id);
          if (!existing) {
            nextChanges.push({
              id: block.id,
              type: "add",
              incoming: block,
              decision: "accept",
            });
            return;
          }
          const existingText = extractBlockText(existing);
          const incomingText = extractBlockText(block);
          if (existingText !== incomingText) {
            const newId = crypto.randomUUID();
            nextChanges.push({
              id: newId,
              type: "modify",
              incoming: { ...block, id: newId },
              current: existing,
              decision: "accept",
              originalId: block.id,
            });
          }
        });
        merged =
          nextCanvasApplyMode === "replace"
            ? resolvedBlocks
            : mergeChangesIntoBlocks(
                currentBlocks,
                nextIncomingBlocks,
                nextChanges,
                "merged",
              );
      }

      return {
        ignoredTags: nextIgnored,
        thoughtLog: nextThoughtLog,
        incomingBlocks: nextIncomingBlocks,
        changes: nextChanges,
        conflictWarning: nextConflictWarning,
        canvasParseError: nextCanvasParseError,
        warnings,
        usePlainText: nextUsePlainText,
        canvasApplyMode: nextCanvasApplyMode,
        mergedBlocks: merged,
      };
    };

    const applyParsedState = (parsed: ParsedBridgeResponse) => {
      setParseError(null);
      setApplyError(null);
      setIgnoredTags(parsed.ignoredTags);
      setThoughtLog(parsed.thoughtLog);
      setIncomingBlocks(parsed.incomingBlocks);
      setChanges(parsed.changes);
      setConflictWarning(parsed.conflictWarning);
      setParseWarnings(parsed.warnings);
      setCanvasParseError(parsed.canvasParseError);
      setUsePlainText(parsed.usePlainText);
      setCanvasApplyMode(parsed.canvasApplyMode);
      latestParsedRef.current = parsed;
    };

    const parseResponse = async () => {
      try {
        const parsed = await parseCurrentResponse();
        applyParsedState(parsed);
      } catch (err) {
        latestParsedRef.current = null;
        setParseError((err as Error).message);
      }
    };

    const handleApply = async (parsedOverride?: ParsedBridgeResponse) => {
      if (!streamId) return false;
      const parsed = parsedOverride ?? latestParsedRef.current;
      const nextThoughtLog = parsed?.thoughtLog ?? thoughtLog;
      const nextMergedBlocks = parsed?.mergedBlocks ?? mergedBlocks;
      const nextChanges = parsed?.changes ?? changes;

      setApplyError(null);
      setIsApplying(true);
      try {
        let createdEntryId: string | null = null;

        if (nextThoughtLog) {
          const blocks = toParagraphBlocks(nextThoughtLog);

          const { data: existingBranch, error: existingBranchError } = await supabase
            .from("branches")
            .select("id")
            .eq("stream_id", streamId)
            .eq("name", currentBranch)
            .maybeSingle();
          if (existingBranchError) throw existingBranchError;

          let branchId = existingBranch?.id ?? null;
          if (!branchId) {
            const { data: createdBranch, error: branchInsertError } = await supabase
              .from("branches")
              .insert({
                stream_id: streamId,
                name: currentBranch,
              })
              .select("id")
              .single();
            if (branchInsertError || !createdBranch) throw branchInsertError;
            branchId = createdBranch.id;
          }

          // Ensure we have a dedicated AI persona (system-level). Try to find
          // an existing system AI persona, otherwise create one.
          let aiPersonaId: string | undefined = undefined;
          try {
            const { data: existing } = await supabase
              .from("personas")
              .select("id")
              .eq("is_system", true)
              .eq("type", "AI")
              .limit(1)
              .maybeSingle();

            if (existing && typeof (existing as { id?: unknown }).id === "string") {
              aiPersonaId = (existing as { id?: string }).id;
            } else {
              const defaultIcon = "Robot";
              const defaultColor = "#7c3aed";
              const { data: created, error: createErr } = await supabase
                .from("personas")
                .insert({
                  type: "AI",
                  name: "AI",
                  icon: defaultIcon,
                  color: defaultColor,
                  is_system: true,
                })
                .select()
                .maybeSingle();

              if (createErr) {
                console.warn("Failed to create AI persona, falling back to snapshot name:", createErr);
              } else if (created && typeof (created as { id?: unknown }).id === "string") {
                aiPersonaId = (created as { id?: string }).id;
              }
            }
          } catch (err) {
            console.warn("Error ensuring AI persona:", err);
          }

          const { data: createdEntry, error: entryError } = await supabase
            .from("entries")
            .insert({
              stream_id: streamId,
              is_draft: false,
              parent_commit_id: currentBranchHeadId,
            })
            .select("id")
            .single();
          if (entryError || !createdEntry) throw entryError;
          createdEntryId = createdEntry.id;

          const { error: sectionError } = await supabase
            .from("sections")
            .insert({
              entry_id: createdEntry.id,
              persona_id: aiPersonaId ?? null,
              persona_name_snapshot: "AI",
              ...buildStoredContentPayload(blocks),
              sort_order: 0,
            });
          if (sectionError) throw sectionError;

          const { error: branchUpdateError } = await supabase
            .from("branches")
            .update({ head_commit_id: createdEntry.id })
            .eq("id", branchId);
          if (branchUpdateError) throw branchUpdateError;

          const { data: bridgeUserData } = await supabase.auth.getUser();
          await supabase.from("audit_logs").insert({
            user_id: bridgeUserData.user?.id ?? null,
            action: "bridge_log_create",
            target_table: "entries",
            payload: { content: nextThoughtLog },
          });
          queryClient.invalidateQueries({ queryKey: ["entries", streamId] });
          queryClient.invalidateQueries({
            queryKey: ["latest-entry-id", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["entries-xml", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["bridge-entries", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["bridge-token-entries", streamId],
          });
          queryClient.invalidateQueries({ queryKey: ["branches", streamId] });
          queryClient.invalidateQueries({ queryKey: ["entries-lineage", streamId] });
          queryClient.invalidateQueries({ queryKey: ["graph-entries"] });
          queryClient.invalidateQueries({
            queryKey: ["graph-branches", streamId],
          });
          queryClient.invalidateQueries({ queryKey: ["home-domains"] });
          queryClient.invalidateQueries({
            queryKey: ["home-recent-entries"],
          });
          queryClient.invalidateQueries({
            queryKey: ["home-recent-streams"],
          });
        }

        if (nextMergedBlocks) {
          const { data: canvas, error } = await supabase
            .from("canvases")
            .select("id")
            .eq("stream_id", streamId)
            .single();
          if (error) throw error;
          if (canvas?.id) {
            const nextRawMarkdown = blocksToStoredMarkdown(
              nextMergedBlocks as PartialBlock[],
            );
            const nextStoredPayload = buildStoredContentPayload(
              nextMergedBlocks,
              nextRawMarkdown,
            );
            const { error: updateError } = await supabase
              .from("canvases")
              .update(nextStoredPayload)
              .eq("id", canvas.id);
            if (updateError) throw updateError;

            queryClient.setQueryData(["canvas", streamId], (previous: Record<
              string,
              unknown
            > | undefined) => ({
              ...(previous ?? {}),
              id: canvas.id,
              stream_id: streamId,
              ...nextStoredPayload,
            }));
            setLiveContent(streamId, nextMergedBlocks as unknown as PartialBlock[]);
            setLiveMarkdown(streamId, nextRawMarkdown);
            markClean(streamId);
            setSyncStatus(streamId, "idle");
            setLocalStatus(streamId, "saved");

            const { data: bridgeUserData } = await supabase.auth.getUser();
            await supabase.from("audit_logs").insert({
              user_id: bridgeUserData.user?.id ?? null,
              action: "bridge_canvas_merge",
              target_table: "canvases",
              target_id: canvas.id,
              payload: {
                changes: nextChanges.map((change: BlockChange) => ({
                  id: change.id,
                  type: change.type,
                  decision: change.decision,
                  originalId: change.originalId ?? null,
                })),
              } as unknown as Json,
            });

            // Auto-save a canvas snapshot so it appears in the timeline
            const { data: userData } = await supabase.auth.getUser();
            const summaryText = nextThoughtLog
              ? nextThoughtLog.length > 200
                ? nextThoughtLog.slice(0, 200) + "…"
                : nextThoughtLog
              : null;
            await supabase.from("canvas_versions").insert({
              canvas_id: canvas.id,
              stream_id: streamId,
              branch_name: currentBranch,
              source_entry_id: createdEntryId ?? currentBranchHeadId,
              ...nextStoredPayload,
              name: "AI Bridge Update",
              summary: summaryText,
              created_by: userData.user?.id ?? null,
            });

            queryClient.invalidateQueries({ queryKey: ["canvas", streamId] });
            queryClient.invalidateQueries({
              queryKey: ["canvas-versions", streamId],
            });
            queryClient.invalidateQueries({
              queryKey: ["canvas-latest-version", streamId],
            });
          }
        }
        onApplySuccess?.();
        return true;
      } catch (err) {
        setApplyError((err as Error).message);
        return false;
      } finally {
        setIsApplying(false);
      }
    };

    const quickApplyResponse = async () => {
      try {
        const parsed = await parseCurrentResponse();
        applyParsedState(parsed);
        if (!parsed.thoughtLog && !parsed.mergedBlocks) {
          return false;
        }
        return await handleApply(parsed);
      } catch (err) {
        latestParsedRef.current = null;
        setParseError((err as Error).message);
        return false;
      }
    };

    const handleApplyClick = () => {
      void handleApply();
    };

    const handlePlainTextImport = () => {
      if (!canProcessCanvas) return;
      const raw =
        extractTagContentByAliases(normalizeBridgeResponseText(pastedXML), [
          "canvas_md",
          "canvas_update_md",
        ]) ??
        extractTagContentByAliases(normalizeBridgeResponseText(pastedXML), [
          "canvas",
          "canvas_update",
        ]) ??
        extractTagContentByAliases(normalizeBridgeResponseText(pastedXML), [
          "canvas_json",
          "canvas_update_json",
        ]) ??
        "";
      const blocks = toParagraphBlocks(raw);
      setIncomingBlocks(blocks);
      setChanges(
        blocks.map((block) => ({
          id: block.id,
          type: "add",
          incoming: block,
          decision: "accept",
        })),
      );
      setUsePlainText(true);
      setCanvasParseError(null);
      setCanvasApplyMode("replace");
    };

    const updateDecision = (id: string, decision: ChangeDecision) => {
      setChanges((prev) =>
        prev.map((change) =>
          change.id === id ? { ...change, decision } : change,
        ),
      );
    };

    const bulkDecision = (decision: ChangeDecision) => {
      setChanges((prev) => prev.map((change) => ({ ...change, decision })));
    };

    return (
      <div className="mt-4 space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-text-default">
            Paste Response XML
          </label>
          <p className="mb-2 text-xs text-text-muted">
            Paste the model output in the same XML structure to parse and merge
            safely.
          </p>
          <textarea
            value={pastedXML}
            onChange={(e) => onPastedXMLChange(e.target.value)}
            className="w-full border border-border-default bg-surface-subtle p-3 font-mono text-[12px] leading-5 text-text-default focus:border-border-default focus: focus: "
            rows={6}
            placeholder={`Paste the LLM response here. Expected format:\n<response>\n  ${canProcessLog ? "<thought_log>...</thought_log>" : ""}${canProcessLog && canProcessCanvas ? "\n  " : ""}${canProcessCanvas ? "<canvas_update>markdown or JSON</canvas_update>" : ""}\n</response>`}
          />
        </div>

        {parseError && (
          <div className=" bg-status-error-bg p-3 text-sm text-status-error-text border border-border-default">
            Error: {parseError}
          </div>
        )}

        {ignoredTags.length > 0 && (
          <div className=" border border-border-default bg-surface-subtle p-3 text-xs text-text-muted">
            Ignored tags: {ignoredTags.join(", ")}
          </div>
        )}

        {conflictWarning && (
          <div className=" border border-border-default bg-status-error-bg p-3 text-xs text-status-error-text">
            {conflictWarning}
          </div>
        )}

        {canvasParseError && canProcessCanvas && (
          <div className="flex items-center justify-between border border-border-default bg-surface-subtle p-3 text-xs text-text-muted">
            <span>{canvasParseError}</span>
            <button
              onClick={handlePlainTextImport}
              className=" bg-action-primary-bg px-2 py-1 text-[11px] text-action-primary-text hover:bg-action-primary-hover"
            >
              Import as Plain Text
            </button>
          </div>
        )}

        {(thoughtLog || incomingBlocks) && (
          <div className=" border border-border-default bg-surface-subtle p-3 text-xs space-y-2">
            <div className="font-medium text-text-default">Parsed Content</div>
            {thoughtLog && (
              <div>
                <span className="font-medium text-text-muted">
                  Thought Log → New Entry:
                </span>
                <div className="mt-1 max-h-32 overflow-y-auto bg-surface-default p-2 text-text-default whitespace-pre-wrap">
                  {thoughtLog}
                </div>
              </div>
            )}
            {incomingBlocks && (
              <div>
                <span className="font-medium text-text-muted">
                  Canvas Update: {incomingBlocks.length} block
                  {incomingBlocks.length !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
        )}

        {changes.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                {(["current", "incoming", "merged"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setPreviewMode(mode)}
                    className={` px-3 py-1 text-xs ${
                      previewMode === mode
                        ? "bg-action-primary-bg text-action-primary-text"
                        : "bg-surface-subtle text-text-default hover:bg-surface-hover"
                    }`}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={() => bulkDecision("accept")}
                  className=" bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
                >
                  Merge All
                </button>
                <button
                  onClick={() => bulkDecision("reject")}
                  className=" bg-surface-subtle px-2 py-1 text-text-default hover:bg-surface-hover"
                >
                  Reject All
                </button>
              </div>
            </div>

            <div className="divide-y divide-border-subtle overflow-hidden border border-border-default bg-surface-default">
              {changes.map((change) => (
                <div
                  key={change.id}
                  className="flex flex-col md:flex-row items-stretch group hover:bg-surface-subtle transition-colors"
                >
                  {/* Meta info & Labels */}
                  <div className="flex flex-row md:flex-col items-center md:items-start justify-between md:justify-center px-4 py-2 bg-surface-hover md:w-32 border-b md:border-b-0 md:border-r border-border-subtle">
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${change.type === "add" ? "text-status-success-text" : "text-action-primary-bg"}`}
                    >
                      {change.type === "add" ? "New" : "Update"}
                    </span>
                    {change.originalId && (
                      <span className="text-[9px] text-text-muted font-mono truncate max-w-full md:mt-1 opacity-50 group-hover:opacity-100 transition-opacity">
                        ID: {change.originalId.slice(0, 8)}
                      </span>
                    )}
                  </div>

                  {/* Content area */}
                  <div className="flex-1 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border-subtle">
                    {change.current && (
                      <div className="flex-1 p-3 flex flex-col gap-1 min-w-0">
                        <span className="text-[9px] font-bold text-text-muted uppercase">
                          Current
                        </span>
                        <div className="text-[12px] text-text-muted line-clamp-3 md:line-clamp-6 leading-relaxed">
                          {extractBlockText(change.current)}
                        </div>
                      </div>
                    )}
                    <div className="flex-1 p-3 flex flex-col gap-1 min-w-0 bg-surface-subtle">
                      <span className="text-[9px] font-bold text-text-muted uppercase">
                        Incoming
                      </span>
                      <div className="text-[12px] text-text-default font-medium leading-relaxed">
                        {extractBlockText(change.incoming)}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex p-2 items-center justify-center gap-1.5 bg-surface-subtle border-t md:border-t-0 md:border-l border-border-subtle min-w-30">
                    <button
                      onClick={() => updateDecision(change.id, "accept")}
                      title="Accept"
                      className={`flex-1  px-2 py-1.5 text-xs font-bold transition-all ${
                        change.decision === "accept"
                          ? "bg-action-primary-bg text-action-primary-text"
                          : "text-text-muted hover:text-text-default hover:bg-surface-hover"
                      }`}
                    >
                      Accept
                    </button>
                    {change.type === "modify" && (
                      <button
                        onClick={() => updateDecision(change.id, "both")}
                        title="Keep both"
                        className={`flex-1  px-2 py-1.5 text-xs font-bold transition-all ${
                          change.decision === "both"
                            ? "bg-action-primary-bg text-action-primary-text"
                            : "text-text-muted hover:text-text-default hover:bg-surface-hover"
                        }`}
                      >
                        Both
                      </button>
                    )}
                    <button
                      onClick={() => updateDecision(change.id, "reject")}
                      title="Reject"
                      className={`flex-1  px-2 py-1.5 text-xs font-bold transition-all ${
                        change.decision === "reject"
                          ? "bg-action-primary-bg text-action-primary-text"
                          : "text-text-muted hover:text-text-default hover:bg-surface-hover"
                      }`}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {applyError && (
          <div className=" bg-status-error-bg p-3 text-sm text-status-error-text border border-border-default">
            Error: {applyError}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={parseResponse}
            className=" bg-action-primary-bg px-4 py-2 text-action-primary-text hover:bg-action-primary-hover transition-colors"
          >
            Parse Response
          </button>
          <button
            onClick={handleApplyClick}
            disabled={isApplying || (!thoughtLog && !mergedBlocks)}
            className=" bg-surface-subtle px-4 py-2 text-text-default hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            {isApplying ? "Applying..." : "Apply Changes"}
          </button>
          {usePlainText && (
            <span className="text-xs text-text-muted self-center">
              Canvas imported as plain text
            </span>
          )}
        </div>
      </div>
    );
  },
);

ResponseParser.displayName = "ResponseParser";
