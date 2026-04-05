import { useMemo } from "react";
import type { PartialBlock } from "@/lib/types/editor";
import {
  contentToDiffText,
  lineDiff,
  type DiffLine,
} from "@/lib/utils/canvasPreview";

interface UseCanvasDiffInput {
  oldContent: PartialBlock[] | null | undefined;
  oldMarkdown?: string | null;
  newContent: PartialBlock[] | null | undefined;
  newMarkdown?: string | null;
}

interface UseCanvasDiffResult {
  diffs: DiffLine[];
  additions: number;
  deletions: number;
}

export function useCanvasDiff({
  oldContent,
  oldMarkdown,
  newContent,
  newMarkdown,
}: UseCanvasDiffInput): UseCanvasDiffResult {
  const diffs = useMemo(() => {
    const oldText = contentToDiffText(oldContent, oldMarkdown);
    const newText = contentToDiffText(newContent, newMarkdown);
    return lineDiff(oldText, newText);
  }, [oldContent, oldMarkdown, newContent, newMarkdown]);

  const additions = useMemo(
    () => diffs.filter((diff) => diff.type === "add").length,
    [diffs],
  );

  const deletions = useMemo(
    () => diffs.filter((diff) => diff.type === "del").length,
    [diffs],
  );

  return {
    diffs,
    additions,
    deletions,
  };
}
