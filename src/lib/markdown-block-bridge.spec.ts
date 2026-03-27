import { describe, expect, it } from "vitest";
import {
  bridgeMarkdownToBlocks,
  blocksToBridgeMarkdown,
  MarkdownBridgeTimeoutError,
} from "@/lib/markdown-block-bridge";
import type { MarkdownBlock } from "@/lib/types";

function textOf(block: { content?: { text?: string }[] } | undefined) {
  return block?.content?.map((item) => item.text ?? "").join("") ?? "";
}

describe("markdown block bridge", () => {
  it("treats a partial ordered-list marker as a paragraph instead of hanging", () => {
    const blocks = bridgeMarkdownToBlocks("1.");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("paragraph");
    expect(textOf(blocks[0])).toBe("1.");
  });

  it("parses an empty ordered-list item when the marker is followed by whitespace", () => {
    const blocks = bridgeMarkdownToBlocks("1. ");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("numberedListItem");
    expect(textOf(blocks[0])).toBe("");
  });

  it("parses multi-digit ordered lists and nested children", () => {
    const blocks = bridgeMarkdownToBlocks("10. Parent\n  11. Child\n  - Nested bullet\n12. Sibling");

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.type).toBe("numberedListItem");
    expect(textOf(blocks[0])).toBe("Parent");
    expect(blocks[0]?.children?.map((child) => child.type)).toEqual([
      "numberedListItem",
      "bulletListItem",
    ]);
    expect(textOf(blocks[0]?.children?.[0])).toBe("Child");
    expect(textOf(blocks[0]?.children?.[1])).toBe("Nested bullet");
    expect(textOf(blocks[1])).toBe("Sibling");
  });

  it("keeps malformed ordered-list-like text as paragraph content", () => {
    const blocks = bridgeMarkdownToBlocks("1.two");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("paragraph");
    expect(textOf(blocks[0])).toBe("1.two");
  });

  it("round-trips numbered list blocks without changing list behavior", () => {
    const markdown = blocksToBridgeMarkdown([
      {
        id: "ordered-root",
        type: "numberedListItem",
        content: [{ type: "text", text: "Root", styles: {} }],
        children: [
          {
            id: "ordered-child",
            type: "numberedListItem",
            content: [{ type: "text", text: "Child", styles: {} }],
          },
        ],
      },
    ] as MarkdownBlock[]);

    expect(markdown).toBe("1. Root\n  1. Child");
    expect(bridgeMarkdownToBlocks(markdown)[0]?.children?.[0]?.type).toBe(
      "numberedListItem",
    );
  });

  it("fails fast with a timeout instead of getting stuck in a long parse", () => {
    expect(() => bridgeMarkdownToBlocks("1. Item", { timeoutMs: 0 })).toThrow(
      MarkdownBridgeTimeoutError,
    );
  });
});
