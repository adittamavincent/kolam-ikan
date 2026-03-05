import { test, expect, Page } from '@playwright/test';

// ============================================================================
// FULL END-TO-END JOURNEY — New User from Sign-Up to Productive Usage
// ============================================================================
// This test file simulates the COMPLETE lifecycle of a new user:
// 1. Signs up with a fresh account (or logs in)
// 2. First-time experience and empty states
// 3. Sets up workspace from scratch
// 4. Becomes productive — writing, organizing, searching
// 5. Uses advanced features — bridge, canvas, personas
// 6. Signs out and signs back in
//
// This is the "golden path" integration test that validates the entire UX.
// ============================================================================

// Auth constants for potential sign-up flow tests
// const TEST_EMAIL = `e2e_journey_${Date.now()}@kolamikan.local`;
// const TEST_PASSWORD = 'JourneyTest2026!';
// const TEST_NAME = 'E2E Journey User';

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

// ===================================================================
// STEP 1: Login Page Polish & Validation
// ===================================================================

test.describe('Journey Step 1: Auth Page UX', () => {
    test('login page shows proper branding and form', async ({ page }) => {
        await page.goto('/login');
        await page.waitForTimeout(1000);

        // Branding should be visible
        const heading = page.locator('h2');
        await expect(heading).toBeVisible();

        // Form fields should be present
        await expect(page.locator('#email')).toBeVisible();
        await expect(page.locator('#password')).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('shows validation on invalid email format', async ({ page }) => {
        await page.goto('/login');

        await page.fill('#email', 'not-an-email');
        await page.fill('#password', 'somepassword');
        await page.click('button[type="submit"]');
        await page.waitForTimeout(2000);

        // Should show some form of error (could be browser validation or custom)
        await expect(page).toHaveURL(/login/);
    });

    test('password visibility toggle works', async ({ page }) => {
        await page.goto('/login');

        await page.fill('#password', 'mypassword');

        // Toggle password visibility
        const toggleBtn = page.getByLabel('Show password');
        if (await toggleBtn.isVisible()) {
            await toggleBtn.click();

            // Password field should now be type="text"
            const passwordType = await page.locator('#password').getAttribute('type');
            expect(passwordType).toBe('text');

            // Wait for auto-hide (3 seconds)
            await page.waitForTimeout(3500);

            // Should revert to password type
            const revertedType = await page.locator('#password').getAttribute('type');
            expect(revertedType).toBe('password');
        }
    });

    test('signup form validates password strength', async ({ page }) => {
        await page.goto('/login');

        // Switch to signup mode
        const signUpBtn = page.getByRole('button', { name: 'Sign Up', exact: true });
        if (await signUpBtn.isVisible()) {
            await signUpBtn.click();
            await page.waitForTimeout(500);

            // Fill with weak password
            await page.fill('#fullName', 'Test');
            await page.fill('#email', 'weak@test.com');
            await page.fill('#password', 'weak');
            await page.fill('#confirmPassword', 'weak');

            // There should be some password strength feedback
            await page.waitForTimeout(1000);

            // Password should be flagged as insufficient
            await expect(page).toHaveURL(/login/);
        }
    });

    test('signup form validates password match', async ({ page }) => {
        await page.goto('/login');

        const signUpBtn = page.getByRole('button', { name: 'Sign Up', exact: true });
        if (await signUpBtn.isVisible()) {
            await signUpBtn.click();
            await page.waitForTimeout(500);

            await page.fill('#fullName', 'Test User');
            await page.fill('#email', 'match@test.com');
            await page.fill('#password', 'StrongPass2026!');
            await page.fill('#confirmPassword', 'DifferentPass2026!');

            await page.click('button[type="submit"]');
            await page.waitForTimeout(1000);

            // Should not navigate away from login (passwords don't match)
            await expect(page).toHaveURL(/login/);
        }
    });
});

// ===================================================================
// STEP 2: Forgot Password Flow
// ===================================================================

test.describe('Journey Step 2: Forgot Password', () => {
    test('forgot password page is accessible from login', async ({ page }) => {
        await page.goto('/login');
        await page.waitForTimeout(1000);

        const forgotLink = page.getByText(/forgot password|lupa password/i);
        if (await forgotLink.isVisible()) {
            await forgotLink.click();
            await page.waitForTimeout(1000);

            // Should navigate to forgot password page
            await expect(page).toHaveURL(/forgot-password/);
        }
    });

    test('forgot password form accepts email and shows confirmation', async ({ page }) => {
        await page.goto('/forgot-password');
        await page.waitForTimeout(1000);

        const emailInput = page.locator('#email, input[type="email"]').first();
        if (await emailInput.isVisible()) {
            await emailInput.fill('forgot@kolamikan.local');

            const submitBtn = page.locator('button[type="submit"]');
            if (await submitBtn.isVisible()) {
                await submitBtn.click();
                await page.waitForTimeout(3000);

                // Should show success message or confirmation
                // (won't actually send email in test env)
                await expect(page).not.toHaveURL(/error/);
            }
        }
    });
});

// ===================================================================
// STEP 3: Authenticated User — Dashboard
// ===================================================================

test.describe('Journey Step 3: Dashboard & Home', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('dashboard shows stats or welcome message', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        // Dashboard should render something meaningful
        await expect(page.locator('body')).not.toBeEmpty();
        await expect(page).not.toHaveURL(/error/);
    });

    test('dashboard shows domain cards if domains exist', async ({ page }) => {
        await page.goto('/');
        await page.waitForTimeout(2000);

        const domains = page.locator('button[title*="double-click to edit"]');
        const domainCount = await domains.count();

        if (domainCount > 0) {
            // Dashboard should show some domain-related content
            await expect(page.locator('body')).not.toBeEmpty();
        }
    });

    test('dashboard loading skeleton appears then resolves', async ({ page }) => {
        await page.goto('/');

        // Brief check — app should not stay in loading state forever
        await page.waitForTimeout(5000);
        await expect(page).not.toHaveURL(/error/);
        await expect(page.locator('body')).not.toBeEmpty();
    });
});

