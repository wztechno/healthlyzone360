import { defineConfig, devices } from '@playwright/test';

/**
 * The **acceptance** project: the exported application against the **real Laravel API**.
 *
 * Plan §18 ends with "the final foundation acceptance workflow must run against the real Laravel
 * API, not only mocks", and this is that workflow. It is a separate configuration rather than a
 * fourth project in `playwright.config.ts` because it needs a different artefact (`dist-api`, built
 * with `EXPO_PUBLIC_DATA_MODE=api`), a different port, and — most importantly — different
 * scheduling: it mutates a shared database and re-registers the same device on every sign-in, so it
 * must run one worker at a time.
 *
 * Prerequisites, checked by the specs themselves rather than assumed:
 *
 * - the Docker stack is up (`docker compose up -d --wait`), API on `http://localhost:8080`;
 * - Mailpit on `http://localhost:8025`, used to read the verification link;
 * - the demo tenants are seeded;
 * - `dist-api` exists. It is **not** the same artefact as `dist`, and the environment matters:
 *
 *   ```sh
 *   cd apps/universal
 *   EXPO_PUBLIC_DATA_MODE=api EXPO_PUBLIC_API_URL=http://localhost:8080 APP_MODE=all-dev \
 *     pnpm run build:web:api
 *   pnpm run e2e:acceptance
 *   ```
 *
 *   A `dist-api` accidentally built in mock mode is caught immediately: every spec asserts the
 *   development banner is absent, and the mock banner is unmissable.
 *
 * When the stack is unreachable every spec skips with an explicit message instead of failing, so a
 * developer without Docker running is told what to start rather than handed a wall of timeouts.
 */
export const ACCEPTANCE_BASE_URL = process.env['ACCEPTANCE_BASE_URL'] ?? 'http://localhost:4174';
export const ACCEPTANCE_API_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:8080';
export const ACCEPTANCE_MAILPIT_URL = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

export default defineConfig({
    testDir: './e2e/acceptance',
    // Shared backend state: two workers signing in as the same demo account would re-register the
    // same device name and revoke each other's token mid-test.
    fullyParallel: false,
    workers: 1,
    forbidOnly: process.env['CI'] === 'true',
    // A real round trip is allowed to be slow once; it is not allowed to be flaky, so no retries —
    // a failure here is a finding, not something to paper over.
    retries: 0,
    reporter: [['list']],
    timeout: 90_000,
    expect: { timeout: 20_000 },

    use: {
        baseURL: ACCEPTANCE_BASE_URL,
        ...devices['Desktop Chrome'],
        locale: 'en-GB',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'off',
    },

    projects: [{ name: 'acceptance', testMatch: /.*\.acceptance\.spec\.ts/ }],

    webServer: {
        command: 'node e2e/static-server.mjs --root dist-api --port 4174',
        url: ACCEPTANCE_BASE_URL,
        reuseExistingServer: process.env['CI'] !== 'true',
        timeout: 60_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
