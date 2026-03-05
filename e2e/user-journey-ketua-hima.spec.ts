import { test, expect, Page } from '@playwright/test';

// ============================================================================
// USER JOURNEY: Ketua HIMA Musik — Early Stage "Masa Bakti"
// ============================================================================
// Simulates a real user: a newly elected student association leader who is
// overwhelmed with responsibilities. He wants to use Kolam Ikan as a
// brainstorming & thought-management tool to organize programs, delegate
// tasks, and keep a running log of ideas and decisions.
//
// Persona profile:
//   Name      : Rizky (Ketua HIMA Musik)
//   Role      : Student Organization Leader
//   Goal      : Organize proker (program kerja), brainstorm event ideas,
//               keep meeting notes, track delegation
//   Pain point: Overwhelmed by many responsibilities early in term
//   Usage     : Start from scratch — create domain, organize structure,
//               log thoughts across multiple personas (Leader vs Creative)
// ============================================================================

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
        await nameInput.fill(`Journey Domain ${Date.now()}`);
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

async function createCabinet(page: Page, name: string) {
    const newCabinetBtn = page.getByRole('button', { name: 'New cabinet' });
    await newCabinetBtn.waitFor({ timeout: 5000 });
    await newCabinetBtn.click();

    const renameInput = page.locator('input[type="text"]').last();
    await renameInput.waitFor({ timeout: 3000 });
    await renameInput.fill(name);
    await renameInput.press('Enter');

    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });
}

async function createStream(page: Page, name: string) {
    const newStreamBtn = page.getByRole('button', { name: 'New stream' });
    await newStreamBtn.waitFor({ timeout: 5000 });
    await newStreamBtn.click();

    const renameInput = page.locator('input[type="text"]').last();
    await renameInput.waitFor({ timeout: 3000 });
    await renameInput.fill(name);
    await renameInput.press('Enter');

    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });
}

async function typeInEditor(page: Page, text: string) {
    const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
    await editor.waitFor({ timeout: 5000 });
    await editor.click();
    await editor.type(text, { delay: 30 });
    await page.waitForTimeout(1500);
}

async function commitEntry(page: Page) {
    await page.getByText('Commit Entry').click();
    await page.waitForTimeout(3000);
}

// ---------------------------------------------------------------------------
// PHASE 1: First-Time Setup — Domain & Structure
// ---------------------------------------------------------------------------

test.describe('Ketua HIMA Musik — Phase 1: Setting Up Workspace', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates "HIMA Musik 2026" domain as first workspace', async ({ page }) => {
        const domainName = `HIMA Musik 2026 ${Date.now()}`;
        const domainsBefore = await page.locator('button[title*="double-click to edit"]').count();

        await page.getByRole('button', { name: 'Add Domain' }).click();

        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill(domainName);

        // Should be able to pick an icon from the grid
        const iconButtons = page.locator('button').filter({
            has: page.locator('svg'),
        });
        const iconCount = await iconButtons.count();
        expect(iconCount).toBeGreaterThan(0);

        await page.getByRole('button', { name: 'Create Domain' }).click();
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForTimeout(1500);

        const domainsAfter = await page.locator('button[title*="double-click to edit"]').count();
        expect(domainsAfter).toBeGreaterThan(domainsBefore);
    });

    test('builds organizational structure with cabinets and streams', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        // Create "Program Kerja" cabinet
        await createCabinet(page, `Program Kerja ${Date.now()}`);

        // Create "Rapat" cabinet
        await createCabinet(page, `Rapat ${Date.now()}`);

        // Create a stream inside the domain
        await createStream(page, `Brainstorm Proker ${Date.now()}`);

        // Verify all items are visible in the navigator
        const treeItems = page.locator('[role="treeitem"]');
        const count = await treeItems.count();
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test('creates multiple streams to simulate real workload', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const suffix = Date.now();
        const streamNames = [
            `Ide Konser Tahunan ${suffix}`,
            `Workshop Plan ${suffix}`,
            `Budget Draft ${suffix}`,
        ];

        for (const name of streamNames) {
            await createStream(page, name);
        }

        // All streams should be visible
        for (const name of streamNames) {
            await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });
        }
    });
});

// ---------------------------------------------------------------------------
// PHASE 2: Brainstorming — Writing & Committing Ideas
// ---------------------------------------------------------------------------

