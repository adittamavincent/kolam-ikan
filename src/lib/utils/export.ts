import { EntryWithSections, BlockNoteBlock } from "@/lib/types";
import bridge from "@/lib/blocknote-markdown-bridge";

export function exportEntriesToMarkdown(entries: EntryWithSections[]): string {
  return entries.map(entryToMarkdown).join("\n\n---\n\n");
}

function entryToMarkdown(entry: EntryWithSections): string {
  const date = entry.created_at
    ? new Date(entry.created_at).toLocaleString()
    : "Unknown Date";

  const sections = entry.sections
    .map((section) => {
      const author = section.persona?.name || "Unknown Author";
      const content = blocksToMarkdown(
        section.content_json as unknown as BlockNoteBlock[],
      );
      return `### ${author}\n\n${content}`;
    })
    .join("\n\n");

  return `## Entry ${date}\n\n${sections}`;
}

function blocksToMarkdown(blocks: BlockNoteBlock[]): string {
  if (!Array.isArray(blocks)) return "";

  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    const text =
      block.content?.map((c: { text: string }) => c.text).join("") || "";

    if (block.type === "bulletListItem") {
      // collect consecutive bullet items and render as a single list
      const items: string[] = [];
      while (i < blocks.length && blocks[i].type === "bulletListItem") {
        const itemText =
          blocks[i].content?.map((c: { text: string }) => c.text).join("") || "";
        items.push(`- ${itemText}`);
        i++;
      }
      out.push(items.join("\n"));
      continue;
    }

    if (block.type === "numberedListItem") {
      const items: string[] = [];
      let num = 1;
      while (i < blocks.length && blocks[i].type === "numberedListItem") {
        const itemText =
          blocks[i].content?.map((c: { text: string }) => c.text).join("") || "";
        items.push(`${num}. ${itemText}`);
        num++;
        i++;
      }
      out.push(items.join("\n"));
      continue;
    }

    if (block.type === "heading") {
      const level = (block.props?.level as number) || 1;
      out.push(`${"#".repeat(level)} ${text}`);
      i++;
      continue;
    }

    // default: paragraph or other inline block
    out.push(text);
    i++;
  }

  // join blocks with a single blank line between block-level elements
  let md = out.join("\n\n");
  // normalize CRLF
  md = md.replace(/\r\n?/g, "\n");
  // ensure list markers use '-' and preserve indentation
  md = md.replace(/^(\s*)[*+]\s+/gm, "$1- ");
  // Prefer bridge output so exported markdown preserves custom metadata
  try {
    const bridged = bridge.blocksToBridgeMarkdown(blocks);
    if (bridged && bridged.trim().length > 0) return bridged;
  } catch {}
  return md;
}

export function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
