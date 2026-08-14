import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against the **exported static build**, not a development server, and that build
 * reads the **real Laravel API**.
 *
 * Both halves of that sentence are load-bearing. The export is what ships, and it is where
 * pre-rendering, the pre-hydration direction script and the real bundle actually exist — a
 * dev-server run would pass with a broken export. The API is what the application will talk to in
 * production; a suite that only ever spoke to fixtures proved the fixtures.
 *
 * ## One artefact, one server
 *
 * There is exactly one export now — `dist-api`, pointed at the stack via `EXPO_PUBLIC_API_URL` —
 * and one static server in front of it on `:4173`. The mock artefact (`dist`) and its second server are
 * gone, along with the conditional registration that used to make `dist-api` optional: it is not
 * optional any more, so a missing one is an error with instructions rather than a suite that
 * quietly loses a third of its projects.
 *
 * ```sh
 * cd apps/universal
 * APP_MODE=all-dev APP_ENV=development \
 *   EXPO_PUBLIC_API_URL=http://localhost:8080 \
 *   pnpm run build:web:api
 * pnpm run e2e                       # every read-only project
 * pnpm run e2e:write                 # the mutating journeys, one worker
 * ```
 *
 * Four projects, matched by file-name suffix:
 *
 * | project       | files                     | what it proves                                        |
 * | ------------- | ------------------------- | ----------------------------------------------------- |
 * | `web-ltr`     | `*.ltr.spec.ts`           | the English journeys, plus the structural invariants   |
 * | `web-rtl`     | `*.rtl.spec.ts`           | the same core journeys in Arabic, `dir="rtl"` asserted |
 * | `a11y`        | `*.a11y.spec.ts`          | axe on every functional screen: nothing serious        |
 * | `web-write`   | `*.write.spec.ts`         | the journeys that mutate the database, serially        |
 *
 * There is no screenshot-baseline project. Pixel comparison was retired deliberately: the baselines
 * are only authoritative inside one pinned container, they go stale on every change to the seeded
 * world, and re-shooting them cost more than the regressions they caught. Appearance is covered by
 * what the other projects already assert — structure, direction and axe.
 *
 * ## Why the timeouts are what they are
 *
 * Every navigation in every project is several real HTTP round trips against a Windows Docker stack
 * (php-fpm over a bind mount), which answers in roughly two to six seconds locally and in tens of
 * milliseconds on CI's artisan-serve stack. So the budgets are generous on purpose — 90 s per test,
 * 20 s per assertion — and the margin costs nothing where it matters.
 */
export const BASE_URL =
    process.env['E2E_BASE_URL'] ?? process.env['BASE_URL'] ?? 'http://localhost:4173';

/**
 * The one artefact. Required, not detected.
 *
 * This used to be an `existsSync` that *removed* projects when the build was absent, which was the
 * right shape while `dist-api` was an extra. It is the only export now, so its absence is a missing
 * prerequisite and the honest response is to say so before a single test starts rather than to run a
 * suite against the wrong bytes — or against none.
 */
const API_BUILD_DIR = resolve(__dirname, 'dist-api');
if (!existsSync(API_BUILD_DIR)) {
    throw new Error(
        [
            `The API-backed export is missing: ${API_BUILD_DIR}`,
            'Every Playwright project reads it, so there is nothing to run without it. Build it with:',
            '',
            '  cd apps/universal',
            '  APP_MODE=all-dev APP_ENV=development \\',
            '    EXPO_PUBLIC_API_URL=http://localhost:8080 \\',
            '    pnpm run build:web:api',
            '',
            'The suite also needs the Laravel stack up and seeded (`docker compose up -d --wait`).',
        ].join('\n'),
    );
}

export default defineConfig({
    testDir: './e2e/specs',
    globalSetup: './e2e/global-setup.ts',
    // The read-only projects share one seeded world and read it; the write project creates its own
    // records and is invoked with `--workers=1`. Nothing here writes state another file reads.
    fullyParallel: true,
    forbidOnly: process.env['CI'] === 'true',
    retries: 1,
    ...(process.env['CI'] === 'true' ? { workers: 2 } : {}),
    reporter: process.env['CI'] === 'true' ? [['list'], ['html', { open: 'never' }]] : [['list']],
    timeout: 90_000,
    expect: {
        timeout: 20_000,
    },

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

        /*
         * The mutating project. It writes to a shared database, so it must run one worker at a time
         * — Playwright has no per-project worker count, so the invocation carries it:
         * `pnpm run e2e:write` (which is `--project=web-write --workers=1`).
         *
         * The Arabic cases inside it set the `h360_locale` cookie themselves. The application's
         * direction comes from that cookie rather than from the context locale, so an Arabic write
         * journey belongs here rather than in `web-rtl`, where a second worker would be competing
         * for the same basket.
         */
        {
            name: 'web-write',
            testMatch: /.*\.write\.spec\.ts/,
            // Generous on purpose: a step in these flows is several round trips, and the Windows
            // Docker stack answers each in seconds.
            timeout: 150_000,
            // A real round trip is allowed to be slow once; it is not allowed to be flaky, so no
            // retries — a failure here is a finding. A retry against a mutated database retries
            // into different state and produces a lie.
            retries: 0,
            expect: { timeout: 30_000 },
            use: { ...devices['Desktop Chrome'], locale: 'en-GB' },
        },
    ],

    webServer: [
        {
            command: 'node e2e/static-server.mjs --root dist-api --port 4173',
            url: BASE_URL,
            reuseExistingServer: process.env['CI'] !== 'true',
            timeout: 60_000,
            stdout: 'ignore',
            stderr: 'pipe',
        },
    ],
});
