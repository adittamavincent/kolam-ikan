import { test as setup, expect } from '@playwright/test';

const STORAGE_STATE_PATH = '.auth/user.json';

const TEST_USER = {
    email: 'test@kolamikan.local',
    password: 'KolamTest2026!',
};

setup('authenticate', async ({ page }) => {
    await page.goto('/login');
    
    // First, try to log in
    await page.fill('#email', TEST_USER.email);
    await page.fill('#password', TEST_USER.password);
    await page.click('button[type="submit"]');

    // Wait a moment for error or redirect
    await page.waitForTimeout(2000);

    // Check if we got an error (user doesn't exist)
    const errorVisible = await page.getByText(/no account found|incorrect email or password|invalid login credentials/i).isVisible().catch(() => false);
    
    if (errorVisible) {
        console.log('Test user does not exist, creating via signup...');
        
        // Switch to Sign Up mode
        await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
        
        // Fill signup form
            await page.fill('#fullName', 'Test User');
        await page.fill('#email', TEST_USER.email);
        await page.fill('#password', TEST_USER.password);
        await page.fill('#confirmPassword', TEST_USER.password);
        
        // Submit signup
        await page.click('button[type="submit"]');
    }

    // Wait for navigation away from login page (could redirect to /, /home, or /domain/...)
    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 15_000 });
    
    // Double-check: verify we're logged in by checking we're NOT on login page
    await expect(page).not.toHaveURL(/login/);

    // Save authenticated state
    await page.context().storageState({ path: STORAGE_STATE_PATH });
});
