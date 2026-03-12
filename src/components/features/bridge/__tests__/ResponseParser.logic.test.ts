import { describe, it, expect } from "vitest";

// --- Test Personas ---
// Raka (chaotic student) pastes garbage into the response parser
// Ibu Sari (organized teacher) pastes valid AI output

// These functions are not exported from ResponseParser.tsx,
// so we re-implement the pure logic here for unit testing.
// If you later refactor these to a separate utils file, import directly.

import { z } from "zod";
import { BlockNoteBlock } from "@/lib/types";

const BlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  props: z.record(z.string(), z.any()).optional(),
  content: z.any().optional(),
  children: z.array(z.any()).optional(),
});

const BlockArraySchema = z.array(BlockSchema);

function extractBlockText(block: BlockNoteBlock): string {
  return block.content?.map((c) => c.text).join("") || "";
}

function toParagraphBlocks(text: string): BlockNoteBlock[] {
  const chunks = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (chunks.length === 0) {
    return [
      {
        id: "test-id",
        type: "paragraph",
        content: [{ type: "text" as const, text: text.trim() }],
      },
    ];
  }
  return chunks.map((chunk, i) => ({
    id: `test-id-${i}`,
    type: "paragraph",
    content: [{ type: "text" as const, text: chunk }],
  }));
}

function resolveIncomingBlocks(raw: string): {
  blocks: BlockNoteBlock[];
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { blocks: [] };
  }
  try {
    const parsed = JSON.parse(trimmed) as BlockNoteBlock[];
    const validated = BlockArraySchema.safeParse(parsed);
    if (!validated.success) {
      return { blocks: [], error: "Invalid BlockNote JSON" };
    }
    return { blocks: validated.data };
  } catch {
    return { blocks: [], error: "Canvas update is not valid JSON" };
  }
}

function applyDiffToBlocks(
  currentBlocks: BlockNoteBlock[],
  diffText: string,
): BlockNoteBlock[] {
  const lines = diffText.split("\n");
  const result = [...currentBlocks];

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("-")) {
      const contentToRemove = trimmedLine.slice(1).trim();
      if (!contentToRemove) return;
      const index = result.findIndex(
        (b) => extractBlockText(b).trim() === contentToRemove,
      );
      if (index !== -1) result.splice(index, 1);
    } else if (trimmedLine.startsWith("+")) {
      const contentToAdd = trimmedLine.slice(1).trim();
      const newBlocks = toParagraphBlocks(contentToAdd || " ");
      result.push(...newBlocks);
    }
  });
  return result;
}

describe("applyDiffToBlocks", () => {
  it("adds a new block with +", () => {
    const current: BlockNoteBlock[] = [];
    const diff = "+ # New Title";
    const result = applyDiffToBlocks(current, diff);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("paragraph"); // toParagraphBlocks in test is simple
  });

  it("removes an existing block with -", () => {
    const current: BlockNoteBlock[] = [
      {
        id: "b1",
        type: "paragraph",
        content: [{ type: "text", text: "Old content" }],
      },
    ];
    const diff = "- Old content";
    const result = applyDiffToBlocks(current, diff);
    expect(result).toHaveLength(0);
  });

  it("handles multiple changes", () => {
    const current: BlockNoteBlock[] = [
      {
        id: "b1",
        type: "paragraph",
        content: [{ type: "text", text: "Keep me" }],
      },
      {
        id: "b2",
        type: "paragraph",
        content: [{ type: "text", text: "Remove me" }],
      },
    ];
    const diff = "- Remove me\n+ Added line";
    const result = applyDiffToBlocks(current, diff);
    expect(result).toHaveLength(2);
    expect(extractBlockText(result[0])).toBe("Keep me");
    expect(extractBlockText(result[1])).toBe("Added line");
  });

  it("is robust to extra whitespace and missing spaces after marker", () => {
    const current: BlockNoteBlock[] = [
      {
        id: "b1",
        type: "paragraph",
        content: [{ type: "text", text: "Target" }],
      },
    ];
    const diff = "  -Target\n+NewItem";
    const result = applyDiffToBlocks(current, diff);
    expect(result).toHaveLength(1);
    expect(extractBlockText(result[0])).toBe("NewItem");
  });
});

function resolveCanvasBlocks(
  raw: string,
  currentBlocks: BlockNoteBlock[] = [],
): {
  blocks: BlockNoteBlock[];
  format: "json" | "markdown" | "diff";
  error?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { blocks: [], format: "markdown" };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const jsonResult = resolveIncomingBlocks(trimmed);
    if (!jsonResult.error) return { blocks: jsonResult.blocks, format: "json" };
  }

  const lines = trimmed.split("\n");

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
  const hasDiffMarkers = normalizedLines.some((l) => {
    const t = l.trim();
    return t.startsWith("+") || t.startsWith("-");
  });

  if (hasDiffMarkers) {
    return {
      blocks: applyDiffToBlocks(currentBlocks, normalizedText),
      format: "diff",
    };
  }

  return { blocks: toParagraphBlocks(trimmed), format: "markdown" };
}

describe("extractBlockText", () => {
  it("extracts text from a simple paragraph block", () => {
    const block: BlockNoteBlock = {
      id: "b1",
      type: "paragraph",
      content: [{ type: "text", text: "Hello world" }],
    };
    expect(extractBlockText(block)).toBe("Hello world");
  });

  it("concatenates multiple inline content items", () => {
    const block: BlockNoteBlock = {
      id: "b2",
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
      ],
    };
    expect(extractBlockText(block)).toBe("Hello world");
  });

  it("returns empty string for block without content", () => {
    const block: BlockNoteBlock = { id: "b3", type: "paragraph" };
    expect(extractBlockText(block)).toBe("");
  });

  it("returns empty string for block with empty content array", () => {
    const block: BlockNoteBlock = { id: "b4", type: "paragraph", content: [] };
    expect(extractBlockText(block)).toBe("");
  });
});

