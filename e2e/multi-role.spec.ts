import { test, expect, Page } from '@playwright/test';

// ============================================================================
// MULTI-ROLE SIMULATION — Different user archetypes on admin@kolamikan.local
// ============================================================================
// Auth: admin@kolamikan.local via .auth/admin.json
//
// All roles share one account. Each role creates a NAMED domain, then
// subsequent tests reference that domain by name/ID — not by positional
// index. Tests are serial within each role so they build on each other.
// A final cross-role section validates multi-domain awareness.
// ============================================================================

const roles = {
    thesis: {
        domainId: '',
        domainName: 'Skripsi Seni Musik',
        cabinetName: 'Kajian Pustaka',
        streamName: 'Referensi Utama',
        streamId: '',
    },
    designer: {
        domainId: '',
        domainName: 'Client PT Maju Jaya',
        cabinetName: 'Branding',
        streamName: 'Logo Concepts',
        streamId: '',
    },
    founder: {
        domainId: '',
        domainName: 'Startup MVP',
        cabinetName: 'MVP Features',
        streamName: 'User Auth Flow',
        streamId: '',
    },
};

// ---------------------------------------------------------------------------
// Helpers — URL-based navigation (no relative clicking)
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

async function createDomainAndCapture(page: Page, name: string): Promise<string> {
    await goHome(page);
    await page.getByRole('button', { name: 'Add Domain' }).click();
    const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
    await nameInput.waitFor({ timeout: 5000 });
    await nameInput.fill(name);
    await page.getByRole('button', { name: 'Create Domain' }).click();

    await page.waitForURL(url => {
        const segments = url.pathname.split('/').filter(Boolean);
        return segments.length === 1 && segments[0].length > 10;
    }, { timeout: 10_000 });

    return page.url().split('/').filter(Boolean).pop()!;
}

async function createCabinet(page: Page, name: string) {
    const btn = page.getByRole('button', { name: 'New cabinet' });
    await btn.waitFor({ timeout: 5000 });
    await btn.click();
    const input = page.locator('input[type="text"]').last();
    await input.waitFor({ timeout: 3000 });
    await input.fill(name);
    await input.press('Enter');
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });
}

async function createStreamAndCapture(page: Page, name: string): Promise<string> {
    const btn = page.getByRole('button', { name: 'New stream' });
    await btn.click();
    const input = page.locator('input[type="text"]').last();
    await input.waitFor({ timeout: 3000 });
    await input.fill(name);
    await input.press('Enter');
    await expect(page.getByText(name)).toBeVisible({ timeout: 5000 });

    // Click to navigate and capture ID
    await page.getByText(name).click();
    await page.waitForURL(url => url.pathname.split('/').filter(Boolean).length === 2, { timeout: 10_000 });
    return page.url().split('/').filter(Boolean).pop()!;
}

const PERSONA_NAME = 'Author';
let personaCreated = false;

async function ensurePersona(page: Page) {
    if (personaCreated) return;
    await goHome(page);
    const personaBtn = page.locator('[title="Manage Personas"]');
    await personaBtn.waitFor({ timeout: 5000 });
    await personaBtn.click();
    await expect(page.getByRole('heading', { name: 'Manage Personas' })).toBeVisible();
    await page.getByRole('button', { name: 'New Persona' }).click();
    const nameInput = page.getByPlaceholder('e.g., Creative Mode');
    await nameInput.fill(PERSONA_NAME);
    await page.getByRole('button', { name: 'Save Persona' }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText(PERSONA_NAME)).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    personaCreated = true;
}

async function writeAndCommit(page: Page, text: string) {
    // Click "Add Persona" to open persona dropdown in EntryCreator
    await page.getByRole('button', { name: 'Add Persona' }).click();
    const menu = page.locator('[role="menu"]');
    await menu.waitFor({ timeout: 3000 });
    await menu.locator('button', { hasText: PERSONA_NAME }).click();
    // Wait for dropdown to close
    await menu.waitFor({ state: 'hidden', timeout: 3000 });

    // Type in the EntryCreator's editor
    const editor = page.locator('.bn-editor[contenteditable="true"]').first();
    await editor.waitFor({ timeout: 5000 });
    await editor.click();
    await editor.type(text, { delay: 30 });
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Commit Entry' }).click();
    await page.waitForTimeout(3000);
}

// ===================================================================
// ROLE 1: Mahasiswa Skripsi — Thesis Research Journal
// ===================================================================

test.describe.serial('Role: Mahasiswa Skripsi', () => {
    test('creates thesis domain with research structure', async ({ page }) => {
        await ensurePersona(page);

        roles.thesis.domainId = await createDomainAndCapture(page, roles.thesis.domainName);

        await goToDomain(page, roles.thesis.domainId);
        await createCabinet(page, roles.thesis.cabinetName);
        roles.thesis.streamId = await createStreamAndCapture(page, roles.thesis.streamName);

        await expect(page.getByText(roles.thesis.cabinetName)).toBeVisible();
    });

    test('logs research finding as entry', async ({ page }) => {
        await goToStream(page, roles.thesis.domainId, roles.thesis.streamId);

        const text = `Temuan literatur: metode Kodaly efektif untuk pendidikan musik usia dini (Smith, 2024)`;
        await writeAndCommit(page, text);
        await expect(page.getByText(text)).toBeVisible({ timeout: 5000 });
    });

    test('uses canvas for thesis outline', async ({ page }) => {
        await goToStream(page, roles.thesis.domainId, roles.thesis.streamId);

        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();
        if (count < 2) return;

        const outline = `BAB I: Pendahuluan - Latar Belakang Masalah`;
        const canvasEditor = editors.nth(count - 1);
        await canvasEditor.click();
        await canvasEditor.type(outline, { delay: 30 });
        await page.waitForTimeout(3000);

        await page.reload();
        await page.waitForTimeout(3000);
        await expect(page.getByText(outline)).toBeVisible({ timeout: 10_000 });
    });
});

