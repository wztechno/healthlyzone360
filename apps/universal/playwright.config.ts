import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against the **exported static build**, not a development server.
 *
 * That is the point: the export is what ships, and it is where pre-rendering, the pre-hydration
 * direction script and the real bundle actually exist. A dev-server run would pass with a broken
 * export.
 *
 * Three projects:
 *
 * | project   | what it proves                                                            |
 * | --------- | ------------------------------------------------------------------------- |
 * | `web-ltr` | the English journeys — sign in, pick a context, revoke a device, forbidden |
 * | `web-rtl` | the same core journey in Arabic, with `dir="rtl"` and logical CSS asserted |
 * | `a11y`    | axe on every functional screen: zero serious or critical violations        |
 */
export const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:4173';

export default defineConfig({
    testDir: './e2e/specs',
    // A shared static server means the projects cannot run in parallel *files* safely only if they
    // shared state; they do not — each test seeds its own cookie and storage.
    fullyParallel: true,
    forbidOnly: process.env['CI'] === 'true',
    retries: 1,
    ...(process.env['CI'] === 'true' ? { workers: 2 } : {}),
    reporter: process.env['CI'] === 'true' ? [['list'], ['html', { open: 'never' }]] : [['list']],
    timeout: 45_000,
    expect: { timeout: 10_000 },

    use: {
        baseURL: BASE_URL,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'off',
    },

    projects: [
        {
            name: 'web-ltr',
            testMatch: /.*\.ltr\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], locale: 'en-GB' },
        },
        {
            name: 'web-rtl',
            testMatch: /.*\.rtl\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], locale: 'ar' },
        },
        {
            name: 'a11y',
            testMatch: /.*\.a11y\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], locale: 'en-GB' },
        },
    ],

    webServer: {
        command: 'node e2e/static-server.mjs --root dist --port 4173',
        url: BASE_URL,
        reuseExistingServer: process.env['CI'] !== 'true',
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