describe("toParagraphBlocks", () => {
  it("converts single-line text to one paragraph block", () => {
    const blocks = toParagraphBlocks("Hello world");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].content?.[0].text).toBe("Hello world");
  });

  it("splits text on double newlines into multiple paragraph blocks", () => {
    const blocks = toParagraphBlocks(
      "Paragraph one.\n\nParagraph two.\n\nParagraph three.",
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0].content?.[0].text).toBe("Paragraph one.");
    expect(blocks[1].content?.[0].text).toBe("Paragraph two.");
    expect(blocks[2].content?.[0].text).toBe("Paragraph three.");
  });

  it("handles text with only whitespace between paragraphs", () => {
    const blocks = toParagraphBlocks("A\n   \nB");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].content?.[0].text).toBe("A");
    expect(blocks[1].content?.[0].text).toBe("B");
  });

  it("handles empty string by creating one block with trimmed text", () => {
    const blocks = toParagraphBlocks("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content?.[0].text).toBe("");
  });

  it("trims whitespace from each paragraph chunk", () => {
    const blocks = toParagraphBlocks(
      "  Leading spaces  \n\n  Trailing spaces  ",
    );
    expect(blocks[0].content?.[0].text).toBe("Leading spaces");
    expect(blocks[1].content?.[0].text).toBe("Trailing spaces");
  });
});

describe("resolveIncomingBlocks", () => {
  // Ibu Sari pastes valid AI-generated JSON
  it("parses valid BlockNote JSON array", () => {
    const json = JSON.stringify([
      {
        id: "b1",
        type: "paragraph",
        content: [{ type: "text", text: "AI response" }],
      },
    ]);
    const result = resolveIncomingBlocks(json);
    expect(result.error).toBeUndefined();
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("paragraph");
  });

  it("parses multiple blocks", () => {
    const json = JSON.stringify([
      {
        id: "b1",
        type: "heading",
        content: [{ type: "text", text: "Title" }],
        props: { level: 1 },
      },
      {
        id: "b2",
        type: "paragraph",
        content: [{ type: "text", text: "Body text" }],
      },
    ]);
    const result = resolveIncomingBlocks(json);
    expect(result.error).toBeUndefined();
    expect(result.blocks).toHaveLength(2);
  });

  // Raka pastes plain text (not JSON)
  it("returns error for plain text input", () => {
    const result = resolveIncomingBlocks("hello world lol");
    expect(result.error).toBe("Canvas update is not valid JSON");
    expect(result.blocks).toHaveLength(0);
  });

  // Raka pastes valid JSON but wrong schema
  it("returns error for valid JSON that is not BlockNote format", () => {
    const result = resolveIncomingBlocks(
      JSON.stringify({ message: "not blocks" }),
    );
    expect(result.error).toBe("Invalid BlockNote JSON");
    expect(result.blocks).toHaveLength(0);
  });

  it("returns error for JSON array with invalid block objects", () => {
    const result = resolveIncomingBlocks(JSON.stringify([{ foo: "bar" }]));
    expect(result.error).toBe("Invalid BlockNote JSON");
  });

  // Empty input
  it("returns empty blocks for empty string", () => {
    const result = resolveIncomingBlocks("");
    expect(result.error).toBeUndefined();
    expect(result.blocks).toHaveLength(0);
  });

  it("returns empty blocks for whitespace-only string", () => {
    const result = resolveIncomingBlocks("   \n\n   ");
    expect(result.error).toBeUndefined();
    expect(result.blocks).toHaveLength(0);
  });

  // Raka pastes XSS attempt
  it("handles HTML/script injection in JSON gracefully", () => {
    const malicious = JSON.stringify([
      {
        id: "b1",
        type: "paragraph",
        content: [{ type: "text", text: '<script>alert("xss")</script>' }],
      },
    ]);
    const result = resolveIncomingBlocks(malicious);
    // Should parse successfully — sanitization happens at render time
    expect(result.error).toBeUndefined();
    expect(result.blocks).toHaveLength(1);
  });

  // Raka pastes truncated JSON
  it("returns error for truncated/incomplete JSON", () => {
    const result = resolveIncomingBlocks('[{"id":"b1","type":"para');
    expect(result.error).toBe("Canvas update is not valid JSON");
  });
});

describe("resolveCanvasBlocks", () => {
  it("normalizes * prefix to + for diff parsing", () => {
    const raw = "* # Title\n\n* ## Section\n* - Item one\n* - Item two";
    const result = resolveCanvasBlocks(raw);
    expect(result.format).toBe("diff");
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("treats standard + prefix as diff", () => {
    const raw = "+ # Title\n+ - Item";
    const result = resolveCanvasBlocks(raw);
    expect(result.format).toBe("diff");
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("falls back to markdown when no diff markers", () => {
    const raw = "# Just a heading\n\nSome paragraph text.";
    const result = resolveCanvasBlocks(raw);
    expect(result.format).toBe("markdown");
  });

  it("handles * prefix with blank lines between groups", () => {
    const raw =
      "* # Road Map\n\n* ## Section One\n\n* * **Bold item:** description";
    const result = resolveCanvasBlocks(raw);
    expect(result.format).toBe("diff");
    expect(result.blocks.length).toBe(3);
  });
});
