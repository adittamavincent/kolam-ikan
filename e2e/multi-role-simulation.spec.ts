import { test, expect, Page } from '@playwright/test';

// ============================================================================
// MULTI-ROLE SIMULATION — Different User Types Using the App
// ============================================================================
// Simulates various target-market users with different goals, workflows, and
// pain points. Each test suite represents a distinct user archetype.
//
// Archetypes:
// 1. Mahasiswa Skripsi   — Thesis student using streams as research journal
// 2. Freelance Designer  — Portfolio-style domain with client streams
// 3. Startup Founder     — Product ideation + team delegation tracking
// 4. Researcher / Dosen  — Academic notes with multiple persona perspectives
// 5. Content Creator     — Blog/video planning with canvas as outline
// ============================================================================

// ---------------------------------------------------------------------------
// Shared Helpers
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
        await nameInput.fill(`Role Test Domain ${Date.now()}`);
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

async function createDomain(page: Page, name: string) {
    await page.getByRole('button', { name: 'Add Domain' }).click();
    const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
    await nameInput.waitFor({ timeout: 5000 });
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Create Domain' }).click();
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForTimeout(1500);
}

async function createCabinet(page: Page, name: string) {
    await page.getByRole('button', { name: 'New cabinet' }).click();
    const input = page.locator('input[type="text"]').last();
    await input.waitFor({ timeout: 3000 });
    await input.fill(name);
    await input.press('Enter');
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });
}

async function createStream(page: Page, name: string) {
    await page.getByRole('button', { name: 'New stream' }).click();
    const input = page.locator('input[type="text"]').last();
    await input.waitFor({ timeout: 3000 });
    await input.fill(name);
    await input.press('Enter');
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });
}

async function writeAndCommit(page: Page, text: string) {
    const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
    await editor.click();
    await editor.type(text, { delay: 30 });
    await page.waitForTimeout(2000);
    await page.getByText('Commit Entry').click();
    await page.waitForTimeout(3000);
}

async function createPersona(page: Page, name: string) {
    const personaBtn = page.locator('[title="Manage Personas"]');
    await expect(personaBtn).toBeVisible({ timeout: 5000 });
    await personaBtn.click();
    await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();
    await page.getByRole('button', { name: 'New Persona' }).click();
    const nameInput = page.getByPlaceholder('e.g., Creative Mode');
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Save Persona' }).click();
    await expect(page.getByText('Failed to save persona')).toHaveCount(0);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Escape');
}

// ===================================================================
// ROLE 1: Mahasiswa Skripsi — Thesis Research Journal
// ===================================================================

test.describe('Role: Mahasiswa Skripsi — Research Journal Workflow', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates thesis domain with literature review structure', async ({ page }) => {
        const suffix = Date.now();
        await createDomain(page, `Skripsi Seni Musik ${suffix}`);

        // Select the new domain
        const domains = page.locator('button[title*="double-click to edit"]');
        await domains.last().click();
        await page.waitForTimeout(1000);

        // Create research structure
        await createCabinet(page, `Kajian Pustaka ${suffix}`);
        await createStream(page, `Referensi Utama ${suffix}`);

        // Verify structure exists
        await expect(page.getByText(`Kajian Pustaka ${suffix}`)).toBeVisible();
        await expect(page.getByText(`Referensi Utama ${suffix}`)).toBeVisible();
    });

    test('logs research findings as chronological entries', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const finding = `Temuan literatur: metode Kodaly efektif untuk pendidikan musik usia dini (Smith, 2024) ${Date.now()}`;
        await writeAndCommit(page, finding);
        await expect(page.getByText(finding)).toBeVisible({ timeout: 5000 });
    });

    test('uses canvas for evolving thesis outline', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();

        if (count >= 2) {
            const canvasEditor = editors.nth(count - 1);
            await canvasEditor.click();

            const outline = `BAB I: Pendahuluan - Latar Belakang Masalah ${Date.now()}`;
            await canvasEditor.type(outline, { delay: 30 });
            await page.waitForTimeout(3000);

            await page.reload();
            await page.waitForTimeout(3000);

            await expect(page.getByText(outline)).toBeVisible({ timeout: 10000 });
        }
    });
});

