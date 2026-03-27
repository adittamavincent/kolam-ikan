import { describe, expect, it } from "vitest";
import { contentToDiffText, lineDiff } from "./canvasPreview";

describe("canvasPreview lineDiff", () => {
  it("adds inline changed segments for paired modified lines", () => {
    const diff = lineDiff("hello world", "hello there");
    const deleted = diff.find((line) => line.type === "del");
    const added = diff.find((line) => line.type === "add");

    expect(deleted?.segments).toEqual([
      { text: "hello ", changed: false },
      { text: "world", changed: true },
    ]);
    expect(added?.segments).toEqual([
      { text: "hello ", changed: false },
      { text: "there", changed: true },
    ]);
  });

  it("marks unmatched inserted lines as fully changed", () => {
    const diff = lineDiff("alpha", "alpha\nbeta");
    const added = diff.find((line) => line.type === "add");

    expect(added?.segments).toEqual([{ text: "beta", changed: true }]);
  });

  it("preserves markdown headings and blank lines when diffing raw markdown", () => {
    const before = contentToDiffText([], "debi tirar mas fotos\n# de cuando\n\nde tube");
    const after = contentToDiffText(
      [],
      "debi tirar mas fotos\n# de cuando\n\nde tube\n1. non",
    );

    const diff = lineDiff(before, after);

    expect(diff.map((line) => [line.type, line.text])).toEqual([
      ["eq", "debi tirar mas fotos"],
      ["eq", "# de cuando"],
      ["eq", ""],
      ["eq", "de tube"],
      ["add", "1. non"],
    ]);
  });

  it("falls back to block markdown when raw markdown is unavailable", () => {
    const text = contentToDiffText([
      {
        type: "heading",
        props: { level: 1 },
        content: [{ type: "text", text: "Title", styles: {} }],
      },
      { type: "paragraph", content: [] },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Body", styles: {} }],
      },
    ]);

    expect(text).toContain("# Title");
    expect(text).toContain("\n\nBody");
  });
});
