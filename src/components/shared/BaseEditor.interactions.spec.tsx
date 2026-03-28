// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BaseEditor from "@/components/shared/BaseEditor";
import { findMarkdownTableBlocks } from "@/lib/markdownTables";

function createRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => "",
    top,
    width,
    x: left,
    y: top,
  } as DOMRect;
}

function setRect(element: Element, rect: DOMRect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
}

function mockRenderedTableGeometry(container: HTMLElement) {
  const shell = container.querySelector(".cm-kolam-table-shell") as HTMLElement | null;
  const table = container.querySelector(
    ".cm-kolam-table-preview-block",
  ) as HTMLTableElement | null;
  const topRail = container.querySelector(".cm-kolam-table-top-rail") as HTMLElement | null;
  const leftRail = container.querySelector(".cm-kolam-table-left-rail") as HTMLElement | null;
  const rightAddZone = container.querySelector(
    ".cm-kolam-table-add-zone.is-right",
  ) as HTMLButtonElement | null;
  const bottomAddZone = container.querySelector(
    ".cm-kolam-table-add-zone.is-bottom",
  ) as HTMLButtonElement | null;

  if (!shell || !table || !topRail || !leftRail || !rightAddZone || !bottomAddZone) {
    throw new Error("Expected a rendered table with live controls");
  }

  setRect(shell, createRect(0, 0, 360, 160));
  setRect(table, createRect(24, 22, 300, 90));
  setRect(topRail, createRect(24, 0, 300, 22));
  setRect(leftRail, createRect(0, 22, 24, 90));
  setRect(rightAddZone, createRect(324, 22, 24, 90));
  setRect(bottomAddZone, createRect(24, 112, 300, 24));

  const rows = Array.from(table.querySelectorAll("tr"));
  const cellRects = new Map<Element, DOMRect>();

  rows.forEach((row, rowIndex) => {
    const rowRect = createRect(24, 22 + rowIndex * 30, 300, 30);
    setRect(row, rowRect);

    Array.from(row.children).forEach((cell, cellIndex) => {
      const cellRect = createRect(24 + cellIndex * 150, 22 + rowIndex * 30, 150, 30);
      setRect(cell, cellRect);
      cellRects.set(cell, cellRect);
    });
  });

  document.elementsFromPoint = vi.fn((clientX: number, clientY: number) => {
    const hits = Array.from(cellRects.entries())
      .filter(([, rect]) =>
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom,
      )
      .map(([element]) => element);

    if (hits.length > 0) {
      return hits;
    }

    return [table];
  });

  return { rightAddZone, table };
}

describe("BaseEditor live table interactions", () => {
  const initialMarkdown = [
    "Intro paragraph",
    "",
    "| alpha | beta |",
    "| --- | --- |",
    "| one | two |",
  ].join("\n");

  beforeEach(() => {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [],
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => createRect(0, 0, 0, 0),
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("reveals the raw markdown when clicking a rendered table cell", async () => {
    const { container } = render(<BaseEditor initialMarkdown={initialMarkdown} />);

    const { table } = mockRenderedTableGeometry(container);
    const firstCell = table.querySelector("th") as HTMLElement | null;
    if (!firstCell) {
      throw new Error("Expected a rendered header cell");
    }

    expect(container.textContent).not.toContain("| alpha | beta |");

    fireEvent.pointerDown(firstCell, {
      button: 0,
      clientX: 60,
      clientY: 36,
      pointerId: 1,
      pointerType: "mouse",
    });

    await waitFor(() => {
      expect(container.textContent).toContain("| alpha | beta |");
    });
  });

  it("adds columns from the right-side plus rail using the drag intent distance", async () => {
    const handleChange = vi.fn();
    const { container } = render(
      <BaseEditor
        initialMarkdown={initialMarkdown}
        onChange={handleChange}
      />,
    );

    const { rightAddZone } = mockRenderedTableGeometry(container);

    fireEvent.pointerDown(rightAddZone, {
      button: 0,
      clientX: 332,
      clientY: 64,
      pointerId: 9,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(window, {
      clientX: 500,
      clientY: 64,
      pointerId: 9,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(window, {
      clientX: 500,
      clientY: 64,
      pointerId: 9,
      pointerType: "mouse",
    });

    await waitFor(() => {
      expect(handleChange).toHaveBeenCalled();
    });

    const latestMarkdown = handleChange.mock.calls.at(-1)?.[1] as string | undefined;
    expect(latestMarkdown).toBeTruthy();

    const block = findMarkdownTableBlocks((latestMarkdown ?? "").split("\n"))[0];
    expect(block?.model.columnCount).toBe(4);
  });

  it("shows the dragged column highlight and live landing indicator while reordering", () => {
    const { container } = render(<BaseEditor initialMarkdown={initialMarkdown} />);
    const { table } = mockRenderedTableGeometry(container);
    const firstHandle = container.querySelector(
      '.cm-kolam-table-handle.is-column[data-index="0"]',
    ) as HTMLButtonElement | null;

    if (!firstHandle) {
      throw new Error("Expected a column reorder handle");
    }

    fireEvent.pointerDown(firstHandle, {
      button: 0,
      clientX: 96,
      clientY: 10,
      pointerId: 21,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(window, {
      clientX: 280,
      clientY: 10,
      pointerId: 21,
      pointerType: "mouse",
    });

    const draggedCells = Array.from(table.querySelectorAll(".cm-kolam-table-drag-source-column"));
    expect(draggedCells).toHaveLength(2);

    const indicator = container.querySelector(
      ".cm-kolam-table-drop-indicator.is-visible.is-column",
    ) as HTMLElement | null;
    expect(indicator).not.toBeNull();
    expect(indicator?.style.left).toBeTruthy();
  });
});
