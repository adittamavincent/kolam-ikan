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
  storedContentToBlocks,
  storedContentToMarkdown,
  trimEmptyOuterMarkdownLines,
} from "@/lib/content-protocol";
import { normalizeOaiCitationsInMarkdown } from "@/lib/oaicite";
import { useLogBranchContext } from "@/lib/hooks/useLogBranchContext";
import { useCanvasDraft } from "@/lib/hooks/useCanvasDraft";
import type { PartialBlock } from "@/lib/types/editor";
import { MarkdownEditor } from "@/components/shared/MarkdownEditor";

interface ResponseParserProps {
  streamId?: string;
  interactionMode?: "ASK" | "GO" | "BOTH";
  aiPersonaLabel?: string;
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
  parse: () => Promise<void>;
  apply: () => Promise<boolean>;
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
  assistantIdentity: BridgeAssistantIdentity | null;
}

type BridgeAssistantIdentitySource =
  | "assistant_identity"
  | "top_level_tags"
  | "inline_fields"
  | "json_fields"
  | "heuristic"
  | "fallback";

export interface BridgeAssistantIdentity {
  assistant: string | null;
  provider: string | null;
  model: string | null;
  displayLabel: string;
  source: BridgeAssistantIdentitySource;
  raw: string | null;
}

type BridgeAssistantIdentityCandidate = Partial<
  Pick<BridgeAssistantIdentity, "assistant" | "provider" | "model">
>;

