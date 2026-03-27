import { describe, expect, it } from "vitest";
import {
  buildMarkdownTableModel,
  findMarkdownTableBlocks,
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
