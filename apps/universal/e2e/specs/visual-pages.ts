import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    APP_URL,
    CONSUMER_EMAIL,
    MEAL_NAME,
    MEAL_SLUG,
    PLAN_NAME,
    PLAN_SLUG,
    issueToken,
    seedSession,
} from './helpers.ts';

/**
 * The shared machinery behind the three visual-regression projects.
 *
 * ## Why the baselines are container-only
 *
 * A screenshot baseline is a claim about how text is rasterised, and that claim is only true on the
 * machine that made it. Windows, macOS and Linux hint and antialias glyphs differently, and even two
 * Linux boxes differ if their font packages differ — so a baseline captured on a developer's laptop
 * is a baseline that fails for everybody else. There is exactly one authoritative environment here:
 * the pinned `mcr.microsoft.com/playwright:v1.62.0-noble` image, which is also what CI runs.
 *
 * That is enforced rather than documented: {@link visualEnabled} is false unless `PLAYWRIGHT_VISUAL`
 * is `1`, which only the `e2e:visual` root script sets, and only when it starts the container. A
 * local `npx playwright test` therefore *skips* the visual projects with a message saying so,
 * instead of producing confident-looking failures that mean nothing.
 *
 * ## Why the clock is pinned
 *
 * The data is seeded, but "today" is not: several of these surfaces mark the current day or compute
 * the earliest delivery date from it, so a baseline captured on one day disagrees with the same page
 * captured on the next. {@link preparePage} therefore fixes the page clock to one instant, which
 * makes "today" a property of the run rather than of the calendar.
 *
 * `clock.setFixedTime` is used rather than `clock.install`: it freezes what `Date` reports while
 * leaving `setTimeout` and the animation frame loop running, which is what React Query, the router
 * and the font loader all need in order to settle at all.
 *
 * ## Why nothing here is addressed by identifier any more
 *
 * It used to be. `/meals/{FIRST_MEAL_ID}` was a constant copied out of the fixture generator, which
 * was legitimate while the world was rebuilt deterministically in the browser. It is impossible
 * against PostgreSQL: every primary key is a UUIDv7 minted at seed time, so the same meal has a
 * different address after every `migrate:fresh`. Each page below is therefore reached the way a
 * person reaches it — a listing, then the card whose test id is the record's **slug**, which is
 * stable across a reseed — and each still asserts the record's *name*, so landing on a different
 * meal fails loudly here instead of quietly re-baselining a different dish.
 */

/** The instant every shot is taken at. Any fixed point does; this one is inside the seeded world. */
export const VISUAL_CLOCK = new Date('2026-07-30T09:00:00.000Z');

/** Monday of the week {@link VISUAL_CLOCK} sits in. */
export const FIXTURE_WEEK = '2026-07-27';

/**
 * The records the two detail shots are of, by slug, with the names they carry.
 *
 * `grilled-chicken-freekeh` is one of `DemoTenantSeeder`'s three hand-authored Verdant meals — it
 * has a full nutrition panel with real provenance notes rather than the neutral preview row the
 * ported fixture meals carry, which makes it the honest subject for a facts-panel baseline.
 * `balanced-week` is the plan the whole commerce story is told through.
 */
export const VISUAL_MEAL_SLUG = MEAL_SLUG;
export const VISUAL_MEAL_NAME = MEAL_NAME;
export const VISUAL_PLAN_SLUG = PLAN_SLUG;
export const VISUAL_PLAN_NAME = PLAN_NAME;

export const VISUAL_ENV_FLAG = 'PLAYWRIGHT_VISUAL';

export const VISUAL_SKIP_REASON =
    'Visual baselines are authoritative only from the pinned Playwright container ' +
    '(mcr.microsoft.com/playwright:v1.62.0-noble). Run `pnpm run e2e:visual` from the repository ' +
    'root; a host run cannot reproduce the container’s font rasterisation.';

/** True only inside the pinned container, which is the only place the `e2e:visual` script runs. */
export const visualEnabled = process.env[VISUAL_ENV_FLAG] === '1';

/* ── viewports ───────────────────────────────────────────────────────────────────────────────── */

export interface VisualViewport {
    readonly key: string;
    readonly width: number;
    readonly height: number;
}

/** The three sizes every page is captured at: a phone, a tablet and a desktop. */
export const VISUAL_VIEWPORTS = {
    mobile: { key: 'mobile', width: 390, height: 844 },
    tablet: { key: 'tablet', width: 834, height: 1112 },
    desktop: { key: 'desktop', width: 1440, height: 900 },
} as const satisfies Record<string, VisualViewport>;

export type VisualViewportKey = keyof typeof VISUAL_VIEWPORTS;

/* ── pages ───────────────────────────────────────────────────────────────────────────────────── */

export interface VisualPage {
    /** Becomes the first half of the snapshot file name. */
    readonly key: string;
    /** Whether the page sits behind the customer gate. */
    readonly session: boolean;
    /** Navigates to the page. Runs after the clock and viewport are set. */
    readonly open: (page: Page) => Promise<void>;
    /** Test ids that must be visible before a shot is taken. */
    readonly ready: readonly string[];
}

/**
 * The surfaces under visual regression.
 *
 * Chosen for stability, not for coverage: each one is built from seeded data, has settled layout,
 * and is a page whose *composition* a regression would be visible in. Screens that are still moving
 * — anything a wave is actively building — are deliberately absent, because a baseline over moving
 * markup is a baseline that gets deleted rather than read.
 */
