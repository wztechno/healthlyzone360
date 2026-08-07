import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The catalogue journey, in English, against the exported static build.
 *
 * Every navigation below is the real router doing real work — including the shell fallback that
 * makes `/meals/{id}`, `/plans/{id}` and `/diets/{slug}` resolve without a pre-rendered page.
 *
 * The one thing these tests deliberately do *not* do is assert exact figures. The fixture world is
 * synthetic and its numbers are derived, so pinning "638 kcal" here would make an unrelated
 * ingredient edit fail a routing test. What is pinned is structure: that the figure exists, that
 * the basis toggle changes it, and that the provenance travels with it.
 */

/** Currency and price markers that must never appear beside a business-supply marker. */
const PRICE_MARKER = /\b(AED|SAR|USD|KWD|BHD|OMR)\b/;

test.describe('meal catalogue (en)', () => {
    test('search, filter and page through the whole catalogue', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-screen')).toBeVisible();
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expect(page.getByTestId('meals-count')).toBeVisible();

        // Twenty per page, and a control that says there are more rather than loading on scroll.
        await expect(page.getByTestId('meals-load-more')).toBeVisible();
        const firstPage = await page.locator('[data-testid$="-price"]').count();
        await page.getByTestId('meals-load-more').click();
        await expect(page.getByTestId('meals-all-loaded')).toBeVisible();
        expect(await page.locator('[data-testid$="-price"]').count()).toBeGreaterThan(firstPage);

        // Filters are collapsed by default so the grid leads; open the disclosure to reach them.
        await page.getByTestId('meals-filter-toggle').click();

        // A numeric range is a real filter wired to `listMeals`, not a decoration.
        await page.getByTestId('meals-ranges-protein-min-input').fill('45');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expect(page).toHaveURL(/proteinMin=45/);

        // Allergen exclusion removes a dish that declares the allergen.
        await page.getByTestId('meals-filter-exclude-milk').click();
        await expect(page).toHaveURL(/exclude=milk/);
        await expect(page.getByTestId('meal-card-daily-pot-halloumi-plate')).toHaveCount(0);

        await page.getByTestId('meals-filter-clear').click();
        await expect(page.getByTestId('meals-grid')).toBeVisible();
    });

    test('a filtered catalogue is a place: the parameters survive a reload', async ({ page }) => {
        await page.goto('/meals?mealType=breakfast&energyMax=500');
        await expect(page.getByTestId('meals-grid')).toBeVisible();

        await page.reload();
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expect(page.getByTestId('meals-filter-mealType-breakfast')).toHaveAttribute(
            'aria-pressed',
            'true',
        );
    });

    test('the empty state explains itself and offers a way back', async ({ page }) => {
        await page.goto('/meals?q=zzzz-nothing-matches-this');
        await expect(page.getByTestId('meals-empty')).toBeVisible();
        await page.getByTestId('meals-empty-clear').click();
        await expect(page.getByTestId('meals-grid')).toBeVisible();
    });
});

test.describe('meal detail (en)', () => {
    test('carries the facts panel, both bases, the allergen list and its provenance', async ({
        page,
    }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();

        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();
        await expect(page.getByTestId('meal-detail-name')).toBeVisible();
        await expect(page.getByTestId('meal-detail-breadcrumbs')).toBeVisible();

        // Nutrition, with the three macro rings and their numeric labels.
        await expect(page.getByTestId('meal-detail-macro-rings-protein')).toBeVisible();
        await expect(page.getByTestId('meal-detail-macro-rings-protein-energy')).toBeVisible();

        // Provenance: source, version, timestamp and the synthetic marking.
        await expect(page.getByTestId('meal-detail-facts-synthetic')).toBeVisible();
        await expect(page.getByTestId('meal-detail-facts-version')).toBeVisible();
        await expect(page.getByTestId('meal-detail-facts-calculated-at')).toBeVisible();

        // The two bases are a real toggle over the same dataset.
        const perServing = await page.getByTestId('meal-detail-facts-amount-energy').innerText();
        await page.getByTestId('meal-detail-facts-basis-per-100g').click();
        await expect(page.getByTestId('meal-detail-facts-amount-energy')).not.toHaveText(
            perServing,
        );

        await expect(page.getByTestId('meal-detail-allergens')).toBeVisible();
        await expect(page.getByTestId('meal-detail-availability')).toBeVisible();
        await expect(page.getByTestId('meal-detail-price')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    test('a business-supply marker never carries a price', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-channels')).toBeVisible();

        if ((await page.getByTestId('meal-detail-b2b').count()) > 0) {
            const marker = await page.getByTestId('meal-detail-b2b-no-price').innerText();
            expect(marker).not.toMatch(PRICE_MARKER);
        }
    });

    test('an anonymous visitor is sent to sign in rather than given a basket', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();

        await page.getByTestId('meal-detail-add-to-basket').click();
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    });

    test('a signed-in visitor adds the meal to a real basket', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-add-to-basket')).toBeVisible();

        await page.getByTestId('meal-detail-add-to-basket').click();
        await expect(page.getByTestId('basket-added')).toBeVisible();
    });

    test('replacement explains itself and offers a destination that resolves', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();

        await page.getByTestId('meal-detail-replace').click();
        await expect(page.getByTestId('meal-detail-replace-dialog')).toBeVisible();
        await page.getByTestId('meal-detail-replace-browse').click();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
    });

    test('a diet tag leads to its category page', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-diets')).toBeVisible();

        await page.locator('[data-testid^="meal-detail-diet-"]').first().click();
        await expect(page.getByTestId('diet-category-screen')).toBeVisible();
        await expect(page.getByTestId('diet-category-suitability')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });
});