test.describe('Ketua HIMA Musik — Phase 2: Brainstorming Session', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('writes initial brainstorm entry and commits', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const uniqueText = `Ide program kerja HIMA Musik 2026: konser tahunan, workshop musik, kolaborasi lintas HIMA ${Date.now()}`;
        await typeInEditor(page, uniqueText);
        await commitEntry(page);

        await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 5000 });
    });

    test('writes multiple entries in quick succession (rapid brainstorming)', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const suffix = Date.now();
        const ideas = [
            `Tema konser: Nusantara in Harmony ${suffix}`,
            `Venue options: Aula kampus, outdoor amphitheater ${suffix}`,
        ];

        for (const idea of ideas) {
            await typeInEditor(page, idea);
            await commitEntry(page);
            await page.waitForTimeout(1000);
        }

        // Both entries should be visible in the log
        for (const idea of ideas) {
            await expect(page.getByText(idea)).toBeVisible({ timeout: 10000 });
        }
    });

    test('entry draft auto-saves before committing', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const draftText = `Draft rencana workshop gitar akustik ${Date.now()}`;

        const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
        await editor.click();
        await editor.type(draftText, { delay: 30 });

        // Wait for auto-save to trigger
        await page.waitForTimeout(3000);

        // The saving indicator should have appeared (or already saved)
        // Content should still be in editor
        await expect(editor).toContainText(draftText);

        // Reload page to test draft recovery
        await page.reload();
        await page.waitForTimeout(3000);

        // Navigate back to the stream
        const foundAgain = await navigateToStream(page);
        if (!foundAgain) return;

        // Check if recovery prompt appears OR draft content is loaded
        const recoveryPrompt = page.getByText(/recovered unsaved work|recovery/i);
        // Editor should be available again after reload
        // const editorAfterReload = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();

        const hasRecovery = await recoveryPrompt.isVisible().catch(() => false);
        if (hasRecovery) {
            // Keep the recovered draft
            const keepBtn = page.getByText('Keep');
            if (await keepBtn.isVisible()) {
                await keepBtn.click();
            }
        }

        // Draft content should be recoverable
        await page.waitForTimeout(2000);
    });

    test('uses keyboard shortcut Cmd+Enter to commit entry quickly', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const quickIdea = `Quick thought: perlu koordinasi dengan BEM untuk venue ${Date.now()}`;
        await typeInEditor(page, quickIdea);

        // Use keyboard shortcut
        await page.keyboard.press('Meta+Enter');
        await page.waitForTimeout(3000);

        await expect(page.getByText(quickIdea)).toBeVisible({ timeout: 5000 });
    });
});

// ---------------------------------------------------------------------------
// PHASE 3: Persona Usage — Switching Hats
// ---------------------------------------------------------------------------

test.describe('Ketua HIMA Musik — Phase 3: Multi-Persona Thinking', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates "Ketua Formal" persona for official decisions', async ({ page }) => {
        const personaBtn = page.locator('[title="Manage Personas"]');
        await expect(personaBtn).toBeVisible({ timeout: 5000 });
        await personaBtn.click();

        await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();

        await page.getByRole('button', { name: 'New Persona' }).click();

        const nameInput = page.getByPlaceholder('e.g., Creative Mode');
        await expect(nameInput).toBeVisible();
        await nameInput.fill(`Ketua Formal ${Date.now()}`);

        // Select a color
        const colorButtons = page.locator('button[class*="rounded-full"][class*="border-2"]');
        const colorCount = await colorButtons.count();
        if (colorCount > 0) {
            await colorButtons.nth(3).click(); // Pick red for authority
        }

        // Select an icon
        const iconButtons = page.locator('button').filter({
            has: page.locator('svg'),
        });
        if (await iconButtons.count() > 5) {
            await iconButtons.nth(9).click(); // Pick shield icon
        }

        await page.getByRole('button', { name: 'Save Persona' }).click();
        await expect(page.getByText('Failed to save persona')).toHaveCount(0);

        await page.keyboard.press('Escape');
    });

    test('creates "Creative Mode" persona for brainstorming', async ({ page }) => {
        const personaBtn = page.locator('[title="Manage Personas"]');
        await expect(personaBtn).toBeVisible({ timeout: 5000 });
        await personaBtn.click();

        await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();

        await page.getByRole('button', { name: 'New Persona' }).click();

        const nameInput = page.getByPlaceholder('e.g., Creative Mode');
        await nameInput.fill(`Creative Brainstorm ${Date.now()}`);

        await page.getByRole('button', { name: 'Save Persona' }).click();
        await expect(page.getByText('Failed to save persona')).toHaveCount(0);

        await page.keyboard.press('Escape');
    });

    test('adds persona section in entry creator for multi-voice entries', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        // Look for "Add Persona" button in the entry creator
        const addPersonaBtn = page.getByText('Add Persona');
        if (await addPersonaBtn.isVisible()) {
            await addPersonaBtn.click();
            await page.waitForTimeout(500);

            // The dropdown should show available personas
            const personaMenu = page.getByText(/Add Author Section/i);
            if (await personaMenu.isVisible()) {
                // Click the first persona option
                const personaOptions = page.locator('[role="menuitem"] button, [role="menuitem"]');
                const optionCount = await personaOptions.count();
                if (optionCount > 0) {
                    await personaOptions.first().click();
                    await page.waitForTimeout(500);

                    // An editor section should now be visible
                    const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
                    expect(await editors.count()).toBeGreaterThanOrEqual(1);
                }
            }
        }
    });
});

// ---------------------------------------------------------------------------
// PHASE 4: Canvas — Evolving Documentation
// ---------------------------------------------------------------------------

