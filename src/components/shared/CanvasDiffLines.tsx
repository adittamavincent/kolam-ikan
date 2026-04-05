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
    return "bg-emerald-100 text-emerald-700";
  }
  if (type === "del") {
    return "bg-rose-100 text-rose-700";
  }
  return "text-slate-600";
}

function segmentClasses(type: DiffLine["type"], changed: boolean): string {
  if (!changed) return "";
  if (type === "add") {
    return "bg-slate-50 text-emerald-700";
  }
  if (type === "del") {
    return "bg-slate-50 text-rose-700";
  }
  return "";
}

export function CanvasDiffLines({
  lines,
  showWhitespace = false,
}: CanvasDiffLinesProps) {
  if (lines.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-slate-500">
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
          <span className="w-3 shrink-0 select-none text-slate-500">
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
