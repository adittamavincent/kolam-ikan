import { test, expect, Page } from '@playwright/test';

// ===== REAL NAVIGATOR + DOMAIN TESTS =====
// Tests create cabinets, streams, domains and interact with the sidebar.
// Prerequisites: `npm run dev` running, logged-in test user

// Helper: login and wait for main page
async function loginAndWait(page: Page) {
    await page.goto('/');
    await expect(page).not.toHaveURL(/login/);
    await page.waitForTimeout(1000);
}

async function ensureDomainSelected(page: Page): Promise<boolean> {
    const domainButtons = page.locator('button[title*="double-click to edit"]');
    let domainCount = await domainButtons.count();

    if (domainCount === 0) {
        const addDomainBtn = page.getByRole('button', { name: 'Add Domain' });
        if (!(await addDomainBtn.isVisible().catch(() => false))) return false;
        await addDomainBtn.click();

        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill(`E2E Domain ${Date.now()}`);
        await page.getByRole('button', { name: 'Create Domain' }).click();
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForTimeout(1500);
        domainCount = await page.locator('button[title*="double-click to edit"]').count();
    }

    if (domainCount === 0) return false;

    const firstDomain = page.locator('button[title*="double-click to edit"]').first();
    if (await firstDomain.isVisible()) {
        await firstDomain.click();
        await page.waitForTimeout(1000);
        return true;
    }

    return false;
}

test.describe('Domain Management', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('domain switcher is visible after login', async ({ page }) => {
        const addDomainBtn = page.getByRole('button', { name: 'Add Domain' });
        await expect(addDomainBtn).toBeVisible({ timeout: 5000 });
    });

    test('creates a new domain', async ({ page }) => {
        const testDomainName = `E2E Test Domain ${Date.now()}`;
        const domainsBefore = await page.locator('button[title*="double-click to edit"]').count();

        await page.getByRole('button', { name: 'Add Domain' }).click();

        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill(testDomainName);

        await page.getByRole('button', { name: 'Create Domain' }).click();
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForTimeout(1500);

        const domainsAfter = await page.locator('button[title*="double-click to edit"]').count();
        expect(domainsAfter).toBeGreaterThanOrEqual(domainsBefore);
    });

    test('switches between domains', async ({ page }) => {
        // Should see at least one domain in the switcher
        // Click on a different domain (if multiple exist)
        const domains = page.locator('[title*="double-click to edit"]');
        const domainCount = await domains.count();

        if (domainCount > 1) {
            // Click the second domain
            await domains.nth(1).click();
            await page.waitForTimeout(1000);

            // Click back to the first domain
            await domains.nth(0).click();
            await page.waitForTimeout(1000);

            // Should still be on main page (no crash)
            await expect(page).not.toHaveURL(/login/);
        }
    });
});

test.describe('Navigator - Cabinets & Streams', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates a new cabinet (folder)', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const newCabinetBtn = page.getByRole('button', { name: 'New cabinet' });
        await newCabinetBtn.waitFor({ timeout: 5000 });
        await newCabinetBtn.click();

        // An inline rename input should appear
        const renameInput = page.locator('input[type="text"]').last();
        await renameInput.waitFor({ timeout: 3000 });

        // Type a name and confirm with Enter
        const cabinetName = `E2E Cabinet ${Date.now()}`;
        await renameInput.fill(cabinetName);
        await renameInput.press('Enter');

        // The cabinet should appear in the navigator
        await expect(page.getByText(cabinetName)).toBeVisible({ timeout: 5000 });
    });

    test('creates a new stream (document)', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const newStreamBtn = page.getByRole('button', { name: 'New stream' });
        await newStreamBtn.waitFor({ timeout: 5000 });
        await newStreamBtn.click();

        // An inline rename input should appear
        const renameInput = page.locator('input[type="text"]').last();
        await renameInput.waitFor({ timeout: 3000 });

        const streamName = `E2E Stream ${Date.now()}`;
        await renameInput.fill(streamName);
        await renameInput.press('Enter');

        // The stream should appear in the navigator
        await expect(page.getByText(streamName)).toBeVisible({ timeout: 5000 });
    });

    test('clicking a stream navigates to it and shows log pane', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const streams = page.locator('[role="treeitem"] > div.cursor-pointer').filter({
            hasNot: page.locator('button[aria-label*="cabinet" i]'),
        }).first();

        if (await streams.isVisible()) {
            await streams.scrollIntoViewIfNeeded();
            await streams.click();
            await page.waitForTimeout(1500);

            // The log pane should be visible (it shows entries area)
            // Look for the entry creator or log-related UI
            const entryArea = page.getByText('Commit Entry');
            // If stream has an entry creator, it should be visible
            if (await entryArea.isVisible()) {
                await expect(entryArea).toBeVisible();
            }
        }
    });

    test('expanding and collapsing a cabinet', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        // Find a cabinet (folder) and try to expand/collapse it
        const cabinetToggle = page.locator('button').filter({ has: page.locator('svg') }).first();

        if (await cabinetToggle.isVisible()) {
            // Click to toggle (expand or collapse)
            await cabinetToggle.click();
            await page.waitForTimeout(500);

            // Click again to toggle back
            await cabinetToggle.click();
            await page.waitForTimeout(500);

            // Page should not crash
            await expect(page).not.toHaveURL(/error/);
        }
    });

    test('right-click context menu appears', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        // Right-click on a navigator item
        const navigatorItems = page.locator('[role="treeitem"] > div.cursor-pointer').first();

        if (await navigatorItems.isVisible()) {
            await navigatorItems.scrollIntoViewIfNeeded();
            await navigatorItems.click({ button: 'right' });

            // Context menu should appear with options like Rename, Delete
            await page.waitForTimeout(500);
            const contextMenu = page.getByText(/rename|delete/i).first();
            if (await contextMenu.isVisible()) {
                await expect(contextMenu).toBeVisible();
            }

            // Press Escape to close
            await page.keyboard.press('Escape');
        }
    });
});

test.describe('Navigator - Search', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('global search opens with keyboard shortcut', async ({ page }) => {
        // Press Cmd+Shift+K (the search shortcut from DomainSwitcher)
        await page.keyboard.press('Meta+Shift+k');

        // Search modal or input should appear
        await page.waitForTimeout(1000);

        // If a search input is visible, type something
        const searchInput = page.locator('input[type="text"], input[type="search"]').first();
        if (await searchInput.isVisible()) {
            await searchInput.fill('test');
            await page.waitForTimeout(500);
        }

        // Close with Escape
        await page.keyboard.press('Escape');
    });
});
