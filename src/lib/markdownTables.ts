"use client";

import {
  Alignment,
  type TableCell,
  completeTable,
  formatTable,
  optionsWithDefaults,
  readTable,
  type Options,
} from "@tgrosinger/md-advanced-tables";

export type MarkdownTableAlignment = "left" | "center" | "right";

export type MarkdownTableRowModel = {
  cells: MarkdownTableCellModel[];
  isDelimiter: boolean;
};

export type MarkdownTableCellModel = {
  content: string;
  paddingLeft: number;
  rawContent: string;
  rawEnd: number;
  rawStart: number;
};

export type MarkdownTableModel = {
  alignments: MarkdownTableAlignment[];
  columnCount: number;
  lineCount: number;
  rows: MarkdownTableRowModel[];
  widths: number[];
};

export type MarkdownTableBlock = {
  end: number;
  model: MarkdownTableModel;
  start: number;
};

export type MarkdownTableAutoCreateResult = {
  cursorColumn: number;
  cursorLineIndex: number;
  lines: string[];
};

export const MARKDOWN_TABLE_OPTIONS: Options = optionsWithDefaults({});

const TABLE_DELIMITER_PATTERN =
  /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+(?:\s*:?-{3,}:?\s*)\|?\s*$/;
const HORIZONTAL_RULE_PATTERN = /^\s*(?:---+|\*\*\*+|___+)\s*$/;

