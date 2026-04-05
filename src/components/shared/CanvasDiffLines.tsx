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
    return "bg-status-success-bg text-status-success-text";
  }
  if (type === "del") {
    return "bg-status-error-bg text-status-error-text";
  }
  return "text-text-subtle";
}

function segmentClasses(type: DiffLine["type"], changed: boolean): string {
  if (!changed) return "";
  if (type === "add") {
    return "bg-surface-subtle text-status-success-text";
  }
  if (type === "del") {
    return "bg-surface-subtle text-status-error-text";
  }
  return "";
}

export function CanvasDiffLines({
  lines,
  showWhitespace = false,
}: CanvasDiffLinesProps) {
  if (lines.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-text-muted">
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
          <span className="w-3 shrink-0 select-none text-text-muted">
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
