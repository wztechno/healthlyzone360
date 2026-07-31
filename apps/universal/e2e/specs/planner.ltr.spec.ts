import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The meal planner, end to end, in English.
 *
 * ## What this journey is really checking
 *
 * One behaviour carries the planner's credibility, and it is the behaviour the reference product
 * gets wrong: **keeping a meal is a planning constraint, and it survives regeneration.** Doc 10,
 * PRS-03 records that the reference conflates keeping with marking-as-eaten, and PRS-04 records the
 * documented consequence — a kept meal's ingredients vanish from the shopping list. Doc 17, PLN-02
 * and PLN-03 reject both. So the journey below keeps a meal, regenerates the whole week, and looks
 * for that meal again; and the grocery screen states, in its own copy, that keeping removes nothing.
 *
 * ## The fixture week is date-pinned
 *
 * `PROTOTYPE_WEEK_START` is Monday 27 July 2026 (`mock/prototype/constants.ts`), and every planner
 * screen must work for any other week too. The journey opens `/customer/planner`, which resolves the
 * plan through `GET /api/v1/meal-plans/current` and redirects — so nothing here hard-codes the route
 * the person lands on, only the Monday the fixtures are anchored to.
 *
 * ## Signing in
 *
 * The default mock world is used and the default account signs in, exactly as the consumer-home
 * journey does: the customer area needs an authenticated, verified person and no organisation
 * context, so `/customer/**` is reachable directly rather than through the workspace pickers. The
 * prototype store seeds the generated week in every world that has completed onboarding.
 */

/** Monday of the fixture week. Pinned in `mock/prototype/constants.ts`. */
const FIXTURE_WEEK = '2026-07-27';

async function openPlanner(page: Page) {
    await signIn(page);
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.goto('/customer/planner');
    await expect(page.getByTestId('planner-week-screen')).toBeVisible();
    await expect(page.getByTestId('planner-week-grid')).toBeVisible();
}

/** The `planner-entry-{id}` prefix of a card, taken from one of its controls. */
async function cardBaseFrom(control: Locator, suffix: string): Promise<string> {
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The control carries no test id.');
    return testId.slice(0, testId.length - suffix.length);
}