test.describe('subscription plans (en)', () => {
    test('browse, compare two, and open one of them', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-screen')).toBeVisible();
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await expect(page.getByTestId('plan-card-balanced-week')).toBeVisible();

        // A comparison of one plan is not a comparison.
        await expect(page.getByTestId('plans-compare-open')).toHaveAttribute(
            'aria-disabled',
            'true',
        );

        await page.getByTestId('plan-card-balanced-week-compare').click();
        await page.getByTestId('plan-card-lean-cut-compare').click();
        await expect(page.getByTestId('plans-compare-count')).toContainText('2');

        await page.getByTestId('plans-compare-open').click();
        await expect(page.getByTestId('plan-comparison-screen')).toBeVisible();
        await expect(page.getByTestId('plan-comparison-table')).toBeVisible();
        await expect(page.getByTestId('plan-comparison-caveat')).toBeVisible();

        await page.getByTestId('plan-comparison-open-balanced-week').click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expect(page.getByTestId('plan-detail-name')).toContainText('Balanced Week');
    });

    test('a category tab narrows the catalogue', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();

        await page.getByTestId('plans-category-high-protein').click();
        await expect(page.getByTestId('plan-card-strength-build')).toBeVisible();
        await expect(page.getByTestId('plan-card-plant-forward')).toHaveCount(0);
    });

    test('the comparison screen says so when nothing was selected', async ({ page }) => {
        await page.goto('/plans/compare');
        await expect(page.getByTestId('plan-comparison-empty')).toBeVisible();
        await page.getByTestId('plan-comparison-back').click();
        await expect(page.getByTestId('plans-screen')).toBeVisible();
    });
});

test.describe('plan detail (en)', () => {
    test('shows bands, macro ranges, durations, delivery and the sample menu', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId('plan-card-balanced-week-open').click();

        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expect(page.getByTestId('plan-detail-variant-picker')).toBeVisible();
        await expect(page.getByTestId('plan-detail-macro-protein')).toBeVisible();
        await expect(page.getByTestId('plan-detail-duration-12w')).toBeVisible();
        await expect(page.getByTestId('plan-detail-delivery')).toBeVisible();
        await expect(page.getByTestId('plan-detail-dietitian')).toBeVisible();
        await expect(page.getByTestId('plan-detail-sample-grid')).toBeVisible();
        await expect(page.getByTestId('plan-detail-price')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        // Changing the band changes the figures it governs. The prefix also matches the picker
        // container and the pre-selected band, so pick an option that is not currently selected.
        const before = await page.getByTestId('plan-detail-macro-protein-value').innerText();
        await page
            .getByTestId('plan-detail-variant-picker')
            .locator('[data-testid^="plan-detail-variant-"][aria-selected="false"]')
            .first()
            .click();
        await expect(page.getByTestId('plan-detail-macro-protein-value')).not.toHaveText(before);
    });

    test('an anonymous visitor is sent to sign in before configuring', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId('plan-card-balanced-week-open').click();

        await page.getByTestId('plan-detail-configure').click();
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    });
});

