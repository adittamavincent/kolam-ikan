"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type StateCommand,
} from "@codemirror/state";
import { autocompletion } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
} from "@codemirror/commands";
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { searchKeymap } from "@codemirror/search";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  drawSelection,
  keymap,
  placeholder as placeholderExtension,
} from "@codemirror/view";
import {
  Point as MarkdownPoint,
  Range as MarkdownRange,
  TableEditor,
} from "@tgrosinger/md-advanced-tables";
import { tags } from "@lezer/highlight";
import { blocksToStoredMarkdown, storedContentToBlocks } from "@/lib/content-protocol";
import {
  MARKDOWN_TABLE_OPTIONS,
  buildMarkdownTableFromHeaderLine,
  findMarkdownTableBlocks,
  isMarkdownHorizontalRule,
  type MarkdownTableCellModel,
  type MarkdownTableAlignment,
  type MarkdownTableRowModel,
} from "@/lib/markdownTables";
import {
  extractFrontmatter,
  normalizeFrontmatterKey,
  default as KolamRenderedMarkdown,
} from "@/components/shared/KolamRenderedMarkdown";
import type {
  MarkdownEditorProps,
  MarkdownEditorHandle,
} from "@/components/shared/MarkdownEditor";

export type BaseEditorProps = MarkdownEditorProps;

const hiddenSyntax = Decoration.replace({});

class ListMarkerWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly className: string,
    private readonly widthCh?: number,
  ) {
    super();
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.className;
    marker.textContent = this.label;
    if (
      this.className.includes("cm-kolam-ordered-marker") &&
      typeof this.widthCh === "number"
    ) {
      marker.style.setProperty(
        "--kolam-list-marker-width",
        `${this.widthCh}ch`,
      );
    }
    return marker;
  }
}

class TaskMarkerWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-kolam-task-marker";

    const checkbox = document.createElement("input");
    checkbox.checked = this.checked;
    checkbox.disabled = true;
    checkbox.tabIndex = -1;
    checkbox.type = "checkbox";

    wrapper.appendChild(checkbox);
    return wrapper;
  }
}

function appendInlineMarkdown(target: HTMLElement, text: string) {
  const pattern =
    /(\[\[([^[\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|==([^=]+)==|~~([^~]+)~~|\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|%%([\s\S]*?)%%)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const offsetMap: number[] = [];

  const appendSegment = (
    visibleText: string,
    sourceStart: number,
    sourceLength: number,
    render: (text: string) => void,
  ) => {
    if (visibleText.length === 0) return;
    render(visibleText);

    if (offsetMap.length === 0) {
      offsetMap.push(sourceStart);
    }

    for (let index = 0; index < visibleText.length; index += 1) {
      offsetMap.push(sourceStart + index + 1);
    }

    offsetMap[offsetMap.length - 1] = sourceStart + sourceLength;
  };

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plainText = text.slice(lastIndex, match.index);
      appendSegment(plainText, lastIndex, plainText.length, (value) => {
        target.append(document.createTextNode(value));
      });
    }

    if (match[13]) {
      lastIndex = pattern.lastIndex;
      continue;
    }

    if (match[2]) {
      const mention = document.createElement("span");
      mention.className = "cm-kolam-table-inline-link";
      appendSegment(match[2], match.index + 2, match[2].length, (value) => {
        mention.textContent = value;
        target.appendChild(mention);
      });
    } else if (match[3] && match[4]) {
      const link = document.createElement("a");
      link.className = "cm-kolam-table-inline-link";
      link.href = match[4];
      link.rel = "noreferrer";
      link.target = "_blank";
      appendSegment(match[3], match.index + 1, match[3].length, (value) => {
        link.textContent = value;
        target.appendChild(link);
      });
    } else if (match[5]) {
      const code = document.createElement("code");
      code.className = "cm-kolam-table-inline-code";
      appendSegment(match[5], match.index + 1, match[5].length, (value) => {
        code.textContent = value;
        target.appendChild(code);
      });
    } else if (match[6]) {
      const mark = document.createElement("mark");
      appendSegment(match[6], match.index + 2, match[6].length, (value) => {
        mark.textContent = value;
        target.appendChild(mark);
      });
    } else if (match[7]) {
      const del = document.createElement("del");
      appendSegment(match[7], match.index + 2, match[7].length, (value) => {
        del.textContent = value;
        target.appendChild(del);
      });
    } else if (match[8]) {
      const strong = document.createElement("strong");
      const em = document.createElement("em");
      appendSegment(match[8], match.index + 3, match[8].length, (value) => {
        em.textContent = value;
        strong.appendChild(em);
        target.appendChild(strong);
      });
    } else if (match[9] || match[10]) {
      const strong = document.createElement("strong");
      const content = match[9] ?? match[10] ?? "";
      appendSegment(content, match.index + 2, content.length, (value) => {
        strong.textContent = value;
        target.appendChild(strong);
      });
    } else if (match[11] || match[12]) {
      const em = document.createElement("em");
      const content = match[11] ?? match[12] ?? "";
      appendSegment(content, match.index + 1, content.length, (value) => {
        em.textContent = value;
        target.appendChild(em);
      });
    } else {
      appendSegment(match[0], match.index, match[0].length, (value) => {
        target.append(document.createTextNode(value));
      });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    const plainText = text.slice(lastIndex);
    appendSegment(plainText, lastIndex, plainText.length, (value) => {
      target.append(document.createTextNode(value));
    });
  }

  return offsetMap.length > 0 ? offsetMap : [0];
}

function getVisibleOffsetFromPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const getProportionalOffset = () => {
    const visibleLength = root.textContent?.length ?? 0;
    if (visibleLength === 0) {
      return 0;
    }

    const rect = root.getBoundingClientRect();
    if (rect.width <= 0) {
      return visibleLength;
    }

    const styles = root.ownerDocument.defaultView?.getComputedStyle(root);
    const paddingLeft = Number.parseFloat(styles?.paddingLeft ?? "0") || 0;
    const paddingRight = Number.parseFloat(styles?.paddingRight ?? "0") || 0;
    const contentStart = rect.left + paddingLeft;
    const contentEnd = Math.max(contentStart, rect.right - paddingRight);
    const contentWidth = Math.max(1, contentEnd - contentStart);
    const clampedX = Math.max(contentStart, Math.min(clientX, contentEnd));
    const ratio = (clampedX - contentStart) / contentWidth;
    return Math.round(ratio * visibleLength);
  };

  const doc = root.ownerDocument;
  const anyDoc = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offset: number; offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  let node: Node | null = null;
  let offset = 0;

  const caretPosition = anyDoc.caretPositionFromPoint?.(clientX, clientY);
  if (caretPosition) {
    node = caretPosition.offsetNode;
    offset = caretPosition.offset;
  } else {
    const range = anyDoc.caretRangeFromPoint?.(clientX, clientY) ?? null;
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node || !root.contains(node)) {
    return getProportionalOffset();
  }

  try {
    const range = doc.createRange();
    range.setStart(root, 0);
    range.setEnd(node, offset);
    return Math.max(
      0,
      Math.min(range.toString().length, root.textContent?.length ?? 0),
    );
  } catch {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let visibleOffset = 0;

    while (walker.nextNode()) {
      const current = walker.currentNode;
      const length = current.textContent?.length ?? 0;

      if (current === node) {
        return visibleOffset + Math.min(offset, length);
      }

      visibleOffset += length;
    }
  }

  return getProportionalOffset();
}

type TableCellBinding = {
  cell: MarkdownTableCellModel;
  element: HTMLTableCellElement;
  lineNumber: number;
  offsetMap: number[];
};

type MeasuredVisibleCharacter = {
  bottom: number;
  endOffset: number;
  left: number;
  right: number;
  startOffset: number;
  top: number;
};

type MeasuredVisibleOffsetResult =
  | {
      offset: number;
      placement: "inside";
    }
  | {
      offset: number;
      placement: "before" | "after";
    };

type AxisRect = {
  end: number;
  start: number;
};

type LivePreviewRevealRange = {
  from: number;
  to: number;
};

const livePreviewRevealEffect = StateEffect.define<LivePreviewRevealRange | null>({
  map: (value, changes) =>
    value
      ? {
          from: changes.mapPos(value.from),
          to: changes.mapPos(value.to),
        }
      : null,
});

function selectionIntersectsRange(
  selection: EditorSelection,
  from: number,
  to: number,
) {
  return selection.ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from <= to;
    }

    return range.from <= to && range.to >= from;
  });
}

function rangesOverlap(
  leftFrom: number,
  leftTo: number,
  rightFrom: number,
  rightTo: number,
) {
  return leftFrom <= rightTo && leftTo >= rightFrom;
}

const livePreviewRevealField = StateField.define<LivePreviewRevealRange | null>({
  create: () => null,
  update: (value, transaction) => {
    let next = value
      ? {
          from: transaction.changes.mapPos(value.from),
          to: transaction.changes.mapPos(value.to),
        }
      : null;
    let didExplicitReveal = false;

    for (const effect of transaction.effects) {
      if (effect.is(livePreviewRevealEffect)) {
        next = effect.value;
        didExplicitReveal = true;
      }
    }

    if (!next || next.from >= next.to) {
      return null;
    }

    if (didExplicitReveal) {
      return next;
    }

    return selectionIntersectsRange(transaction.state.selection, next.from, next.to)
      ? next
      : null;
  },
});

function dispatchPreviewSelection(
  view: EditorView,
  anchor: number,
  previewRange: LivePreviewRevealRange | null,
  options: {
    preserveScroll?: boolean;
    scrollIntoView?: boolean;
  } = {},
) {
  const { preserveScroll = false, scrollIntoView = true } = options;
  const effects = [];
  if (previewRange) {
    effects.push(livePreviewRevealEffect.of(previewRange));
  }
  if (preserveScroll) {
    effects.push(view.scrollSnapshot());
  }

  view.dispatch({
    effects,
    scrollIntoView: preserveScroll ? false : scrollIntoView,
    selection: EditorSelection.cursor(anchor),
  });
  view.focus();
}

export function resolveTableCellSourceOffset(
  cell: Pick<MarkdownTableCellModel, "content" | "paddingLeft" | "rawEnd" | "rawStart">,
  offsetMap: number[],
  visibleOffset: number,
) {
  const rawCellWidth = Math.max(0, cell.rawEnd - cell.rawStart);
  const boundedVisibleOffset = Math.max(
    0,
    Math.min(visibleOffset, Math.max(0, offsetMap.length - 1)),
  );
  const visibleSourceOffset =
    cell.paddingLeft + (offsetMap[boundedVisibleOffset] ?? cell.content.length);

  return Math.max(0, Math.min(visibleSourceOffset, rawCellWidth));
}

