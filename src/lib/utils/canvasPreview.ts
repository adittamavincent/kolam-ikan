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

export type DiffLine = { type: "eq" | "add" | "del"; text: string };

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.unshift({ type: "eq", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      result.unshift({ type: "del", text: oldLines[i - 1] });
      i--;
    }
  }

  return result;
}
