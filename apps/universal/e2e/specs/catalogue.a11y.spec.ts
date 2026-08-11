import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

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

test.describe('catalogue accessibility (axe)', () => {
    test('meal catalogue, filters and all', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'meals');

        // The filters are collapsed by default so the grid leads; open the disclosure and axe the
        // panel — the ranges and chip groups are where most of the controls live.
        await page.getByTestId('meals-filter-toggle').click();
        await expect(page.getByTestId('meals-ranges')).toBeVisible();
        await expectNoSeriousViolations(page, 'meals-filters-open');
    });

    test('meal detail, on both nutrition bases and with the composition open', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();
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
        await page.getByTestId('plan-card-balanced-week-compare').click();
        await page.getByTestId('plan-card-lean-cut-compare').click();
        await page.getByTestId('plans-compare-open').click();
        await expect(page.getByTestId('plan-comparison-table')).toBeVisible();
        await expectNoSeriousViolations(page, 'plan-comparison');
    });

    test('plan detail', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId('plan-card-balanced-week-open').click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'plan-detail');
    });
});
