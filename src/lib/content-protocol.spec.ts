import { describe, expect, it } from "vitest";
import {
  buildStoredContentPayload,
  storedContentToBlocks,
  storedContentToMarkdown,
} from "@/lib/content-protocol";

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

    expect(payload.content_format).toBe("markdown+blocknote-v1");
    expect(payload.raw_markdown).toContain("## Heading");
    expect(payload.raw_markdown).toContain("- Item");
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

  it("reconstructs blocks from markdown when json is missing", () => {
    const blocks = storedContentToBlocks({
      raw_markdown: "# Title\n\n- One",
      content_json: null,
    });

    expect(blocks[0]?.type).toBe("heading");
    expect(blocks[1]?.type).toBe("bulletListItem");
  });
});
