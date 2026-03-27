import bridge from "@/lib/blocknote-markdown-bridge";
import type { PartialBlock } from "@/lib/types/editor";
import { BlockNoteBlock } from "@/lib/types";
import { Json } from "@/lib/types/database.types";

export const CONTENT_FORMAT_MARKDOWN_BLOCKNOTE = "markdown+blocknote-v1";

type StoredContentRecord = {
  content_json?: Json | null;
  raw_markdown?: string | null;
  content_format?: string | null;
};

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
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: PartialBlock[] = [];

  for (const line of lines) {
    if (line.length === 0) {
      blocks.push({ type: "paragraph", content: [] });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        props: { level: Math.min(3, headingMatch[1].length) },
        content: [{ type: "text", text: headingMatch[2], styles: {} }],
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      blocks.push({
        type: "bulletListItem",
        content: [{ type: "text", text: bulletMatch[1], styles: {} }],
      });
      continue;
    }

    const numberedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (numberedMatch) {
      blocks.push({
        type: "numberedListItem",
        content: [{ type: "text", text: numberedMatch[1], styles: {} }],
      });
      continue;
    }

    blocks.push({
      type: "paragraph",
      content: [{ type: "text", text: line, styles: {} }],
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
  blocks: PartialBlock[] | BlockNoteBlock[] | null | undefined,
): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";

  try {
    const markdown = bridge.blocksToBridgeMarkdown(blocks as BlockNoteBlock[]);
    if (markdown.trim().length > 0) {
      return markdown.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    }
  } catch {
    // Fall through to plain-text fallback.
  }

  return flattenBlockText(blocks as PartialBlock[]);
}

export function buildStoredContentPayload(
  blocks: PartialBlock[] | BlockNoteBlock[] | null | undefined,
): {
  content_json: Json;
  raw_markdown: string;
  content_format: string;
} {
  const normalizedBlocks = Array.isArray(blocks) ? blocks : [];

  return {
    content_json: normalizedBlocks as unknown as Json,
    raw_markdown: blocksToStoredMarkdown(normalizedBlocks),
    content_format: CONTENT_FORMAT_MARKDOWN_BLOCKNOTE,
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
      record.content_format?.trim() || CONTENT_FORMAT_MARKDOWN_BLOCKNOTE,
  };
}

export function storedContentToMarkdown(record: StoredContentRecord): string {
  const rawMarkdown = record.raw_markdown?.trim();
  if (rawMarkdown) return rawMarkdown;

  if (isBlockArray(record.content_json)) {
    return blocksToStoredMarkdown(record.content_json);
  }

  return "";
}

export function storedContentToBlocks(record: StoredContentRecord): PartialBlock[] {
  if (isBlockArray(record.content_json) && record.content_json.length > 0) {
    return record.content_json;
  }

  const rawMarkdown = record.raw_markdown?.trim();
  if (!rawMarkdown) return [];

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
