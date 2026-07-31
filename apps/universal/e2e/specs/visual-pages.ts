import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signIn } from './helpers.ts';

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
 * instead of producing 38 confident-looking failures that mean nothing.
 *
 * ## Why the clock is pinned
 *
 * The fixture world is pinned to `PROTOTYPE_NOW` (`mock/prototype/constants.ts`) —
 * 2026-07-30T09:00:00Z, inside the fixture planner week that starts on Monday 2026-07-27. The
 * *browser's* clock is not: the planner marks the current day column, so a baseline captured on one
 * day disagrees with the same page captured on the next. {@link preparePage} therefore fixes the
 * page clock to the same instant the fixtures were built from, which makes "today" a property of the
 * data set rather than of the calendar.
 *
 * `clock.setFixedTime` is used rather than `clock.install`: it freezes what `Date` reports while
 * leaving `setTimeout` and the animation frame loop running, which is what React Query, the router
 * and the font loader all need in order to settle at all.
 */

/** The instant the whole prototype world is derived from. Mirrors `PROTOTYPE_NOW`. */
export const VISUAL_CLOCK = new Date('2026-07-30T09:00:00.000Z');

/** Monday of the fixture planner week. Mirrors `PROTOTYPE_WEEK_START`. */
export const FIXTURE_WEEK = '2026-07-27';

/**
 * Deterministic fixture identifiers, from `mock/prototype/ids.ts`.
 *
 * Band `c0` is meals and `d0` is subscription plans; ordinal `00` is the first row of each table.
 * They are written out rather than imported because the specs deliberately do not depend on the
 * application's module graph — but every page that uses one asserts the record's name as well, so a
 * reordered fixture table fails loudly here instead of quietly re-baselining a different meal.
 */
export const FIRST_MEAL_ID = '01935f6d-0000-7000-8000-00000000c000';
export const FIRST_PLAN_ID = '01935f6d-0000-7000-8000-00000000d000';

/** The name the first meal fixture carries. Guards against a silent fixture reorder. */
export const FIRST_MEAL_NAME = 'Herb Garden Chicken Bowl';
/** The name the first plan fixture carries. */
export const FIRST_PLAN_NAME = 'Balanced Week';

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
 * The eight surfaces under visual regression.
 *
 * Chosen for stability, not for coverage: each one is built from pinned fixtures, has settled
 * layout, and is a page whose *composition* a regression would be visible in. Screens that are
 * still moving — anything a wave is actively building — are deliberately absent, because a baseline
 * over moving markup is a baseline that gets deleted rather than read.
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
            await page.goto(`/meals/${FIRST_MEAL_ID}`);
            await expect(page.getByTestId('meal-detail-name')).toContainText(FIRST_MEAL_NAME);
        },
        ready: ['meal-detail-screen', 'meal-detail-facts'],
    },
    {
        key: 'plan-detail',
        session: false,
        open: async (page) => {
            await page.goto(`/plans/${FIRST_PLAN_ID}`);
            await expect(page.getByTestId('plan-detail-name')).toContainText(FIRST_PLAN_NAME);
        },
        ready: ['plan-detail-screen', 'plan-detail-durations'],
    },
    {
        key: 'nutrition-targets',
        session: true,
        open: async (page) => {
            await page.goto('/customer/nutrition');
        },
        ready: ['nutrition-target-screen', 'nutrition-target-content'],
    },
    {
        key: 'planner-week',
        session: true,
        open: async (page) => {
            // The pinned week rather than `/customer/planner`, which resolves "current" through the
            // repository: a redirect makes the captured route depend on the clock twice over.
            await page.goto(`/customer/planner/week/${FIXTURE_WEEK}`);
        },
        ready: ['planner-week-screen', 'planner-week-summary'],
    },
    {
        key: 'subscription-configurator',
        session: true,
        open: async (page) => {
            await page.goto(`/plans/${FIRST_PLAN_ID}`);
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
 */
export async function preparePage(
    page: Page,
    viewport: VisualViewport,
    options: { readonly arabic?: boolean } = {},
): Promise<void> {
    await page.clock.setFixedTime(VISUAL_CLOCK);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    if (options.arabic === true) {
        await page
            .context()
            .addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
    }
}

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
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
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