const KNOWN_ASSISTANT_HINTS: Array<{
  provider: string;
  assistant: string;
  modelPatterns: RegExp[];
  assistantPatterns?: RegExp[];
}> = [
  {
    provider: "OpenAI",
    assistant: "ChatGPT",
    modelPatterns: [
      /\b(gpt[-\s]?(?:5(?:\.\d+)?|4\.5|4\.1(?:[-\s]?(?:mini|nano))?|4o(?:[-\s]?mini)?|3\.5(?:[-\s]?turbo)?))\b/i,
      /\b(o[134](?:[-\s]?(?:mini|pro))?)\b/i,
    ],
    assistantPatterns: [/\bchatgpt\b/i, /\bopenai\b/i],
  },
  {
    provider: "Anthropic",
    assistant: "Claude",
    modelPatterns: [
      /\b(claude(?:[-\s]?(?:3(?:\.\d+)?|4))?(?:[-\s]?(?:haiku|sonnet|opus))?(?:\s*\d(?:\.\d+)?)?)\b/i,
    ],
    assistantPatterns: [/\bclaude\b/i, /\banthropic\b/i],
  },
  {
    provider: "Google",
    assistant: "Gemini",
    modelPatterns: [
      /\b(gemini(?:[-\s]?(?:1\.5|2\.0|2\.5))?(?:[-\s]?(?:flash(?:-lite)?|pro|thinking))?)\b/i,
    ],
    assistantPatterns: [/\bgemini\b/i, /\bgoogle\b/i],
  },
  {
    provider: "xAI",
    assistant: "Grok",
    modelPatterns: [/\b(grok(?:[-\s]?\d+)?)\b/i],
    assistantPatterns: [/\bgrok\b/i, /\bx\.?ai\b/i],
  },
  {
    provider: "Perplexity",
    assistant: "Perplexity",
    modelPatterns: [
      /\b(sonar(?:[-\s]?(?:reasoning|pro|deep research))?)\b/i,
      /\b(perplexity(?:[-\s]?(?:pro|deep research))?)\b/i,
    ],
    assistantPatterns: [/\bperplexity\b/i],
  },
  {
    provider: "Meta",
    assistant: "Llama",
    modelPatterns: [
      /\b(llama(?:[-\s]?\d+(?:\.\d+)?)?(?:[-\s]?(?:instruct|vision))?)\b/i,
    ],
    assistantPatterns: [/\bllama\b/i, /\bmeta\b/i],
  },
  {
    provider: "Mistral",
    assistant: "Mistral",
    modelPatterns: [
      /\b(mistral(?:[-\s]?(?:small|medium|large|next|nemo)))\b/i,
    ],
    assistantPatterns: [/\bmistral\b/i],
  },
  {
    provider: "DeepSeek",
    assistant: "DeepSeek",
    modelPatterns: [
      /\b(deepseek(?:[-\s]?(?:r\d+|v\d+|reasoner|chat|coder))?)\b/i,
    ],
    assistantPatterns: [/\bdeepseek\b/i],
  },
  {
    provider: "Cohere",
    assistant: "Cohere",
    modelPatterns: [/\b(command[-\s]?(?:r|r\+|a)?)\b/i],
    assistantPatterns: [/\bcohere\b/i],
  },
  {
    provider: "Alibaba",
    assistant: "Qwen",
    modelPatterns: [
      /\b(qwen(?:[-\s]?\d+(?:\.\d+)?)?(?:[-\s]?(?:coder|vl|max|plus|turbo))?)\b/i,
    ],
    assistantPatterns: [/\bqwen\b/i],
  },
  {
    provider: "Microsoft",
    assistant: "Copilot",
    modelPatterns: [/\b(copilot)\b/i],
    assistantPatterns: [/\bcopilot\b/i, /\bmicrosoft\b/i],
  },
  {
    provider: "OpenRouter",
    assistant: "OpenRouter",
    modelPatterns: [/\b(openrouter)\b/i],
    assistantPatterns: [/\bopenrouter\b/i],
  },
  {
    provider: "Poe",
    assistant: "Poe",
    modelPatterns: [/\b(poe)\b/i],
    assistantPatterns: [/\bpoe\b/i],
  },
];

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

    const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
    if (taskMatch) {
      flushParagraph();
      blocks.push({
        id: crypto.randomUUID(),
        type: "checkListItem",
        props: {
          checked: (taskMatch[1].toLowerCase() === "x") as unknown as Json,
        },
        content: [{ type: "text", text: taskMatch[2] }],
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

function parseCanvasDiffLine(line: string): {
  type: "add" | "remove" | "context" | "ignore" | "other";
  content: string;
} {
  const trimmedStart = line.trimStart();
  if (!trimmedStart) {
    return { type: "other", content: "" };
  }
  if (trimmedStart === "<!-- end list -->") {
    return { type: "ignore", content: "" };
  }
  if (trimmedStart === "+" || trimmedStart === "+ ") {
    return { type: "add", content: "" };
  }
  if (trimmedStart.startsWith("+ ")) {
    return { type: "add", content: trimmedStart.slice(2) };
  }
  if (trimmedStart === "-" || trimmedStart === "- ") {
    return { type: "remove", content: "" };
  }
  if (trimmedStart.startsWith("- ")) {
    return { type: "remove", content: trimmedStart.slice(2) };
  }
  if (line.startsWith(" ")) {
    return { type: "context", content: line.slice(1) };
  }
  return { type: "other", content: trimmedStart };
}

function stripNestedCanvasPrefixes(line: string): string {
  let normalized = line.trim().replace(/\\\*/g, "*");

  while (/^[+-]\s+/.test(normalized)) {
    normalized = normalized.replace(/^[+-]\s+/, "").trimStart();
  }

  return normalized;
}

function normalizeComparableCanvasLine(line: string): string {
  const trimmed = stripNestedCanvasPrefixes(line);
  if (!trimmed || trimmed === "<!-- end list -->") return "";

  let normalized = trimmed;
  if (normalized.startsWith("* ")) {
    normalized = `- ${normalized.slice(2)}`;
  }
  normalized = normalized.replace(/^-\s+\*\s+/, "- ");
  return normalized.replace(/\s+/g, " ").trim();
}

function normalizeLooseCanvasLine(line: string): string {
  return normalizeComparableCanvasLine(line).replace(/^[-*]\s+/, "");
}

function normalizeAddedCanvasLine(line: string): string {
  const trimmed = stripNestedCanvasPrefixes(line);
  if (!trimmed || trimmed === "<!-- end list -->") return "";
  if (trimmed.startsWith("* ")) {
    return `- ${trimmed.slice(2)}`;
  }
  return trimmed;
}

function sanitizeCanvasMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let lastNonEmptyLine = "";

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();

    if (!trimmed || trimmed === "<!-- end list -->") {
      result.push(trimmed === "<!-- end list -->" ? "" : rawLine);
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed) && trimmed === lastNonEmptyLine) {
      continue;
    }

    const inlineBulletMatch = trimmed.match(/^(.+?:\*\*|.+?:)\s+\+\s+\\?\*\s+(.+)$/);
    if (inlineBulletMatch) {
      result.push(inlineBulletMatch[1]);
      result.push(`- ${inlineBulletMatch[2]}`);
      lastNonEmptyLine = `- ${inlineBulletMatch[2]}`;
      continue;
    }

    if (/^\*\*[^*]+:\*\*$/.test(trimmed)) {
      result.push(trimmed);
      lastNonEmptyLine = trimmed;
      let lookahead = index + 1;
      while (lookahead < lines.length) {
        const candidate = lines[lookahead];
        const candidateTrimmed = candidate.trim();
        if (!candidateTrimmed) {
          result.push("");
          index = lookahead;
          break;
        }
        if (
          candidateTrimmed.startsWith("#") ||
          candidateTrimmed.startsWith(">") ||
          candidateTrimmed.startsWith("- ") ||
          candidateTrimmed.startsWith("* ") ||
          candidateTrimmed.startsWith("1. ")
        ) {
          break;
        }
        result.push(`- ${candidateTrimmed}`);
        lastNonEmptyLine = `- ${candidateTrimmed}`;
        index = lookahead;
        lookahead += 1;
      }
      continue;
    }

    result.push(trimmed);
    lastNonEmptyLine = trimmed;
  }

  return trimEmptyOuterMarkdownLines(result.join("\n"));
}