test.describe('the public calculators (en)', () => {
    test('the calorie calculator asks, answers and shows its working', async ({ page }) => {
        await page.goto('/tools/calorie-calculator');
        await expect(page.getByTestId('calorie-calculator-screen')).toBeVisible();

        // Nothing is claimed before the measurements exist.
        await expect(page.getByTestId('calorie-calculator-incomplete')).toBeVisible();

        await page.getByTestId('calorie-calculator-age-input').fill('34');
        await page.getByTestId('calorie-calculator-height-input').fill('170');
        await page.getByTestId('calorie-calculator-weight-input').fill('68');

        await expect(page.getByTestId('calorie-calculator-target')).toBeVisible();
        await expect(page.getByTestId('calorie-calculator-target-maintenance-value')).toBeVisible();
        await expect(page.getByTestId('calorie-calculator-target-target-value')).toBeVisible();
        await expect(page.getByTestId('calorie-calculator-target-tolerance')).toBeVisible();
        await expect(page.getByTestId('calorie-calculator-target-prototype')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        // The working and the citations are reachable, not merely claimed.
        await page.getByTestId('calorie-calculator-target-citations-header').click();
        await expect(
            page.getByTestId('calorie-calculator-target-working-citations-panel'),
        ).toBeVisible();

        // A unit switch keeps the measurement rather than clearing it.
        await page.getByTestId('calorie-calculator-units-imperial').click();
        await expect(page.getByTestId('calorie-calculator-height-feet-input')).toHaveValue('5');
        await expect(page.getByTestId('calorie-calculator-height-inches-input')).toHaveValue('7');

        await page.getByTestId('calorie-calculator-macro').click();
        await expect(page.getByTestId('macro-calculator-screen')).toBeVisible();
    });

    test('the macro calculator splits the same estimate into grams first', async ({ page }) => {
        await page.goto('/tools/macro-calculator');
        await expect(page.getByTestId('macro-calculator-screen')).toBeVisible();
        await expect(page.getByTestId('macro-calculator-incomplete')).toBeVisible();

        await page.getByTestId('macro-calculator-age-input').fill('29');
        await page.getByTestId('macro-calculator-height-input').fill('182');
        await page.getByTestId('macro-calculator-weight-input').fill('80');

        await expect(page.getByTestId('macro-calculator-macros')).toBeVisible();
        await expect(page.getByTestId('macro-calculator-macros-table')).toBeVisible();
        await expect(page.getByTestId('macro-calculator-macros-ring-protein')).toBeVisible();
        await expect(page.getByTestId('macro-calculator-macros-grams-protein')).toBeVisible();
        await expect(page.getByTestId('macro-calculator-macros-nutrients')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        await page.getByTestId('macro-calculator-meals').click();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
    });
});

/**
 * Rule 1's acceptance check, stated as geometry.
 *
 * §8 asks for exactly this and there was no equivalent before: "in any card grid, every card's
 * price occupies the same vertical offset from the card bottom". It is the objective form of the
 * complaint the whole redesign opens with — that the one figure a shopper compares across cards
 * sits at a different height in every one — and it is measured rather than asserted about classes,
 * because the mechanism is a flex behaviour and class names cannot prove a flex behaviour worked.
 *
 * The grid deliberately mixes meals and products, which carry different amounts of content. If the
 * pinned footer ever comes undone, this is where it will be caught.
 */
test.describe('card grid baselines (en)', () => {
    test('every price in a row sits the same distance from its card bottom', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expect(page.locator('[data-testid^="meal-card-"]').first()).toBeVisible();

        const offsets = await page.evaluate(() => {
            const cards = [...document.querySelectorAll('[data-testid^="meal-card-"]')].filter(
                (card) => card.querySelector('[data-testid$="-price"]') !== null,
            );

            // Group by the top edge, so cards on different rows are compared within their own row
            // rather than against each other — a wrapped grid has several rows and only cards
            // sharing one are required to share a baseline.
            const rows = new Map<number, number[]>();
            for (const card of cards) {
                const price = card.querySelector('[data-testid$="-price"]');
                if (price === null) continue;
                const cardBox = card.getBoundingClientRect();
                const priceBox = price.getBoundingClientRect();
                const top = Math.round(cardBox.top);
                const offset = Math.round(cardBox.bottom - priceBox.bottom);
                rows.set(top, [...(rows.get(top) ?? []), offset]);
            }
            return [...rows.values()].filter((row) => row.length > 1);
        });

        expect(offsets.length).toBeGreaterThan(0);
        for (const row of offsets) {
            expect(new Set(row).size, `row offsets: ${row.join(', ')}`).toBe(1);
        }
    });
});
