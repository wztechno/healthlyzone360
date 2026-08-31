import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { PLAN_SLUG, probeStack, skipUnlessStackIsUp } from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The accessibility gate for the eight catalogue screens: zero serious or critical axe violations.
 *
 * Same threshold as the marketplace and screen sweeps — moderate findings go to the risk register
 * rather than blocking here. Three of these screens are the wave's highest-risk surfaces for
 * assistive technology and are swept in their *interactive* states rather than only as they land:
 * the facts panel on its second basis, the accordion with a panel open, and the comparison table
 * once it has columns.
 */
async function expectNoSeriousViolations(page: Page, screen: string) {
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
        blocking,
        `${screen}: ${blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join('; ')}`,
    ).toEqual([]);
}

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    skipUnlessStackIsUp(stack);
});

test.describe('catalogue accessibility (axe)', () => {
    test('meal catalogue, filters and all', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'meals');

        // At this width the filters are the rail beside the grid, so the first pass above already
        // covered them. Narrow the viewport to reach the other arrangement — a disclosure, where
        // the toggle's `aria-expanded`/`aria-controls` pair is the thing worth axeing — and check
        // the ranges and chip groups there too.
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(page.getByTestId('meals-filter-toggle')).toBeVisible();
        await page.getByTestId('meals-filter-toggle').click();

        // Open every section, so axe sees each group's controls rather than five collapsed
        // headers. The sliders in particular are the newest control on the page and the one most
        // worth holding to the label-and-name rules.
        for (const group of ['diet', 'kitchen', 'exclude', 'ranges']) {
            await page.getByTestId(`meals-filter-group-${group}`).click();
        }
        await expect(page.getByTestId('meals-ranges')).toBeVisible();
        await expectNoSeriousViolations(page, 'meals-filters-open');
    });

    test('meal detail, on both nutrition bases and with the composition open', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid$="-open"][data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'meal-detail');

        await page.getByTestId('meal-detail-facts-basis-per-100g').click();
        await expectNoSeriousViolations(page, 'meal-detail-per-100g');

        await page.getByTestId('meal-detail-ingredients-header').click();
        await expectNoSeriousViolations(page, 'meal-detail-composition');
    });

    test('plan catalogue', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'plans');
    });

    test('plan comparison, empty and populated', async ({ page }) => {
        await page.goto('/plans/compare');
        await expect(page.getByTestId('plan-comparison-empty')).toBeVisible();
        await expectNoSeriousViolations(page, 'plan-comparison-empty');

        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-compare`).click();
        await page.getByTestId('plan-card-lean-cut-compare').click();
        await page.getByTestId('plans-compare-open').click();
        await expect(page.getByTestId('plan-comparison-table')).toBeVisible();
        await expectNoSeriousViolations(page, 'plan-comparison');
    });

    test('plan detail', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'plan-detail');
    });
});