function findMatchingCanvasLine(
  lines: string[],
  startIndex: number,
  target: string,
) {
  const comparableTarget = normalizeComparableCanvasLine(target);
  const looseComparableTarget = normalizeLooseCanvasLine(target);
  for (let index = startIndex; index < lines.length; index += 1) {
    const comparableCurrent = normalizeComparableCanvasLine(lines[index]);
    if (
      comparableCurrent === comparableTarget ||
      normalizeLooseCanvasLine(lines[index]) === looseComparableTarget
    ) {
      return index;
    }
  }
  return -1;
}

export function applyCanvasMarkdownDiff(
  currentMarkdown: string,
  diffText: string,
): string {
  const source = currentMarkdown.replace(/\r\n/g, "\n");
  const currentLines = source.length > 0 ? source.split("\n") : [];
  const diffLines = diffText.replace(/\r\n/g, "\n").split("\n");
  const result: string[] = [];
  let cursor = 0;

  const flushUntil = (index: number) => {
    while (cursor < index && cursor < currentLines.length) {
      result.push(currentLines[cursor]);
      cursor += 1;
    }
  };

  for (const line of diffLines) {
    const parsed = parseCanvasDiffLine(line);
    if (parsed.type === "ignore") continue;

    if (parsed.type === "add") {
      result.push(normalizeAddedCanvasLine(parsed.content));
      continue;
    }

    if (parsed.type === "remove") {
      const matchIndex = findMatchingCanvasLine(currentLines, cursor, parsed.content);
      if (matchIndex !== -1) {
        flushUntil(matchIndex);
        cursor = matchIndex + 1;
      }
      continue;
    }

    if (parsed.type === "context") {
      const matchIndex = findMatchingCanvasLine(currentLines, cursor, parsed.content);
      if (matchIndex !== -1) {
        flushUntil(matchIndex);
        result.push(currentLines[matchIndex]);
        cursor = matchIndex + 1;
      }
      continue;
    }
  }

  flushUntil(currentLines.length);
  return sanitizeCanvasMarkdown(result.join("\n"));
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
  hasRemovals?: boolean;
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

  const loosenedLines = loosenedDiffText.split("\n");
  const hasAdditionMarkers = loosenedLines.some((line) => {
    const trimmedLine = line.trim();
    return (
      trimmedLine === "+" ||
      trimmedLine === "+ " ||
      trimmedLine.startsWith("+ ")
    );
  });
  const hasContextMarkers = loosenedLines.some((line) => {
    return line.startsWith(" ") && line.trim().length > 0;
  });
  const hasRemovalMarkers = loosenedLines.some((line) => {
    const trimmedLine = line.trim();
    return (
      trimmedLine === "-" ||
      trimmedLine === "- " ||
      trimmedLine.startsWith("- ")
    );
  });
  const hasDiffMarkers = hasAdditionMarkers || (hasRemovalMarkers && hasContextMarkers);

  if (hasDiffMarkers) {
    return {
      blocks: applyDiffToBlocks(currentBlocks, loosenedDiffText),
      format: "diff",
      hasRemovals: hasRemovalMarkers,
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

function appendCitationSection(
  content: string,
  citations: string | null,
): string {
  if (!citations?.trim()) return content;
  if (/(^|\n)#{1,6}\s+(citations|references)\s*$/im.test(content)) {
    return content;
  }

  return `${content.trimEnd()}\n\n## Citations\n${citations.trim()}`;
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

function cleanIdentityValue(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/[`"'“”]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (/^(unknown|n\/a|na|unspecified|not sure)$/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function canonicalizeProvider(value: string | null | undefined) {
  const cleaned = cleanIdentityValue(value);
  if (!cleaned) return null;
  const normalized = cleaned.toLowerCase();

  if (normalized.includes("openai") || normalized.includes("chatgpt")) {
    return "OpenAI";
  }
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "Anthropic";
  }
  if (normalized.includes("google") || normalized.includes("gemini")) {
    return "Google";
  }
  if (normalized.includes("xai") || normalized.includes("x.ai") || normalized.includes("grok")) {
    return "xAI";
  }
  if (normalized.includes("perplexity") || normalized.includes("sonar")) {
    return "Perplexity";
  }
  if (normalized.includes("meta") || normalized.includes("llama")) {
    return "Meta";
  }
  if (normalized.includes("mistral")) {
    return "Mistral";
  }
  if (normalized.includes("deepseek")) {
    return "DeepSeek";
  }
  if (normalized.includes("cohere") || normalized.includes("command")) {
    return "Cohere";
  }
  if (normalized.includes("qwen")) {
    return "Alibaba";
  }
  if (normalized.includes("microsoft") || normalized.includes("copilot")) {
    return "Microsoft";
  }
  if (normalized.includes("openrouter")) {
    return "OpenRouter";
  }
  if (normalized.includes("poe")) {
    return "Poe";
  }

  return cleaned;
}

function canonicalizeAssistant(value: string | null | undefined) {
  const cleaned = cleanIdentityValue(value);
  if (!cleaned) return null;
  const normalized = cleaned.toLowerCase();

  if (normalized.includes("chatgpt") || normalized.includes("gpt")) {
    return "ChatGPT";
  }
  if (normalized.includes("claude")) {
    return "Claude";
  }
  if (normalized.includes("gemini")) {
    return "Gemini";
  }
  if (normalized.includes("grok")) {
    return "Grok";
  }
  if (normalized.includes("perplexity") || normalized.includes("sonar")) {
    return "Perplexity";
  }
  if (normalized.includes("llama")) {
    return "Llama";
  }
  if (normalized.includes("mistral")) {
    return "Mistral";
  }
  if (normalized.includes("deepseek")) {
    return "DeepSeek";
  }
  if (normalized.includes("cohere") || normalized.includes("command")) {
    return "Cohere";
  }
  if (normalized.includes("qwen")) {
    return "Qwen";
  }
  if (normalized.includes("copilot")) {
    return "Copilot";
  }
  if (normalized.includes("openrouter")) {
    return "OpenRouter";
  }
  if (normalized.includes("poe")) {
    return "Poe";
  }

  return cleaned;
}

function pickFirstValue(
  candidates: Array<string | null | undefined>,
) {
  for (const candidate of candidates) {
    const cleaned = cleanIdentityValue(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

function buildAssistantDisplayLabel(
  identity: BridgeAssistantIdentityCandidate,
  fallbackLabel: string,
) {
  const assistant = canonicalizeAssistant(identity.assistant);
  const provider = canonicalizeProvider(identity.provider);
  const model = cleanIdentityValue(identity.model);

  if (model) {
    const comparableModel = model.toLowerCase();
    if (assistant && comparableModel.includes(assistant.toLowerCase())) {
      return model;
    }
    if (provider && comparableModel.includes(provider.toLowerCase())) {
      return model;
    }
    if (assistant) {
      return `${assistant} (${model})`;
    }
    if (provider) {
      return `${provider} (${model})`;
    }
    return model;
  }

  return assistant ?? provider ?? fallbackLabel;
}

function extractTagAttributes(
  text: string,
  tagNames: string[],
) {
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}\\b([^>]*)>`, "i");
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function extractAttributeValue(
  attributes: string | null,
  keys: string[],
) {
  if (!attributes) return null;
  for (const key of keys) {
    const pattern = new RegExp(`${key}\\s*=\\s*["']([^"']+)["']`, "i");
    const match = pattern.exec(attributes);
    if (match?.[1]) {
      return cleanIdentityValue(match[1]);
    }
  }
  return null;
}

function extractIdentityFieldsFromText(text: string) {
  const source = text.replace(/\r\n/g, "\n");
  return {
    assistant: pickFirstValue([
      source.match(/\bassistant(?:\s+name|\s+identity|\s+product)?\s*[:=-]\s*([^\n;|<]+)/i)?.[1],
      source.match(/\bname\s*[:=-]\s*([^\n;|<]+)/i)?.[1],
      source.match(/\bwho\s+are\s+you\s*[:?-]?\s*([^\n<]+)/i)?.[1],
    ]),
    provider: pickFirstValue([
      source.match(/\bprovider(?:\s+name)?\s*[:=-]\s*([^\n;|<]+)/i)?.[1],
      source.match(/\bvendor\s*[:=-]\s*([^\n;|<]+)/i)?.[1],
      source.match(/\bcompany\s*[:=-]\s*([^\n;|<]+)/i)?.[1],
    ]),
    model: pickFirstValue([
      source.match(/\bmodel(?:\s+name|\s+id)?\s*[:=-]\s*([^\n;|<]+)/i)?.[1],
      source.match(/\bengine\s*[:=-]\s*([^\n;|<]+)/i)?.[1],
    ]),
  };
}

function extractIdentityFieldsFromJson(text: string) {
  return {
    assistant: pickFirstValue([
      text.match(/"(?:assistant|assistant_name|name|product)"\s*:\s*"([^"]+)"/i)?.[1],
    ]),
    provider: pickFirstValue([
      text.match(/"(?:provider|vendor|company)"\s*:\s*"([^"]+)"/i)?.[1],
    ]),
    model: pickFirstValue([
      text.match(/"(?:model|model_name|model_id|engine)"\s*:\s*"([^"]+)"/i)?.[1],
    ]),
  };
}

function detectKnownAssistantIdentity(text: string) {
  for (const hint of KNOWN_ASSISTANT_HINTS) {
    const matchedModel = hint.modelPatterns
      .map((pattern) => pattern.exec(text)?.[1])
      .find(Boolean);
    if (matchedModel) {
      return {
        provider: hint.provider,
        assistant: hint.assistant,
        model: cleanIdentityValue(matchedModel),
      };
    }

    const matchedAssistant = hint.assistantPatterns?.some((pattern) =>
      pattern.test(text),
    );
    if (matchedAssistant) {
      return {
        provider: hint.provider,
        assistant: hint.assistant,
        model: null,
      };
    }
  }

  return null;
}

export function detectBridgeAssistantIdentity(
  rawText: string,
  fallbackLabel = "AI",
): BridgeAssistantIdentity | null {
  const normalized = normalizeBridgeResponseText(rawText);
  if (!normalized) return null;

  const identityTagNames = [
    "assistant_identity",
    "identity",
    "model_identity",
    "assistant_metadata",
    "metadata",
  ];
  const identityBlock = extractTagContentByAliases(normalized, identityTagNames);
  const identityAttributes = extractTagAttributes(normalized, identityTagNames);

  const fromIdentityBlock = identityBlock
    ? {
        assistant: pickFirstValue([
          extractTagContentByAliases(identityBlock, [
            "assistant",
            "assistant_name",
            "name",
            "product",
          ]),
          extractAttributeValue(identityAttributes, ["assistant", "assistant_name", "name"]),
          extractIdentityFieldsFromText(identityBlock).assistant,
        ]),
        provider: pickFirstValue([
          extractTagContentByAliases(identityBlock, ["provider", "vendor", "company"]),
          extractAttributeValue(identityAttributes, ["provider", "vendor", "company"]),
          extractIdentityFieldsFromText(identityBlock).provider,
        ]),
        model: pickFirstValue([
          extractTagContentByAliases(identityBlock, ["model", "model_name", "model_id", "engine"]),
          extractAttributeValue(identityAttributes, ["model", "model_name", "model_id", "engine"]),
          extractIdentityFieldsFromText(identityBlock).model,
        ]),
      }
    : null;

  const fromTopLevelTags = {
    assistant: pickFirstValue([
      extractTagContentByAliases(normalized, ["assistant_name", "assistant"]),
    ]),
    provider: pickFirstValue([
      extractTagContentByAliases(normalized, ["provider", "vendor", "company"]),
    ]),
    model: pickFirstValue([
      extractTagContentByAliases(normalized, ["model", "model_name", "model_id", "engine"]),
    ]),
  };
  const fromInlineFields = extractIdentityFieldsFromText(identityBlock ?? normalized);
  const fromJsonFields = extractIdentityFieldsFromJson(identityBlock ?? normalized);
  const fromHeuristics = detectKnownAssistantIdentity(identityBlock ?? normalized);

  const sources: Array<{
    source: BridgeAssistantIdentitySource;
    candidate: BridgeAssistantIdentityCandidate | null;
    raw: string | null;
  }> = [
    {
      source: "assistant_identity",
      candidate: fromIdentityBlock,
      raw: identityBlock,
    },
    {
      source: "top_level_tags",
      candidate: fromTopLevelTags,
      raw: null,
    },
    {
      source: "inline_fields",
      candidate: fromInlineFields,
      raw: identityBlock ?? normalized,
    },
    {
      source: "json_fields",
      candidate: fromJsonFields,
      raw: identityBlock ?? normalized,
    },
    {
      source: "heuristic",
      candidate: fromHeuristics,
      raw: identityBlock ?? normalized,
    },
  ];

  for (const entry of sources) {
    const provider = canonicalizeProvider(entry.candidate?.provider);
    const model = cleanIdentityValue(entry.candidate?.model);
    const assistant = pickFirstValue([
      canonicalizeAssistant(entry.candidate?.assistant),
      canonicalizeAssistant(model),
      canonicalizeAssistant(provider),
    ]);
    if (!assistant && !provider && !model) {
      continue;
    }

    return {
      assistant,
      provider,
      model,
      displayLabel: buildAssistantDisplayLabel(
        { assistant, provider, model },
        fallbackLabel,
      ),
      source: entry.source,
      raw: cleanIdentityValue(entry.raw),
    };
  }

  return fallbackLabel
    ? {
        assistant: cleanIdentityValue(fallbackLabel),
        provider: null,
        model: null,
        displayLabel: fallbackLabel,
        source: "fallback",
        raw: null,
      }
    : null;
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
      aiPersonaLabel = "AI",
      pastedXML,
      onPastedXMLChange,
      onApplySuccess,
      onStatusChange,
    },
    ref,
  ) => {
    const [parseError, setParseError] = useState<string | null>(null);
    const [, setIgnoredTags] = useState<string[]>([]);
    const [thoughtLog, setThoughtLog] = useState<string | null>(null);
    const [incomingBlocks, setIncomingBlocks] = useState<
      MarkdownBlock[] | null
    >(null);
    const [changes, setChanges] = useState<BlockChange[]>([]);
    const [, setConflictWarning] = useState<string | null>(null);
    const [applyError, setApplyError] = useState<string | null>(null);
    const [isApplying, setIsApplying] = useState(false);
    const [, setParseWarnings] = useState<string[]>([]);
    const [, setCanvasParseError] = useState<string | null>(
      null,
    );
    const [previewMode] = useState<
      "current" | "incoming" | "merged"
    >("merged");
    const [, setUsePlainText] = useState(false);
    const [canvasApplyMode, setCanvasApplyMode] = useState<"merge" | "replace">(
      "merge",
    );
    const [lastParsedContent, setLastParsedContent] = useState<string | null>(
      null,
    );
    const [assistantIdentity, setAssistantIdentity] =
      useState<BridgeAssistantIdentity | null>(null);


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
      setAssistantIdentity(null);
      latestParsedRef.current = null;
      onPastedXMLChange("");
      setLastParsedContent(null);
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

    const canApply = !isApplying && ((!!thoughtLog && canProcessLog) || (!!mergedBlocks && canProcessCanvas));
    const canParse = !!pastedXML.trim();
    const hasParsed = !!thoughtLog || !!incomingBlocks || !!mergedBlocks;

    useEffect(() => {
      onStatusChange?.({
        isApplying,
        canApply,
        canParse,
        hasParsed,
      });
    }, [isApplying, canApply, canParse, hasParsed, onStatusChange]);

    useEffect(() => {
      if (canParse && pastedXML !== lastParsedContent && !parseError) {
        void parseResponse();
      }
      // parseResponse is intentionally omitted to avoid re-running on every render.
      // It closes over the latest state and is only triggered by parse guard inputs.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canParse, pastedXML, lastParsedContent, parseError]);



    const parseCurrentResponse = async (): Promise<ParsedBridgeResponse> => {
      if (!streamId) {
        throw new Error("Stream not available");
      }

      const raw = normalizeBridgeResponseText(pastedXML);
      if (!raw) {
        throw new Error("No response to parse");
      }

      const nextAssistantIdentity = detectBridgeAssistantIdentity(
        raw,
        aiPersonaLabel,
      );
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
        "answer",
        "final",
        "reply",
      ]);
      const citationsContent = extractTagContentByAliases(raw, [
        "citations",
        "sources",
        "references",
        "citation_list",
      ]);
      const canvasJsonContent = extractTagContentByAliases(raw, [
        "canvas_json",
        "canvas_update_json",
        "artifact_json",
      ]);
      const canvasMarkdownContent = extractTagContentByAliases(raw, [
        "canvas_md",
        "canvas_update_md",
        "artifact_md",
      ]);
      const canvasDefaultContent = extractTagContentByAliases(raw, [
        "canvas",
        "canvas_update",
        "artifact",
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
            raw_markdown: string | null;
            updated_at: string | null;
          }
        | null
        | undefined;

      if (!thoughtContent && !canvasContent) {
        throw new Error(
          "Could not find log/canvas tags in the response. Use <log>...</log> and/or <canvas>...</canvas> (aliases like <answer>, <final>, <reply>, or <artifact> also work). " +
            "Make sure the LLM response contains the expected XML structure.",
        );
      }

      if (thoughtContent) {
        nextThoughtLog = normalizeOaiCitationsInMarkdown(
          appendCitationSection(
            thoughtContent,
            citationsContent ? normalizeOaiCitationsInMarkdown(citationsContent) : null,
          ),
        );
      }

      let resolvedBlocks: MarkdownBlock[] | null = null;
      if (canvasContent) {
        const normalizedCanvasContent =
          normalizeOaiCitationsInMarkdown(
            appendCitationSection(
              canvasContent,
              citationsContent ? normalizeOaiCitationsInMarkdown(citationsContent) : null,
            ),
          );
        const { data: fetchedCanvas, error: currentCanvasError } = await supabase
          .from("canvases")
          .select("id, content_json, raw_markdown, updated_at")
          .eq("stream_id", streamId)
          .maybeSingle();
        if (currentCanvasError) throw currentCanvasError;
        currentCanvasRecord = fetchedCanvas;
        if (fetchedCanvas) {
          queryClient.setQueryData(["canvas", streamId], fetchedCanvas);
        }
        const currentBlocks =
          (fetchedCanvas?.content_json as unknown as MarkdownBlock[]) || [];
        const currentCanvasMarkdown = storedContentToMarkdown(fetchedCanvas ?? {});

        const result = (() => {
          if (canvasJsonContent) {
            const jsonResult = resolveIncomingBlocks(canvasJsonContent);
            return {
              blocks: jsonResult.blocks,
              error: jsonResult.error,
              format: "json" as const,
            };
          }
            return resolveCanvasBlocks(normalizedCanvasContent, currentBlocks);
          })();

        if (result.error) {
          nextCanvasParseError = result.error;
          warnings.push("Canvas update could not be parsed");
        } else {
          if (result.format === "diff") {
            const patchedMarkdown = applyCanvasMarkdownDiff(
              currentCanvasMarkdown,
              normalizedCanvasContent,
            );
            const patchedBlocks = storedContentToBlocks({
              raw_markdown: patchedMarkdown,
            }) as MarkdownBlock[];
            resolvedBlocks = patchedBlocks;
            nextIncomingBlocks = patchedBlocks;
            nextCanvasApplyMode = "replace";
          } else {
            resolvedBlocks = result.blocks;
            nextIncomingBlocks = result.blocks;
          }
          if (result.format === "markdown") {
            warnings.push("Canvas update parsed in compact markdown mode.");
          } else if (result.format === "diff") {
            warnings.push("Canvas update applied via git-diff mode.");
          }
        }
      }

      if (canProcessLog && !nextThoughtLog) {
        if (canvasContent) {
          nextThoughtLog = "Updated the canvas for this turn.";
          warnings.push("No <log> found — inserted a minimal delta note.");
        } else {
          warnings.push(
            "No <thought_log> found — expected for this interaction mode.",
          );
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
            .select("id, content_json, raw_markdown, updated_at")
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
            .select("id, content_json, raw_markdown, updated_at")
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
        assistantIdentity: nextAssistantIdentity,
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
      setAssistantIdentity(parsed.assistantIdentity);
      latestParsedRef.current = parsed;
    };

    const parseResponse = async () => {
      try {
        const parsed = await parseCurrentResponse();
        applyParsedState(parsed);
        setLastParsedContent(pastedXML);
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
      const nextAssistantLabel =
        parsed?.assistantIdentity?.displayLabel ??
        assistantIdentity?.displayLabel ??
        aiPersonaLabel;

      setApplyError(null);
      setIsApplying(true);
      try {
        let createdEntryId: string | null = null;
        let appliedBranchHeadId: string | null = currentBranchHeadId;

        if (nextThoughtLog && canProcessLog) {
          const blocks = toParagraphBlocks(nextThoughtLog);

          const { data: existingBranch, error: existingBranchError } = await supabase
            .from("branches")
            .select("id, head_commit_id")
            .eq("stream_id", streamId)
            .eq("name", currentBranch)
            .maybeSingle();
          if (existingBranchError) throw existingBranchError;

          let branchId = existingBranch?.id ?? null;
          let branchHeadId =
            (existingBranch as { head_commit_id?: string | null } | null)?.head_commit_id ??
            currentBranchHeadId;
          if (!branchHeadId) {
            const cachedLatestEntryId = queryClient.getQueryData<string>([
              "latest-entry-id",
              streamId,
            ]);
            if (typeof cachedLatestEntryId === "string" && cachedLatestEntryId.trim()) {
              branchHeadId = cachedLatestEntryId;
            } else {
              const { data: latestEntry, error: latestEntryError } = await supabase
                .from("entries")
                .select("id")
                .eq("stream_id", streamId)
                .eq("is_draft", false)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (latestEntryError) throw latestEntryError;
              branchHeadId =
                latestEntry && typeof (latestEntry as { id?: unknown }).id === "string"
                  ? ((latestEntry as { id?: string }).id ?? null)
                  : null;
            }
          }
          if (!branchId) {
            const { data: createdBranch, error: branchInsertError } = await supabase
              .from("branches")
              .insert({
                stream_id: streamId,
                name: currentBranch,
              })
              .select("id, head_commit_id")
              .single();
            if (branchInsertError || !createdBranch) throw branchInsertError;
            branchId = createdBranch.id;
            branchHeadId =
              (createdBranch as { head_commit_id?: string | null }).head_commit_id ?? branchHeadId;
          }
          appliedBranchHeadId = branchHeadId ?? null;

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
              parent_commit_id: branchHeadId ?? null,
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
              persona_name_snapshot: nextAssistantLabel,
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
          queryClient.invalidateQueries({
            queryKey: ["bridge-quick-entries", streamId],
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

        if (nextMergedBlocks && canProcessCanvas) {
          const { data: canvas, error } = await supabase
            .from("canvases")
            .select("id")
            .eq("stream_id", streamId)
            .maybeSingle();
          if (error) throw error;

          const nextRawMarkdown = blocksToStoredMarkdown(
            nextMergedBlocks as PartialBlock[],
          );
          const nextStoredPayload = buildStoredContentPayload(
            nextMergedBlocks,
            nextRawMarkdown,
          );

          let canvasId = canvas?.id ?? null;
          if (canvasId) {
            const { error: updateError } = await supabase
              .from("canvases")
              .update(nextStoredPayload)
              .eq("id", canvasId);
            if (updateError) throw updateError;
          } else {
            const { data: createdCanvas, error: insertError } = await supabase
              .from("canvases")
              .insert({
                stream_id: streamId,
                ...nextStoredPayload,
              })
              .select("id")
              .single();
            if (insertError || !createdCanvas?.id) throw insertError;
            canvasId = createdCanvas.id;
          }

          queryClient.setQueryData(["canvas", streamId], (previous: Record<
            string,
            unknown
          > | undefined) => ({
            ...(previous ?? {}),
            id: canvasId,
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
            target_id: canvasId,
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
            canvas_id: canvasId,
            stream_id: streamId,
            branch_name: currentBranch,
            source_entry_id: createdEntryId ?? appliedBranchHeadId,
            ...nextStoredPayload,
            name: "AI Bridge Update",
            summary: summaryText,
            created_by: userData.user?.id ?? null,
          });

          queryClient.invalidateQueries({ queryKey: ["canvas", streamId] });
          queryClient.invalidateQueries({
            queryKey: ["bridge-quick-canvas", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["canvas-versions", streamId],
          });
          queryClient.invalidateQueries({
            queryKey: ["canvas-latest-version", streamId],
          });
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
        const parsed =
          latestParsedRef.current && lastParsedContent === pastedXML
            ? latestParsedRef.current
            : await parseCurrentResponse();
        applyParsedState(parsed);
        setLastParsedContent(pastedXML);
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

    const displayCanvasMarkdown = useMemo(
      () =>
        mergedBlocks
          ? blocksToStoredMarkdown(mergedBlocks as PartialBlock[])
          : "",
      [mergedBlocks],
    );

    return (
      <div className="bridge-response-parser flex flex-col gap-4 flex-1 min-h-0">
        {(!hasParsed && !isApplying) && (
          <div className="border border-border-default bg-surface-subtle p-8 text-center">
            <p className="text-sm text-text-muted">
              Waiting for response or import to review the execution plan.
            </p>
          </div>
        )}

        {(parseError || applyError) && (
          <div className="bg-status-error-bg p-3 text-sm text-status-error-text border border-border-default">
            Error: {parseError || applyError}
          </div>
        )}

        {hasParsed && (
          <div className="flex flex-col gap-4 flex-1 min-h-0">
            {assistantIdentity && assistantIdentity.source !== "fallback" && (
              <div className="border border-border-default bg-surface-subtle px-3 py-2 text-[11px] text-text-muted">
                Parsed assistant:{" "}
                <span className="font-semibold text-text-default">
                  {assistantIdentity.displayLabel}
                </span>
                {assistantIdentity.provider &&
                assistantIdentity.provider !== assistantIdentity.displayLabel ? (
                  <span> · {assistantIdentity.provider}</span>
                ) : null}
              </div>
            )}
            {/* Log Pane */}
            {thoughtLog && (
              <div className="flex flex-col border border-border-default bg-surface-default overflow-hidden flex-1 min-h-37.5">
                <div className="flex items-center gap-2 bg-surface-subtle border-b border-border-default px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Log Pane (New Entry)
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="section-editor-surface markdown-editor-readonly prose prose-sm max-w-none dark:prose-invert min-h-full">
                    <MarkdownEditor
                      key={`bridge-log-${lastParsedContent ?? "empty"}`}
                      initialMarkdown={thoughtLog}
                      editable={false}
                      placeholder="The AI's reasoning or the content for the new log entry..."
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Canvas Pane */}
            {mergedBlocks && (
              <div className="flex flex-col border border-border-default bg-surface-default overflow-hidden flex-1 min-h-37.5">
                <div className="flex items-center gap-2 bg-surface-subtle border-b border-border-default px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  Canvas Pane (Proposed Merged Content)
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="section-editor-surface markdown-editor-readonly prose prose-sm max-w-none dark:prose-invert min-h-full">
                    <MarkdownEditor
                      key={`bridge-canvas-${lastParsedContent ?? "empty"}-${canvasApplyMode}`}
                      initialMarkdown={displayCanvasMarkdown}
                      editable={false}
                      placeholder="The final proposed markdown for the canvas..."
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

ResponseParser.displayName = "ResponseParser";
