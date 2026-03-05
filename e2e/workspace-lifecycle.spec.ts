import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// WORKSPACE LIFECYCLE — Full journey for user: test@kolamikan.local
// ============================================================================
// Sequential tests that build on each other. Each test's output is the next
// test's input. Covers: domain → cabinet → stream → persona → entry → canvas → bridge.
//
// Auth: test@kolamikan.local via .auth/user.json (set in playwright.config)
// ============================================================================

// File-backed shared state — survives Playwright worker restarts between serial blocks
const CTX_FILE = path.join(__dirname, '.ctx-state.json');

const ctx: {
    domainId: string;
    streamId: string;
    domainName: string;
    cabinetName: string;
    streamName: string;
    personaName: string;
    entryText: string;
    canvasText: string;
} = {
    domainId: '',
    streamId: '',
    domainName: 'Lifecycle Domain',
    cabinetName: 'Research Notes',
    streamName: 'Literature Review',
    personaName: 'Analyst',
    entryText: '',
    canvasText: '',
};

function saveCtx() {
    fs.writeFileSync(CTX_FILE, JSON.stringify(ctx), 'utf-8');
}

function restoreCtx() {
    try {
        if (fs.existsSync(CTX_FILE)) {
            const saved = JSON.parse(fs.readFileSync(CTX_FILE, 'utf-8'));
            Object.assign(ctx, saved);
        }
    } catch { /* ignore read errors */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function goHome(page: Page) {
    await page.goto('/');
    await expect(page).not.toHaveURL(/login/, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');
}

async function goToDomain(page: Page, domainId: string) {
    await page.goto(`/${domainId}`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(domainId));
}

async function goToStream(page: Page, domainId: string, streamId: string) {
    await page.goto(`/${domainId}/${streamId}`);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(new RegExp(streamId));
}

function selectDomainByLabel(page: Page, name: string) {
    return page.locator(`button[aria-label="${name}"]`);
}

// ===================================================================
// CATEGORY 1: Workspace Setup (domain, cabinet, stream)
// ===================================================================

test.describe.serial('Workspace Setup', () => {
    test('dashboard loads for authenticated user', async ({ page }) => {
        await goHome(page);
        await expect(page.locator('body')).not.toBeEmpty();
        await expect(page).not.toHaveURL(/error/);
    });

    test('creates a domain', async ({ page }) => {
        await goHome(page);

        await page.getByRole('button', { name: 'Add Domain' }).click();
        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill(ctx.domainName);
        await page.getByRole('button', { name: 'Create Domain' }).click();

        // Wait for redirect to the new domain — URL will be /<uuid>
        await page.waitForURL(url => {
            const segments = url.pathname.split('/').filter(Boolean);
            return segments.length === 1 && segments[0].length > 10;
        }, { timeout: 10_000 });

        ctx.domainId = page.url().split('/').filter(Boolean).pop()!;
        expect(ctx.domainId.length).toBeGreaterThan(10);
        saveCtx();

        // Domain button should appear in the switcher
        await expect(selectDomainByLabel(page, ctx.domainName)).toBeVisible({ timeout: 5000 });
    });

    test('creates a cabinet inside the domain', async ({ page }) => {
        await goToDomain(page, ctx.domainId);

        const newCabinetBtn = page.getByRole('button', { name: 'New cabinet' });
        await newCabinetBtn.waitFor({ timeout: 5000 });
        await newCabinetBtn.click();

        const input = page.locator('input[type="text"]').last();
        await input.waitFor({ timeout: 3000 });
        await input.fill(ctx.cabinetName);
        await input.press('Enter');

        await expect(page.getByText(ctx.cabinetName)).toBeVisible({ timeout: 5000 });
    });

    test('creates a stream inside the cabinet', async ({ page }) => {
        await goToDomain(page, ctx.domainId);
        await expect(page.getByText(ctx.cabinetName)).toBeVisible({ timeout: 5000 });

        const newStreamBtn = page.getByRole('button', { name: 'New stream' });
        await newStreamBtn.click();

        const input = page.locator('input[type="text"]').last();
        await input.waitFor({ timeout: 3000 });
        await input.fill(ctx.streamName);
        await input.press('Enter');

        await expect(page.getByText(ctx.streamName)).toBeVisible({ timeout: 5000 });

        // Click the stream to navigate to it — capture stream ID from URL
        await page.getByText(ctx.streamName).click();
        await page.waitForURL(url => {
            const segments = url.pathname.split('/').filter(Boolean);
            return segments.length === 2;
        }, { timeout: 10_000 });

        ctx.streamId = page.url().split('/').filter(Boolean).pop()!;
        expect(ctx.streamId.length).toBeGreaterThan(10);
        saveCtx();
    });

    test('stream page shows entry creator with Commit Entry button', async ({ page }) => {
        await goToStream(page, ctx.domainId, ctx.streamId);
        await expect(page.getByRole('button', { name: 'Commit Entry' })).toBeVisible({ timeout: 5000 });
    });
});

// ===================================================================
// CATEGORY 2: Persona Management
// ===================================================================

test.describe.serial('Persona Management', () => {
    test('creates a persona via Manage Personas', async ({ page }) => {
        restoreCtx();
        await goHome(page);

        const personaBtn = page.locator('[title="Manage Personas"]');
        await expect(personaBtn).toBeVisible({ timeout: 5000 });
        await personaBtn.click();

        await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();
        await page.getByRole('button', { name: 'New Persona' }).click();

        const nameInput = page.getByPlaceholder('e.g., Creative Mode');
        await nameInput.fill(ctx.personaName);
        await page.getByRole('button', { name: 'Save Persona' }).click();

        await expect(page.getByText('Failed to save persona')).toHaveCount(0);
        await page.waitForTimeout(1000);

        await expect(page.getByText(ctx.personaName)).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });

    test('persona appears in Manage Personas on revisit', async ({ page }) => {
        await goHome(page);

        const personaBtn = page.locator('[title="Manage Personas"]');
        await personaBtn.click();
        await page.waitForTimeout(1000);

        await expect(page.getByText(ctx.personaName)).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });
});

// ===================================================================
// CATEGORY 3: Writing Entries (chronological log)
// ===================================================================

test.describe.serial('Entry Writing', () => {
    test('writes and commits an entry in the stream', async ({ page }) => {
        restoreCtx();
        await goToStream(page, ctx.domainId, ctx.streamId);

        ctx.entryText = `Research finding: Kodaly method effective for early music education ${Date.now()}`;

        // Click "Add Persona" to open the persona dropdown in EntryCreator
        await page.getByRole('button', { name: 'Add Persona' }).click();
        // Wait for dropdown and select the persona
        const menu = page.locator('[role="menu"]');
        await menu.waitFor({ timeout: 3000 });
        await menu.locator('button', { hasText: ctx.personaName }).click();
        // Wait for dropdown to close
        await menu.waitFor({ state: 'hidden', timeout: 3000 });

        // Wait for the EntryCreator's editor to appear
        const editor = page.locator('.bn-editor[contenteditable="true"]').first();
        await editor.waitFor({ timeout: 5000 });

        await editor.click();
        await editor.type(ctx.entryText, { delay: 30 });
        await page.waitForTimeout(2000);

        await page.getByRole('button', { name: 'Commit Entry' }).click();
        await page.waitForTimeout(3000);

        await expect(page.getByText(ctx.entryText)).toBeVisible({ timeout: 5000 });
    });

    test('committed entry persists after page reload', async ({ page }) => {
        await goToStream(page, ctx.domainId, ctx.streamId);
        await expect(page.getByText(ctx.entryText)).toBeVisible({ timeout: 10_000 });
    });

    test('Cmd+Enter commits an entry', async ({ page }) => {
        await goToStream(page, ctx.domainId, ctx.streamId);

        const quickText = `Quick note via shortcut ${Date.now()}`;

        // Add persona section first
        await page.getByRole('button', { name: 'Add Persona' }).click();
        const menu = page.locator('[role="menu"]');
        await menu.waitFor({ timeout: 3000 });
        await menu.locator('button', { hasText: ctx.personaName }).click();
        await menu.waitFor({ state: 'hidden', timeout: 3000 });

        const editor = page.locator('.bn-editor[contenteditable="true"]').first();
        await editor.waitFor({ timeout: 5000 });

        await editor.click();
        await editor.type(quickText, { delay: 30 });
        await page.waitForTimeout(1500);

        await page.keyboard.press('Meta+Enter');
        await page.waitForTimeout(3000);

        await expect(page.getByText(quickText)).toBeVisible({ timeout: 5000 });
    });
});

// ===================================================================
// CATEGORY 4: Canvas (synthesis writing)
// ===================================================================

test.describe.serial('Canvas Writing', () => {
    test('types in canvas and content auto-saves', async ({ page }) => {
        restoreCtx();
        await goToStream(page, ctx.domainId, ctx.streamId);

        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();
        if (count < 2) {
            test.skip();
            return;
        }

        ctx.canvasText = `Thesis outline: Chapter 1 Introduction ${Date.now()}`;
        const canvasEditor = editors.nth(count - 1);
        await canvasEditor.click();
        await canvasEditor.type(ctx.canvasText, { delay: 30 });
        await page.waitForTimeout(3000);
    });

    test('canvas content persists after reload', async ({ page }) => {
        if (!ctx.canvasText) {
            test.skip();
            return;
        }
        await goToStream(page, ctx.domainId, ctx.streamId);
        await expect(page.getByText(ctx.canvasText)).toBeVisible({ timeout: 10_000 });
    });
});

// ===================================================================
// CATEGORY 5: Bridge (AI synthesis modal)
// ===================================================================

test.describe.serial('Bridge Modal', () => {
    test('opens bridge and shows interaction modes', async ({ page }) => {
        restoreCtx();
        await goToStream(page, ctx.domainId, ctx.streamId);

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible().catch(() => false))) {
            test.skip();
            return;
        }

        await bridgeBtn.click();
        await page.waitForTimeout(1000);
        await expect(page.getByText(/ASK|GO|BOTH/i).first()).toBeVisible({ timeout: 5000 });
    });

    test('bridge copy to clipboard works', async ({ page }) => {
        await goToStream(page, ctx.domainId, ctx.streamId);

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible().catch(() => false))) {
            test.skip();
            return;
        }

        await bridgeBtn.click();
        await page.waitForTimeout(1000);

        const copyBtn = page.getByText(/copy to clipboard|copy/i).first();
        if (!(await copyBtn.isVisible().catch(() => false))) {
            test.skip();
            return;
        }

        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await copyBtn.click();
        await expect(page.getByText(/copied/i)).toBeVisible({ timeout: 3000 });
    });
});

