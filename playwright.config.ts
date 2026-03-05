import { defineConfig, devices } from '@playwright/test';

const STORAGE_STATE_PATH = '.auth/user.json';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,       // Run tests sequentially (they share state)
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,                 // One worker to avoid conflicts
    reporter: process.env.CI ? 'html' : 'list',
    timeout: 30_000,            // 30s per test

    use: {
        baseURL: 'http://localhost:3000',
        trace: process.env.CI ? 'on-first-retry' : 'off',
        screenshot: process.env.CI ? 'only-on-failure' : 'off',
        video: process.env.CI ? 'retain-on-failure' : 'off',
    },

    projects: [
        // Setup project: logs in once and saves auth state
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
        },
        // Auth tests: test login/signup flows WITHOUT stored auth
        {
            name: 'auth',
            testMatch: /auth\.spec\.ts/,
            use: { ...devices['Desktop Chrome'] },
            dependencies: ['setup'], // Run after setup to ensure server is ready
        },
        // All other tests: run WITH stored auth state
        {
            name: 'chromium',
            testIgnore: /auth\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                storageState: STORAGE_STATE_PATH,
            },
            dependencies: ['setup'], // Run after setup completes
        },
    ],

    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