const FENCE_PATTERN = /^(```|~~~)/;

function mapAlignment(alignment: Alignment | undefined): MarkdownTableAlignment {
  switch (alignment) {
    case Alignment.RIGHT:
      return "right";
    case Alignment.CENTER:
      return "center";
    default:
      return "left";
  }
}

function computeFormattedWidths(tableLines: string[]) {
  const formatted = formatTable(
    completeTable(readTable(tableLines, MARKDOWN_TABLE_OPTIONS), MARKDOWN_TABLE_OPTIONS)
      .table,
    MARKDOWN_TABLE_OPTIONS,
  ).table;
  const formattedRows = formatted.getRows();
  const columnCount = formatted.getWidth();

  return Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(
      3,
      ...formattedRows.map((row) => row.getCellAt(columnIndex)?.rawContent.length ?? 0),
    ),
  );
}

function findUnescapedPipes(line: string) {
  const positions: number[] = [];

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "|") continue;

    let backslashes = 0;
    for (let cursor = index - 1; cursor >= 0 && line[cursor] === "\\"; cursor -= 1) {
      backslashes += 1;
    }

    if (backslashes % 2 === 0) {
      positions.push(index);
    }
  }

  return positions;
}

function getCellRanges(line: string, expectedCellCount: number) {
  const pipes = findUnescapedPipes(line);
  const starts: number[] = [];
  const ends: number[] = [];

  if (pipes.length === 0) {
    starts.push(0);
    ends.push(line.length);
  } else {
    let segmentStart = pipes[0] === 0 ? 1 : 0;
    let pipeIndex = pipes[0] === 0 ? 1 : 0;

    while (pipeIndex < pipes.length) {
      const segmentEnd = pipes[pipeIndex];
      starts.push(segmentStart);
      ends.push(segmentEnd);
      segmentStart = pipes[pipeIndex] + 1;
      pipeIndex += 1;
    }

    if (pipes.at(-1) !== line.length - 1) {
      starts.push(segmentStart);
      ends.push(line.length);
    }
  }

  const ranges = starts.map((start, index) => ({
    rawEnd: ends[index] ?? line.length,
    rawStart: start,
  }));

  while (ranges.length < expectedCellCount) {
    ranges.push({
      rawEnd: line.length,
      rawStart: line.length,
    });
  }

  return ranges.slice(0, expectedCellCount);
}

function buildCellModel(cell: TableCell | undefined, line: string, rawStart: number, rawEnd: number) {
  const fallbackRaw = line.slice(rawStart, rawEnd);

  return {
    content: cell?.content ?? "",
    paddingLeft: cell?.paddingLeft ?? 0,
    rawContent: cell?.rawContent ?? fallbackRaw,
    rawEnd,
    rawStart,
  };
}

export function isMarkdownTableDelimiter(text: string) {
  return TABLE_DELIMITER_PATTERN.test(text);
}

export function isMarkdownHorizontalRule(text: string) {
  return HORIZONTAL_RULE_PATTERN.test(text);
}

export function buildMarkdownTableModel(
  tableLines: string[],
): MarkdownTableModel | null {
  if (tableLines.length < 2 || !isMarkdownTableDelimiter(tableLines[1])) {
    return null;
  }

  try {
    const completed = completeTable(
      readTable(tableLines, MARKDOWN_TABLE_OPTIONS),
      MARKDOWN_TABLE_OPTIONS,
    ).table;
    const delimiterRow = completed.getDelimiterRow();
    const columnCount = completed.getWidth();

    return {
      alignments: Array.from({ length: columnCount }, (_, index) =>
        mapAlignment(delimiterRow?.getCellAt(index)?.getAlignment()),
      ),
      columnCount,
      lineCount: tableLines.length,
      rows: completed.getRows().map((row, rowIndex) => {
        const line = tableLines[rowIndex] ?? "";
        const ranges = getCellRanges(line, columnCount);

        return {
          cells: Array.from({ length: columnCount }, (_, index) =>
            buildCellModel(
              row.getCellAt(index),
              line,
              ranges[index]?.rawStart ?? line.length,
              ranges[index]?.rawEnd ?? line.length,
            ),
          ),
          isDelimiter: row.isDelimiter(),
        };
      }),
      widths: computeFormattedWidths(tableLines),
    };
  } catch {
    return null;
  }
}

export function scanMarkdownTableBlock(
  lines: string[],
  startIndex: number,
): MarkdownTableBlock | null {
  if (
    startIndex + 1 >= lines.length ||
    !lines[startIndex].includes("|") ||
    !isMarkdownTableDelimiter(lines[startIndex + 1])
  ) {
    return null;
  }

  const tableLines = [lines[startIndex], lines[startIndex + 1]];
  let endIndex = startIndex + 2;

  while (
    endIndex < lines.length &&
    lines[endIndex].trim().length > 0 &&
    lines[endIndex].includes("|") &&
    !FENCE_PATTERN.test(lines[endIndex].trim())
  ) {
    tableLines.push(lines[endIndex]);
    endIndex += 1;
  }

  const model = buildMarkdownTableModel(tableLines);
  if (!model) return null;

  return {
    end: endIndex,
    model,
    start: startIndex,
  };
}

export function findMarkdownTableBlocks(lines: string[]) {
  const blocks: MarkdownTableBlock[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (FENCE_PATTERN.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) continue;

    const block = scanMarkdownTableBlock(lines, index);
    if (!block) continue;

    blocks.push(block);
    index = block.end - 1;
  }

  return blocks;
}

export function buildMarkdownTableFromHeaderLine(
  line: string,
): MarkdownTableAutoCreateResult | null {
  if (
    !line.includes("|") ||
    isMarkdownTableDelimiter(line) ||
    isMarkdownHorizontalRule(line)
  ) {
    return null;
  }

  try {
    const formatted = formatTable(
      completeTable(
        readTable([line, "| |"], MARKDOWN_TABLE_OPTIONS),
        MARKDOWN_TABLE_OPTIONS,
      ).table,
      MARKDOWN_TABLE_OPTIONS,
    ).table;
    const lines = formatted.getRows().map((row) => row.toText());
    const model = buildMarkdownTableModel(lines);

    if (!model || model.columnCount < 2 || model.rows.length < 3) {
      return null;
    }

    return {
      cursorColumn: model.rows[2]?.cells[0]?.rawStart ?? 0,
      cursorLineIndex: 2,
      lines,
    };
  } catch {
    return null;
  }
}