export function pickRectIndexFromAxis(rects: AxisRect[], point: number) {
  if (rects.length === 0) {
    return -1;
  }

  if (point <= rects[0].start) {
    return 0;
  }

  for (let index = 0; index < rects.length - 1; index += 1) {
    const boundary = (rects[index].end + rects[index + 1].start) / 2;
    if (point < boundary) {
      return index;
    }
  }

  return rects.length - 1;
}

export function getTableCellContentBounds(
  cell: Pick<MarkdownTableCellModel, "paddingLeft" | "rawContent" | "rawEnd" | "rawStart">,
) {
  const rawCellWidth = Math.max(0, cell.rawEnd - cell.rawStart);
  const trailingWhitespace = cell.rawContent.match(/\s*$/)?.[0].length ?? 0;
  const start = Math.max(0, Math.min(cell.paddingLeft, rawCellWidth));
  const end = Math.max(start, Math.min(rawCellWidth - trailingWhitespace, rawCellWidth));

  return { end, start };
}

export function resolveMeasuredTextPositionFromMeasuredCharacters(
  measuredCharacters: MeasuredVisibleCharacter[],
  clientX: number,
  clientY: number,
) : MeasuredVisibleOffsetResult | null {
  if (measuredCharacters.length === 0) {
    return null;
  }

  const sortedCharacters = [...measuredCharacters].sort((left, right) => {
    if (left.top !== right.top) return left.top - right.top;
    if (left.left !== right.left) return left.left - right.left;
    return left.startOffset - right.startOffset;
  });

  const lines: Array<{
    bottom: number;
    chars: MeasuredVisibleCharacter[];
    left: number;
    right: number;
    top: number;
  }> = [];

  for (const character of sortedCharacters) {
    const lastLine = lines.at(-1);
    const overlapsLastLine =
      lastLine &&
      character.top <= lastLine.bottom + 2 &&
      character.bottom >= lastLine.top - 2;

    if (overlapsLastLine && lastLine) {
      lastLine.chars.push(character);
      lastLine.left = Math.min(lastLine.left, character.left);
      lastLine.right = Math.max(lastLine.right, character.right);
      lastLine.top = Math.min(lastLine.top, character.top);
      lastLine.bottom = Math.max(lastLine.bottom, character.bottom);
      continue;
    }

    lines.push({
      bottom: character.bottom,
      chars: [character],
      left: character.left,
      right: character.right,
      top: character.top,
    });
  }

  const targetLine =
    lines.reduce<{
      distance: number;
      line: (typeof lines)[number];
    } | null>((nearest, line) => {
      const dy =
        clientY < line.top
          ? line.top - clientY
          : clientY > line.bottom
            ? clientY - line.bottom
            : 0;
      const dx =
        clientX < line.left
          ? line.left - clientX
          : clientX > line.right
            ? clientX - line.right
            : 0;
      const distance = Math.hypot(dx, dy);

      if (!nearest || distance < nearest.distance) {
        return { distance, line };
      }

      return nearest;
    }, null)?.line ?? lines[0];

  const lineCharacters = [...targetLine.chars].sort((left, right) => {
    if (left.left !== right.left) return left.left - right.left;
    return left.startOffset - right.startOffset;
  });
  const firstCharacter = lineCharacters[0];
  const lastCharacter = lineCharacters.at(-1) ?? firstCharacter;

  if (clientX <= firstCharacter.left) {
    return {
      offset: firstCharacter.startOffset,
      placement: "before",
    };
  }

  if (clientX >= lastCharacter.right) {
    return {
      offset: lastCharacter.endOffset,
      placement: "after",
    };
  }

  for (const character of lineCharacters) {
    if (clientX >= character.left && clientX <= character.right) {
      const midpoint = (character.left + character.right) / 2;
      return {
        offset: clientX <= midpoint ? character.startOffset : character.endOffset,
        placement: "inside",
      };
    }
  }

  const nearestCharacter =
    lineCharacters.reduce<{
      character: MeasuredVisibleCharacter;
      distance: number;
    } | null>((nearest, character) => {
      const distance =
        clientX < character.left
          ? character.left - clientX
          : clientX > character.right
            ? clientX - character.right
            : 0;

      if (!nearest || distance < nearest.distance) {
        return { character, distance };
      }

      return nearest;
    }, null)?.character ?? lastCharacter;

  return {
    offset:
      clientX <= nearestCharacter.left
        ? nearestCharacter.startOffset
        : nearestCharacter.endOffset,
    placement: "inside",
  };
}

export function resolveVisibleOffsetFromMeasuredCharacters(
  measuredCharacters: MeasuredVisibleCharacter[],
  clientX: number,
  clientY: number,
) {
  return (
    resolveMeasuredTextPositionFromMeasuredCharacters(
      measuredCharacters,
      clientX,
      clientY,
    )?.offset ?? null
  );
}

function measureVisibleCharacters(root: HTMLElement) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const measuredCharacters: MeasuredVisibleCharacter[] = [];

  let visibleOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? "";

    for (let index = 0; index < text.length; index += 1) {
      const range = doc.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);

      const rects = Array.from(range.getClientRects()).filter(
        (rect) => rect.width > 0 || rect.height > 0,
      );
      if (rects.length === 0) {
        continue;
      }

      measuredCharacters.push({
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
        endOffset: visibleOffset + index + 1,
        left: Math.min(...rects.map((rect) => rect.left)),
        right: Math.max(...rects.map((rect) => rect.right)),
        startOffset: visibleOffset + index,
        top: Math.min(...rects.map((rect) => rect.top)),
      });
    }

    visibleOffset += text.length;
  }

  return measuredCharacters;
}

function getVisibleTextOffsetFromPoint(
  root: HTMLElement,
  clientX: number,
  clientY: number,
) {
  const measuredCharacters = measureVisibleCharacters(root);
  const measuredPosition = resolveMeasuredTextPositionFromMeasuredCharacters(
    measuredCharacters,
    clientX,
    clientY,
  );

  if (measuredPosition !== null) {
    return measuredPosition;
  }

  return {
    offset: getVisibleOffsetFromPoint(root, clientX, clientY),
    placement: "inside" as const,
  };
}

function getDistanceToRect(rect: DOMRect, clientX: number, clientY: number) {
  const dx =
    clientX < rect.left
      ? rect.left - clientX
      : clientX > rect.right
        ? clientX - rect.right
        : 0;
  const dy =
    clientY < rect.top
      ? rect.top - clientY
      : clientY > rect.bottom
        ? clientY - rect.bottom
        : 0;

  return Math.hypot(dx, dy);
}

function findTableCellBindingFromPoint(
  table: HTMLTableElement,
  bindings: TableCellBinding[],
  clientX: number,
  clientY: number,
) {
  const tableRect = table.getBoundingClientRect();
  if (
    clientX < tableRect.left - 1 ||
    clientX > tableRect.right + 1 ||
    clientY < tableRect.top - 1 ||
    clientY > tableRect.bottom + 1
  ) {
    return null;
  }

  const documentAtPoint = table.ownerDocument;
  const elementsAtPoint =
    documentAtPoint.elementsFromPoint?.(clientX, clientY) ??
    [documentAtPoint.elementFromPoint(clientX, clientY)].filter(
      (element): element is Element => Boolean(element),
    );
  const bindingByElement = new Map(bindings.map((binding) => [binding.element, binding]));

  for (const element of elementsAtPoint) {
    const candidate =
      element instanceof HTMLTableCellElement
        ? element
        : element.closest("th, td");

    if (
      candidate instanceof HTMLTableCellElement &&
      table.contains(candidate)
    ) {
      const binding = bindingByElement.get(candidate);
      if (binding) {
        return binding;
      }
    }
  }

  const rows = Array.from(table.querySelectorAll("tr")).filter(
    (row): row is HTMLTableRowElement => row.children.length > 0,
  );
  const rowIndex = pickRectIndexFromAxis(
    rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        end: rect.bottom,
        start: rect.top,
      };
    }),
    clientY,
  );

  if (rowIndex >= 0) {
    const row = rows[rowIndex];
    const cells = Array.from(row.children).filter(
      (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
    );
    const cellIndex = pickRectIndexFromAxis(
      cells.map((cell) => {
        const rect = cell.getBoundingClientRect();
        return {
          end: rect.right,
          start: rect.left,
        };
      }),
      clientX,
    );
    const cell = cellIndex >= 0 ? cells[cellIndex] : null;

    if (cell) {
      const binding = bindingByElement.get(cell);
      if (binding) {
        return binding;
      }
    }
  }

  let nearest: { binding: TableCellBinding; distance: number } | null = null;

  for (const binding of bindings) {
    const rect = binding.element.getBoundingClientRect();
    const inside =
      clientX >= rect.left - 0.5 &&
      clientX <= rect.right + 0.5 &&
      clientY >= rect.top - 0.5 &&
      clientY <= rect.bottom + 0.5;

    if (inside) {
      return binding;
    }

    const distance = getDistanceToRect(rect, clientX, clientY);
    if (!nearest || distance < nearest.distance) {
      nearest = { binding, distance };
    }
  }

  return nearest && nearest.distance <= 1 ? nearest.binding : null;
}

function applyTableHitFeedback(
  table: HTMLTableElement,
  hitCell: HTMLTableCellElement,
) {
  table
    .querySelectorAll(".cm-kolam-table-hit-cell, .cm-kolam-table-hit-row, .cm-kolam-table-hit-col")
    .forEach((node) => {
      node.classList.remove(
        "cm-kolam-table-hit-cell",
        "cm-kolam-table-hit-row",
        "cm-kolam-table-hit-col",
      );
    });

  hitCell.classList.add("cm-kolam-table-hit-cell");

  const row = hitCell.parentElement as HTMLTableRowElement | null;
  if (row) {
    Array.from(row.children).forEach((child) => {
      if (child instanceof HTMLTableCellElement) {
        child.classList.add("cm-kolam-table-hit-row");
      }
    });
  }

  const columnIndex = hitCell.cellIndex;
  table.querySelectorAll("tr").forEach((rowElement) => {
    const columnCell = rowElement.children.item(columnIndex);
    if (columnCell instanceof HTMLTableCellElement) {
      columnCell.classList.add("cm-kolam-table-hit-col");
    }
  });
}

