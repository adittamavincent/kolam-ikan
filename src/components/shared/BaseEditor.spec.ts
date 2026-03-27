import { describe, expect, it } from "vitest";
import {
  computeMarkdownListContinuation,
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
