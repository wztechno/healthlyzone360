import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { signIn } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is RTL from the first paint and the planner never flashes left-to-right.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

/**
 * The planner in Arabic.
 *
 * ## The assertion that matters is geometric, not textual
 *
 * A translated planner that still lays Monday out on the left is not a right-to-left planner. The
 * week grid is the hardest surface in the application to get right, because a calendar is the one
 * component where "which end is the beginning" is a visible, checkable fact — so the column geometry
 * is measured rather than assumed.
 *
 * `CalendarGrid` lays its day columns out as **flex children in source order** with no positional
 * utility anywhere (see the component's own note). A `flex-row` lays its children right-to-left under
 * `dir="rtl"` on both platforms, so Monday lands on the right for free. This spec is what stops that
 * from silently regressing the first time somebody reaches for an absolute offset.
 *
 * The drawer is measured for the same reason: `end` placement resolves through source order too,
 * which puts the panel on the *left* in Arabic.
 */

const FIXTURE_WEEK = '2026-07-27';
const FIXTURE_WEEK_END = '2026-08-02';

async function openPlanner(page: Page) {
    await signIn(page);
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.goto('/customer/planner');
    await expect(page.getByTestId('planner-week-screen')).toBeVisible();
}

test.describe('meal planner (ar, RTL)', () => {
    test('lays the first day of the week out on the right', async ({ page }) => {
        await openPlanner(page);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(page.getByTestId('planner-week-grid')).toBeVisible();

        const monday = await page
            .getByTestId(`planner-week-grid-day-${FIXTURE_WEEK}`)
            .evaluate((element) => element.getBoundingClientRect().left);
        const sunday = await page
            .getByTestId(`planner-week-grid-day-${FIXTURE_WEEK_END}`)
            .evaluate((element) => element.getBoundingClientRect().left);

        // Monday is the first column, so in Arabic it sits furthest to the right.
        expect(monday).toBeGreaterThan(sunday);
    });

    test('translates the planner rather than only mirroring it', async ({ page }) => {
        await openPlanner(page);

        await expect(page.getByTestId('planner-week-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('planner-week-regenerate')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('planner-week-summary')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('planner-week-cost-note')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('medical-disclaimer').first()).toContainText(ARABIC_SCRIPT);
    });

    test('states the keeping-is-not-eating rule in Arabic', async ({ page }) => {
        await openPlanner(page);

        await page.getByTestId('planner-week-regenerate').click();
        await expect(page.getByTestId('planner-week-regenerate-locks')).toContainText(
            ARABIC_SCRIPT,
        );
    });

    test('collapses to an agenda on a narrow viewport, still right-to-left', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openPlanner(page);

        await expect(page.getByTestId('planner-week-agenda')).toBeVisible();
        await expect(page.getByTestId('planner-week-grid')).toHaveCount(0);
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

        // No page-level horizontal scroll: the agenda must fit the viewport it collapsed for.
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });

    test('attaches the replacement drawer to the trailing edge, which is the left in Arabic', async ({
        page,
    }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        const menu = page.locator('[data-testid^="planner-entry-"][data-testid$="-menu"]').first();
        const testId = await menu.getAttribute('data-testid');
        if (testId === null) throw new Error('The entry menu carries no test id.');
        const base = testId.slice(0, testId.length - '-menu'.length);

        await menu.click();
        await page.getByTestId(`${base}-replace`).click();
        await expect(page.getByTestId('planner-replace')).toBeVisible();

        const geometry = await page.getByTestId('planner-replace').evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, right: rect.right, width: window.innerWidth };
        });

        // `end` placement is the trailing edge: the left-hand one under `dir="rtl"`.
        expect(geometry.left).toBeLessThan(2);
        expect(geometry.right).toBeLessThan(geometry.width);
    });

    test('translates the difference preview, signs and all', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();

        const menu = page.locator('[data-testid^="planner-entry-"][data-testid$="-menu"]').first();
        const testId = await menu.getAttribute('data-testid');
        if (testId === null) throw new Error('The entry menu carries no test id.');
        const base = testId.slice(0, testId.length - '-menu'.length);

        await menu.click();
        await page.getByTestId(`${base}-replace`).click();
        await expect(page.getByTestId('planner-replace-body')).toBeVisible();

        const candidate = page
            .locator('[data-testid^="planner-replace-candidate-"][data-testid$="-name"]')
            .first();
        await expect(candidate).toBeVisible();
        const candidateTestId = await candidate.getAttribute('data-testid');
        if (candidateTestId === null) throw new Error('The candidate carries no test id.');
        const candidateBase = candidateTestId.slice(0, candidateTestId.length - '-name'.length);

        // The direction of a difference is a word as well as a sign, so it is translated too.
        await expect(page.getByTestId(`${candidateBase}-difference-energy`)).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId(`${candidateBase}-compatibility`)).toContainText(
            ARABIC_SCRIPT,
        );
    });

    test('translates the grocery list and its derivation note', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId('planner-week-grocery').click();

        await expect(page.getByTestId('grocery-screen')).toBeVisible();
        await expect(page.getByTestId('grocery-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('grocery-derivation')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('grocery-local-note')).toContainText(ARABIC_SCRIPT);
    });
});
