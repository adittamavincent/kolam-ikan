import bridge from "@/lib/markdown-block-bridge";
import type { PartialBlock } from "@/lib/types/editor";
import { MarkdownBlock } from "@/lib/types";
import { Json } from "@/lib/types/database.types";

export const CONTENT_FORMAT_MARKDOWN_EDITOR = "markdown-v1";

type StoredContentRecord = {
  content_json?: Json | null;
  raw_markdown?: string | null;
  content_format?: string | null;
};

function normalizeMarkdown(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n") : "";
}

export function trimEmptyOuterMarkdownLines(
  value: string | null | undefined,
): string {
  const normalized = normalizeMarkdown(value);
  return normalized.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "");
}

function toTextContent(text: string) {
  return text.length > 0 ? [{ type: "text" as const, text, styles: {} }] : [];
}

function isBlockArray(value: unknown): value is PartialBlock[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item != null &&
        typeof item === "object" &&
        typeof (item as { type?: unknown }).type === "string",
    )
  );
}

function fallbackMarkdownToBlocks(markdown: string): PartialBlock[] {
  const lines = normalizeMarkdown(markdown).split("\n");
  const blocks: PartialBlock[] = [];

  for (const rawLine of lines) {
    if (rawLine.length === 0) {
      blocks.push({ type: "paragraph", content: [] });
      continue;
    }

    const line = rawLine.trimStart();

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        props: { level: Math.min(3, headingMatch[1].length) },
        content: toTextContent(headingMatch[2]),
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    const taskMatch = line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
    if (taskMatch) {
      blocks.push({
        type: "checkListItem",
        props: { checked: taskMatch[1].toLowerCase() === "x" },
        content: toTextContent(taskMatch[2]),
      });
      continue;
    }

    if (bulletMatch) {
      blocks.push({
        type: "bulletListItem",
        content: toTextContent(bulletMatch[1]),
      });
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (numberedMatch) {
      blocks.push({
        type: "numberedListItem",
        content: toTextContent(numberedMatch[1]),
      });
      continue;
    }

    blocks.push({
      type: "paragraph",
      content: toTextContent(rawLine),
    });
  }

  return blocks;
}

function flattenBlockText(blocks: PartialBlock[]): string {
  const readBlock = (block: PartialBlock): string => {
    const content = Array.isArray(block.content)
      ? block.content
          .map((item) =>
            typeof (item as { text?: unknown }).text === "string"
              ? (item as { text: string }).text
              : "",
          )
          .join("")
      : "";
    const children = Array.isArray(block.children)
      ? block.children.map(readBlock).filter(Boolean).join("\n")
      : "";
    return [content, children].filter(Boolean).join("\n");
  };

  return blocks.map(readBlock).filter(Boolean).join("\n").trimEnd();
}

export function blocksToStoredMarkdown(
  blocks: PartialBlock[] | MarkdownBlock[] | null | undefined,
): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";

  try {
    const markdown = bridge.blocksToBridgeMarkdown(blocks as MarkdownBlock[]);
    if (markdown.trim().length > 0) {
      return normalizeMarkdown(markdown).replace(/\n+$/, "");
    }
  } catch {
    // Fall through to plain-text fallback.
  }

  return flattenBlockText(blocks as PartialBlock[]);
}

export function buildStoredContentPayload(
  blocks: PartialBlock[] | MarkdownBlock[] | null | undefined,
  rawMarkdown?: string | null,
): {
  content_json: Json;
  raw_markdown: string;
  content_format: string;
} {
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];
  const normalizedRawMarkdown = normalizeMarkdown(rawMarkdown);

  return {
    content_json: normalizedBlocks as unknown as Json,
    raw_markdown:
      typeof rawMarkdown === "string"
        ? normalizedRawMarkdown
        : blocksToStoredMarkdown(normalizedBlocks),
    content_format: CONTENT_FORMAT_MARKDOWN_EDITOR,
  };
}

export function cloneStoredContentFields(record: StoredContentRecord): {
  content_json: Json;
  raw_markdown: string;
  content_format: string;
} {
  const blocks = storedContentToBlocks(record);
  return {
    content_json: (isBlockArray(record.content_json) ? record.content_json : blocks) as unknown as Json,
    raw_markdown: storedContentToMarkdown(record),
    content_format:
      record.content_format?.trim() || CONTENT_FORMAT_MARKDOWN_EDITOR,
  };
}

export function storedContentToMarkdown(record: StoredContentRecord): string {
  const rawMarkdown = normalizeMarkdown(record.raw_markdown);
  if (rawMarkdown.trim().length > 0) return rawMarkdown;

  if (isBlockArray(record.content_json)) {
    return blocksToStoredMarkdown(record.content_json);
  }

  return "";
}

export function storedContentToBlocks(record: StoredContentRecord): PartialBlock[] {
  if (isBlockArray(record.content_json) && record.content_json.length > 0) {
    return record.content_json;
  }

  const rawMarkdown = normalizeMarkdown(record.raw_markdown);
  if (rawMarkdown.trim().length === 0) return [];

  try {
    const blocks = bridge.bridgeMarkdownToBlocks(rawMarkdown) as PartialBlock[];
    if (Array.isArray(blocks) && blocks.length > 0) {
      return blocks;
    }
  } catch {
    // Fall through to a plain markdown fallback.
  }

  return fallbackMarkdownToBlocks(rawMarkdown);
}
