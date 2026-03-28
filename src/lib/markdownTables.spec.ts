import { describe, expect, it } from "vitest";
import {
  buildMarkdownTableModel,
  findMarkdownTableBlocks,
  isMarkdownHorizontalRule,
} from "@/lib/markdownTables";

describe("buildMarkdownTableModel", () => {
  it("captures alignments and normalized row cells", () => {
    const model = buildMarkdownTableModel([
      "| Name | Score | Status |",
      "| :--- | ---: | :----: |",
      "| Ada | 42 | Ready |",
    ]);

    expect(model).not.toBeNull();
    expect(model?.columnCount).toBe(3);
    expect(model?.alignments).toEqual(["left", "right", "center"]);
    expect(model?.rows[0].cells.map((cell) => cell.content)).toEqual([
      "Name",
      "Score",
      "Status",
    ]);
    expect(model?.rows[2].cells.map((cell) => cell.content)).toEqual([
      "Ada",
      "42",
      "Ready",
    ]);
    expect(model?.rows[2].cells[0]).toMatchObject({
      content: "Ada",
      rawContent: " Ada ",
    });
    expect(model?.widths).toHaveLength(3);
  });

  it("keeps raw cell ranges aligned with columns for leading-pipe rows", () => {
    const model = buildMarkdownTableModel([
      "| :---                | :---   | :---       | :---        | :---   |",
      "| ------------------- | ------ | ---------- | ----------- | ------ |",
      "| **Beta Testing**    | Sam    | 2026-05-20 | Not Started | Low    |",
    ]);

    expect(model).not.toBeNull();
    expect(model?.rows[2].cells.map((cell) => [cell.rawStart, cell.rawEnd])).toEqual([
      [1, 22],
      [23, 31],
      [32, 44],
      [45, 58],
      [59, 67],
    ]);
    expect(model?.rows[2].cells.map((cell) => cell.rawContent)).toEqual([
      " **Beta Testing**    ",
      " Sam    ",
      " 2026-05-20 ",
      " Not Started ",
      " Low    ",
    ]);
  });
});

describe("findMarkdownTableBlocks", () => {
  it("finds markdown tables outside fenced code blocks", () => {
    const blocks = findMarkdownTableBlocks([
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```md",
      "| ignored | row |",
      "| --- | --- |",
      "| 3 | 4 |",
      "```",
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.start).toBe(0);
    expect(blocks[0]?.end).toBe(3);
  });
});

describe("isMarkdownHorizontalRule", () => {
  it("accepts common thematic break syntaxes", () => {
    expect(isMarkdownHorizontalRule("---")).toBe(true);
    expect(isMarkdownHorizontalRule("***")).toBe(true);
    expect(isMarkdownHorizontalRule("___")).toBe(true);
    expect(isMarkdownHorizontalRule("  ----  ")).toBe(true);
  });

  it("rejects shorter or mixed punctuation", () => {
    expect(isMarkdownHorizontalRule("--")).toBe(false);
    expect(isMarkdownHorizontalRule("-*-")).toBe(false);
    expect(isMarkdownHorizontalRule("text ---")).toBe(false);
  });
});