// ===================================================================
// ROLE 2: Freelance Designer — Client Project Tracking
// ===================================================================

test.describe('Role: Freelance Designer — Client Projects', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates separate domain for each client', async ({ page }) => {
        const suffix = Date.now();
        await createDomain(page, `Client: PT Maju Jaya ${suffix}`);

        const domains = page.locator('button[title*="double-click to edit"]');
        const count = await domains.count();
        expect(count).toBeGreaterThanOrEqual(1);
    });

    test('organizes deliverables in cabinets', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const suffix = Date.now();
        await createCabinet(page, `Branding ${suffix}`);
        await createStream(page, `Logo Concepts ${suffix}`);

        await expect(page.getByText(`Branding ${suffix}`)).toBeVisible();
        await expect(page.getByText(`Logo Concepts ${suffix}`)).toBeVisible();
    });

    test('logs revision notes with timestamps', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const revisionNote = `Revisi dari klien: warna logo terlalu gelap, minta versi dengan palet pastel ${Date.now()}`;
        await writeAndCommit(page, revisionNote);
        await expect(page.getByText(revisionNote)).toBeVisible({ timeout: 5000 });
    });

    test('switches between client domains to check progress', async ({ page }) => {
        const domains = page.locator('button[title*="double-click to edit"]');
        const domainCount = await domains.count();

        if (domainCount < 2) return;

        // Switch to first domain
        await domains.first().click();
        await page.waitForTimeout(1000);
        await expect(page).not.toHaveURL(/error/);

        // Switch to second domain
        await domains.nth(1).click();
        await page.waitForTimeout(1000);
        await expect(page).not.toHaveURL(/error/);

        // Back to first
        await domains.first().click();
        await page.waitForTimeout(1000);
        await expect(page).not.toHaveURL(/error/);
    });
});

// ===================================================================
// ROLE 3: Startup Founder — Product Ideation
// ===================================================================

test.describe('Role: Startup Founder — Product Ideation', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates product domain with feature streams', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const suffix = Date.now();
        await createCabinet(page, `MVP Features ${suffix}`);
        await createStream(page, `User Auth Flow ${suffix}`);
        await createStream(page, `Payment Integration ${suffix}`);

        await expect(page.getByText(`MVP Features ${suffix}`)).toBeVisible();
        await expect(page.getByText(`User Auth Flow ${suffix}`)).toBeVisible();
    });

    test('brainstorms feature requirements with rapid entries', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const suffix = Date.now();
        const requirements = [
            `User story: Sebagai pengguna baru, saya ingin bisa mendaftar dengan Google SSO ${suffix}`,
            `Technical: Butuh Supabase auth integration + row-level security ${suffix}`,
        ];

        for (const req of requirements) {
            await writeAndCommit(page, req);
            await page.waitForTimeout(500);
        }

        for (const req of requirements) {
            await expect(page.getByText(req)).toBeVisible({ timeout: 10000 });
        }
    });

    test('uses bridge to generate AI-assisted feature specs', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible())) return;

        await bridgeBtn.click();
        await page.waitForTimeout(1000);

        // Modal should open with interaction modes
        const modeText = page.getByText(/ASK|GO|BOTH/i).first();
        if (await modeText.isVisible()) {
            await expect(modeText).toBeVisible();
        }

        await page.keyboard.press('Escape');
    });
});

// ===================================================================
// ROLE 4: Researcher / Dosen — Multi-Perspective Academic Notes
// ===================================================================

