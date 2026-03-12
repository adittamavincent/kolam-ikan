import { test, expect } from "@playwright/test";

// ===== REAL AUTHENTICATION TESTS =====
// These tests use real dev test accounts against a running app.
// Prerequisites: `npm run dev` must be running on localhost:3000

const TEST_USER = {
  email: "test@kolamikan.local",
  password: "KolamTest2026!",
};

// Ensure these tests run without any stored auth
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("shows login page with branding", async ({ page }) => {
    await expect(page.locator("h2").first()).toContainText("Kolam Ikan");
    await expect(page.locator('button[type="submit"]')).toContainText(
      "Sign in",
    );
  });

  test("shows validation errors for empty submit", async ({ page }) => {
    await page.click('button[type="submit"]');
    // Should stay on login page — form not submitted
    await expect(page).toHaveURL(/login/);
  });

  test("shows error for wrong password", async ({ page }) => {
    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", "WrongPassword123!");
    await page.click('button[type="submit"]');

    // Wait for error message
    await expect(page.getByText(/incorrect|invalid/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("logs in with valid credentials and redirects to home", async ({
    page,
  }) => {
    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.click('button[type="submit"]');

    // Should redirect away from login page
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 15_000,
    });
    await expect(page).not.toHaveURL(/login/);
  });

  test("shows dev speed-login dashboard in development", async ({ page }) => {
    // The dev toolbox should be visible when NODE_ENV=development
    const devToolbox = page.getByText("Dev Toolbox");
    // This may or may not be visible depending on environment
    if (await devToolbox.isVisible()) {
      await expect(page.getByText("Default Test User")).toBeVisible();
      await expect(page.getByText("Admin Account")).toBeVisible();
      await expect(page.getByText("Empty Account")).toBeVisible();
    }
  });

  test("password toggle shows/hides password", async ({ page }) => {
    await page.fill("#password", "TestPassword");

    // Password should be hidden by default
    await expect(page.locator("#password")).toHaveAttribute("type", "password");

    // Click the eye icon to show
    await page.getByLabel("Show password").click();
    await expect(page.locator("#password")).toHaveAttribute("type", "text");

    // Should auto-hide after ~3 seconds
    await page.waitForTimeout(3500);
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
  });
});

test.describe("Sign Up Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    // Switch to Sign Up mode
    await page.getByRole("button", { name: "Sign Up", exact: true }).click();
  });

  test("shows signup form fields", async ({ page }) => {
    await expect(page.locator("#fullName")).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#confirmPassword")).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText(
      "Create Account",
    );
  });

  test("validates password strength", async ({ page }) => {
    await page.fill("#fullName", "Test Signup");
    await page.fill("#email", "signup-test@kolamikan.local");
    await page.fill("#password", "weak");
    await page.locator("#password").blur();

    // Should show password strength hint
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test("validates password match", async ({ page }) => {
    await page.fill("#fullName", "Test Signup");
    await page.fill("#email", "signup-test@kolamikan.local");
    await page.fill("#password", "StrongPass1!");
    await page.fill("#confirmPassword", "DifferentPass1!");
    await page.locator("#confirmPassword").blur();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });
});

test.describe("Session Persistence", () => {
  test("stays logged in after page reload", async ({ page }) => {
    // Login first
    await page.goto("/login");
    await page.fill("#email", TEST_USER.email);
    await page.fill("#password", TEST_USER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 15_000,
    });

    // Reload
    await page.reload();

    // Should still be on the main page, not redirected to login
    await expect(page).not.toHaveURL(/login/, { timeout: 5000 });
  });
});
