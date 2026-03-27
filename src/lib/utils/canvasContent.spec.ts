import { describe, expect, it } from "vitest";
import { areCanvasContentsEquivalent, normalizeCanvasContent } from "./canvasContent";

describe("canvasContent", () => {
  it("ignores markdown block ids, empty styles, and trailing empty paragraphs", () => {
    const canonical = [
      {
        id: "block-a",
        type: "paragraph",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [{ id: "text-a", type: "text", text: "Kolam", styles: {} }],
      },
    ];

    const roundTripped = [
      {
        id: "block-b",
        type: "paragraph",
        content: [{ id: "text-b", type: "text", text: "Kolam" }],
      },
      {
        id: "block-c",
        type: "paragraph",
        props: {
          textColor: "default",
          backgroundColor: "default",
          textAlignment: "left",
        },
        content: [],
      },
    ];

    expect(areCanvasContentsEquivalent(canonical, roundTripped)).toBe(true);
  });

  it("normalizes nested children with default props", () => {
    const a = [
      {
        id: "list-a",
        type: "bulletListItem",
        props: { textColor: "default", backgroundColor: "default" },
        content: [{ type: "text", text: "Alpha", styles: {} }],
        children: [
          {
            id: "child-a",
            type: "paragraph",
            props: { textAlignment: "left" },
            content: [{ type: "text", text: "Beta" }],
          },
        ],
      },
    ];

    const b = [
      {
        id: "list-b",
        type: "bulletListItem",
        content: [{ id: "text-b", type: "text", text: "Alpha" }],
        children: [
          {
            id: "child-b",
            type: "paragraph",
            content: [{ id: "text-c", type: "text", text: "Beta", styles: {} }],
          },
        ],
      },
    ];

    expect(normalizeCanvasContent(a)).toBe(normalizeCanvasContent(b));
  });

  it("still detects real content changes", () => {
    const before = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "One" }],
      },
    ];
    const after = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Two" }],
      },
    ];

    expect(areCanvasContentsEquivalent(before, after)).toBe(false);
  });

  it("treats null and empty canvas structures as equivalent", () => {
    expect(normalizeCanvasContent(null)).toBeNull();
    expect(normalizeCanvasContent([])).toBeNull();
    expect(
      areCanvasContentsEquivalent(null, [
        {
          type: "paragraph",
          content: [],
        },
      ]),
    ).toBe(true);
  });
});
