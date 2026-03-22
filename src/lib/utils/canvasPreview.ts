import { PartialBlock } from "@blocknote/core";

export const CANVAS_PREVIEW_OPEN_EVENT = "kolam_canvas_preview_open";

export interface CanvasPreviewOpenDetail {
  streamId: string;
  versionId: string;
  versionName: string;
  versionCreatedAt: string | null;
  content: PartialBlock[] | null;
}

export interface CanvasPreviewStashRecord {
  streamId: string;
  snapshotId: string;
  snapshotName: string;
  snapshotCreatedAt: string | null;
  stashedAt: string;
  draftContent: PartialBlock[] | null;
}

const STASH_KEY_PREFIX = "kolam_canvas_preview_stash_v1_";

export function canvasPreviewStashKey(streamId: string): string {
  return `${STASH_KEY_PREFIX}${streamId}`;
}

export function saveCanvasPreviewStash(
  streamId: string,
  record: CanvasPreviewStashRecord,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(canvasPreviewStashKey(streamId), JSON.stringify(record));
  } catch (error) {
    console.warn("Failed to save canvas preview stash", error);
  }
}

export function loadCanvasPreviewStash(
  streamId: string,
): CanvasPreviewStashRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(canvasPreviewStashKey(streamId));
    if (!raw) return null;
    return JSON.parse(raw) as CanvasPreviewStashRecord;
  } catch (error) {
    console.warn("Failed to read canvas preview stash", error);
    return null;
  }
}

export function blocksToPlainText(blocks: PartialBlock[] | null | undefined): string {
  const source = blocks ?? [];
  return source
    .map((block) => {
      const content = Array.isArray(block.content) ? block.content : [];
      return content
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") {
            const maybeText = (item as { text?: unknown }).text;
            if (typeof maybeText === "string") return maybeText;
          }
          return "";
        })
        .join("");
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export type DiffSegment = { text: string; changed: boolean };

export type DiffLine = {
  type: "eq" | "add" | "del";
  text: string;
  segments?: DiffSegment[];
};

type RawDiffLine = { type: "eq" | "add" | "del"; text: string };

function buildSequenceDiff(oldItems: string[], newItems: string[]): RawDiffLine[] {
  const m = oldItems.length;
  const n = newItems.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldItems[i - 1] === newItems[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: RawDiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldItems[i - 1] === newItems[j - 1]) {
      result.unshift({ type: "eq", text: oldItems[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", text: newItems[j - 1] });
      j--;
    } else {
      result.unshift({ type: "del", text: oldItems[i - 1] });
      i--;
    }
  }

  return result;
}

function compressSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return [];

  const compressed: DiffSegment[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const current = segments[i];
    const previous = compressed[compressed.length - 1];
    if (current.changed === previous.changed) {
      previous.text += current.text;
      continue;
    }
    compressed.push({ ...current });
  }

  return compressed;
}

function buildCharDiffSegments(
  oldText: string,
  newText: string,
): {
  oldSegments: DiffSegment[];
  newSegments: DiffSegment[];
} {
  const oldChars = Array.from(oldText);
  const newChars = Array.from(newText);
  const maxPrefix = Math.min(oldChars.length, newChars.length);
  let prefixLength = 0;

  while (
    prefixLength < maxPrefix &&
    oldChars[prefixLength] === newChars[prefixLength]
  ) {
    prefixLength++;
  }

  let oldSuffixIndex = oldChars.length - 1;
  let newSuffixIndex = newChars.length - 1;
  while (
    oldSuffixIndex >= prefixLength &&
    newSuffixIndex >= prefixLength &&
    oldChars[oldSuffixIndex] === newChars[newSuffixIndex]
  ) {
    oldSuffixIndex--;
    newSuffixIndex--;
  }

  const prefix = oldChars.slice(0, prefixLength).join("");
  const oldChanged = oldChars.slice(prefixLength, oldSuffixIndex + 1).join("");
  const newChanged = newChars.slice(prefixLength, newSuffixIndex + 1).join("");
  const suffix = oldChars.slice(oldSuffixIndex + 1).join("");

  const oldSegments = compressSegments(
    [
      prefix ? { text: prefix, changed: false } : null,
      oldChanged ? { text: oldChanged, changed: true } : null,
      suffix ? { text: suffix, changed: false } : null,
    ].filter((segment): segment is DiffSegment => segment !== null),
  );

  const newSegments = compressSegments(
    [
      prefix ? { text: prefix, changed: false } : null,
      newChanged ? { text: newChanged, changed: true } : null,
      suffix ? { text: suffix, changed: false } : null,
    ].filter((segment): segment is DiffSegment => segment !== null),
  );

  return {
    oldSegments,
    newSegments,
  };
}

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const rawLines = buildSequenceDiff(oldLines, newLines);
  const result: DiffLine[] = rawLines.map((line) => ({ ...line }));

  let start = 0;
  while (start < result.length) {
    if (result[start].type === "eq") {
      start++;
      continue;
    }

    let end = start;
    while (end < result.length && result[end].type !== "eq") {
      end++;
    }

    const deletedLines: Array<{ index: number; text: string }> = [];
    const addedLines: Array<{ index: number; text: string }> = [];

    for (let i = start; i < end; i++) {
      if (result[i].type === "del") {
        deletedLines.push({ index: i, text: result[i].text });
      } else if (result[i].type === "add") {
        addedLines.push({ index: i, text: result[i].text });
      }
    }

    const pairCount = Math.min(deletedLines.length, addedLines.length);
    for (let i = 0; i < pairCount; i++) {
      const deleted = deletedLines[i];
      const added = addedLines[i];
      const { oldSegments, newSegments } = buildCharDiffSegments(
        deleted.text,
        added.text,
      );

      result[deleted.index].segments = oldSegments;
      result[added.index].segments = newSegments;
    }

    for (let i = pairCount; i < deletedLines.length; i++) {
      const deleted = deletedLines[i];
      result[deleted.index].segments = [{ text: deleted.text, changed: true }];
    }

    for (let i = pairCount; i < addedLines.length; i++) {
      const added = addedLines[i];
      result[added.index].segments = [{ text: added.text, changed: true }];
    }

    start = end;
  }

  return result;
}
