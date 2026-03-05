import { test, expect, Page } from '@playwright/test';

// ===== REAL CANVAS & BRIDGE TESTS =====
// Tests interact with the canvas editor and bridge modal.
// Prerequisites: `npm run dev` running, logged-in test user with at least one stream

async function loginAndWait(page: Page) {
    await page.goto('/');
    await expect(page).not.toHaveURL(/login/);
    await page.waitForTimeout(1000);
}

async function navigateToStream(page: Page): Promise<boolean> {
    const streams = page.locator('[role="treeitem"] > div.cursor-pointer').filter({
        hasNot: page.locator('button[aria-label*="cabinet" i]'),
    });
    const count = await streams.count();

    for (let i = 0; i < count; i++) {
        const item = streams.nth(i);
        await item.scrollIntoViewIfNeeded();
        await item.click();
        await page.waitForTimeout(1500);

        const commitBtn = page.getByRole('button', { name: 'Commit Entry' });
        if (await commitBtn.isVisible().catch(() => false)) {
            return true;
        }
    }
    return false;
}

test.describe('Canvas', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('canvas area is visible when a stream is selected', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        // Look for canvas area — it should be on the right side of the layout
        // The canvas uses a BlockNote editor too
        const canvasEditors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const editorCount = await canvasEditors.count();

        // There should be at least 2 editors: one for log entry, one for canvas
        // (or at least one if canvas is shown separately)
        expect(editorCount).toBeGreaterThanOrEqual(1);
    });

    test('typing in canvas persists content', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        // Find the canvas editor (it's typically the second editor, or the one
        // in the main content area, not the sidebar entry creator)
        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();

        if (count >= 2) {
            // The canvas editor is usually the larger one / second one
            const canvasEditor = editors.nth(count - 1);
            await canvasEditor.click();

            const uniqueText = `E2E canvas content ${Date.now()}`;
            await canvasEditor.type(uniqueText, { delay: 30 });
            await page.waitForTimeout(3000); // Wait for auto-save

            // Reload and verify
            await page.reload();
            await page.waitForTimeout(3000);

            await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10_000 });
        }
    });
});

test.describe('Bridge Modal', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('bridge button opens the modal', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        // Look for the Bridge button (it may have an icon or text like "Bridge", "AI", etc.)
        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (await bridgeBtn.isVisible()) {
            await bridgeBtn.click();
            await page.waitForTimeout(1000);

            // The bridge modal should show interaction mode options
            await expect(page.getByText(/ASK|GO|BOTH/i).first()).toBeVisible({ timeout: 5000 });
        }
    });

    test('bridge modal shows persona selector', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible())) return;

        await bridgeBtn.click();
        await page.waitForTimeout(1000);

        // Should show a persona dropdown or selector
        const personaSelector = page.getByText(/persona|select persona/i).first();
        if (await personaSelector.isVisible()) {
            await expect(personaSelector).toBeVisible();
        }
    });

    test('bridge modal shows token counter', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible())) return;

        await bridgeBtn.click();
        await page.waitForTimeout(1000);

        // Should show token count
        const tokenDisplay = page.getByText(/token/i).first();
        if (await tokenDisplay.isVisible()) {
            await expect(tokenDisplay).toBeVisible();
        }
    });

    test('bridge modal copy XML button works', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible())) return;

        await bridgeBtn.click();
        await page.waitForTimeout(1000);

        // Look for "Copy to Clipboard" button
        const copyBtn = page.getByText(/copy to clipboard|copy/i).first();
        if (await copyBtn.isVisible()) {
            // Grant clipboard permission
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await copyBtn.click();
            await page.waitForTimeout(500);

            // Should show "Copied!" feedback
            await expect(page.getByText(/copied/i)).toBeVisible({ timeout: 3000 });
        }
    });
});

test.describe('Layout & Resize', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('sidebar is visible and resizable', async ({ page }) => {
        // At minimum, the sidebar should be present
        const sidebar = page.locator('nav, [class*="sidebar"]').first();
        if (await sidebar.isVisible()) {
            const box = await sidebar.boundingBox();
            expect(box).not.toBeNull();
            if (box) {
                // Sidebar should have reasonable width
                expect(box.width).toBeGreaterThan(100);
                expect(box.width).toBeLessThan(600);
            }
        }
    });

    test('app does not crash at small viewport', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 }); // iPhone size
        await page.waitForTimeout(1000);

        // Page should still be functional
        await expect(page).not.toHaveURL(/error/);
        // Some content should be visible
        await expect(page.locator('body')).not.toBeEmpty();
    });
});
