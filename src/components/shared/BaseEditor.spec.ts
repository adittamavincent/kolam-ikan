import { describe, expect, it } from "vitest";
import {
  computeMarkdownListContinuation,
  getTableCellContentBounds,
  pickRectIndexFromAxis,
  resolveMeasuredTextPositionFromMeasuredCharacters,
  resolveTableCellSourceOffset,
  resolveVisibleOffsetFromMeasuredCharacters,
  shouldIgnoreOrderedListExtraSpace,
  shouldAutoInsertOrderedListSpace,
} from "@/components/shared/BaseEditor";

describe("computeMarkdownListContinuation", () => {
  it("continues ordered lists with incremented numbering", () => {
    expect(computeMarkdownListContinuation("1. First", "1. First".length)).toEqual({
      from: "1. First".length,
      nextMarker: "2. ",
      replacement: "\n2. ",
    });
  });

  it("preserves indentation for nested ordered lists", () => {
    expect(
      computeMarkdownListContinuation("  12. Nested", "  12. Nested".length),
    ).toEqual({
      from: "  12. Nested".length,
      nextMarker: "  13. ",
      replacement: "\n  13. ",
    });
  });

  it("exits an empty ordered list item instead of repeating the marker", () => {
    expect(computeMarkdownListContinuation("1. ", "1. ".length)).toEqual({
      from: 0,
      nextMarker: "",
      replacement: "",
    });
  });

  it("continues task list items as unchecked tasks", () => {
    expect(
      computeMarkdownListContinuation("- [x] Done", "- [x] Done".length),
    ).toEqual({
      from: "- [x] Done".length,
      nextMarker: "- [ ] ",
      replacement: "\n- [ ] ",
    });
  });

  it("ignores cursors inside the list marker prefix", () => {
    expect(computeMarkdownListContinuation("7. Item", 1)).toBeNull();
  });
});

describe("shouldAutoInsertOrderedListSpace", () => {
  it("adds a space after typing an ordered list marker at the start of a line", () => {
    expect(shouldAutoInsertOrderedListSpace("12", 2)).toBe(true);
  });

  it("supports indented ordered list markers", () => {
    expect(shouldAutoInsertOrderedListSpace("  3", 3)).toBe(true);
  });

  it("does not trigger in the middle of normal text", () => {
    expect(shouldAutoInsertOrderedListSpace("version 2", "version 2".length)).toBe(
      false,
    );
  });
});

describe("shouldIgnoreOrderedListExtraSpace", () => {
  it("ignores a manual space right after an auto-inserted ordered marker", () => {
    expect(shouldIgnoreOrderedListExtraSpace("1. ", "1. ".length)).toBe(true);
  });

  it("supports indented ordered markers", () => {
    expect(shouldIgnoreOrderedListExtraSpace("  3. ", "  3. ".length)).toBe(true);
  });

  it("does not block spaces once list content has started", () => {
    expect(shouldIgnoreOrderedListExtraSpace("1. hello", 3)).toBe(false);
  });
});

describe("resolveTableCellSourceOffset", () => {
  it("keeps table clicks anchored to rendered text instead of stretched cell width", () => {
    expect(
      resolveTableCellSourceOffset(
        {
          content: "Alex",
          paddingLeft: 1,
          rawEnd: 18,
          rawStart: 0,
        },
        [0, 1, 2, 3, 4],
        4,
      ),
    ).toBe(5);
  });

  it("respects leading markdown padding and clamps to the raw cell width", () => {
    expect(
      resolveTableCellSourceOffset(
        {
          content: "",
          paddingLeft: 3,
          rawEnd: 2,
          rawStart: 0,
        },
        [0],
        0,
      ),
    ).toBe(2);
  });
});

describe("resolveVisibleOffsetFromMeasuredCharacters", () => {
  it("clamps clicks in the empty right side of a left-aligned cell to the last character", () => {
    expect(
      resolveVisibleOffsetFromMeasuredCharacters(
        [
          { startOffset: 0, endOffset: 1, left: 0, right: 5, top: 0, bottom: 10 },
          { startOffset: 1, endOffset: 2, left: 5, right: 10, top: 0, bottom: 10 },
          { startOffset: 2, endOffset: 3, left: 10, right: 15, top: 0, bottom: 10 },
          { startOffset: 3, endOffset: 4, left: 15, right: 20, top: 0, bottom: 10 },
        ],
        80,
        5,
      ),
    ).toBe(4);
  });

  it("clamps clicks in the empty left side of a line to the first character", () => {
    expect(
      resolveVisibleOffsetFromMeasuredCharacters(
        [
          { startOffset: 0, endOffset: 1, left: 20, right: 25, top: 0, bottom: 10 },
          { startOffset: 1, endOffset: 2, left: 25, right: 30, top: 0, bottom: 10 },
        ],
        2,
        5,
      ),
    ).toBe(0);
  });

  it("selects the nearest rendered line before clamping horizontally", () => {
    expect(
      resolveVisibleOffsetFromMeasuredCharacters(
        [
          { startOffset: 0, endOffset: 1, left: 0, right: 5, top: 0, bottom: 10 },
          { startOffset: 1, endOffset: 2, left: 5, right: 10, top: 0, bottom: 10 },
          { startOffset: 2, endOffset: 3, left: 0, right: 5, top: 14, bottom: 24 },
          { startOffset: 3, endOffset: 4, left: 5, right: 10, top: 14, bottom: 24 },
        ],
        50,
        18,
      ),
    ).toBe(4);
  });
});

describe("getTableCellContentBounds", () => {
  it("uses the trimmed raw cell end so clicks after bold text land after the closing markdown", () => {
    expect(
      getTableCellContentBounds({
        paddingLeft: 1,
        rawContent: " **Beta Testing**    ",
        rawEnd: 21,
        rawStart: 0,
      }),
    ).toEqual({
      end: 17,
      start: 1,
    });
  });

  it("keeps plain-text cells ending before trailing padding spaces", () => {
    expect(
      getTableCellContentBounds({
        paddingLeft: 1,
        rawContent: " Low    ",
        rawEnd: 8,
        rawStart: 0,
      }),
    ).toEqual({
      end: 4,
      start: 1,
    });
  });
});

describe("resolveMeasuredTextPositionFromMeasuredCharacters", () => {
  it("marks clicks to the right of rendered text as after-text placement", () => {
    expect(
      resolveMeasuredTextPositionFromMeasuredCharacters(
        [
          { startOffset: 0, endOffset: 1, left: 0, right: 5, top: 0, bottom: 10 },
          { startOffset: 1, endOffset: 2, left: 5, right: 10, top: 0, bottom: 10 },
        ],
        80,
        5,
      ),
    ).toEqual({
      offset: 2,
      placement: "after",
    });
  });
});

describe("pickRectIndexFromAxis", () => {
  it("clamps points to the last rendered cell when clicking past the right edge", () => {
    expect(
      pickRectIndexFromAxis(
        [
          { start: 0, end: 100 },
          { start: 100, end: 200 },
          { start: 200, end: 300 },
        ],
        340,
      ),
    ).toBe(2);
  });

  it("keeps points in the middle of a rendered cell on that cell", () => {
    expect(
      pickRectIndexFromAxis(
        [
          { start: 0, end: 100 },
          { start: 100, end: 200 },
          { start: 200, end: 300 },
        ],
        175,
      ),
    ).toBe(1);
  });

  it("moves exact boundary clicks to the cell on the right", () => {
    expect(
      pickRectIndexFromAxis(
        [
          { start: 0, end: 100 },
          { start: 100, end: 200 },
        ],
        100,
      ),
    ).toBe(1);
  });
});
