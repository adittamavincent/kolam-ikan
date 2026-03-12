import { test as setup, expect } from "@playwright/test";

const ACCOUNTS = [
  {
    email: "test@kolamikan.local",
    password: "KolamTest2026!",
    stateFile: ".auth/user.json",
  },
  {
    email: "admin@kolamikan.local",
    password: "KolamTest2026!",
    stateFile: ".auth/admin.json",
  },
  {
    email: "new@kolamikan.local",
    password: "KolamTest2026!",
    stateFile: ".auth/new.json",
  },
];

for (const account of ACCOUNTS) {
  setup(`authenticate ${account.email}`, async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");

    await page.fill("#email", account.email);
    await page.fill("#password", account.password);
    await page.click('button[type="submit"]');

    const result = await Promise.race([
      page
        .getByText(
          /no account found|incorrect email or password|invalid login credentials/i,
        )
        .waitFor({ timeout: 10_000 })
        .then(() => "error" as const),
      page
        .waitForURL((url) => !url.pathname.includes("/login"), {
          timeout: 10_000,
        })
        .then(() => "success" as const),
    ]);

    if (result === "error") {
      await page.getByRole("button", { name: "Sign Up", exact: true }).click();
      await page.fill("#fullName", account.email.split("@")[0]);
      await page.fill("#email", account.email);
      await page.fill("#password", account.password);
      await page.fill("#confirmPassword", account.password);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.pathname.includes("/login"), {
        timeout: 15_000,
      });
    }

    await expect(page).not.toHaveURL(/login/);
    await page.context().storageState({ path: account.stateFile });
  });
}
