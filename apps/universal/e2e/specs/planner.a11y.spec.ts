import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The accessibility gate for the planner: zero serious or critical axe violations.
 *
 * Same threshold as the marketplace, catalogue and screen sweeps — moderate findings go to the risk
 * register rather than blocking here.
 *
 * Four of these surfaces are swept in an *interactive* state rather than only as they land, because
 * that is where the failures actually are: an overlay with no accessible name, a focus trap that
 * never engaged, a live region announced as an alert. The week grid is swept at desktop width, where
 * it is a genuine seven-column layout rather than an agenda — the two are different trees, and the
 * grid is the one with twenty-eight interactive cards in it.
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

const FIXTURE_WEEK = '2026-07-27';

async function openPlanner(page: Page) {
    await signIn(page);
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.goto('/customer/planner');
    await expect(page.getByTestId('planner-week-screen')).toBeVisible();
}

/** The `planner-entry-{id}` prefix of the first card on screen. */
async function firstCardBase(page: Page): Promise<string> {
    const menu = page.locator('[data-testid^="planner-entry-"][data-testid$="-menu"]').first();
    await expect(menu).toBeVisible();
    const testId = await menu.getAttribute('data-testid');
    if (testId === null) throw new Error('The entry menu carries no test id.');
    return testId.slice(0, testId.length - '-menu'.length);
}

test.describe('planner accessibility (axe)', () => {
    test('the weekly planner, as a desktop grid', async ({ page }) => {
        await openPlanner(page);
        await expect(page.getByTestId('planner-week-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-week-grid');
    });

    test('the weekly planner as an agenda, on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openPlanner(page);
        await expect(page.getByTestId('planner-week-agenda')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-week-agenda');
    });

    test('the regeneration confirmation, which is a dialog', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId('planner-week-regenerate').click();
        await expect(page.getByTestId('planner-week-regenerate-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-week-regenerate-dialog');
    });

    test('the plan-actions sheet, the notes drawer and the history drawer', async ({ page }) => {
        await openPlanner(page);

        await page.getByTestId('planner-week-menu').click();
        await expect(page.getByTestId('planner-week-actions')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-week-actions');

        await page.getByTestId('planner-week-action-notes').click();
        await expect(page.getByTestId('planner-notes-body')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-notes');
        await page.getByTestId('planner-notes-close').click();

        await page.getByTestId('planner-week-menu').click();
        await page.getByTestId('planner-week-action-history').click();
        await expect(page.getByTestId('planner-history-events')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-history');
    });

    test('the daily planner', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();
        await expect(page.getByTestId('planner-day-agenda')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-day');
    });

    test('the add-entry drawer, on each of its four kinds', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        await page.getByTestId('planner-day-add').click();
        await expect(page.getByTestId('planner-add-body')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-add-food');

        for (const kind of ['recipe', 'kitchen-meal', 'restaurant']) {
            await page.getByTestId(`planner-add-kind-${kind}`).click();
            await expectNoSeriousViolations(page, `planner-add-${kind}`);
        }
    });

    test('the replacement drawer, open and populated', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        const base = await firstCardBase(page);
        await page.getByTestId(`${base}-menu`).click();
        await page.getByTestId(`${base}-replace`).click();
        await expect(page.getByTestId('planner-replace-body')).toBeVisible();
        await expect(
            page
                .locator('[data-testid^="planner-replace-candidate-"][data-testid$="-name"]')
                .first(),
        ).toBeVisible();

        await expectNoSeriousViolations(page, 'planner-replace');
    });

    test('the home-prepared recipe record', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        const menus = page.locator('[data-testid^="planner-entry-"][data-testid$="-menu"]');
        // `count()` does not wait, and the day screen exists before its entries do.
        await expect(menus.first()).toBeVisible();
        const count = await menus.count();
        for (let index = 0; index < count; index += 1) {
            const menu = menus.nth(index);
            const testId = await menu.getAttribute('data-testid');
            if (testId === null) continue;
            const base = testId.slice(0, testId.length - '-menu'.length);
            await menu.click();
            const detail = page.getByTestId(`${base}-open-detail`);
            if ((await detail.count()) > 0 && (await detail.innerText()).includes('recipe')) {
                await detail.click();
                break;
            }
            await page.getByTestId(`${base}-actions-cancel`).click();
        }

        await expect(page.getByTestId('recipe-detail-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'recipe-detail');
    });

    test('the grocery list, including its pantry section', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId('planner-week-grocery').click();
        await expect(page.getByTestId('grocery-screen')).toBeVisible();
        await expect(page.getByTestId('grocery-pantry')).toBeVisible();
        await expectNoSeriousViolations(page, 'grocery');
    });

    test('the designed empty states, which are screens in their own right', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/planner/week/2026-10-05');
        await expect(page.getByTestId('planner-week-empty')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-week-empty');

        await page.goto('/customer/planner/week/last-week');
        await expect(page.getByTestId('planner-week-not-found')).toBeVisible();
        await expectNoSeriousViolations(page, 'planner-week-not-found');
    });
});
