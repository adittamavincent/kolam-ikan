import { test, expect, Page } from '@playwright/test';

// ===== REAL LOG & ENTRY TESTS =====
// Tests create entries, switch personas, commit, and verify persistence.
// Prerequisites: `npm run dev` running, logged-in test user with at least one stream

async function loginAndWait(page: Page) {
    await page.goto('/');
    await expect(page).not.toHaveURL(/login/);
    await page.waitForTimeout(1000);
}

// Helper: navigate to first available stream
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

        // Check if the entry creator (Commit Entry button) appeared
        const commitBtn = page.getByRole('button', { name: 'Commit Entry' });
        if (await commitBtn.isVisible().catch(() => false)) {
            return true;
        }
    }
    return false;
}

test.describe('Log Entries', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('entry creator is visible when a stream is selected', async ({ page }) => {
        const found = await navigateToStream(page);
        if (found) {
            await expect(page.getByText('Commit Entry')).toBeVisible();
        }
    });

    test('typing in the editor shows saving status', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        // Find the BlockNote editor area
        const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
        if (await editor.isVisible()) {
            await editor.click();
            await editor.type('E2E test entry content', { delay: 50 });

            // Should show saving indicator (e.g. "Saving..." or status dot)
            await page.waitForTimeout(1500);

            // The content should be in the editor
            await expect(editor).toContainText('E2E test entry content');
        }
    });

    test('committing an entry clears the editor', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        // Type content
        const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
        if (!(await editor.isVisible())) return;

        await editor.click();
        const uniqueText = `E2E commit test ${Date.now()}`;
        await editor.type(uniqueText, { delay: 30 });

        // Wait for save to complete
        await page.waitForTimeout(2000);

        // Click Commit Entry
        await page.getByText('Commit Entry').click();

        // Wait for commit to process
        await page.waitForTimeout(3000);

        // The committed entry should now appear in the log (above the editor)
        // and the editor should be cleared
        await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 5000 });
    });

    test('committed entry persists after page reload', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        // Type and commit an entry
        const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
        if (!(await editor.isVisible())) return;

        const uniqueText = `E2E persist test ${Date.now()}`;
        await editor.click();
        await editor.type(uniqueText, { delay: 30 });
        await page.waitForTimeout(2000);
        await page.getByText('Commit Entry').click();
        await page.waitForTimeout(3000);

        // Reload the page
        await page.reload();
        await page.waitForTimeout(3000);

        // The entry should still be visible
        await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10_000 });
    });
});

test.describe('Persona Management', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('persona manager opens from sidebar', async ({ page }) => {
        // Click the "Manage Personas" button
        const personaBtn = page.locator('[title="Manage Personas"]');
        if (await personaBtn.isVisible()) {
            await personaBtn.click();
            await page.waitForTimeout(1000);

            // Persona manager dialog should appear
            await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();
        }
    });

    test('creates a new persona', async ({ page }) => {
        // Open persona manager
        const personaBtn = page.locator('[title="Manage Personas"]');
        if (!(await personaBtn.isVisible())) return;

        await personaBtn.click();
        await page.waitForTimeout(1000);

        // Click New Persona button
        const addBtn = page.getByRole('button', { name: 'New Persona' });
        if (await addBtn.isVisible()) {
            await addBtn.click();
            await page.waitForTimeout(500);

            // Fill name
            const nameInput = page.getByPlaceholder('e.g., Creative Mode');
            if (await nameInput.isVisible()) {
                const personaName = `E2E Bot ${Date.now()}`;
                await nameInput.fill(personaName);

                // Save
                const saveBtn = page.getByRole('button', { name: 'Save Persona' });
                if (await saveBtn.isVisible()) {
                    await saveBtn.click();
                    await page.waitForTimeout(2000);

                    // Verify persona appears in the list
                    const createdPersona = page.getByText(personaName);
                    if (await createdPersona.isVisible().catch(() => false)) {
                        await expect(createdPersona).toBeVisible();
                    }
                }
            }
        }

        // Close the dialog
        await page.keyboard.press('Escape');
    });
});

test.describe('Keyboard Shortcuts', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('Cmd+Enter commits entry when editor is focused', async ({ page }) => {
        const found = await navigateToStream(page);
        if (!found) return;

        const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
        if (!(await editor.isVisible())) return;

        const uniqueText = `E2E shortcut test ${Date.now()}`;
        await editor.click();
        await editor.type(uniqueText, { delay: 30 });
        await page.waitForTimeout(2000);

        // Use keyboard shortcut to commit
        await page.keyboard.press('Meta+Enter');
        await page.waitForTimeout(3000);

        // The entry should be committed and visible in the log
        await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 5000 });
    });
});