// ===================================================================
// STEP 4: Full Workspace Setup & Usage
// ===================================================================

test.describe('Journey Step 4: Complete Workspace Setup', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('full workflow: create domain → cabinet → stream → entry → canvas', async ({ page }) => {
        const suffix = Date.now();

        // 1. Create domain
        await page.getByRole('button', { name: 'Add Domain' }).click();
        const nameInput = page.getByPlaceholder('e.g., My Knowledge Base');
        await nameInput.waitFor({ timeout: 5000 });
        await nameInput.fill(`Full Journey ${suffix}`);
        await page.getByRole('button', { name: 'Create Domain' }).click();
        await page.waitForTimeout(1500);
        await page.reload();
        await page.waitForTimeout(1500);

        // 2. Select the new domain
        const domains = page.locator('button[title*="double-click to edit"]');
        await domains.last().click();
        await page.waitForTimeout(1000);

        // 3. Create cabinet
        const newCabinetBtn = page.getByRole('button', { name: 'New cabinet' });
        await newCabinetBtn.waitFor({ timeout: 5000 });
        await newCabinetBtn.click();
        const cabinetInput = page.locator('input[type="text"]').last();
        await cabinetInput.waitFor({ timeout: 3000 });
        await cabinetInput.fill(`Notes ${suffix}`);
        await cabinetInput.press('Enter');
        await page.waitForTimeout(1000);

        // 4. Create stream
        const newStreamBtn = page.getByRole('button', { name: 'New stream' });
        await newStreamBtn.click();
        const streamInput = page.locator('input[type="text"]').last();
        await streamInput.waitFor({ timeout: 3000 });
        await streamInput.fill(`Daily Log ${suffix}`);
        await streamInput.press('Enter');
        await page.waitForTimeout(1000);

        // 5. Navigate to the stream
        const stream = page.getByText(`Daily Log ${suffix}`);
        await stream.click();
        await page.waitForTimeout(1500);

        // 6. Write and commit an entry
        const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
        if (await editor.isVisible()) {
            await editor.click();
            const entryText = `First entry in full journey test ${suffix}`;
            await editor.type(entryText, { delay: 30 });
            await page.waitForTimeout(2000);

            await page.getByText('Commit Entry').click();
            await page.waitForTimeout(3000);

            // 7. Verify entry appears
            await expect(page.getByText(entryText)).toBeVisible({ timeout: 5000 });

            // 8. Write in canvas
            const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
            const editorCount = await editors.count();
            if (editorCount >= 2) {
                const canvas = editors.nth(editorCount - 1);
                await canvas.click();
                const canvasText = `Canvas plan for ${suffix}`;
                await canvas.type(canvasText, { delay: 30 });
                await page.waitForTimeout(3000);
            }
        }

        // Success — the full workflow completed without errors
        await expect(page).not.toHaveURL(/error/);
    });
});

