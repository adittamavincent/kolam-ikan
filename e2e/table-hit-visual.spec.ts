import { expect, test } from "@playwright/test";

type ViewportCase = {
  height: number;
  name: string;
  width: number;
};

const VIEWPORT_CASES: ViewportCase[] = [
  { name: "mobile-320", width: 320, height: 640 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-4k", width: 3840, height: 2160 },
];

const MARKUP = `
<style>
  body { margin: 0; padding: 16px; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
  .wrap { width: 100%; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #94a3b8; padding: 8px 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  th { background: #e2e8f0; }
  .is-hit { outline: 2px solid #f97316; outline-offset: -2px; }
  #dot {
    position: fixed;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #22c55e;
    border: 1px solid #14532d;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 1000;
  }
</style>
<div class="wrap">
  <table id="target-table">
    <thead>
      <tr>
        <th>Task</th>
        <th>Owner</th>
        <th>Due Date</th>
        <th>Status</th>
        <th>Priority</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Market Research</td><td>Alex</td><td>2026-04-10</td><td>Completed</td><td>High</td></tr>
      <tr><td>UI/UX Design</td><td>Jordan</td><td>2026-04-22</td><td>In Progress</td><td>High</td></tr>
      <tr><td>API Integration</td><td>Taylor</td><td>2026-05-05</td><td>Pending</td><td>Medium</td></tr>
      <tr><td>Beta Testing</td><td>Sam</td><td>2026-05-20</td><td>Not Started</td><td>Low</td></tr>
    </tbody>
  </table>
</div>
<div id="dot" aria-hidden="true"></div>
<script>
  const table = document.getElementById("target-table");
  const dot = document.getElementById("dot");

  function hitTest(clientX, clientY) {
    const cells = Array.from(table.querySelectorAll("th, td"));
    const measured = cells.map((cell) => {
      const rect = cell.getBoundingClientRect();
      const row = cell.parentElement;
      const rowIndex = row && row.parentElement && row.parentElement.tagName === "THEAD"
        ? 0
        : row ? row.sectionRowIndex : -1;
      return {
        cell,
        colIndex: cell.cellIndex,
        rowIndex,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });

    const hit = measured.find((rect) =>
      clientX >= rect.left - 0.5 &&
      clientX <= rect.right + 0.5 &&
      clientY >= rect.top - 0.5 &&
      clientY <= rect.bottom + 0.5
    ) || null;

    return hit;
  }

  window.__tableHitState = { hit: null };

  table.addEventListener("pointerdown", (event) => {
    const hit = hitTest(event.clientX, event.clientY);
    Array.from(table.querySelectorAll(".is-hit")).forEach((node) => node.classList.remove("is-hit"));

    if (hit) {
      hit.cell.classList.add("is-hit");
      const rect = hit.cell.getBoundingClientRect();
      window.__tableHitState = {
        hit: {
          rowIndex: hit.rowIndex,
          colIndex: hit.colIndex,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          clientX: event.clientX,
          clientY: event.clientY,
        },
      };
    } else {
      window.__tableHitState = { hit: null };
    }

    dot.style.left = event.clientX + "px";
    dot.style.top = event.clientY + "px";
  });
</script>
`;

test.describe("table hit testing visual alignment", () => {
  for (const viewportCase of VIEWPORT_CASES) {
    test(`overlay aligns to clicked cell within +/-1px (${viewportCase.name})`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewportCase.width, height: viewportCase.height });
      await page.setContent(MARKUP);

      const samplePoints = await page.evaluate(() => {
        const table = document.getElementById("target-table") as HTMLTableElement | null;
        if (!table) {
          return [];
        }

        const cells = Array.from(
          table.querySelectorAll<HTMLTableCellElement>("th, td"),
        );
        const picks = [cells[0], cells[Math.floor(cells.length / 2)], cells[cells.length - 1]];

        return picks.filter(Boolean).map((cell) => {
          const rect = cell.getBoundingClientRect();
          const row = cell.parentElement as HTMLTableRowElement | null;
          const sectionTag = row?.parentElement?.tagName;
          return {
            x: rect.left + rect.width * 0.5,
            y: rect.top + rect.height * 0.5,
            expectedCol: cell.cellIndex,
            expectedRow: sectionTag === "THEAD" ? 0 : (row?.sectionRowIndex ?? -1),
          };
        });
      });

      const requiredPoints = await page.evaluate(() => {
        const table = document.getElementById("target-table") as HTMLTableElement | null;
        if (!table) {
          return [];
        }

        const marketCell = Array.from(
          table.querySelectorAll<HTMLTableCellElement>("tbody td"),
        ).find((cell) => cell.textContent?.trim() === "Market Research");
        const alexCell = Array.from(
          table.querySelectorAll<HTMLTableCellElement>("tbody td"),
        ).find((cell) => cell.textContent?.trim() === "Alex");
        const ownerHeader = Array.from(
          table.querySelectorAll<HTMLTableCellElement>("thead th"),
        ).find((cell) => cell.textContent?.trim() === "Owner");

        if (!marketCell || !alexCell || !ownerHeader) {
          return [];
        }

        const marketRect = marketCell.getBoundingClientRect();
        const alexRect = alexCell.getBoundingClientRect();
        const ownerRect = ownerHeader.getBoundingClientRect();
        const ownerInset = Math.max(2, ownerRect.width * 0.04);

        return [
          {
            x: marketRect.left + marketRect.width * 0.5,
            y: marketRect.top + marketRect.height * 0.5,
            expectedCol: marketCell.cellIndex,
            expectedRow: (marketCell.parentElement as HTMLTableRowElement).sectionRowIndex,
          },
          {
            x: alexRect.left + alexRect.width * 0.5,
            y: alexRect.top + alexRect.height * 0.5,
            expectedCol: alexCell.cellIndex,
            expectedRow: (alexCell.parentElement as HTMLTableRowElement).sectionRowIndex,
          },
          {
            x: ownerRect.left + ownerInset,
            y: ownerRect.top + ownerRect.height * 0.5,
            expectedCol: ownerHeader.cellIndex,
            expectedRow: 0,
          },
          {
            x: ownerRect.right - ownerInset,
            y: ownerRect.top + ownerRect.height * 0.5,
            expectedCol: ownerHeader.cellIndex,
            expectedRow: 0,
          },
        ];
      });

      expect(requiredPoints.length).toBe(4);

      for (const point of [...samplePoints, ...requiredPoints]) {
        await page.mouse.click(point.x, point.y);

        const hit = await page.evaluate(() => {
          type BrowserHit = {
            bottom: number;
            clientX: number;
            clientY: number;
            colIndex: number;
            left: number;
            right: number;
            rowIndex: number;
            top: number;
          };

          return (
            (window as { __tableHitState?: { hit: BrowserHit | null } })
              .__tableHitState?.hit ?? null
          );
        });
        expect(hit).not.toBeNull();
        if (!hit) {
          throw new Error("Expected a hit cell but found null");
        }

        expect(hit.colIndex).toBe(point.expectedCol);
        expect(hit.rowIndex).toBe(point.expectedRow);

        const dx =
          hit.clientX < hit.left
            ? hit.left - hit.clientX
            : hit.clientX > hit.right
              ? hit.clientX - hit.right
              : 0;
        const dy =
          hit.clientY < hit.top
            ? hit.top - hit.clientY
            : hit.clientY > hit.bottom
              ? hit.clientY - hit.bottom
              : 0;
        const distance = Math.hypot(dx, dy);

        expect(distance).toBeLessThanOrEqual(1);
      }

      await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`table-hit-overlay-${viewportCase.name}.png`),
      });
    });
  }
});
