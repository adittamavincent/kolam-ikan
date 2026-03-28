import { MarkdownBlock, MarkdownInlineContent } from "@/lib/types";
import type { Json } from "@/lib/types/database.types";

const DEFAULT_BRIDGE_TIMEOUT_MS = 50;

export class MarkdownBridgeTimeoutError extends Error {
  constructor(message = "Markdown bridge conversion timed out") {
    super(message);
    this.name = "MarkdownBridgeTimeoutError";
  }
}

type BridgeOptions = {
  timeoutMs?: number;
};

function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeHtml(str: string) {
  return str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function genId() {
  return `md-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

function createTimeoutGuard(timeoutMs = DEFAULT_BRIDGE_TIMEOUT_MS) {
  const startedAt = Date.now();

  return () => {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new MarkdownBridgeTimeoutError();
    }
  };
}

function getLineIndent(line: string) {
  const leading = line.match(/^(\s*)/);
  const leadingSpaces = leading ? leading[1].length : 0;

  return {
    depth: Math.floor(leadingSpaces / 2),
    withoutIndent: line.slice(leadingSpaces),
  };
}

function parseBulletListLine(line: string): string | null {
  const { withoutIndent } = getLineIndent(line);
  const match = withoutIndent.match(/^[-*]\s+(.*)$/);
  if (!match) return null;
  return match[1];
}

function parseOrderedListLine(line: string): string | null {
  const { withoutIndent } = getLineIndent(line);
  const match = withoutIndent.match(/^\d+[.)]\s+(.*)$/);
  if (!match) return null;
  return match[1];
}

function parseHeadingLine(line: string): { level: number; text: string } | null {
  const { withoutIndent } = getLineIndent(line);
  const match = withoutIndent.trimEnd().match(/^(#{1,6})\s+(.*)$/);
  if (!match) return null;
  return { level: match[1].length, text: match[2] };
}

function isBlockBoundary(line: string): boolean {
  return (
    parseBulletListLine(line) !== null ||
    parseOrderedListLine(line) !== null ||
    parseHeadingLine(line) !== null
  );
}

function toTextContent(text: string): MarkdownInlineContent[] {
  return text.length > 0 ? [{ type: "text", text, styles: {} }] : [];
}

// Wrap text with a span that contains JSON metadata in `data-md`.
function wrapWithMeta(text: string, meta: Record<string, unknown> | null) {
  if (!meta || Object.keys(meta).length === 0) return text;
  const json = JSON.stringify(meta);
  const encoded = encodeURIComponent(json);
  return `<span data-md="${encoded}">${escapeHtml(text)}</span>`;
}

export function blocksToBridgeMarkdown(
  blocks: MarkdownBlock[],
  options: BridgeOptions = {},
): string {
  if (!Array.isArray(blocks)) return "";

  const guard = createTimeoutGuard(options.timeoutMs);
  const seen = new Set<MarkdownBlock>();
  const segments: { markdown: string; type: string }[] = [];

  function renderBlock(
    block: MarkdownBlock,
    target: string[],
    indent = 0,
  ) {
    guard();

    if (seen.has(block)) {
      throw new Error("Encountered a cyclic markdown block tree");
    }

    seen.add(block);

    try {
      const indentStr = " ".repeat(indent);
      const text = (block.content || []).map((content) => content.text).join("") || "";
      const meta = ((block.props as Record<string, unknown> | undefined)?.md ??
        (block.props as Record<string, unknown> | undefined)?.bn ??
        null) as Record<string, unknown> | null;

      if (block.type === "bulletListItem") {
        target.push(`${indentStr}- ${wrapWithMeta(text, meta)}`);
        if (Array.isArray(block.children) && block.children.length > 0) {
          for (const child of block.children) renderBlock(child, target, indent + 2);
        }
        return;
      }

      if (block.type === "numberedListItem") {
        target.push(`${indentStr}1. ${wrapWithMeta(text, meta)}`);
        if (Array.isArray(block.children) && block.children.length > 0) {
          for (const child of block.children) renderBlock(child, target, indent + 2);
        }
        return;
      }

      if (block.type === "heading") {
        const level = (block.props && (block.props.level as number)) || 1;
        target.push(`${indentStr}${"#".repeat(level)} ${text}`);
        return;
      }

      target.push(`${indentStr}${wrapWithMeta(text, meta)}`);
      if (Array.isArray(block.children) && block.children.length > 0) {
        for (const child of block.children) renderBlock(child, target, indent + 2);
      }
    } finally {
      seen.delete(block);
    }
  }

  for (const block of blocks) {
    const lines: string[] = [];
    renderBlock(block, lines, 0);
    segments.push({
      markdown: lines.join("\n"),
      type: block.type,
    });
  }

  return segments
    .map((segment, index) => {
      if (index === 0) return segment.markdown;

      const previous = segments[index - 1];
      const separator =
        previous.type === "paragraph" && segment.type === "paragraph"
          ? "\n\n"
          : "\n";

      return `${separator}${segment.markdown}`;
    })
    .join("");
}

// Parse a markdown string produced by `blocksToBridgeMarkdown` into simple MarkdownBlock[].
// This parser is intentionally minimal: it recognizes list item prefixes and the
// inline metadata spans produced above.
export function bridgeMarkdownToBlocks(
  markdown: string,
  options: BridgeOptions = {},
): MarkdownBlock[] {
  if (!markdown) return [];

  const guard = createTimeoutGuard(options.timeoutMs);
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  function parseInline(text: string): { text: string; meta: Record<string, unknown> | null }[] {
    guard();

    const results: { text: string; meta: Record<string, unknown> | null }[] = [];
    const spanRe = /<span\s+data-(?:md|bn)="([^"]+)">([\s\S]*?)<\/span>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = spanRe.exec(text)) !== null) {
      guard();

      if (match.index > lastIndex) {
        results.push({
          text: unescapeHtml(text.slice(lastIndex, match.index)),
          meta: null,
        });
      }

      try {
        const decoded = decodeURIComponent(match[1]);
        const meta = JSON.parse(decoded);
        results.push({ text: unescapeHtml(match[2]), meta });
      } catch {
        results.push({ text: unescapeHtml(match[2]), meta: null });
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      results.push({ text: unescapeHtml(text.slice(lastIndex)), meta: null });
    }

    return results;
  }

  const root: MarkdownBlock[] = [];
  const lastAtDepth: (MarkdownBlock | undefined)[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    guard();

    const line = lines[idx];
    if (line.trim() === "") {
      lastAtDepth.length = 0;
      continue;
    }

    const { depth } = getLineIndent(line);
    const bulletText = parseBulletListLine(line);
    const orderedText = parseOrderedListLine(line);

    if (bulletText !== null || orderedText !== null) {
      const rawText = bulletText ?? orderedText ?? "";
      const parts = parseInline(rawText);
      const content =
        parts.length > 0
          ? parts.map((part) => ({ type: "text" as const, text: part.text, styles: {} }))
          : [];
      const bnMeta =
        parts.length === 1
          ? (parts[0].meta as Record<string, unknown> | null)
          : null;
      const node: MarkdownBlock = {
        id: genId(),
        type: bulletText !== null ? "bulletListItem" : "numberedListItem",
        props: bnMeta
          ? ({ md: bnMeta } as unknown as Record<string, Json>)
          : undefined,
        content,
      };

      if (depth === 0) {
        root.push(node);
      } else {
        const parent = lastAtDepth[depth - 1];
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(node);
        } else {
          root.push(node);
        }
      }

      lastAtDepth[depth] = node;
      lastAtDepth.length = depth + 1;
      continue;
    }

    const heading = parseHeadingLine(line);
    if (heading) {
      root.push({
        id: genId(),
        type: "heading",
        props: { level: heading.level },
        content: toTextContent(heading.text),
      });
      lastAtDepth.length = 0;
      continue;
    }

    const paragraphLines = [line];
    let nextIdx = idx + 1;
    while (nextIdx < lines.length) {
      guard();
      if (lines[nextIdx].trim() === "" || isBlockBoundary(lines[nextIdx])) {
        break;
      }
      paragraphLines.push(lines[nextIdx]);
      nextIdx += 1;
    }

    idx = nextIdx - 1;
    const parts = parseInline(paragraphLines.join("\n"));
    const content =
      parts.length > 0
        ? parts.map((part) => ({ type: "text" as const, text: part.text, styles: {} }))
        : [];
    const bnMeta =
      parts.length === 1 ? (parts[0].meta as Record<string, unknown> | null) : null;

    root.push({
      id: genId(),
      type: "paragraph",
      props: bnMeta ? ({ md: bnMeta } as unknown as Record<string, Json>) : undefined,
      content,
    });
    lastAtDepth.length = 0;
  }

  return root;
}

const bridge = {
  blocksToBridgeMarkdown,
  bridgeMarkdownToBlocks,
};

export default bridge;
