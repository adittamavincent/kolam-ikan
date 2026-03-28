"use client";

import { DiffLine } from "@/lib/utils/canvasPreview";

interface CanvasDiffLinesProps {
  lines: DiffLine[];
  showWhitespace?: boolean;
}

function formatSegmentText(text: string, showWhitespace: boolean): string {
  if (!showWhitespace) return text;

  return text.replace(/ /g, "·").replace(/\t/g, "→   ");
}

function rowClasses(type: DiffLine["type"]): string {
  if (type === "add") {
    return "bg-emerald-500/8 text-emerald-600 dark:text-emerald-400";
  }
  if (type === "del") {
    return "bg-rose-500/8 text-rose-600 dark:text-rose-400";
  }
  return "text-text-subtle";
}

function segmentClasses(type: DiffLine["type"], changed: boolean): string {
  if (!changed) return "";
  if (type === "add") {
    return "bg-emerald-500/20 text-emerald-700 dark:bg-emerald-500/25 dark:text-emerald-200";
  }
  if (type === "del") {
    return "bg-rose-500/20 text-rose-700 dark:bg-rose-500/25 dark:text-rose-200";
  }
  return "";
}

export function CanvasDiffLines({
  lines,
  showWhitespace = false,
}: CanvasDiffLinesProps) {
  if (lines.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-text-muted">
        No differences.
      </div>
    );
  }

  return (
    <>
      {lines.map((line, index) => (
        <div
          key={`${line.type}-${index}`}
          className={`flex gap-3 px-4 py-0.5 leading-5 ${rowClasses(line.type)}`}
        >
          <span className="w-3 shrink-0 select-none text-text-muted opacity-60">
            {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
          </span>
          <span className="whitespace-pre-wrap wrap-break-word">
            {line.segments && line.segments.length > 0
              ? line.segments.map((segment, segmentIndex) => (
                  <span
                    key={`${line.type}-${index}-${segmentIndex}`}
                    className={segmentClasses(line.type, segment.changed)}
                  >
                    {formatSegmentText(segment.text, showWhitespace) || " "}
                  </span>
                ))
              : formatSegmentText(line.text, showWhitespace) || " "}
          </span>
        </div>
      ))}
    </>
  );
}
