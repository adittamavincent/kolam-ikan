import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStoredContentPayload,
  storedContentToBlocks,
  storedContentToMarkdown,
} from "@/lib/content-protocol";
import bridge from "@/lib/markdown-block-bridge";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("content protocol", () => {
  it("serializes blocks into markdown-first storage payloads", () => {
    const payload = buildStoredContentPayload([
      {
        id: "b1",
        type: "heading",
        props: { level: 2 },
        content: [{ type: "text", text: "Heading", styles: {} }],
      },
      {
        id: "b2",
        type: "bulletListItem",
        content: [{ type: "text", text: "Item", styles: {} }],
      },
    ]);

    expect(payload.content_format).toBe("markdown-v1");
    expect(payload.raw_markdown).toContain("## Heading");
    expect(payload.raw_markdown).toContain("- Item");
  });

  it("preserves exact raw markdown when provided explicitly", () => {
    const rawMarkdown = "1. first\n2.  second\n\n   10. nested-ish";
    const payload = buildStoredContentPayload([], rawMarkdown);

    expect(payload.raw_markdown).toBe(rawMarkdown);
  });

  it("prefers stored markdown when it exists", () => {
    const markdown = "# Title\n\n- One";

    expect(
      storedContentToMarkdown({
        raw_markdown: markdown,
        content_json: [],
      }),
    ).toBe(markdown);
  });

  it("preserves trailing spaces needed for an in-progress ordered list marker", () => {
    expect(
      storedContentToMarkdown({
        raw_markdown: "1. ",
        content_json: [],
      }),
    ).toBe("1. ");
  });

  it("reconstructs blocks from markdown when json is missing", () => {
    const blocks = storedContentToBlocks({
      raw_markdown: "# Title\n\n- One",
      content_json: null,
    });

    expect(blocks[0]?.type).toBe("heading");
    expect(blocks[1]?.type).toBe("bulletListItem");
  });

  it("falls back to plain markdown parsing when the bridge throws", () => {
    vi.spyOn(bridge, "bridgeMarkdownToBlocks").mockImplementation(() => {
      throw new Error("bridge timeout");
    });

    const blocks = storedContentToBlocks({
      raw_markdown: "10. Item",
      content_json: null,
    });

    expect(blocks).toEqual([
      {
        type: "numberedListItem",
        content: [{ type: "text", text: "Item", styles: {} }],
      },
    ]);
  });
});