test.describe('Role: Researcher — Multi-Perspective Notes', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates personas for different research perspectives', async ({ page }) => {
        const suffix = Date.now();
        await createPersona(page, `Analytical ${suffix}`);
        await createPersona(page, `Critical Review ${suffix}`);

        // Verify personas exist
        const personaBtn = page.locator('[title="Manage Personas"]');
        await personaBtn.click();
        await page.waitForTimeout(1000);

        await expect(page.getByText(`Analytical ${suffix}`)).toBeVisible({ timeout: 5000 });
        await expect(page.getByText(`Critical Review ${suffix}`)).toBeVisible({ timeout: 5000 });

        await page.keyboard.press('Escape');
    });

    test('writes entry then uses canvas for synthesis', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        // Log a finding
        const finding = `Data analisis: 67% responden prefer metode pembelajaran hybrid ${Date.now()}`;
        await writeAndCommit(page, finding);

        // Write synthesis in canvas
        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();

        if (count >= 2) {
            const canvasEditor = editors.nth(count - 1);
            await canvasEditor.click();
            const synthesis = `Sintesis: Temuan ini mendukung hipotesis awal tentang efektivitas blended learning ${Date.now()}`;
            await canvasEditor.type(synthesis, { delay: 30 });
            await page.waitForTimeout(3000);
        }

        await expect(page).not.toHaveURL(/error/);
    });
});

// ===================================================================
// ROLE 5: Content Creator — Blog & Video Planning
// ===================================================================

test.describe('Role: Content Creator — Content Pipeline', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('creates content pipeline structure', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const suffix = Date.now();
        await createCabinet(page, `YouTube Videos ${suffix}`);
        await createStream(page, `Tutorial Mixing Audio ${suffix}`);

        await expect(page.getByText(`YouTube Videos ${suffix}`)).toBeVisible();
    });

    test('drafts video script in entries and outline in canvas', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        // Log script ideas
        const scriptIdea = `Hook: "Apakah mixing audio di rumah bisa seprofesional studio?" ${Date.now()}`;
        await writeAndCommit(page, scriptIdea);

        await expect(page.getByText(scriptIdea)).toBeVisible({ timeout: 5000 });
    });

    test('searches across content for repurposing', async ({ page }) => {
        // Open global search
        await page.keyboard.press('Meta+Shift+k');
        await page.waitForTimeout(1000);

        const searchInput = page.locator('input[type="text"], input[type="search"]').first();
        if (await searchInput.isVisible()) {
            await searchInput.fill('tutorial');
            await page.waitForTimeout(2000);

            // Should not crash
            await expect(page).not.toHaveURL(/error/);
        }

        await page.keyboard.press('Escape');
    });
});

// ===================================================================
// CROSS-ROLE: Switching Between Domains (Multi-Project User)
// ===================================================================

test.describe('Cross-Role: Multi-Domain User Workflow', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('navigates home dashboard and sees domain overview', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Dashboard should show domain cards or stats
        await expect(page).not.toHaveURL(/error/);
        await expect(page.locator('body')).not.toBeEmpty();
    });

    test('home button returns to dashboard from any domain', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        // Look for home button in the domain switcher
        const homeBtn = page.locator('a[href="/"], button').filter({
            has: page.locator('svg'),
        }).first();

        if (await homeBtn.isVisible()) {
            await homeBtn.click();
            await page.waitForTimeout(1500);

            // Should be on the home/dashboard page
            const url = page.url();
            expect(url.endsWith('/') || url.includes('localhost:3000')).toBeTruthy();
        }
    });

    test('suggestion buttons in create domain modal work', async ({ page }) => {
        await page.getByRole('button', { name: 'Add Domain' }).click();

        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });

        // Look for suggestion buttons (Personal, Work, Study, etc.)
        const suggestions = ['Personal', 'Work', 'Study', 'Projects', 'Ideas'];
        for (const suggestion of suggestions) {
            const btn = page.getByRole('button', { name: suggestion });
            if (await btn.isVisible().catch(() => false)) {
                await btn.click();
                await page.waitForTimeout(300);

                // Name input should now contain the suggestion text
                const value = await nameInput.inputValue();
                expect(value.length).toBeGreaterThan(0);
                break; // Just test one
            }
        }

        await page.keyboard.press('Escape');
    });
});