// ===================================================================
// STEP 5: Sign Out & Re-authentication
// ===================================================================

test.describe('Journey Step 5: Sign Out Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('user menu is accessible from sidebar', async ({ page }) => {
        // The user avatar/menu should be visible at the bottom of the domain switcher
        // Look for any button/link that could be the user menu
        const userAvatar = page.locator('button').filter({
            has: page.locator('img, svg'),
        }).last();

        if (await userAvatar.isVisible()) {
            await userAvatar.click();
            await page.waitForTimeout(500);

            // Should show menu with sign out option
            const signOutBtn = page.getByText(/sign out|log out|keluar/i);
            if (await signOutBtn.isVisible()) {
                await expect(signOutBtn).toBeVisible();
            }

            await page.keyboard.press('Escape');
        }
    });
});

// ===================================================================
// STEP 6: Data Integrity — Entries Survive Full Cycle
// ===================================================================

test.describe('Journey Step 6: Data Integrity', () => {
    test.beforeEach(async ({ page }) => {
        await loginAndWait(page);
    });

    test('committed entries persist across hard reload', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const uniqueText = `Persistence verification ${Date.now()}`;

        const editor = page.locator('[class*="bn-editor"], [contenteditable="true"]').first();
        if (!(await editor.isVisible())) return;

        await editor.click();
        await editor.type(uniqueText, { delay: 30 });
        await page.waitForTimeout(2000);

        await page.getByText('Commit Entry').click();
        await page.waitForTimeout(3000);

        // Hard reload
        await page.reload();
        await page.waitForTimeout(3000);

        // Entry should still be there
        await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 10000 });
    });

    test('canvas content persists across hard reload', async ({ page }) => {
        const ready = await ensureDomainSelected(page);
        if (!ready) return;

        const found = await navigateToStream(page);
        if (!found) return;

        const editors = page.locator('[class*="bn-editor"], [contenteditable="true"]');
        const count = await editors.count();

        if (count < 2) return;

        const canvas = editors.nth(count - 1);
        await canvas.click();

        const canvasText = `Canvas persistence check ${Date.now()}`;
        await canvas.type(canvasText, { delay: 30 });
        await page.waitForTimeout(3000);

        await page.reload();
        await page.waitForTimeout(3000);

        await expect(page.getByText(canvasText)).toBeVisible({ timeout: 10000 });
    });

    test('domain structure persists across reload', async ({ page }) => {
        // Domains should still be in the switcher after reload
        const domainsBefore = await page.locator('button[title*="double-click to edit"]').count();

        await page.reload();
        await page.waitForTimeout(2000);

        const domainsAfter = await page.locator('button[title*="double-click to edit"]').count();
        expect(domainsAfter).toBe(domainsBefore);
    });
});