test.describe('meal planner (en)', () => {
    test('keeps a meal, regenerates the week, and finds it still there', async ({ page }) => {
        await openPlanner(page);

        // The live region exists before anything changes, not only after the first mutation.
        await expect(page.getByTestId('planner-announcer')).toBeAttached();

        const lockButton = page
            .locator('[data-testid^="planner-entry-"][data-testid$="-lock"]')
            .first();
        await expect(lockButton).toBeVisible();
        const base = await cardBaseFrom(lockButton, '-lock');

        const keptName = await page.getByTestId(`${base}-name`).innerText();

        await lockButton.click();
        await expect(page.getByTestId(`${base}-badge-locked`)).toBeVisible();
        await expect(page.getByTestId('planner-announcer')).toContainText('kept');

        // The confirmation says what will happen before it happens.
        await page.getByTestId('planner-week-regenerate').click();
        await expect(page.getByTestId('planner-week-regenerate-locks')).toContainText(
            'does not record that you ate it',
        );
        await page.getByTestId('planner-week-regenerate-confirm').click();

        await expect(page.getByTestId('planner-announcer')).toContainText('Week regenerated');
        // The kept meal is still in its slot, and still marked as kept.
        await expect(page.getByTestId(`${base}-name`)).toHaveText(keptName);
        await expect(page.getByTestId(`${base}-badge-locked`)).toBeVisible();
    });

    test('summarises the week against the target without claiming anything was eaten', async ({
        page,
    }) => {
        await openPlanner(page);

        await expect(page.getByTestId('planner-week-summary')).toBeVisible();
        await expect(page.getByTestId('planner-week-summary-meter-energy')).toBeVisible();
        await expect(page.getByTestId('planner-week-summary-tolerance-energy')).toBeVisible();
        await expect(page.getByTestId('planner-week-summary-actual')).toContainText('planned');
        await expect(page.getByTestId('planner-week-cost-total')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    test('adds every kind of entry a day can hold', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        await page.getByTestId('planner-day-add').click();
        await expect(page.getByTestId('planner-add-body')).toBeVisible();

        // A planned restaurant meal: free entry, no record behind it, and the drawer says so.
        await page.getByTestId('planner-add-kind-restaurant').click();
        await expect(page.getByTestId('planner-add-restaurant-form')).toContainText('estimate');
        await page
            .getByTestId('planner-add-restaurant-venue')
            .locator('input')
            .first()
            .fill('The corner place');
        await page.getByTestId('planner-add-restaurant-submit').click();
        await expect(page.getByTestId('planner-announcer')).toContainText('added');

        // A home-prepared recipe.
        await page.getByTestId('planner-day-add').click();
        await expect(page.getByTestId('planner-add-body')).toBeVisible();
        await page.getByTestId('planner-add-kind-recipe').click();
        await page
            .locator('[data-testid^="planner-add-recipe-"][data-testid$="-add"]')
            .first()
            .click();
        await expect(page.getByTestId('planner-announcer')).toContainText('added');

        // A kitchen meal from the marketplace.
        await page.getByTestId('planner-day-add').click();
        await expect(page.getByTestId('planner-add-body')).toBeVisible();
        await page.getByTestId('planner-add-kind-kitchen-meal').click();
        await page
            .locator('[data-testid^="planner-add-meal-"][data-testid$="-add"]')
            .first()
            .click();
        await expect(page.getByTestId('planner-announcer')).toContainText('added');

        // A single food, which needs a search and a quantity.
        await page.getByTestId('planner-day-add').click();
        await expect(page.getByTestId('planner-add-body')).toBeVisible();
        await expect(page.getByTestId('planner-add-food-prompt')).toBeVisible();
        await page.getByTestId('planner-add-search').locator('input').first().fill('orange');
        await page
            .locator('[data-testid^="planner-add-food-"][data-testid$="-add"]')
            .first()
            .click();
        await expect(page.getByTestId('planner-announcer')).toContainText('added');
    });

    test('previews the difference before replacing a meal, then replaces it', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        const menu = page.locator('[data-testid^="planner-entry-"][data-testid$="-menu"]').first();
        const base = await cardBaseFrom(menu, '-menu');
        const before = await page.getByTestId(`${base}-name`).innerText();

        await menu.click();
        await page.getByTestId(`${base}-replace`).click();
        await expect(page.getByTestId('planner-replace-body')).toBeVisible();

        // What is planned now, so every figure below has something to be a difference from.
        await expect(page.getByTestId('planner-replace-current')).toBeVisible();

        // All the filters the specification lists, on both sources.
        for (const control of [
            'planner-replace-filter-kitchen',
            'planner-replace-filter-meal-type',
            'planner-replace-filter-diet',
            'planner-replace-filter-allergens',
            'planner-replace-range-energy',
            'planner-replace-range-protein',
            'planner-replace-range-carbohydrate',
            'planner-replace-range-fat',
            'planner-replace-range-price',
            'planner-replace-range-preparation',
        ]) {
            await expect(page.getByTestId(control)).toBeVisible();
        }

        const candidate = page
            .locator('[data-testid^="planner-replace-candidate-"][data-testid$="-name"]')
            .first();
        await expect(candidate).toBeVisible();
        const candidateBase = await cardBaseFrom(candidate, '-name');

        // The three differences, each signed and each stated in words as well as a sign.
        await expect(page.getByTestId(`${candidateBase}-difference-energy`)).toBeVisible();
        await expect(page.getByTestId(`${candidateBase}-cost-difference`)).toBeVisible();
        await expect(page.getByTestId(`${candidateBase}-allergen-difference`)).toBeVisible();
        await expect(page.getByTestId(`${candidateBase}-compatibility`)).toBeVisible();

        // The scope of a recurring replacement is explained before it can be chosen.
        await page.getByTestId('planner-replace-mode-recurring').click();
        await expect(page.getByTestId('planner-replace-mode-explanation')).toContainText('later');

        await page.getByTestId(`${candidateBase}-replace-once`).click();
        await expect(page.getByTestId('planner-replace-body')).toBeHidden();
        await expect(page.getByTestId('planner-announcer')).toContainText('replaced');
        await expect(page.getByTestId(`${base}-name`)).not.toHaveText(before);
    });

    test('adjusts a portion and rescales the figures with it', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        const stepper = page
            .locator('[data-testid^="planner-entry-"][data-testid$="-portion-increment"]')
            .first();
        const base = await cardBaseFrom(stepper, '-portion-increment');
        const before = await page.getByTestId(`${base}-nutrition`).innerText();

        await stepper.click();
        await expect(page.getByTestId('planner-announcer')).toContainText('portion set to');
        await expect(page.getByTestId(`${base}-nutrition`)).not.toHaveText(before);
    });

    test('keeps notes and shows the plan history', async ({ page }) => {
        await openPlanner(page);

        await page.getByTestId('planner-week-menu').click();
        await page.getByTestId('planner-week-action-notes').click();
        await expect(page.getByTestId('planner-notes-body')).toBeVisible();
        // The dietitian's note is present and is not an editable field.
        await expect(page.getByTestId('planner-notes-dietitian-note')).toBeVisible();

        await page
            .getByTestId('planner-notes-input')
            .locator('textarea, input')
            .first()
            .fill('Cook the stew on Sunday.');
        await page.getByTestId('planner-notes-save').click();
        await expect(page.getByTestId('planner-announcer')).toContainText('notes saved');

        await page.getByTestId('planner-notes-close').click();
        await page.getByTestId('planner-week-menu').click();
        await page.getByTestId('planner-week-action-history').click();
        await expect(page.getByTestId('planner-history-events')).toBeVisible();
        await expect(page.locator('[data-testid^="planner-history-event-"]').first()).toBeVisible();
    });

    test('saves the week as a template and duplicates it, for real', async ({ page }) => {
        await openPlanner(page);

        await page.getByTestId('planner-week-menu').click();
        await page.getByTestId('planner-week-action-template').click();
        await page
            .getByTestId('planner-week-template-name')
            .locator('input')
            .first()
            .fill('My usual week');
        await page.getByTestId('planner-week-template-confirm').click();
        await expect(page.getByTestId('planner-announcer')).toContainText('template');

        await page.getByTestId('planner-week-menu').click();
        await page.getByTestId('planner-week-action-duplicate').click();
        await page.getByTestId('planner-week-duplicate-confirm').click();
        await expect(page.getByTestId('planner-announcer')).toContainText('duplicated');
    });

    test('answers share and export honestly rather than with a dead control', async ({ page }) => {
        await openPlanner(page);

        await page.getByTestId('planner-week-menu').click();
        await page.getByTestId('planner-week-action-export').click();
        await expect(page.getByTestId('prototype-notice')).toBeVisible();
    });

    test('shops for the week without re-shopping a leftover', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId('planner-week-grocery').click();

        await expect(page.getByTestId('grocery-screen')).toBeVisible();
        await expect(page.getByTestId('grocery-total-value')).toBeVisible();
        await expect(page.getByTestId('grocery-derivation')).toContainText('leftover');
        // The rejection of the reference product's documented defect, stated in the product's copy.
        await expect(page.getByTestId('grocery-derivation')).toContainText(
            'Keeping a meal in your plan never removes',
        );

        const tick = page.locator('[data-testid^="grocery-item-"][data-testid$="-tick"]').first();
        await expect(tick).toBeVisible();
        await tick.click();
        await expect(page.getByTestId('grocery-local-note')).toBeVisible();

        await expect(page.getByTestId('grocery-pantry')).toBeVisible();
        await expect(page.locator('[data-testid^="grocery-pantry-"]').first()).toBeVisible();
    });

    test('opens the home-prepared recipe behind a planner entry', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        // Every recipe entry offers "open the recipe" in its menu; the first one is enough.
        const menus = page.locator('[data-testid^="planner-entry-"][data-testid$="-menu"]');
        // `count()` does not wait, and the day screen exists before its entries do — counting
        // straight after the screen appears counts the skeleton and finds nothing to open.
        await expect(menus.first()).toBeVisible();
        const count = await menus.count();
        let opened = false;
        for (let index = 0; index < count; index += 1) {
            const menu = menus.nth(index);
            const base = await cardBaseFrom(menu, '-menu');
            await menu.click();
            const detail = page.getByTestId(`${base}-open-detail`);
            if ((await detail.count()) > 0) {
                const label = await detail.innerText();
                if (label.includes('recipe')) {
                    await detail.click();
                    opened = true;
                    break;
                }
            }
            await page.getByTestId(`${base}-actions-cancel`).click();
        }
        expect(opened).toBe(true);

        await expect(page.getByTestId('recipe-detail-screen')).toBeVisible();
        await expect(page.getByTestId('recipe-detail-name')).toBeVisible();
        await expect(page.getByTestId('recipe-detail-ingredients-table')).toBeVisible();
        await expect(page.getByTestId('recipe-detail-step-1')).toBeVisible();
        await expect(page.getByTestId('recipe-detail-facts')).toBeVisible();
        await expect(page.getByTestId('recipe-detail-version')).toBeVisible();
        await expect(page.getByTestId('recipe-detail-nutrition-version')).toBeVisible();
        await expect(page.getByTestId('recipe-detail-attribution')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    test('works for a week the fixtures know nothing about', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/planner/week/2026-10-05');

        await expect(page.getByTestId('planner-week-screen')).toBeVisible();
        await expect(page.getByTestId('planner-week-empty')).toBeVisible();
        await expect(page.getByTestId('planner-week-generate')).toBeVisible();
    });

    test('answers a malformed week with a not-found rather than a failure', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer/planner/week/last-week');

        await expect(page.getByTestId('planner-week-not-found')).toBeVisible();
    });

    test('is entirely operable from the keyboard', async ({ page }) => {
        await openPlanner(page);
        await page.getByTestId(`planner-week-open-day-${FIXTURE_WEEK}`).first().click();
        await expect(page.getByTestId('planner-day-screen')).toBeVisible();

        const menu = page.locator('[data-testid^="planner-entry-"][data-testid$="-menu"]').first();
        const base = await cardBaseFrom(menu, '-menu');

        // Focus and activate with the keyboard alone: no pointer touches the mutation path.
        await page.getByTestId(`${base}-lock`).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId(`${base}-badge-locked`)).toBeVisible();

        await menu.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId(`${base}-replace`)).toBeVisible();
        await page.getByTestId(`${base}-replace`).focus();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('planner-replace-body')).toBeVisible();

        // Escape closes the drawer, which is the other half of a keyboard-operable overlay.
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('planner-replace-body')).toBeHidden();
    });
});