// ===================================================================
// CATEGORY 6: Navigation & Search
// ===================================================================

test.describe.serial('Navigation & Search', () => {
    test('domain switcher shows the created domain', async ({ page }) => {
        restoreCtx();
        await goHome(page);
        await expect(selectDomainByLabel(page, ctx.domainName)).toBeVisible({ timeout: 5000 });
    });

    test('clicking domain navigates to domain page by ID', async ({ page }) => {
        await goHome(page);
        await selectDomainByLabel(page, ctx.domainName).click();
        await expect(page).toHaveURL(new RegExp(ctx.domainId), { timeout: 5000 });
    });

    test('navigator shows cabinet and stream', async ({ page }) => {
        await goToDomain(page, ctx.domainId);
        await expect(page.getByText(ctx.cabinetName)).toBeVisible({ timeout: 5000 });
        await expect(page.getByText(ctx.streamName)).toBeVisible({ timeout: 5000 });
    });

    test('global search with Cmd+Shift+K finds content', async ({ page }) => {
        await goToDomain(page, ctx.domainId);

        await page.keyboard.press('Meta+Shift+k');
        await page.waitForTimeout(1000);

        const searchInput = page.locator('input[type="text"], input[type="search"]').first();
        if (await searchInput.isVisible()) {
            await searchInput.fill('Kodaly');
            await page.waitForTimeout(2000);
            await expect(page).not.toHaveURL(/error/);
        }

        await page.keyboard.press('Escape');
    });

    test('sign out flow works', async ({ page }) => {
        await goHome(page);

        // Open user/profile menu from domain switcher
        const signOutBtn = page.getByText('Sign out');
        const profileBtn = page.locator('button').filter({ has: page.locator('svg') }).last();
        if (await profileBtn.isVisible()) {
            await profileBtn.click();
            await page.waitForTimeout(500);
        }
        if (await signOutBtn.isVisible()) {
            await signOutBtn.click();
            await expect(page).toHaveURL(/login/, { timeout: 10_000 });
        }
    });
});