function clearTableHitFeedback(table: HTMLTableElement) {
  table
    .querySelectorAll(".cm-kolam-table-hit-cell, .cm-kolam-table-hit-row, .cm-kolam-table-hit-col")
    .forEach((node) => {
      node.classList.remove(
        "cm-kolam-table-hit-cell",
        "cm-kolam-table-hit-row",
        "cm-kolam-table-hit-col",
      );
    });
}

function getRenderedTableRows(table: HTMLTableElement) {
  return Array.from(table.querySelectorAll("tr")).filter(
    (row): row is HTMLTableRowElement => row.children.length > 0,
  );
}

function getAverageAxisSize(values: number[]) {
  if (values.length === 0) {
    return 40;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.max(24, total / values.length);
}

function getBindingByCell(bindings: TableCellBinding[]) {
  return new Map(bindings.map((binding) => [binding.element, binding]));
}

function findEditorViewFromElement(element: HTMLElement | null) {
  let current: HTMLElement | null = element;

  while (current) {
    const view = EditorView.findFromDOM(current);
    if (view) {
      return view;
    }
    current = current.parentElement;
  }

  return null;
}

function getPreviewRangeForLineSpan(
  view: EditorView,
  startLineNumber: number,
  endLineNumber: number,
): LivePreviewRevealRange | null {
  if (
    !Number.isFinite(startLineNumber) ||
    !Number.isFinite(endLineNumber) ||
    startLineNumber < 1 ||
    endLineNumber < startLineNumber ||
    endLineNumber > view.state.doc.lines
  ) {
    return null;
  }

  return {
    from: view.state.doc.line(startLineNumber).from,
    to: view.state.doc.line(endLineNumber).to,
  };
}

function getPreviewRangeFromShell(
  view: EditorView,
  shell: HTMLElement | null,
) {
  if (!shell) {
    return null;
  }

  const startLineNumber = Number.parseInt(
    shell.dataset.kolamPreviewStartLine ?? "",
    10,
  );
  const endLineNumber = Number.parseInt(
    shell.dataset.kolamPreviewEndLine ?? "",
    10,
  );

  return getPreviewRangeForLineSpan(view, startLineNumber, endLineNumber);
}

function setCursorToBinding(
  table: HTMLTableElement,
  binding: TableCellBinding,
  options: {
    preserveScroll?: boolean;
  } = {},
) {
  const view = findEditorViewFromElement(table);
  if (!view) return null;

  const line = view.state.doc.line(binding.lineNumber);
  const bounds = getTableCellContentBounds(binding.cell);
  const anchor = line.from + binding.cell.rawStart + bounds.start;
  const previewRange = getPreviewRangeFromShell(
    view,
    table.closest<HTMLElement>(".cm-kolam-table-shell"),
  );

  dispatchPreviewSelection(
    view,
    Math.max(line.from, Math.min(anchor, line.to)),
    previewRange,
    options,
  );
  return view;
}

function runCommandAtBinding(
  table: HTMLTableElement,
  binding: TableCellBinding,
  action: (editor: TableEditor) => void,
  options: {
    preserveScroll?: boolean;
  } = {},
) {
  const view = setCursorToBinding(table, binding, options);
  if (!view) return false;
  return runTableEditorCommand(view, action);
}

function getRowBindingAtIndex(
  rows: HTMLTableRowElement[],
  rowIndex: number,
  bindingByCell: Map<HTMLTableCellElement, TableCellBinding>,
) {
  const row = rows[rowIndex];
  if (!row) return null;

  const firstCell = Array.from(row.children).find(
    (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
  );
  if (!firstCell) return null;

  return bindingByCell.get(firstCell) ?? null;
}

function getColumnBindingAtIndex(
  rows: HTMLTableRowElement[],
  columnIndex: number,
  bindingByCell: Map<HTMLTableCellElement, TableCellBinding>,
) {
  for (const row of rows) {
    const candidate = row.children.item(columnIndex);
    if (candidate instanceof HTMLTableCellElement) {
      const binding = bindingByCell.get(candidate);
      if (binding) {
        return binding;
      }
    }
  }

  return null;
}

function buildTableControls(
  shell: HTMLDivElement,
  table: HTMLTableElement,
  bindings: TableCellBinding[],
) {
  const topRail = document.createElement("div");
  topRail.className = "cm-kolam-table-top-rail";
  const leftRail = document.createElement("div");
  leftRail.className = "cm-kolam-table-left-rail";

  const rightAddZone = document.createElement("button");
  rightAddZone.className = "cm-kolam-table-add-zone is-right";
  rightAddZone.type = "button";
  rightAddZone.setAttribute("aria-label", "Add column to the right");

  const bottomAddZone = document.createElement("button");
  bottomAddZone.className = "cm-kolam-table-add-zone is-bottom";
  bottomAddZone.type = "button";
  bottomAddZone.setAttribute("aria-label", "Add row to the bottom");

  const reorderIndicator = document.createElement("div");
  reorderIndicator.className = "cm-kolam-table-drop-indicator";
  reorderIndicator.setAttribute("aria-hidden", "true");

  shell.append(topRail, leftRail, rightAddZone, bottomAddZone, reorderIndicator);

  const bindingByCell = getBindingByCell(bindings);

  const makeGripDots = () => {
    const dots = document.createElement("span");
    dots.className = "cm-kolam-table-grip-dots";
    dots.setAttribute("aria-hidden", "true");
    return dots;
  };

  const clearReorderSourceHighlight = () => {
    table
      .querySelectorAll(
        ".cm-kolam-table-drag-source, .cm-kolam-table-drag-source-column, .cm-kolam-table-drag-source-row, .cm-kolam-table-drag-edge-start, .cm-kolam-table-drag-edge-end",
      )
      .forEach((node) => {
        node.classList.remove(
          "cm-kolam-table-drag-source",
          "cm-kolam-table-drag-source-column",
          "cm-kolam-table-drag-source-row",
          "cm-kolam-table-drag-edge-start",
          "cm-kolam-table-drag-edge-end",
        );
      });
  };

  const clearReorderIndicator = () => {
    reorderIndicator.classList.remove("is-column", "is-row", "is-visible");
    reorderIndicator.style.removeProperty("height");
    reorderIndicator.style.removeProperty("left");
    reorderIndicator.style.removeProperty("top");
    reorderIndicator.style.removeProperty("width");
  };

  const applyReorderSourceHighlight = (
    axis: "row" | "column",
    startIndex: number,
    rows: HTMLTableRowElement[],
  ) => {
    clearReorderSourceHighlight();

    if (axis === "column") {
      rows.forEach((row, rowIndex) => {
        const cell = row.children.item(startIndex);
        if (!(cell instanceof HTMLTableCellElement)) {
          return;
        }

        cell.classList.add(
          "cm-kolam-table-drag-source",
          "cm-kolam-table-drag-source-column",
        );
        if (rowIndex === 0) {
          cell.classList.add("cm-kolam-table-drag-edge-start");
        }
        if (rowIndex === rows.length - 1) {
          cell.classList.add("cm-kolam-table-drag-edge-end");
        }
      });
      return;
    }

    const row = rows[startIndex];
    if (!row) {
      return;
    }

    const cells = Array.from(row.children).filter(
      (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
    );
    cells.forEach((cell, cellIndex) => {
      cell.classList.add(
        "cm-kolam-table-drag-source",
        "cm-kolam-table-drag-source-row",
      );
      if (cellIndex === 0) {
        cell.classList.add("cm-kolam-table-drag-edge-start");
      }
      if (cellIndex === cells.length - 1) {
        cell.classList.add("cm-kolam-table-drag-edge-end");
      }
    });
  };

  const updateReorderIndicator = (
    axis: "row" | "column",
    startIndex: number,
    destinationIndex: number,
    rows: HTMLTableRowElement[],
  ) => {
    clearReorderIndicator();

    if (destinationIndex === startIndex || rows.length === 0) {
      return;
    }

    const tableRect = table.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();

    reorderIndicator.classList.add(
      "is-visible",
      axis === "column" ? "is-column" : "is-row",
    );

    if (axis === "column") {
      const cells = Array.from(rows[0]?.children ?? []).filter(
        (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
      );
      const targetCell = cells[destinationIndex];
      if (!targetCell) {
        clearReorderIndicator();
        return;
      }

      const rect = targetCell.getBoundingClientRect();
      const boundary = destinationIndex > startIndex ? rect.right : rect.left;

      reorderIndicator.style.left = `${boundary - shellRect.left}px`;
      reorderIndicator.style.top = `${tableRect.top - shellRect.top}px`;
      reorderIndicator.style.height = `${tableRect.height}px`;
      return;
    }

    const targetRow = rows[destinationIndex];
    if (!targetRow) {
      clearReorderIndicator();
      return;
    }

    const rect = targetRow.getBoundingClientRect();
    const boundary = destinationIndex > startIndex ? rect.bottom : rect.top;

    reorderIndicator.style.left = `${tableRect.left - shellRect.left}px`;
    reorderIndicator.style.top = `${boundary - shellRect.top}px`;
    reorderIndicator.style.width = `${tableRect.width}px`;
  };

  const beginDragInsert = (
    axis: "row" | "column",
    sourceEvent: PointerEvent,
  ) => {
    sourceEvent.preventDefault();
    sourceEvent.stopPropagation();

    shell.classList.add("is-table-control-active");
    const pointerId = sourceEvent.pointerId;
    const target = sourceEvent.currentTarget;
    if (target instanceof HTMLElement) {
      target.setPointerCapture(pointerId);
    }

    const rows = getRenderedTableRows(table);
    const columnCount = Math.max(
      1,
      rows[0]?.children.length ?? 1,
    );
    const widths = Array.from({ length: columnCount }, (_, index) => {
      for (const row of rows) {
        const cell = row.children.item(index);
        if (cell instanceof HTMLTableCellElement) {
          return cell.getBoundingClientRect().width;
        }
      }
      return 0;
    });
    const heights = rows.map((row) => row.getBoundingClientRect().height);
    const unit =
      axis === "column"
        ? getAverageAxisSize(widths)
        : getAverageAxisSize(heights);

    const start = axis === "column" ? sourceEvent.clientX : sourceEvent.clientY;
    let intent = 1;

    const updateIntent = (event: PointerEvent) => {
      const current = axis === "column" ? event.clientX : event.clientY;
      const delta = Math.max(0, current - start);
      intent = 1 + Math.floor(delta / Math.max(1, unit));

      const host = axis === "column" ? rightAddZone : bottomAddZone;
      host.dataset.intent = String(intent);
    };

    const cleanup = () => {
      if (target instanceof HTMLElement && target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      rightAddZone.dataset.intent = "";
      bottomAddZone.dataset.intent = "";
      shell.classList.remove("is-table-control-active");
      window.removeEventListener("pointermove", updateIntent);
      window.removeEventListener("pointerup", applyIntent);
      window.removeEventListener("pointercancel", cancelIntent);
    };

    const applyIntent = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      cleanup();
      const renderedRows = getRenderedTableRows(table);
      if (renderedRows.length === 0) return;

      if (axis === "column") {
        const columnIndex = Math.max(0, renderedRows[0].children.length - 1);
        const anchor = getColumnBindingAtIndex(renderedRows, columnIndex, bindingByCell);
        if (!anchor) return;

        runCommandAtBinding(
          table,
          anchor,
          (editor) => {
            for (let index = 0; index < intent; index += 1) {
              editor.insertColumn(MARKDOWN_TABLE_OPTIONS);
              editor.moveColumn(9999, MARKDOWN_TABLE_OPTIONS);
            }
          },
          { preserveScroll: true },
        );
        return;
      }

      const rowIndex = Math.max(0, renderedRows.length - 1);
      const anchor = getRowBindingAtIndex(renderedRows, rowIndex, bindingByCell);
      if (!anchor) return;

      runCommandAtBinding(
        table,
        anchor,
        (editor) => {
          for (let index = 0; index < intent; index += 1) {
            editor.insertRow(MARKDOWN_TABLE_OPTIONS);
            editor.moveRow(9999, MARKDOWN_TABLE_OPTIONS);
          }
        },
        { preserveScroll: true },
      );
    };

    const cancelIntent = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      cleanup();
    };

    window.addEventListener("pointermove", updateIntent);
    window.addEventListener("pointerup", applyIntent);
    window.addEventListener("pointercancel", cancelIntent);
    updateIntent(sourceEvent);
  };

  const beginReorder = (
    axis: "row" | "column",
    startIndex: number,
    sourceEvent: PointerEvent,
  ) => {
    sourceEvent.preventDefault();
    sourceEvent.stopPropagation();

    shell.classList.add("is-table-control-active");
    const pointerId = sourceEvent.pointerId;
    const target = sourceEvent.currentTarget;
    if (target instanceof HTMLElement) {
      target.setPointerCapture(pointerId);
    }

    let destinationIndex = startIndex;
    const rows = getRenderedTableRows(table);

    applyReorderSourceHighlight(axis, startIndex, rows);
    if (target instanceof HTMLElement) {
      target.classList.add("is-dragging");
    }

    const updateDestination = (event: PointerEvent) => {
      const rows = getRenderedTableRows(table);
      if (rows.length === 0) {
        destinationIndex = startIndex;
        clearReorderIndicator();
        return;
      }

      if (axis === "row") {
        destinationIndex = pickRectIndexFromAxis(
          rows.map((row) => {
            const rect = row.getBoundingClientRect();
            return {
              end: rect.bottom,
              start: rect.top,
            };
          }),
          event.clientY,
        );
      } else {
        const firstRow = rows[0];
        const cells = Array.from(firstRow.children).filter(
          (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
        );

        destinationIndex = pickRectIndexFromAxis(
          cells.map((cell) => {
            const rect = cell.getBoundingClientRect();
            return {
              end: rect.right,
              start: rect.left,
            };
          }),
          event.clientX,
        );
      }

      if (destinationIndex < 0) {
        destinationIndex = startIndex;
      }

      updateReorderIndicator(axis, startIndex, destinationIndex, rows);
    };

    const cleanup = () => {
      if (target instanceof HTMLElement && target.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
      if (target instanceof HTMLElement) {
        target.classList.remove("is-dragging");
      }
      clearReorderSourceHighlight();
      clearReorderIndicator();
      shell.classList.remove("is-table-control-active");
      window.removeEventListener("pointermove", updateDestination);
      window.removeEventListener("pointerup", applyReorder);
      window.removeEventListener("pointercancel", cancelReorder);
    };

    const applyReorder = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      cleanup();
      if (destinationIndex === startIndex) {
        return;
      }

      const rows = getRenderedTableRows(table);
      if (rows.length === 0) {
        return;
      }

      const offset = destinationIndex - startIndex;
      if (offset === 0) {
        return;
      }

      if (axis === "column") {
        const anchor = getColumnBindingAtIndex(rows, startIndex, bindingByCell);
        if (!anchor) return;

        runCommandAtBinding(
          table,
          anchor,
          (editor) => {
            editor.moveColumn(offset, MARKDOWN_TABLE_OPTIONS);
          },
          { preserveScroll: true },
        );
        return;
      }

      const anchor = getRowBindingAtIndex(rows, startIndex, bindingByCell);
      if (!anchor) return;
      runCommandAtBinding(
        table,
        anchor,
        (editor) => {
          editor.moveRow(offset, MARKDOWN_TABLE_OPTIONS);
        },
        { preserveScroll: true },
      );
    };

    const cancelReorder = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) {
        return;
      }

      cleanup();
    };

    window.addEventListener("pointermove", updateDestination);
    window.addEventListener("pointerup", applyReorder);
    window.addEventListener("pointercancel", cancelReorder);
    updateDestination(sourceEvent);
  };

  const rebuildRails = () => {
    topRail.replaceChildren();
    leftRail.replaceChildren();

    const rows = getRenderedTableRows(table);
    if (rows.length === 0) return;

    const firstRowCells = Array.from(rows[0].children).filter(
      (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
    );
    const columnWidths = firstRowCells.map((cell) =>
      Math.max(1, Math.round(cell.getBoundingClientRect().width)),
    );
    const rowHeights = rows.map((row) =>
      Math.max(1, Math.round(row.getBoundingClientRect().height)),
    );

    topRail.style.gridTemplateColumns = columnWidths.map((width) => `${width}px`).join(" ");
    leftRail.style.gridTemplateRows = rowHeights.map((height) => `${height}px`).join(" ");

    firstRowCells.forEach((_, columnIndex) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "cm-kolam-table-handle is-column";
      handle.setAttribute("aria-label", `Reorder column ${columnIndex + 1}`);
      handle.dataset.index = String(columnIndex);
      handle.appendChild(makeGripDots());
      handle.addEventListener("pointerdown", (event) => {
        beginReorder("column", columnIndex, event);
      });
      topRail.appendChild(handle);
    });

    rows.forEach((_, rowIndex) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "cm-kolam-table-handle is-row";
      handle.setAttribute("aria-label", `Reorder row ${rowIndex + 1}`);
      handle.dataset.index = String(rowIndex);
      handle.appendChild(makeGripDots());
      handle.addEventListener("pointerdown", (event) => {
        beginReorder("row", rowIndex, event);
      });
      leftRail.appendChild(handle);
    });
  };

  rightAddZone.addEventListener("pointerdown", (event) => {
    beginDragInsert("column", event);
  });

  bottomAddZone.addEventListener("pointerdown", (event) => {
    beginDragInsert("row", event);
  });

  shell.addEventListener("pointerenter", rebuildRails);
  rebuildRails();
}

function attachTableSelection(
  shell: HTMLDivElement,
  table: HTMLTableElement,
  bindings: TableCellBinding[],
) {
  shell.addEventListener("pointerleave", () => {
    if (shell.classList.contains("is-table-control-active")) {
      return;
    }
    clearTableHitFeedback(table);
  });

  table.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const binding = findTableCellBindingFromPoint(
      table,
      bindings,
      event.clientX,
      event.clientY,
    );
    if (!binding) {
      return;
    }

    const view = findEditorViewFromElement(table);
    if (!view) return;

    const line = view.state.doc.line(binding.lineNumber);
    const visiblePosition = getVisibleTextOffsetFromPoint(
      binding.element,
      event.clientX,
      event.clientY,
    );
    const visibleOffset = Math.max(
      0,
      Math.min(
        visiblePosition.offset,
        binding.offsetMap.length - 1,
      ),
    );
    const contentBounds = getTableCellContentBounds(binding.cell);
    const sourceOffset =
      visiblePosition.placement === "before"
        ? contentBounds.start
        : visiblePosition.placement === "after"
          ? contentBounds.end
          : resolveTableCellSourceOffset(
              binding.cell,
              binding.offsetMap,
              visibleOffset,
            );
    const anchor = line.from + binding.cell.rawStart + sourceOffset;
    const previewRange = getPreviewRangeFromShell(view, shell);

    dispatchPreviewSelection(
      view,
      Math.max(line.from, Math.min(anchor, line.to)),
      previewRange,
    );

    applyTableHitFeedback(table, binding.element);
  });

  // Keep table text-selection interaction available even if control rendering fails.
  buildTableControls(shell, table, bindings);
}