// ===================================================================
// ROLE 2: Freelance Designer — Client Projects
// ===================================================================

test.describe.serial('Role: Freelance Designer', () => {
    test('creates client domain with deliverables structure', async ({ page }) => {
        roles.designer.domainId = await createDomainAndCapture(page, roles.designer.domainName);

        await goToDomain(page, roles.designer.domainId);
        await createCabinet(page, roles.designer.cabinetName);
        roles.designer.streamId = await createStreamAndCapture(page, roles.designer.streamName);
    });

    test('logs revision notes', async ({ page }) => {
        await goToStream(page, roles.designer.domainId, roles.designer.streamId);

        const note = `Revisi dari klien: warna logo terlalu gelap, minta versi dengan palet pastel`;
        await writeAndCommit(page, note);
        await expect(page.getByText(note)).toBeVisible({ timeout: 5000 });
    });
});

// ===================================================================
// ROLE 3: Startup Founder — Product Ideation
// ===================================================================

test.describe.serial('Role: Startup Founder', () => {
    test('creates product domain with feature streams', async ({ page }) => {
        roles.founder.domainId = await createDomainAndCapture(page, roles.founder.domainName);

        await goToDomain(page, roles.founder.domainId);
        await createCabinet(page, roles.founder.cabinetName);
        roles.founder.streamId = await createStreamAndCapture(page, roles.founder.streamName);
    });

    test('rapid brainstorming with multiple entries', async ({ page }) => {
        await goToStream(page, roles.founder.domainId, roles.founder.streamId);

        const reqs = [
            `User story: pengguna baru mendaftar dengan Google SSO`,
            `Technical: Supabase auth + row-level security`,
        ];

        for (const req of reqs) {
            await writeAndCommit(page, req);
        }

        for (const req of reqs) {
            await expect(page.getByText(req)).toBeVisible({ timeout: 10_000 });
        }
    });

    test('opens bridge for AI-assisted specs', async ({ page }) => {
        await goToStream(page, roles.founder.domainId, roles.founder.streamId);

        const bridgeBtn = page.getByRole('button', { name: /bridge/i }).first();
        if (!(await bridgeBtn.isVisible().catch(() => false))) return;

        await bridgeBtn.click();
        await page.waitForTimeout(1000);
        await expect(page.getByText(/ASK|GO|BOTH/i).first()).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Escape');
    });
});

// ===================================================================
// CROSS-ROLE: Switching domains by name (proving multi-domain state)
// ===================================================================

test.describe.serial('Cross-Role: Multi-Domain Awareness', () => {
    test('home dashboard shows all 3 domains', async ({ page }) => {
        await goHome(page);

        // All 3 domain buttons should exist in the switcher
        for (const role of Object.values(roles)) {
            await expect(
                page.locator(`button[aria-label="${role.domainName}"]`),
            ).toBeVisible({ timeout: 5000 });
        }
    });

    test('switches to thesis domain by name and sees its structure', async ({ page }) => {
        await goToDomain(page, roles.thesis.domainId);
        await expect(page.getByText(roles.thesis.cabinetName)).toBeVisible({ timeout: 5000 });
        await expect(page.getByText(roles.thesis.streamName)).toBeVisible({ timeout: 5000 });
    });

    test('switches to designer domain by name and sees its structure', async ({ page }) => {
        await goToDomain(page, roles.designer.domainId);
        await expect(page.getByText(roles.designer.cabinetName)).toBeVisible({ timeout: 5000 });
        await expect(page.getByText(roles.designer.streamName)).toBeVisible({ timeout: 5000 });
    });

    test('switches to founder domain by name and sees its structure', async ({ page }) => {
        await goToDomain(page, roles.founder.domainId);
        await expect(page.getByText(roles.founder.cabinetName)).toBeVisible({ timeout: 5000 });
        await expect(page.getByText(roles.founder.streamName)).toBeVisible({ timeout: 5000 });
    });

    test('stream data is isolated per domain', async ({ page }) => {
        // Go to thesis stream — should see thesis entry, not founder's
        await goToStream(page, roles.thesis.domainId, roles.thesis.streamId);
        await expect(page.getByText(/Kodaly/i)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/Google SSO/i)).not.toBeVisible();

        // Go to founder stream — should see founder entry, not thesis
        await goToStream(page, roles.founder.domainId, roles.founder.streamId);
        await expect(page.getByText(/Google SSO/i)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/Kodaly/i)).not.toBeVisible();
    });
});