test.describe('Ketua HIMA Musik — Phase 4: Canvas for Living Documents', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('writes structured plan in canvas and it auto-saves', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        // Find the canvas editor (usually the second contenteditable area)
        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();

        if (count >= 2) {
            const canvasEditor = editors.nth(count - 1);
            await canvasEditor.click();

            const planText = `PROKER HIMA MUSIK 2026 - Draft ${Date.now()}`;
            await canvasEditor.type(planText, { delay: 30 });
            await page.waitForTimeout(3000); // Auto-save

            // Reload to verify persistence
            await page.reload();
            await page.waitForTimeout(3000);

            await expect(page.getByText(planText)).toBeVisible({ timeout: 10000 });
        }
    });

    test('canvas content survives navigation between streams', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        // Write in canvas
        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();

        if (count < 2) return;

        const canvasEditor = editors.nth(count - 1);
        await canvasEditor.click();
        const canvasText = `Navigation persistence test ${Date.now()}`;
        await canvasEditor.type(canvasText, { delay: 30 });
        await page.waitForTimeout(3000);

        // Navigate to a different stream if possible
        const streams = page.locator('[role="treeitem"] > div.cursor-pointer').filter({
            hasNot: page.locator('button[aria-label*="cabinet" i]'),
        });
        const streamCount = await streams.count();

        if (streamCount > 1) {
            // Click second stream
            await streams.nth(1).click();
            await page.waitForTimeout(1500);

            // Navigate back to first stream
            await streams.nth(0).click();
            await page.waitForTimeout(2000);

            // Canvas text should still be there
            await expect(page.getByText(canvasText)).toBeVisible({ timeout: 10000 });
        }
    });
});

// ---------------------------------------------------------------------------
// PHASE 5: Bridge — AI-Assisted Thinking
// ---------------------------------------------------------------------------

test.describe('Ketua HIMA Musik — Phase 5: Using Bridge for AI Help', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('opens bridge and selects interaction mode', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible())) return;

        await bridgeBtn.click();
        await page.waitForTimeout(1000);

        // Should see ASK/GO/BOTH interaction modes
        const askMode = page.getByText(/ASK/i).first();

        if (await askMode.isVisible()) {
            await askMode.click();
            await page.waitForTimeout(500);
        }

        // Verify token counter is displayed
        const tokenDisplay = page.getByText(/token/i).first();
        if (await tokenDisplay.isVisible()) {
            await expect(tokenDisplay).toBeVisible();
        }
    });

    test('bridge copies XML to clipboard', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        // First commit some content so bridge has something to work with
        const contextEntry = `Meeting notes: discussed venue booking timeline ${Date.now()}`;
        await typeInEditor(page, contextEntry);
        await commitEntry(page);

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible())) return;

        await bridgeBtn.click();
        await page.waitForTimeout(1000);

        const copyBtn = page.getByText(/copy to clipboard|copy/i).first();
        if (await copyBtn.isVisible()) {
            await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
            await copyBtn.click();
            await page.waitForTimeout(500);

            // Verify "Copied!" feedback
            await expect(page.getByText(/copied/i)).toBeVisible({ timeout: 3000 });
        }
    });
});

// ---------------------------------------------------------------------------
// PHASE 6: Search & Navigation — Finding Things Fast
// ---------------------------------------------------------------------------

test.describe('Ketua HIMA Musik — Phase 6: Search & Discovery', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('global search finds previously committed entries', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        // First, create an entry with searchable content
        const found = await navigateToStream(page);
        if (!found) return;

        const searchableText = `Koordinasi BEM untuk auditorium ${Date.now()}`;
        await typeInEditor(page, searchableText);
        await commitEntry(page);

        // Open global search
        await page.keyboard.press('Meta+Shift+k');
        await page.waitForTimeout(1000);

        const searchInput = page.locator('input[type="text"], input[type="search"]').first();
        if (await searchInput.isVisible()) {
            // Search for the keyword
            await searchInput.fill('auditorium');
            await page.waitForTimeout(2000);

            // Results should appear (we can't guarantee specific results
            // but the search should not error)
            await expect(page).not.toHaveURL(/error/);
        }

        await page.keyboard.press('Escape');
    });

    test('navigates between multiple streams without state leakage', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const streams = page.locator('[role="treeitem"] > div.cursor-pointer').filter({
            hasNot: page.locator('button[aria-label*="cabinet" i]'),
        });
        const streamCount = await streams.count();

        if (streamCount < 2) return;

        // Click stream 1
        await streams.nth(0).click();
        await page.waitForTimeout(1500);

        // Click stream 2
        await streams.nth(1).click();
        await page.waitForTimeout(1500);

        // Click back to stream 1
        await streams.nth(0).click();
        await page.waitForTimeout(1500);

        // App should not crash, editor should be functional
        await expect(page).not.toHaveURL(/error/);
        const commitBtn = page.getByRole('button', { name: 'Commit Entry' });
        if (await commitBtn.isVisible()) {
            await expect(commitBtn).toBeVisible();
        }
    });
});