function attachHorizontalRuleSelection(
  root: HTMLElement,
  hitbox: HTMLElement,
  lineNumber: number,
) {
  hitbox.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const view = findEditorViewFromElement(root);
    if (!view) return;

    const line = view.state.doc.line(lineNumber);
    const rect = hitbox.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / width));
    const lineLength = Math.max(1, line.length);
    const anchor = line.from + Math.round(ratio * lineLength);
    const previewRange = getPreviewRangeForLineSpan(view, lineNumber, lineNumber);

    dispatchPreviewSelection(
      view,
      Math.max(line.from, Math.min(anchor, line.to)),
      previewRange,
    );
  });
}

class TableBlockWidget extends WidgetType {
  constructor(
    private readonly rows: MarkdownTableRowModel[],
    private readonly alignments: MarkdownTableAlignment[],
    private readonly startLineNumber: number,
    private readonly interactive: boolean,
  ) {
    super();
  }

  eq(other: TableBlockWidget) {
    return (
      other.alignments.join(",") === this.alignments.join(",") &&
      other.startLineNumber === this.startLineNumber &&
      other.rows
        .map(
          (row) =>
            `${row.isDelimiter ? 1 : 0}:${row.cells
              .map((cell) => cell.rawContent)
              .join("\u0000")}`,
        )
        .join("\u0001") ===
        this.rows
          .map(
            (row) =>
              `${row.isDelimiter ? 1 : 0}:${row.cells
                .map((cell) => cell.rawContent)
                .join("\u0000")}`,
          )
          .join("\u0001")
    );
  }

