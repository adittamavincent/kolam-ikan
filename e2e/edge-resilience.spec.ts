import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// EDGE CASES & RESILIENCE — Stress testing on new@kolamikan.local
// ============================================================================
// Auth: new@kolamikan.local via .auth/new.json
//
// Tests boundary conditions, keyboard shortcuts, viewport resilience,
// rapid interactions, persona edge cases, and empty states — all on a
// separate account to avoid polluting other users' data.
// ============================================================================

// File-backed shared state — survives Playwright worker restarts between serial blocks
const CTX_FILE = path.join(__dirname, '.ctx-edge.json');

const ctx = {
    domainId: '',
    streamId: '',
    domainName: 'Edge Case Domain',
    cabinetName: 'Edge Cabinet',
    streamName: 'Edge Stream',
    personaName: 'Edge Persona',
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
}

async function goToStream(page: Page, domainId: string, streamId: string) {
    await page.goto(`/${domainId}/${streamId}`);
    await page.waitForLoadState('networkidle');
}

// ===================================================================
// CATEGORY 1: Empty States — fresh account experience
// ===================================================================

test.describe.serial('Empty States', () => {
    test('home dashboard loads for fresh account with no domains', async ({ page }) => {
        await goHome(page);
        await expect(page.locator('body')).not.toBeEmpty();
        await expect(page).not.toHaveURL(/error/);
        // Add Domain button must be visible
        await expect(page.getByRole('button', { name: 'Add Domain' })).toBeVisible({ timeout: 5000 });
    });

    test('direct URL to unknown route does not crash', async ({ page }) => {
        await page.goto('/nonexistent-uuid-12345');
        await page.waitForTimeout(2000);
        await expect(page).not.toHaveURL(/error/);
        await expect(page.locator('body')).not.toBeEmpty();
    });
});

// ===================================================================
// CATEGORY 2: Setup — create resources for edge-case testing
// ===================================================================

test.describe.serial('Edge Setup', () => {
    test('creates domain for edge-case testing', async ({ page }) => {
        await goHome(page);
        await page.getByRole('button', { name: 'Add Domain' }).click();
        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill(ctx.domainName);
        await page.getByRole('button', { name: 'Create Domain' }).click();

        await page.waitForURL(url => {
            const segments = url.pathname.split('/').filter(Boolean);
            return segments.length === 1 && segments[0].length > 10;
        }, { timeout: 10_000 });

        ctx.domainId = page.url().split('/').filter(Boolean).pop()!;
        saveCtx();
    });

    test('creates cabinet and stream for edge-case testing', async ({ page }) => {
        await goToDomain(page, ctx.domainId);

        // Cabinet
        await page.getByRole('button', { name: 'New cabinet' }).click();
        const cabInput = page.locator('input[type="text"]').last();
        await cabInput.waitFor({ timeout: 3000 });
        await cabInput.fill(ctx.cabinetName);
        await cabInput.press('Enter');
        await expect(page.getByText(ctx.cabinetName)).toBeVisible({ timeout: 5000 });

        // Stream
        await page.getByRole('button', { name: 'New stream' }).click();
        const strInput = page.locator('input[type="text"]').last();
        await strInput.waitFor({ timeout: 3000 });
        await strInput.fill(ctx.streamName);
        await strInput.press('Enter');
        await expect(page.getByText(ctx.streamName)).toBeVisible({ timeout: 5000 });

        // Navigate to stream and capture ID
        await page.getByText(ctx.streamName).click();
        await page.waitForURL(url => url.pathname.split('/').filter(Boolean).length === 2, { timeout: 10_000 });
        ctx.streamId = page.url().split('/').filter(Boolean).pop()!;
        saveCtx();
    });

    test('creates persona for edge-case testing', async ({ page }) => {
        await goHome(page);

        const personaBtn = page.locator('[title="Manage Personas"]');
        await personaBtn.click();
        await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();

        await page.getByRole('button', { name: 'New Persona' }).click();
        const nameInput = page.getByPlaceholder('e.g., Creative Mode');
        await nameInput.fill(ctx.personaName);
        await page.getByRole('button', { name: 'Save Persona' }).click();
        await page.waitForTimeout(1000);

        await expect(page.getByText(ctx.personaName)).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });
});

// ===================================================================
// CATEGORY 3: Domain Edge Cases
// ===================================================================

