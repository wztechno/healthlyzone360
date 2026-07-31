import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright runs against the **exported static build**, not a development server.
 *
 * That is the point: the export is what ships, and it is where pre-rendering, the pre-hydration
 * direction script and the real bundle actually exist. A dev-server run would pass with a broken
 * export.
 *
 * Six projects, matched by file-name suffix:
 *
 * | project       | files                     | what it proves                                        |
 * | ------------- | ------------------------- | ----------------------------------------------------- |
 * | `web-ltr`     | `*.ltr.spec.ts`           | the English journeys, plus the structural invariants   |
 * | `web-rtl`     | `*.rtl.spec.ts`           | the same core journeys in Arabic, `dir="rtl"` asserted |
 * | `a11y`        | `*.a11y.spec.ts`          | axe on every functional screen: nothing serious        |
 * | `visual`      | `*.visual.spec.ts`        | 24 English light-appearance baselines                  |
 * | `visual-rtl`  | `*.visual-rtl.spec.ts`    | 10 Arabic right-to-left baselines                      |
 * | `visual-dark` | `*.visual-dark.spec.ts`   | 4 dark-appearance baselines                            |
 *
 * ## The visual projects only produce a verdict inside the pinned container
 *
 * A screenshot baseline is a claim about glyph rasterisation, and that claim is only true on the
 * machine that made it: Windows, macOS and two differently-packaged Linux boxes all disagree. So the
 * 38 baselines are captured and compared **only** inside `mcr.microsoft.com/playwright:v1.62.0-noble`
 * — the same image CI uses — and every visual test skips elsewhere with an explicit message. See
 * `e2e/specs/visual-pages.ts`; the switch is `PLAYWRIGHT_VISUAL=1`, set by the repository's
 * `e2e:visual` script and by nothing else.
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
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            /**
             * One per cent of the frame. On the largest shot (1440×900) that is about thirteen
             * thousand pixels: enough to absorb subpixel differences in glyph rasterisation between
             * two runs of the same container, and nowhere near enough to absorb a moved card, a
             * changed spacing step or a badge that stopped rendering.
             */
            maxDiffPixelRatio: 0.01,
            animations: 'disabled',
            caret: 'hide',
            // CSS pixels rather than device pixels, so a baseline does not depend on the DPR of
            // whatever ran it.
            scale: 'css',
        },
    },

    /**
     * `e2e/specs/__screenshots__/{project}/{name}.png`.
     *
     * Deliberately without `{platform}`. The default template embeds the operating system in the
     * file name, which is honest for a suite whose baselines are captured on several — and
     * misleading for one whose baselines may only ever come from a single pinned Linux container.
     * A `-linux` suffix would invite somebody to add a `-win32` sibling, which is precisely the
     * thing that must not exist.
     */
    snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',

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
         * The three visual projects share everything except locale and appearance. Each sets
         * `reducedMotion: 'reduce'` on top of the per-shot `animations: 'disabled'` above: the
         * latter freezes CSS animations at the moment of capture, the former makes the application
         * itself render final states, and a baseline wants both — one stops the paint moving, the
         * other stops the layout depending on when the shot was taken.
         *
         * The viewport is set per test rather than per project: eight pages at three sizes is
         * twenty-four combinations, and three projects per size would be nine projects saying the
         * same thing.
         */
        {
            name: 'visual',
            testMatch: /.*\.visual\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                locale: 'en-GB',
                colorScheme: 'light',
                contextOptions: { reducedMotion: 'reduce' },
            },
        },
        {
            name: 'visual-rtl',
            testMatch: /.*\.visual-rtl\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                locale: 'ar',
                colorScheme: 'light',
                contextOptions: { reducedMotion: 'reduce' },
            },
        },
        {
            name: 'visual-dark',
            testMatch: /.*\.visual-dark\.spec\.ts/,
            use: {
                ...devices['Desktop Chrome'],
                locale: 'en-GB',
                // Dark styling is entirely `@media (prefers-color-scheme: dark)` in the generated
                // token stylesheet — there is no in-application toggle to drive instead.
                colorScheme: 'dark',
                contextOptions: { reducedMotion: 'reduce' },
            },
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