  ignoreEvent() {
    return true;
  }

  toDOM() {
    const shell = document.createElement("div");
    shell.className = "cm-kolam-table-shell";
    shell.dataset.kolamPreviewStartLine = String(this.startLineNumber);
    shell.dataset.kolamPreviewEndLine = String(
      this.startLineNumber + this.rows.length - 1,
    );

    const table = document.createElement("table");
    table.className = "kolam-table cm-kolam-table-preview-block";
    const bindings: TableCellBinding[] = [];

    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    let hasBodyRows = false;

    this.rows.forEach((row, rowIndex) => {
      if (row.isDelimiter) return;

      const lineNumber = this.startLineNumber + rowIndex;
      const tr = document.createElement("tr");
      const parent = rowIndex === 0 ? thead : tbody;
      const cellTag = rowIndex === 0 ? "th" : "td";
      if (rowIndex > 0) {
        hasBodyRows = true;
      }

      row.cells.forEach((cell, index) => {
        const cellElement = document.createElement(cellTag);
        cellElement.style.textAlign = this.alignments[index] ?? "left";
        const offsetMap = appendInlineMarkdown(cellElement, cell.content);
        if (this.interactive && cellElement instanceof HTMLTableCellElement) {
          bindings.push({
            cell,
            element: cellElement,
            lineNumber,
            offsetMap,
          });
        }
        tr.appendChild(cellElement);
      });

      parent.appendChild(tr);
    });

    table.appendChild(thead);
    if (hasBodyRows) {
      table.appendChild(tbody);
    }

    shell.appendChild(table);

    if (this.interactive && bindings.length > 0) {
      attachTableSelection(shell, table, bindings);
    }

    return shell;
  }
}

class HorizontalRuleWidget extends WidgetType {
  constructor(private readonly lineNumber: number) {
    super();
  }

  toDOM() {
    const hitbox = document.createElement("div");
    hitbox.className = "cm-kolam-rule-hitbox";

    const rule = document.createElement("hr");
    rule.className = "kolam-rule cm-kolam-rule-preview-block";

    hitbox.appendChild(rule);
    attachHorizontalRuleSelection(hitbox, hitbox, this.lineNumber);
    return hitbox;
  }
}

const kolamEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--background-primary)",
    color: "var(--text-normal)",
    fontFamily: "var(--font-text)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-text)",
  },
  ".cm-content": {
    caretColor: "var(--caret-color)",
    color: "var(--text-normal)",
    fontFamily: "var(--font-text)",
    padding: "0",
    lineHeight: "1.65",
  },
  ".cm-line": {
    color: "var(--text-normal)",
    padding: "0",
  },
  ".cm-activeLine": {
    backgroundColor:
      "color-mix(in srgb, var(--text-selection) 28%, var(--background-primary))",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--caret-color)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--background-primary)",
    border: "none",
    color: "var(--text-faint)",
    fontFamily: "var(--font-monospace)",
  },
  ".cm-activeLineGutter": {
    backgroundColor:
      "color-mix(in srgb, var(--text-selection) 28%, var(--background-primary))",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection":
    {
      backgroundColor: "var(--text-selection)",
    },
  ".cm-selectionBackground": {
    backgroundColor: "var(--text-selection) !important",
  },
});

const kolamHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6,
    ],
    color: "var(--text-normal)",
    fontWeight: "700",
  },
  {
    tag: tags.strong,
    color: "var(--text-normal)",
    fontWeight: "700",
  },
  {
    tag: tags.emphasis,
    color: "var(--text-normal)",
    fontStyle: "italic",
  },
  {
    tag: [tags.link, tags.url],
    color: "var(--text-normal)",
    textDecoration: "underline",
  },
  {
    tag: [tags.meta, tags.processingInstruction, tags.contentSeparator],
    color: "var(--text-faint)",
  },
  {
    tag: tags.monospace,
    color: "var(--text-normal)",
    fontFamily: "var(--font-monospace)",
  },
]);

function addDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
  decoration: Decoration,
) {
  if (from < to) {
    builder.add(from, to, decoration);
  }
}

function addHiddenDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
) {
  addDecoration(builder, from, to, hiddenSyntax);
}

function addMarkDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
  className: string,
) {
  addDecoration(builder, from, to, Decoration.mark({ class: className }));
}

function addWidgetDecoration(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
  widget: WidgetType,
) {
  addDecoration(builder, from, to, Decoration.replace({ widget }));
}

class BufferedDecorationBuilder {
  private readonly entries: Array<{
    from: number;
    to: number;
    value: Decoration;
  }> = [];

  add(from: number, to: number, value: Decoration) {
    this.entries.push({ from, to, value });
  }

  finish() {
    const builder = new RangeSetBuilder<Decoration>();
    this.entries
      .sort((left, right) => {
        if (left.from !== right.from) return left.from - right.from;

        const leftStartSide = (left.value as Decoration & { startSide?: number })
          .startSide ?? 0;
        const rightStartSide = (right.value as Decoration & { startSide?: number })
          .startSide ?? 0;
        if (leftStartSide !== rightStartSide) {
          return leftStartSide - rightStartSide;
        }

        if (left.to !== right.to) return left.to - right.to;
        return 0;
      })
      .forEach((entry) => {
        builder.add(entry.from, entry.to, entry.value);
      });

    return builder.finish();
  }
}

function intersectsSelection(
  state: EditorState,
  from: number,
  to: number,
  expandToLine = false,
) {
  const rangeFrom = expandToLine ? state.doc.lineAt(from).from : from;
  const rangeTo = expandToLine ? state.doc.lineAt(to).to : to;

  return selectionIntersectsRange(state.selection, rangeFrom, rangeTo);
}

function decorateDelimitedToken(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  from: number,
  to: number,
  leftWidth: number,
  rightWidth: number,
  className: string,
) {
  const contentFrom = from + leftWidth;
  const contentTo = to - rightWidth;

  addHiddenDecoration(builder, from, contentFrom);
  addMarkDecoration(builder, contentFrom, contentTo, className);
  addHiddenDecoration(builder, contentTo, to);
}