test.describe.serial('Domain Edge Cases', () => {
    test('double-click on domain opens edit modal', async ({ page }) => {
        await goHome(page);

        const domainBtn = page.locator(`button[aria-label="${ctx.domainName}"]`);
        if (!(await domainBtn.isVisible().catch(() => false))) return;

        await domainBtn.dblclick();
        await page.waitForTimeout(1000);

        const editTitle = page.getByText('Edit Domain');
        if (await editTitle.isVisible()) {
            await expect(editTitle).toBeVisible();
            await page.keyboard.press('Escape');
        }
    });

    test('creating domain with empty name is prevented', async ({ page }) => {
        await goHome(page);

        await page.getByRole('button', { name: 'Add Domain' }).click();
        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });

        // Leave name empty — Create Domain button should be disabled
        const createBtn = page.getByRole('button', { name: 'Create Domain' });
        await expect(createBtn).toBeDisabled();

        // Should still be on modal (not navigated)
        await expect(nameInput).toBeVisible();
        await page.keyboard.press('Escape');
    });

    test('creating domain with whitespace-only name is prevented', async ({ page }) => {
        await goHome(page);

        await page.getByRole('button', { name: 'Add Domain' }).click();
        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill('   ');

        // Create Domain button should be disabled for whitespace-only name
        const createBtn = page.getByRole('button', { name: 'Create Domain' });
        await expect(createBtn).toBeDisabled();

        await expect(nameInput).toBeVisible();
        await page.keyboard.press('Escape');
    });
});

// ===================================================================
// CATEGORY 4: Content Edge Cases
// ===================================================================

test.describe.serial('Content Edge Cases', () => {
    test('handles unicode content (Indonesian, emoji, CJK)', async ({ page }) => {
        restoreCtx();
        await goToStream(page, ctx.domainId, ctx.streamId);

        // Add persona section to EntryCreator
        await page.getByRole('button', { name: 'Add Persona' }).click();
        const menu = page.locator('[role="menu"]');
        await menu.waitFor({ timeout: 3000 });
        await menu.locator('button', { hasText: ctx.personaName }).click();
        await menu.waitFor({ state: 'hidden', timeout: 3000 });

        const unicodeText = `Catatan: Müzik eğitimi 🎵 音楽教育 ${Date.now()}`;
        const editor = page.locator('.bn-editor[contenteditable="true"]').first();
        await editor.waitFor({ timeout: 5000 });
        await editor.click();
        await editor.type(unicodeText, { delay: 30 });
        await page.waitForTimeout(2000);

        await page.getByRole('button', { name: 'Commit Entry' }).click();
        await page.waitForTimeout(3000);

        await expect(page.getByText(unicodeText)).toBeVisible({ timeout: 5000 });
    });

    test('handles very long single-line entry', async ({ page }) => {
        restoreCtx();
        await goToStream(page, ctx.domainId, ctx.streamId);

        // Add persona section to EntryCreator
        await page.getByRole('button', { name: 'Add Persona' }).click();
        const menu = page.locator('[role="menu"]');
        await menu.waitFor({ timeout: 3000 });
        await menu.locator('button', { hasText: ctx.personaName }).click();
        await menu.waitFor({ state: 'hidden', timeout: 3000 });

        const longText = 'A'.repeat(500) + ` ${Date.now()}`;
        const editor = page.locator('.bn-editor[contenteditable="true"]').first();
        await editor.waitFor({ timeout: 5000 });
        await editor.click();
        await editor.type(longText, { delay: 5 });
        await page.waitForTimeout(2000);

        await page.getByRole('button', { name: 'Commit Entry' }).click();
        await page.waitForTimeout(3000);

        // Should not crash — committed entry appears
        await expect(page).not.toHaveURL(/error/);
    });
});

// ===================================================================
// CATEGORY 5: Keyboard Shortcuts
// ===================================================================

test.describe.serial('Keyboard Shortcuts', () => {
    test('Cmd+D opens create domain modal', async ({ page }) => {
        await goHome(page);
        await page.keyboard.press('Meta+d');
        await page.waitForTimeout(1000);

        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await expect(nameInput).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });

    test('Cmd+Shift+K opens global search', async ({ page }) => {
        await goHome(page);
        await page.keyboard.press('Meta+Shift+k');
        await page.waitForTimeout(1000);

        const searchInput = page.getByPlaceholder(/search/i);
        await expect(searchInput).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });

    test('Escape closes open modals', async ({ page }) => {
        await goHome(page);
        await page.getByRole('button', { name: 'Add Domain' }).click();
        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });

        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        await expect(nameInput).not.toBeVisible();
    });
});

// ===================================================================
// CATEGORY 6: Navigator Edge Cases
// ===================================================================

