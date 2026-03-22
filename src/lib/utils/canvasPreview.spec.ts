import { describe, expect, it } from "vitest";
import { lineDiff } from "./canvasPreview";

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
});