function decorateHeading(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  state: EditorState,
  from: number,
  level: number,
) {
  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const markerMatch = lineText.match(/^(#{1,6})\s+/);

  if (!markerMatch) return;

  const contentFrom = line.from + markerMatch[0].length;
  addHiddenDecoration(builder, line.from, contentFrom);
  addMarkDecoration(
    builder,
    contentFrom,
    line.to,
    `cm-kolam-heading cm-kolam-heading-${level}`,
  );
}

function decorateLink(
  builder: { add: (from: number, to: number, value: Decoration) => void },
  state: EditorState,
  from: number,
  to: number,
) {
  const raw = state.doc.sliceString(from, to);
  const match = raw.match(/^\[([^\]]*)\]\(([\s\S]*)\)$/);
  if (!match) return;

  const label = match[1];
  const labelFrom = from + 1;
  const labelTo = labelFrom + label.length;

  addHiddenDecoration(builder, from, labelFrom);
  addMarkDecoration(builder, labelFrom, labelTo, "cm-kolam-link");
  addHiddenDecoration(builder, labelTo, to);
}

function getDocumentLines(doc: EditorState["doc"]) {
  const lines: string[] = [];
  for (let index = 1; index <= doc.lines; index += 1) {
    lines.push(doc.line(index).text);
  }
  return lines;
}

function offsetFromLineColumn(lines: string[], row: number, column: number) {
  let offset = 0;
  for (let index = 0; index < row; index += 1) {
    offset += lines[index]?.length ?? 0;
    if (index < lines.length - 1) offset += 1;
  }
  return offset + Math.max(0, Math.min(column, lines[row]?.length ?? 0));
}

function lineColumnFromOffset(lines: string[], offset: number) {
  let remaining = Math.max(0, offset);

  for (let row = 0; row < lines.length; row += 1) {
    const lineLength = lines[row].length;
    if (remaining <= lineLength) {
      return { column: remaining, row };
    }

    remaining -= lineLength;
    if (row < lines.length - 1) {
      if (remaining === 0) {
        return { column: lineLength, row };
      }
      remaining -= 1;
    }
  }

  return {
    column: lines.at(-1)?.length ?? 0,
    row: Math.max(0, lines.length - 1),
  };
}

function isRowInsideFence(lines: string[], row: number) {
  let inFence = false;

  for (let index = 0; index <= row && index < lines.length; index += 1) {
    if (/^(```|~~~)/.test(lines[index].trim())) {
      inFence = !inFence;
    }
  }

  return inFence;
}

class CodeMirrorTableEditorAdapter {
  private lines: string[];

  private nextSelection:
    | { anchor: number; head: number }
    | null;

  constructor(private readonly view: EditorView) {
    this.lines = getDocumentLines(view.state.doc);
    this.nextSelection = {
      anchor: view.state.selection.main.from,
      head: view.state.selection.main.to,
    };
  }

  private replaceDocument() {
    const nextDoc = this.lines.join("\n");
    const anchor = this.nextSelection?.anchor ?? 0;
    const head = this.nextSelection?.head ?? anchor;
    this.view.dispatch({
      changes: {
        from: 0,
        insert: nextDoc,
        to: this.view.state.doc.length,
      },
      selection: EditorSelection.range(anchor, head),
      userEvent: "input",
    });
  }

  getCursorPosition() {
    const head = this.nextSelection?.head ?? this.view.state.selection.main.head;
    const position = lineColumnFromOffset(this.lines, head);
    return new MarkdownPoint(position.row, position.column);
  }

  setCursorPosition(pos: MarkdownPoint) {
    const offset = offsetFromLineColumn(this.lines, pos.row, pos.column);
    this.nextSelection = { anchor: offset, head: offset };
  }

  setSelectionRange(range: MarkdownRange) {
    this.nextSelection = {
      anchor: offsetFromLineColumn(
        this.lines,
        range.start.row,
        range.start.column,
      ),
      head: offsetFromLineColumn(this.lines, range.end.row, range.end.column),
    };
  }

  getLastRow() {
    return Math.max(0, this.lines.length - 1);
  }

  acceptsTableEdit(row: number) {
    return !isRowInsideFence(this.lines, row);
  }

  getLine(row: number) {
    return this.lines[row] ?? "";
  }

  insertLine(row: number, line: string) {
    this.lines.splice(row, 0, line);
  }

  deleteLine(row: number) {
    this.lines.splice(row, 1);
    if (this.lines.length === 0) {
      this.lines = [""];
    }
  }

  replaceLines(startRow: number, endRow: number, lines: string[]) {
    this.lines.splice(startRow, endRow - startRow, ...lines);
  }

  transact(func: () => void) {
    func();
    this.replaceDocument();
  }
}

function runTableEditorCommand(
  view: EditorView,
  action: (editor: TableEditor) => void,
) {
  if (!view.state.selection.main.empty) return false;

  const editor = new TableEditor(new CodeMirrorTableEditorAdapter(view));
  if (!editor.cursorIsInTable(MARKDOWN_TABLE_OPTIONS)) {
    return false;
  }

  action(editor);
  return true;
}

function buildLivePreviewDecorations(
  state: EditorState,
  revealSelection: boolean,
) {
  const builder = new BufferedDecorationBuilder();
  const source = state.doc.toString();
  const lines = source.split("\n");
  const frontmatter = extractFrontmatter(source);
  const frontmatterEndLine =
    frontmatter.rangeEnd > 0
      ? state.doc.lineAt(Math.max(0, frontmatter.rangeEnd - 1)).number
      : 0;
  const orderedListPattern = /^(\s*)(\d+[.)])\s+/;
  const tableLineNumbers = new Set<number>();
  const explicitlyRevealedRange =
    state.field(livePreviewRevealField, false) ?? null;

  if (
    frontmatter.rangeEnd > 0 &&
    (!revealSelection || !intersectsSelection(state, 0, frontmatter.rangeEnd))
  ) {
    addHiddenDecoration(builder, 0, frontmatter.rangeEnd);
  }

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.from === node.to) return;

      switch (node.name) {
        case "ATXHeading1":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            decorateHeading(builder, state, node.from, 1);
          }
          return false;
        case "ATXHeading2":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            decorateHeading(builder, state, node.from, 2);
          }
          return false;
        case "ATXHeading3":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            decorateHeading(builder, state, node.from, 3);
          }
          return false;
        case "ATXHeading4":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            decorateHeading(builder, state, node.from, 4);
          }
          return false;
        case "ATXHeading5":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            decorateHeading(builder, state, node.from, 5);
          }
          return false;
        case "ATXHeading6":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            decorateHeading(builder, state, node.from, 6);
          }
          return false;
        case "StrongEmphasis":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to)) {
            decorateDelimitedToken(
              builder,
              node.from,
              node.to,
              2,
              2,
              "cm-kolam-strong",
            );
          }
          return false;
        case "Emphasis":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to)) {
            decorateDelimitedToken(
              builder,
              node.from,
              node.to,
              1,
              1,
              "cm-kolam-emphasis",
            );
          }
          return false;
        case "Strikethrough":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to)) {
            decorateDelimitedToken(
              builder,
              node.from,
              node.to,
              2,
              2,
              "cm-kolam-strikethrough",
            );
          }
          return false;
        case "InlineCode":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to)) {
            decorateDelimitedToken(
              builder,
              node.from,
              node.to,
              1,
              1,
              "cm-kolam-inline-code",
            );
          }
          return false;
        case "Link":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to)) {
            decorateLink(builder, state, node.from, node.to);
          }
          return false;
        case "Blockquote":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            addMarkDecoration(
              builder,
              node.from,
              node.to,
              "cm-kolam-blockquote",
            );
          }
          return;
        case "QuoteMark":
          if (!revealSelection || !intersectsSelection(state, node.from, node.to, true)) {
            addHiddenDecoration(builder, node.from, node.to);
          }
          return;
        default:
          return;
      }
    },
  });

  findMarkdownTableBlocks(lines).forEach((block) => {
    let intersectsTable = false;

    block.model.rows.forEach((_, rowOffset) => {
      const lineNumber = block.start + rowOffset + 1;
      tableLineNumbers.add(lineNumber);

      const line = state.doc.line(lineNumber);
      if (revealSelection && intersectsSelection(state, line.from, line.to, true)) {
        intersectsTable = true;
      }
    });

    if (intersectsTable) {
      return;
    }

    const firstLine = state.doc.line(block.start + 1);
    const lastLine = state.doc.line(block.start + block.model.rows.length);
    const explicitlyRevealed =
      explicitlyRevealedRange !== null &&
      rangesOverlap(
        explicitlyRevealedRange.from,
        explicitlyRevealedRange.to,
        firstLine.from,
        lastLine.to,
      );

    if (explicitlyRevealed) {
      return;
    }

    const widget = new TableBlockWidget(
      block.model.rows,
      block.model.alignments,
      block.start + 1,
      revealSelection,
    );

    addDecoration(
      builder,
      firstLine.from,
      lastLine.to,
      Decoration.replace({ block: true, widget }),
    );
  });

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    if (tableLineNumbers.has(lineNumber)) {
      continue;
    }
    const isActiveLine =
      revealSelection && intersectsSelection(state, line.from, line.to, true);

    if (lineNumber <= frontmatterEndLine || isRowInsideFence(lines, lineNumber - 1)) {
      continue;
    }

    if (!isActiveLine && isMarkdownHorizontalRule(line.text)) {
      const explicitlyRevealed =
        explicitlyRevealedRange !== null &&
        rangesOverlap(
          explicitlyRevealedRange.from,
          explicitlyRevealedRange.to,
          line.from,
          line.to,
        );
      if (explicitlyRevealed) {
        continue;
      }

      addDecoration(
        builder,
        line.from,
        line.to,
        Decoration.replace({
          block: true,
          widget: new HorizontalRuleWidget(lineNumber),
        }),
      );
      continue;
    }
    const orderedMatch = line.text.match(orderedListPattern);

    let orderedFamilyWidthCh: number | null = null;
    if (orderedMatch) {
      const indent = orderedMatch[1];
      let maxMarkerLength = orderedMatch[2].length;

      for (let scan = lineNumber - 1; scan >= 1; scan -= 1) {
        const candidate = state.doc.line(scan);
        const candidateMatch = candidate.text.match(orderedListPattern);
        if (!candidateMatch || candidateMatch[1] !== indent) break;
        maxMarkerLength = Math.max(
          maxMarkerLength,
          candidateMatch[2].length,
        );
      }

      for (let scan = lineNumber + 1; scan <= state.doc.lines; scan += 1) {
        const candidate = state.doc.line(scan);
        const candidateMatch = candidate.text.match(orderedListPattern);
        if (!candidateMatch || candidateMatch[1] !== indent) break;
        maxMarkerLength = Math.max(
          maxMarkerLength,
          candidateMatch[2].length,
        );
      }

      orderedFamilyWidthCh = Math.max(3.25, maxMarkerLength + 1.25);
    }

    if (!isActiveLine) {
      const calloutMatch = line.text.match(/^>\s*\[!([^\]\+\-]+)\]([+-])?\s*/i);
      if (calloutMatch) {
        const contentFrom = line.from + calloutMatch[0].length;
        addHiddenDecoration(builder, line.from, contentFrom);
        addMarkDecoration(
          builder,
          contentFrom,
          line.to,
          "cm-kolam-callout-title",
        );
      }

      const taskMatch = line.text.match(/^(\s*)[-+*]\s+\[( |x|X)\]\s+/);
      if (taskMatch) {
        const markerFrom = line.from + taskMatch[1].length;
        const markerTo = line.from + taskMatch[0].length;
        addWidgetDecoration(
          builder,
          markerFrom,
          markerTo,
          new TaskMarkerWidget(taskMatch[2].toLowerCase() === "x"),
        );
      } else {
        if (orderedMatch) {
          const markerFrom = line.from + orderedMatch[1].length;
          const markerTo = line.from + orderedMatch[0].length;
          addWidgetDecoration(
            builder,
            markerFrom,
            markerTo,
            new ListMarkerWidget(
              orderedMatch[2],
              "cm-kolam-list-marker cm-kolam-ordered-marker",
              orderedFamilyWidthCh ?? undefined,
            ),
          );
        } else {
          const bulletMatch = line.text.match(/^(\s*)[-+*]\s+/);
          if (bulletMatch) {
            const markerFrom = line.from + bulletMatch[1].length;
            const markerTo = line.from + bulletMatch[0].length;
            addWidgetDecoration(
              builder,
              markerFrom,
              markerTo,
              new ListMarkerWidget(
                "\u2022",
                "cm-kolam-list-marker cm-kolam-bullet-marker",
              ),
            );
          }
        }
      }
    }

    const regexTokens = [
      {
        className: "cm-kolam-link",
        leftWidth: 2,
        regex: /\[\[([^[\]]+)\]\]/g,
        rightWidth: 2,
      },
      {
        className: "cm-kolam-highlight",
        leftWidth: 2,
        regex: /==([^=]+)==/g,
        rightWidth: 2,
      },
    ];

    regexTokens.forEach((token) => {
      let match: RegExpExecArray | null;

      while ((match = token.regex.exec(line.text)) !== null) {
        const from = line.from + match.index;
        const to = from + match[0].length;

        if (revealSelection && intersectsSelection(state, from, to)) {
          continue;
        }

        decorateDelimitedToken(
          builder,
          from,
          to,
          token.leftWidth,
          token.rightWidth,
          token.className,
        );
      }
    });
  }

  return builder.finish();
}

function createLivePreviewExtension({
  revealSelection = true,
}: {
  revealSelection?: boolean;
} = {}) {
  return [
    livePreviewRevealField,
    StateField.define<DecorationSet>({
      create: (state) => buildLivePreviewDecorations(state, revealSelection),
      update: (decorations, transaction) => {
        if (
          transaction.docChanged ||
          transaction.selection ||
          transaction.effects.length > 0
        ) {
          return buildLivePreviewDecorations(transaction.state, revealSelection);
        }

        return decorations.map(transaction.changes);
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
  ];
}

function formatSelection(
  open: string,
  close = open,
): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const beforeFrom = Math.max(0, range.from - open.length);
      const afterTo = Math.min(state.doc.length, range.to + close.length);
      const before = state.doc.sliceString(beforeFrom, range.from);
      const after = state.doc.sliceString(range.to, afterTo);

      if (range.empty) {
        if (before === open && after === close) {
          return {
            changes: [],
            range: EditorSelection.cursor(afterTo),
          };
        }

        const line = state.doc.lineAt(range.from);
        const lineText = state.doc.sliceString(line.from, line.to);
        const cursorOffset = range.from - line.from;

        if (
          lineText.slice(cursorOffset, cursorOffset + close.length) === close
        ) {
          const beforeCursor = lineText.slice(0, cursorOffset);
          const openOffset = beforeCursor.lastIndexOf(open);

          if (openOffset >= 0 && openOffset + open.length <= cursorOffset) {
            return {
              changes: [],
              range: EditorSelection.cursor(afterTo),
            };
          }
        }
      }
      const isWrapped = before === open && after === close;

      if (isWrapped) {
        return {
          changes: [
            { from: beforeFrom, to: range.from, insert: "" },
            { from: range.to, to: afterTo, insert: "" },
          ],
          range: range.empty
            ? EditorSelection.cursor(beforeFrom)
            : EditorSelection.range(
                Math.max(beforeFrom, range.from - open.length),
                Math.max(beforeFrom, range.to - open.length),
              ),
        };
      }

      return {
        changes: [
          { from: range.from, insert: open },
          { from: range.to, insert: close },
        ],
        range: range.empty
          ? EditorSelection.cursor(range.from + open.length)
          : EditorSelection.range(
              range.from + open.length,
              range.to + open.length,
            ),
      };
    });

    dispatch(
      state.update(changes, {
        scrollIntoView: true,
        userEvent: "input",
      }),
    );

    return true;
  };
}

type MarkdownListContinuation = {
  exitList?: boolean;
  from: number;
  nextMarker: string;
  replacement: string;
};

function shouldExitEmptyListItem(
  lineText: string,
  cursorOffset: number,
  markerPrefixLength: number,
  itemContent: string,
) {
  if (itemContent.trim().length > 0) {
    return false;
  }

  if (cursorOffset < markerPrefixLength) {
    return false;
  }

  return lineText.slice(cursorOffset).trim().length === 0;
}

export function shouldAutoInsertOrderedListSpace(
  lineText: string,
  cursorOffset: number,
): boolean {
  const beforeCursor = lineText.slice(0, cursorOffset);
  const afterCursor = lineText.slice(cursorOffset);

  if (!/^\s*\d+$/.test(beforeCursor)) return false;
  return afterCursor.length === 0 || /^\s*$/.test(afterCursor);
}

export function shouldIgnoreOrderedListExtraSpace(
  lineText: string,
  cursorOffset: number,
): boolean {
  const beforeCursor = lineText.slice(0, cursorOffset);
  const afterCursor = lineText.slice(cursorOffset);

  return /^\s*\d+[.)]\s$/.test(beforeCursor) && afterCursor.length === 0;
}

export function computeMarkdownListContinuation(
  lineText: string,
  cursorOffset: number,
): MarkdownListContinuation | null {
  const orderedMatch = lineText.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/);
  const taskMatch = lineText.match(/^(\s*)([-+*])(\s+)\[( |x|X)\](\s+)(.*)$/);
  const bulletMatch = lineText.match(/^(\s*)([-+*])(\s+)(.*)$/);

  if (taskMatch) {
    const prefixLength =
      taskMatch[1].length +
      taskMatch[2].length +
      taskMatch[3].length +
      3 +
      taskMatch[5].length;
    const markerPrefixLength =
      taskMatch[1].length + taskMatch[2].length + taskMatch[3].length + 3;

    if (
      shouldExitEmptyListItem(
        lineText,
        cursorOffset,
        markerPrefixLength,
        taskMatch[6],
      )
    ) {
      return {
        exitList: true,
        from: 0,
        nextMarker: taskMatch[1],
        replacement: taskMatch[1],
      };
    }

    if (cursorOffset < prefixLength) return null;

    return {
      from: cursorOffset,
      nextMarker: `${taskMatch[1]}${taskMatch[2]} [ ] `,
      replacement: `\n${taskMatch[1]}${taskMatch[2]} [ ] ${lineText.slice(cursorOffset)}`,
    };
  }

  if (orderedMatch) {
    const prefixLength =
      orderedMatch[1].length +
      orderedMatch[2].length +
      orderedMatch[3].length +
      orderedMatch[4].length;
    const markerPrefixLength =
      orderedMatch[1].length + orderedMatch[2].length + orderedMatch[3].length;

    if (
      shouldExitEmptyListItem(
        lineText,
        cursorOffset,
        markerPrefixLength,
        orderedMatch[5],
      )
    ) {
      return {
        exitList: true,
        from: 0,
        nextMarker: orderedMatch[1],
        replacement: orderedMatch[1],
      };
    }

    if (cursorOffset < prefixLength) return null;

    const nextMarker = `${orderedMatch[1]}${Number.parseInt(orderedMatch[2], 10) + 1}${orderedMatch[3]} `;
    return {
      from: cursorOffset,
      nextMarker,
      replacement: `\n${nextMarker}${lineText.slice(cursorOffset)}`,
    };
  }

  if (bulletMatch) {
    const prefixLength =
      bulletMatch[1].length + bulletMatch[2].length + bulletMatch[3].length;
    const markerPrefixLength = bulletMatch[1].length + bulletMatch[2].length;

    if (
      shouldExitEmptyListItem(
        lineText,
        cursorOffset,
        markerPrefixLength,
        bulletMatch[4],
      )
    ) {
      return {
        exitList: true,
        from: 0,
        nextMarker: bulletMatch[1],
        replacement: bulletMatch[1],
      };
    }

    if (cursorOffset < prefixLength) return null;

    const nextMarker = `${bulletMatch[1]}${bulletMatch[2]} `;
    return {
      from: cursorOffset,
      nextMarker,
      replacement: `\n${nextMarker}${lineText.slice(cursorOffset)}`,
    };
  }

  return null;
}

export function continueMarkdownListCommand(): StateCommand {
  return ({ state, dispatch }) => {
    const selection = state.selection.main;
    if (!selection.empty) return false;

    const line = state.doc.lineAt(selection.from);
    const cursorOffset = selection.from - line.from;
    const continuation = computeMarkdownListContinuation(line.text, cursorOffset);
    if (!continuation) return false;

    if (continuation.exitList && line.from >= 2) {
      const precedingText = state.doc.sliceString(line.from - 2, line.from);
      if (precedingText === "\n\n") {
        dispatch(
          state.update({
            changes: {
              from: line.from - 1,
              to: line.to,
              insert: "",
            },
            selection: EditorSelection.cursor(line.from - 1),
            scrollIntoView: true,
            userEvent: "input",
          }),
        );

        return true;
      }
    }

    dispatch(
      state.update({
        changes: {
          from: line.from + continuation.from,
          to: line.to,
          insert: continuation.replacement,
        },
        selection: EditorSelection.cursor(
          line.from + continuation.from + continuation.replacement.length - line.text.slice(cursorOffset).length,
        ),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );

    return true;
  };
}

function exitMarkdownTable(): StateCommand {
  return ({ state, dispatch }) => {
    const selection = state.selection.main;
    if (!selection.empty) return false;

    const cursorLine = state.doc.lineAt(selection.from).number;
    const lines = getDocumentLines(state.doc);
    const block = findMarkdownTableBlocks(lines).find((candidate) => {
      const firstLine = candidate.start + 1;
      const lastLine = candidate.start + candidate.model.rows.length;
      return cursorLine >= firstLine && cursorLine <= lastLine;
    });

    if (!block) return false;

    const lastLine = state.doc.line(block.start + block.model.rows.length);
    const insert = lastLine.number === state.doc.lines ? "\n\n" : "\n";
    const nextCursor = lastLine.to + 1;

    dispatch(
      state.update({
        changes: {
          from: lastLine.to,
          insert,
          to: lastLine.to,
        },
        selection: EditorSelection.cursor(nextCursor),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );

    return true;
  };
}

function deleteToLineStart(): StateCommand {
  return ({ state, dispatch }) => {
    const selection = state.selection.main;
    if (!selection.empty) {
      return false;
    }

    const line = state.doc.lineAt(selection.from);
    if (selection.from <= line.from) {
      return false;
    }

    dispatch(
      state.update({
        changes: {
          from: line.from,
          insert: "",
          to: selection.from,
        },
        selection: EditorSelection.cursor(line.from),
        scrollIntoView: true,
        userEvent: "delete.backward",
      }),
    );

    return true;
  };
}

export function shouldTriggerTableEnterForPosition(
  lines: string[],
  lineIndex: number,
  cursorOffset: number,
) {
  const block = findMarkdownTableBlocks(lines).find(
    (candidate) => lineIndex >= candidate.start && lineIndex < candidate.end,
  );

  if (!block) {
    return false;
  }

  const row = block.model.rows[lineIndex - block.start];
  if (!row || row.isDelimiter) {
    return false;
  }

  return row.cells.some(
    (cell) => cursorOffset >= cell.rawStart && cursorOffset <= cell.rawEnd,
  );
}

function shouldTriggerTableEnter(view: EditorView) {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = view.state.doc.lineAt(selection.from);
  return shouldTriggerTableEnterForPosition(
    getDocumentLines(view.state.doc),
    line.number - 1,
    selection.from - line.from,
  );
}

export function shouldAutoCreateMarkdownTable(
  lineText: string,
  cursorOffset: number,
) {
  return cursorOffset === lineText.length && buildMarkdownTableFromHeaderLine(lineText) !== null;
}

function autoCreateMarkdownTable(): StateCommand {
  return ({ state, dispatch }) => {
    const selection = state.selection.main;
    if (!selection.empty) {
      return false;
    }

    const line = state.doc.lineAt(selection.from);
    const cursorOffset = selection.from - line.from;
    const table = buildMarkdownTableFromHeaderLine(line.text);

    if (!table || !shouldAutoCreateMarkdownTable(line.text, cursorOffset)) {
      return false;
    }

    const insert = table.lines.join("\n");
    const cursorLineOffset = table.lines
      .slice(0, table.cursorLineIndex)
      .reduce((total, currentLine) => total + currentLine.length + 1, 0);

    dispatch(
      state.update({
        changes: {
          from: line.from,
          to: line.to,
          insert,
        },
        selection: EditorSelection.cursor(
          line.from + cursorLineOffset + table.cursorColumn,
        ),
        scrollIntoView: true,
        userEvent: "input",
      }),
    );

    return true;
  };
}

function orderedListInputHandler() {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (!view.state.selection.main.empty || from !== to) return false;

    const line = view.state.doc.lineAt(from);
    const cursorOffset = from - line.from;

    if (text === ".") {
      if (!shouldAutoInsertOrderedListSpace(line.text, cursorOffset)) {
        return false;
      }

      view.dispatch({
        changes: {
          from,
          to,
          insert: ". ",
        },
        selection: EditorSelection.cursor(from + 2),
        scrollIntoView: true,
        userEvent: "input",
      });

      return true;
    }

    if (text === " " && shouldIgnoreOrderedListExtraSpace(line.text, cursorOffset)) {
      return true;
    }

    return false;
  });
}

const kolamEditorKeymap = [
  {
    key: "Tab",
    run: (target: EditorView) =>
      runTableEditorCommand(target, (editor) =>
        editor.nextCell(MARKDOWN_TABLE_OPTIONS),
      ),
  },
  {
    key: "Shift-Tab",
    run: (target: EditorView) =>
      runTableEditorCommand(target, (editor) =>
        editor.previousCell(MARKDOWN_TABLE_OPTIONS),
      ),
  },
  {
    key: "Enter",
    run: (target: EditorView) =>
      (shouldTriggerTableEnter(target) &&
        runTableEditorCommand(target, (editor) => editor.nextRow(MARKDOWN_TABLE_OPTIONS))) ||
      autoCreateMarkdownTable()(target) ||
      continueMarkdownListCommand()(target),
  },
  {
    key: "Shift-Enter",
    run: (target: EditorView) => exitMarkdownTable()(target),
  },
  {
    key: "Mod-Backspace",
    run: (target: EditorView) => deleteToLineStart()(target),
    preventDefault: true,
  },
  { key: "Mod-b", run: formatSelection("**") },
  { key: "Mod-i", run: formatSelection("*") },
];

function stringifyFrontmatterValue(value: string | string[] | boolean) {
  if (Array.isArray(value)) {
    return value.length === 0 ? ["[]"] : ["", ...value.map((item) => `  - ${item}`)];
  }

  if (typeof value === "boolean") {
    return [value ? "true" : "false"];
  }

  return [value];
}

function replaceFrontmatterProperty(
  markdownValue: string,
  key: string,
  nextValue: string | string[] | boolean,
) {
  const normalizedKey = normalizeFrontmatterKey(key.trim() || "property");
  const { body, properties } = extractFrontmatter(markdownValue);
  const nextProperties = [...properties];
  const propertyIndex = nextProperties.findIndex(
    (property) => property.key === normalizedKey,
  );

  if (propertyIndex >= 0) {
    nextProperties[propertyIndex] = { key: normalizedKey, value: nextValue };
  } else {
    nextProperties.push({ key: normalizedKey, value: nextValue });
  }

  const lines = nextProperties.flatMap((property) => {
    const serialized = stringifyFrontmatterValue(property.value);
    if (Array.isArray(property.value) && property.value.length > 0) {
      return [`${property.key}:${serialized[0]}`, ...serialized.slice(1)];
    }
    return [`${property.key}: ${serialized[0]}`];
  });

  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function PropertiesPanel({
  markdown,
  editable = false,
  onChange,
}: {
  markdown: string;
  editable?: boolean;
  onChange?: (nextMarkdown: string) => void;
}) {
  const { properties } = extractFrontmatter(markdown);
  if (properties.length === 0) return null;

  return (
    <div className="kolam-properties-panel">
      <div className="kolam-properties-header">
        <span>Properties</span>
        {editable ? (
          <button
            className="kolam-property-action"
            onClick={() => {
              onChange?.(replaceFrontmatterProperty(markdown, "property", ""));
            }}
            type="button"
          >
            + Add
          </button>
        ) : null}
      </div>
      <div className="kolam-properties-grid">
        {properties.map((property) => (
          <React.Fragment key={property.key}>
            <div className="kolam-property-key">{property.key}</div>
            <div className="kolam-property-value">
              {editable ? (
                Array.isArray(property.value) ? (
                  <input
                    className="kolam-property-input"
                    onChange={(event) => {
                      const nextValue = event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean);
                      onChange?.(
                        replaceFrontmatterProperty(markdown, property.key, nextValue),
                      );
                    }}
                    type="text"
                    value={property.value.join(", ")}
                  />
                ) : typeof property.value === "boolean" ? (
                  <label className="kolam-property-toggle">
                    <input
                      checked={property.value}
                      onChange={(event) => {
                        onChange?.(
                          replaceFrontmatterProperty(
                            markdown,
                            property.key,
                            event.target.checked,
                          ),
                        );
                      }}
                      type="checkbox"
                    />
                    <span>{property.value ? "True" : "False"}</span>
                  </label>
                ) : (
                  <input
                    className="kolam-property-input"
                    onChange={(event) => {
                      onChange?.(
                        replaceFrontmatterProperty(
                          markdown,
                          property.key,
                          event.target.value,
                        ),
                      );
                    }}
                    type="text"
                    value={property.value}
                  />
                )
              ) : Array.isArray(property.value) ? (
                property.value.map((value) => (
                  <span className="kolam-property-pill" key={value}>
                    {value}
                  </span>
                ))
              ) : typeof property.value === "boolean" ? (
                <span className="kolam-property-pill">
                  {property.value ? "True" : "False"}
                </span>
              ) : (
                property.value || " "
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default function BaseEditor({
  initialContent,
  initialMarkdown,
  onChange,
  editable = true,
  placeholder,
  onEditorReady,
  onFocusChange,
  highlightTerm: _highlightTerm,
}: BaseEditorProps) {
  void _highlightTerm;

  const [markdownValue, setMarkdownValue] = useState(() =>
    typeof initialMarkdown === "string"
      ? initialMarkdown
      : blocksToStoredMarkdown(initialContent ?? []),
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const markdownRef = useRef(markdownValue);
  const focusRef = useRef(false);
  const changeRef = useRef(onChange);
  const focusChangeRef = useRef(onFocusChange);
  const [editableCompartment] = useState(() => new Compartment());
  const [readOnlyCompartment] = useState(() => new Compartment());
  const [placeholderCompartment] = useState(() => new Compartment());

  const frontmatter = useMemo(
    () => extractFrontmatter(markdownValue),
    [markdownValue],
  );

  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    focusChangeRef.current = onFocusChange;
  }, [onFocusChange]);

  useEffect(() => {
    markdownRef.current = markdownValue;
  }, [markdownValue]);

  useEffect(() => {
    if (!containerRef.current || viewRef.current) return;

    const extensions: Extension[] = [
      kolamEditorTheme,
      syntaxHighlighting(kolamHighlightStyle),
      EditorView.lineWrapping,
      drawSelection(),
      history(),
      autocompletion(),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      orderedListInputHandler(),
      createLivePreviewExtension({ revealSelection: editable }),
      keymap.of([
        ...kolamEditorKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.focusChanged) {
          focusRef.current = update.view.hasFocus;
          focusChangeRef.current?.(focusRef.current);
        } else {
          focusRef.current = update.view.hasFocus;
        }

        if (!update.docChanged) {
          return;
        }

        const nextMarkdown = update.state.doc.toString();

        if (nextMarkdown === markdownRef.current) {
          return;
        }

        markdownRef.current = nextMarkdown;
        setMarkdownValue(nextMarkdown);
        changeRef.current?.(
          storedContentToBlocks({ raw_markdown: nextMarkdown }),
          nextMarkdown,
        );
      }),
      editableCompartment.of(EditorView.editable.of(editable)),
      readOnlyCompartment.of(EditorState.readOnly.of(!editable)),
      placeholderCompartment.of(
        placeholder ? placeholderExtension(placeholder) : [],
      ),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: markdownRef.current,
        extensions,
      }),
      parent: containerRef.current,
    });

    focusRef.current = view.hasFocus;
    focusChangeRef.current?.(focusRef.current);
    viewRef.current = view;

    return () => {
      focusRef.current = false;
      focusChangeRef.current?.(false);
      view.destroy();
      viewRef.current = null;
    };
  }, [
    editable,
    editableCompartment,
    placeholder,
    placeholderCompartment,
    readOnlyCompartment,
  ]);

  useEffect(() => {
    if (!viewRef.current) return;

    viewRef.current.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(editable)),
    });
    viewRef.current.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(!editable)),
    });
  }, [editable, editableCompartment, readOnlyCompartment]);

  useEffect(() => {
    if (!viewRef.current) return;

    viewRef.current.dispatch({
      effects: placeholderCompartment.reconfigure(
        placeholder ? placeholderExtension(placeholder) : [],
      ),
    });
  }, [placeholder, placeholderCompartment]);

  useEffect(() => {
    if (!onEditorReady) return;

    const handle: MarkdownEditorHandle = {
      focus: () => {
        viewRef.current?.focus();
      },
      isFocused: () => focusRef.current,
    };

    onEditorReady(handle);
  }, [onEditorReady]);

  useEffect(() => {
    const nextMarkdown =
      typeof initialMarkdown === "string"
        ? initialMarkdown
        : blocksToStoredMarkdown(initialContent ?? []);

    if (focusRef.current || nextMarkdown === markdownRef.current) {
      return;
    }

    markdownRef.current = nextMarkdown;

    if (!viewRef.current) return;

    const currentDoc = viewRef.current.state.doc.toString();
    if (currentDoc === nextMarkdown) return;

    viewRef.current.dispatch({
      changes: {
        from: 0,
        to: viewRef.current.state.doc.length,
        insert: nextMarkdown,
      },
      selection: EditorSelection.cursor(0),
    });
  }, [initialContent, initialMarkdown]);

  const handleMarkdownChange = (nextMarkdown: string) => {
    markdownRef.current = nextMarkdown;
    setMarkdownValue(nextMarkdown);

    if (viewRef.current && viewRef.current.state.doc.toString() !== nextMarkdown) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: nextMarkdown,
        },
      });
    }

    changeRef.current?.(
      storedContentToBlocks({ raw_markdown: nextMarkdown }),
      nextMarkdown,
    );
  };

  if (!editable) {
    return (
      <div className="kolam-editor-shell">
        {frontmatter.properties.length > 0 ? (
          <PropertiesPanel
            editable={false}
            markdown={markdownValue}
            onChange={handleMarkdownChange}
          />
        ) : null}

        <div className="kolam-codemirror-frame is-readonly">
          <KolamRenderedMarkdown source={frontmatter.body} />
        </div>
      </div>
    );
  }

  return (
    <div className="kolam-editor-shell">
      {frontmatter.properties.length > 0 ? (
        <PropertiesPanel
          editable={editable}
          markdown={markdownValue}
          onChange={handleMarkdownChange}
        />
      ) : null}

      <div
        className={`kolam-codemirror-frame ${editable ? "is-editable" : "is-readonly"}`}
      >
        <div className="kolam-codemirror-root" ref={containerRef} />
      </div>
    </div>
  );
}