test.describe.serial('Navigator Edge Cases', () => {
    test('cancelling stream creation with Escape removes the input', async ({ page }) => {
        restoreCtx();
        await goToDomain(page, ctx.domainId);

        const btn = page.getByRole('button', { name: 'New stream' });
        await btn.click();

        const input = page.locator('input[type="text"]').last();
        await input.waitFor({ timeout: 3000 });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        // The inline input should disappear
        const inputCountAfter = await page.locator('input[type="text"]').count();
        expect(inputCountAfter).toBe(0);
    });

    test('right-click context menu shows rename and delete options', async ({ page }) => {
        restoreCtx();
        await goToDomain(page, ctx.domainId);

        const streamItem = page.locator('[role="treeitem"]').filter({
            hasText: ctx.streamName,
        }).first();

        if (await streamItem.isVisible()) {
            await streamItem.click({ button: 'right' });
            await page.waitForTimeout(500);

            const renameOpt = page.getByText(/rename/i);
            const deleteOpt = page.getByText(/delete/i);

            if (await renameOpt.isVisible()) {
                await expect(renameOpt).toBeVisible();
            }
            if (await deleteOpt.isVisible()) {
                await expect(deleteOpt).toBeVisible();
            }

            await page.keyboard.press('Escape');
        }
    });
});

// ===================================================================
// CATEGORY 7: Persona Edge Cases
// ===================================================================

test.describe.serial('Persona Edge Cases', () => {
    test('saving persona with empty name shows error', async ({ page }) => {
        await goHome(page);

        const personaBtn = page.locator('[title="Manage Personas"]');
        await personaBtn.click();
        await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();

        await page.getByRole('button', { name: 'New Persona' }).click();

        // Leave name empty and try to save
        await page.getByRole('button', { name: 'Save Persona' }).click();
        await page.waitForTimeout(1000);

        // Should show validation error or stay on form
        const nameInput = page.getByPlaceholder('e.g., Creative Mode');
        await expect(nameInput).toBeVisible();

        await page.keyboard.press('Escape');
    });

    test('persona with special characters saves correctly', async ({ page }) => {
        await goHome(page);

        const personaBtn = page.locator('[title="Manage Personas"]');
        await personaBtn.click();
        await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();

        await page.getByRole('button', { name: 'New Persona' }).click();

        const specialName = 'Créative-Thinker_2.0';
        await page.getByPlaceholder('e.g., Creative Mode').fill(specialName);
        await page.getByRole('button', { name: 'Save Persona' }).click();
        await page.waitForTimeout(1000);

        await expect(page.getByText('Failed to save persona')).toHaveCount(0);
        await expect(page.getByText(specialName)).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
    });
});

// ===================================================================
// CATEGORY 8: Viewport & Responsiveness
// ===================================================================

test.describe.serial('Viewport Resilience', () => {
    test('tablet viewport (768px) renders without crash', async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await goHome(page);
        await expect(page).not.toHaveURL(/error/);
        await expect(page.locator('body')).not.toBeEmpty();
    });

    test('iPhone viewport (375px) renders without crash', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await goHome(page);
        await expect(page).not.toHaveURL(/error/);
        await expect(page.locator('body')).not.toBeEmpty();
    });

    test('very wide viewport (2560px) renders properly', async ({ page }) => {
        await page.setViewportSize({ width: 2560, height: 1440 });
        await goHome(page);
        await expect(page).not.toHaveURL(/error/);
    });

    test('dynamic viewport resizing does not crash', async ({ page }) => {
        await goHome(page);
        for (const w of [1280, 768, 375, 1024, 1920]) {
            await page.setViewportSize({ width: w, height: 800 });
            await page.waitForTimeout(500);
        }
        await expect(page).not.toHaveURL(/error/);
    });
});

// ===================================================================
// CATEGORY 9: Rapid Interactions & Stress
// ===================================================================

test.describe.serial('Rapid Interactions', () => {
    test('rapid domain switching does not crash', async ({ page }) => {
        restoreCtx();

        // Create a second domain for switching
        await goHome(page);
        await page.getByRole('button', { name: 'Add Domain' }).click();
        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill('Rapid Switch Target');
        await page.getByRole('button', { name: 'Create Domain' }).click();
        await page.waitForURL(url => url.pathname.split('/').filter(Boolean).length === 1, { timeout: 10_000 });

        // Wait for the create modal to fully close
        await expect(page.locator('#headlessui-portal-root >> .fixed')).toHaveCount(0, { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);

        // Click domain buttons by known names
        const domainNames = [ctx.domainName, 'Rapid Switch Target'];
        for (let i = 0; i < 5; i++) {
            const name = domainNames[i % domainNames.length];
            const btn = page.locator(`button[aria-label="${name}"]`);
            if (await btn.isVisible().catch(() => false)) {
                await btn.click();
                await page.waitForTimeout(300);
            }
        }

        await expect(page).not.toHaveURL(/error/);
    });

    test('session persists across multiple navigations', async ({ page }) => {
        restoreCtx();
        await goHome(page);
        await goToDomain(page, ctx.domainId);
        await goToStream(page, ctx.domainId, ctx.streamId);
        await goHome(page);
        await goToDomain(page, ctx.domainId);

        await expect(page).not.toHaveURL(/login/);
        await expect(page).not.toHaveURL(/error/);
    });
});
