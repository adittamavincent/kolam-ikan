import { BlockNoteBlock, BlockNoteContent } from "@/lib/types";
import type { Json } from "@/lib/types/database.types";

function escapeHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeHtml(str: string) {
  return str.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function genId() {
  return `bn-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

// Wrap text with a span that contains JSON metadata in `data-bn`
function wrapWithMeta(text: string, meta: Record<string, unknown> | null) {
  if (!meta || Object.keys(meta).length === 0) return text;
  const json = JSON.stringify(meta);
  const encoded = encodeURIComponent(json);
  return `<span data-bn="${encoded}">${escapeHtml(text)}</span>`;
}

export function blocksToBridgeMarkdown(blocks: BlockNoteBlock[]): string {
  if (!Array.isArray(blocks)) return "";

  const out: string[] = [];

  function renderBlock(block: BlockNoteBlock, indent = 0) {
    const indentStr = " ".repeat(indent);
    const text = (block.content || []).map(c => c.text).join("") || "";
    const meta = ((block.props as Record<string, unknown> | undefined)?.bn ?? null) as Record<string, unknown> | null;

    if (block.type === "bulletListItem") {
      out.push(`${indentStr}- ${wrapWithMeta(text, meta)}`);
      if (Array.isArray(block.children) && block.children.length > 0) {
        for (const child of block.children) renderBlock(child, indent + 2);
      }
      return;
    }

    if (block.type === "numberedListItem") {
      out.push(`${indentStr}1. ${wrapWithMeta(text, meta)}`);
      if (Array.isArray(block.children) && block.children.length > 0) {
        for (const child of block.children) renderBlock(child, indent + 2);
      }
      return;
    }

    if (block.type === "heading") {
      const level = (block.props && (block.props.level as number)) || 1;
      out.push(`${indentStr}${"#".repeat(level)} ${text}`);
      return;
    }

    // paragraph or other
    out.push(`${indentStr}${wrapWithMeta(text, meta)}`);
    if (Array.isArray(block.children) && block.children.length > 0) {
      for (const child of block.children) renderBlock(child, indent + 2);
    }
  }

  for (const b of blocks) renderBlock(b, 0);

  // join blocks with single blank line between top-level elements
  const joined: string[] = [];
  let i = 0;
  while (i < out.length) {
    if (/^\s*([-\d]+\.|-)\s+/.test(out[i])) {
      const group: string[] = [];
      while (i < out.length && (/^\s*([-\d]+\.|-)\s+/.test(out[i]) || /^\s+$/.test(out[i]))) {
        group.push(out[i]); i++;
      }
      joined.push(group.join("\n"));
      continue;
    }
    joined.push(out[i]);
    i++;
  }

  return joined.join("\n\n");
}

// Parse a markdown string produced by `blocksToBridgeMarkdown` into simple BlockNoteBlock[].
// This parser is intentionally minimal: it recognizes list item prefixes and the
// inline <span data-bn="...">...</span> wrappers produced above.
export function bridgeMarkdownToBlocks(markdown: string): BlockNoteBlock[] {
  if (!markdown) return [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");

  function parseInline(text: string): { text: string; meta: Record<string, unknown> | null }[] {
    const results: { text: string; meta: Record<string, unknown> | null }[] = [];
    const spanRe = /<span\s+data-bn="([^"]+)">([\s\S]*?)<\/span>/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = spanRe.exec(text)) !== null) {
      if (m.index > lastIndex) {
        results.push({ text: unescapeHtml(text.slice(lastIndex, m.index)), meta: null });
      }
      try {
        const decoded = decodeURIComponent(m[1]);
        const meta = JSON.parse(decoded);
        results.push({ text: unescapeHtml(m[2]), meta });
      } catch {
        results.push({ text: unescapeHtml(m[2]), meta: null });
      }
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) {
      results.push({ text: unescapeHtml(text.slice(lastIndex)), meta: null });
    }
    return results;
  }

  const root: BlockNoteBlock[] = [];
  const lastAtDepth: (BlockNoteBlock | undefined)[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.trim() === '') continue;

    const leading = line.match(/^(\s*)/);
    const leadingSpaces = leading ? leading[1].length : 0;
    const depth = Math.floor(leadingSpaces / 2);
    const trimmed = line.trim();

    const ul = trimmed.match(/^-(?:\s+)([\s\S]*)$/);
    const ol = trimmed.match(/^\d+\.(?:\s+)([\s\S]*)$/);
    if (ul || ol) {
      const raw = (ul ? ul[1] : ol![1]);
      const parts = parseInline(raw);
      const content: BlockNoteContent[] = parts.map(p => ({ type: 'text', text: p.text, styles: {} }));
      const bnMeta = parts.length === 1 ? (parts[0].meta as Record<string, unknown> | null) : null;
      const node: BlockNoteBlock = { id: genId(), type: ul ? 'bulletListItem' : 'numberedListItem', props: bnMeta ? ({ bn: bnMeta } as unknown as Record<string, Json>) : undefined, content };

      if (depth === 0) {
        root.push(node);
        lastAtDepth[0] = node;
      } else {
        const parent = lastAtDepth[depth - 1];
        if (parent) {
          parent.children = parent.children || [];
          parent.children.push(node);
          lastAtDepth[depth] = node;
        } else {
          // fallback: attach to root
          root.push(node);
          lastAtDepth[depth] = node;
        }
      }
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      root.push({ id: genId(), type: 'heading', props: { level }, content: [{ type: 'text', text: h[2], styles: {} }] });
      continue;
    }

    // paragraph
    let j = idx;
    const paraLines: string[] = [];
    while (j < lines.length && lines[j].trim() !== '' && !/^\s*[-\d]+\./.test(lines[j])) {
      paraLines.push(lines[j]); j++;
    }
    idx = j - 1;
    const joined = paraLines.join('\n');
    const parts = parseInline(joined);
    const content: BlockNoteContent[] = parts.map(p => ({ type: 'text', text: p.text, styles: {} }));
    const bnMeta = parts.length === 1 ? (parts[0].meta as Record<string, unknown> | null) : null;
    root.push({ id: genId(), type: 'paragraph', props: bnMeta ? ({ bn: bnMeta } as unknown as Record<string, Json>) : undefined, content });
  }

  return root;
}

const bridge = {
  blocksToBridgeMarkdown,
  bridgeMarkdownToBlocks,
};

export default bridge;