export const VISUAL_PAGES: readonly VisualPage[] = [
    {
        key: 'landing',
        session: false,
        open: async (page) => {
            await page.goto('/');
        },
        ready: ['landing-screen', 'landing-featured-grid'],
    },
    {
        key: 'discover',
        session: false,
        open: async (page) => {
            await page.goto('/discover');
        },
        // A card, not `discover-kitchens-list`: that id belongs to the `QueryStates` loading,
        // error and empty branches and is absent once the data arrives.
        ready: ['discover-screen', 'kitchen-card-verdant-kitchen'],
    },
    {
        key: 'kitchen-profile',
        session: false,
        open: async (page) => {
            // Reached by a press rather than by a hand-written identifier: the card's test id is
            // the kitchen's slug, which is stable, and the navigation is the one a person makes.
            await page.goto('/kitchens');
            await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toBeVisible();
            await page.getByTestId('kitchen-card-verdant-kitchen').click();
            await expect(page.getByTestId('kitchen-name')).toContainText('Verdant Kitchen');
        },
        ready: ['kitchen-profile-screen', 'kitchen-branches'],
    },
    {
        key: 'meal-detail',
        session: false,
        open: async (page) => {
            await page.goto('/meals');
            await expect(page.getByTestId('meals-grid')).toBeVisible();
            await page.getByTestId(`meal-card-${VISUAL_MEAL_SLUG}`).click();
            await expect(page.getByTestId('meal-detail-name')).toContainText(VISUAL_MEAL_NAME);
        },
        ready: ['meal-detail-screen', 'meal-detail-facts'],
    },
    {
        key: 'plan-detail',
        session: false,
        open: async (page) => {
            await page.goto('/plans');
            await expect(page.getByTestId('plans-grid')).toBeVisible();
            await page.getByTestId(`plan-card-${VISUAL_PLAN_SLUG}-open`).click();
            await expect(page.getByTestId('plan-detail-name')).toContainText(VISUAL_PLAN_NAME);
        },
        ready: ['plan-detail-screen', 'plan-detail-durations'],
    },
    {
        key: 'subscription-configurator',
        session: true,
        open: async (page) => {
            await page.goto('/plans');
            await expect(page.getByTestId('plans-grid')).toBeVisible();
            await page.getByTestId(`plan-card-${VISUAL_PLAN_SLUG}-open`).click();
            await expect(page.getByTestId('plan-detail-configure')).toBeVisible();
            await page.getByTestId('plan-detail-configure').click();
        },
        ready: ['configurator-screen', 'configurator-step-plan'],
    },
];

export function visualPage(key: string): VisualPage {
    const found = VISUAL_PAGES.find((candidate) => candidate.key === key);
    if (found === undefined) throw new Error(`No visual page named "${key}".`);
    return found;
}

/* ── capture ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Everything that has to be true *before* a page is opened: the clock, the viewport, and — for
 * Arabic — the locale cookie the pre-hydration script in `+html.tsx` reads before any style applies.
 *
 * The cookie's URL is derived from {@link APP_URL} rather than written out, so a run against a
 * non-default port (`E2E_BASE_URL`) still sets a cookie the document will actually receive. A cookie
 * scoped to the wrong origin is silently ignored, and the shot would be a perfectly stable English
 * baseline saved under an Arabic name.
 */
export async function preparePage(
    page: Page,
    viewport: VisualViewport,
    options: { readonly arabic?: boolean } = {},
): Promise<void> {
    await page.clock.setFixedTime(VISUAL_CLOCK);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    if (options.arabic === true) {
        await page.context().addCookies([{ name: 'h360_locale', value: 'ar', url: APP_URL }]);
    }
}

/**
 * One consumer token per worker process, issued on first use.
 *
 * Module scope is deliberately the cache: Playwright gives each worker its own module registry, so
 * this is per-worker state rather than shared mutable state between them, and a token outlives the
 * page it was issued for.
 */
let consumerToken: string | null = null;

/**
 * Opens a page and waits until it is genuinely still.
 *
 * Three separate things settle at different times and all three move pixels: the route's own
 * markers, the web fonts (until they land, every string is measured in a fallback face), and the
 * entrance animations. Reduced motion is on for these projects so the third is a no-op, but the
 * first two are real waits rather than a fixed sleep.
 */
export async function openAndSettle(page: Page, target: VisualPage): Promise<void> {
    if (target.session) {
        // The seeded consumer: verified, activated, no membership — so the landing resolver sends
        // this account to the customer home rather than through a workspace picker.
        //
        // One token for the whole worker, seeded rather than typed. The single authenticated page
        // here is photographed at three viewports and each of those retries once, which is six
        // credential attempts inside a minute — enough to trip the API's sign-in throttle and turn
        // the last baselines into pictures of "try again in 13 seconds".
        consumerToken ??= (
            await issueToken(page.request, CONSUMER_EMAIL, 'visual-baselines', 'web')
        ).token;
        await seedSession(page, consumerToken);
    }

    await target.open(page);

    for (const testId of target.ready) {
        await expect(page.getByTestId(testId)).toBeVisible();
    }

    await page.evaluate(async () => {
        await document.fonts.ready;
    });
}

/**
 * The snapshot name: `{page}-{viewport}.png`. The project name is added by the path template in
 * `playwright.config.ts`, so the three projects cannot collide.
 */
export function snapshotName(target: VisualPage, viewport: VisualViewport): string {
    return `${target.key}-${viewport.key}.png`;
}
