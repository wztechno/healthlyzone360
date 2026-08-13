import { expect, test } from '@playwright/test';

import { PLAN_NAME, PLAN_SLUG, probeStack, skipUnlessStackIsUp } from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The catalogue journey, in English, against the exported static build reading the real API.
 *
 * Every navigation below is the real router doing real work — including the shell fallback that
 * makes `/meals/{id}` and `/plans/{id}` resolve without a pre-rendered page.
 *
 * The one thing these tests deliberately do *not* do is assert exact figures. The seeded nutrition
 * is derived, so pinning "638 kcal" here would make an unrelated ingredient edit fail a routing
 * test. What is pinned is structure: that the figure exists, that the basis toggle changes it, and
 * that the provenance travels with it.
 *
 * Adding a meal to a basket used to live here too. It writes a cart row now, so it moved to
 * `commerce.write.spec.ts` where one worker owns the seeded consumer's basket at a time.
 */

/** Currency and price markers that must never appear beside a business-supply marker. */
const PRICE_MARKER = /\b(AED|SAR|USD|KWD|BHD|OMR)\b/;

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    // The catalogue journeys are page-after-page of real cursor requests — the pagination walk
    // below exhausts a forty-odd-row catalogue twenty at a time — and the project's 90 s default is
    // a budget for one request. `test.slow()` triples it where that cost is actually paid.
    test.slow();
    skipUnlessStackIsUp(stack);
});

test.describe('meal catalogue (en)', () => {
    test('search, filter and page through the whole catalogue', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-screen')).toBeVisible();
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await expect(page.getByTestId('meals-count')).toBeVisible();

        // Twenty per page, and a control that says there are more rather than loading on scroll.
        await expect(page.getByTestId('meals-load-more')).toBeVisible();
        const priced = page.locator('[data-testid$="-price"]');
        const firstPage = await priced.count();

        // Page to the end rather than assuming how many pages there are. One press exhausted the
        // catalogue while it held exactly forty meals, and stopped doing so the day the seeded
        // world gained sellable products. The claim worth pinning is that every press adds meals
        // and that the cursor eventually runs out and says so.
        let loaded = firstPage;
        while ((await page.getByTestId('meals-load-more').count()) > 0) {
            await page.getByTestId('meals-load-more').click();
            await expect.poll(async () => priced.count()).toBeGreaterThan(loaded);
            loaded = await priced.count();
        }
        await expect(page.getByTestId('meals-all-loaded')).toBeVisible();
        expect(loaded).toBeGreaterThan(firstPage);

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

    test('an anonymous visitor is asked how to continue rather than given a basket', async ({
        page,
    }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();

        await page.getByTestId('meal-detail-add-to-basket').click();

        // Guest ordering turned the straight redirect into a choice, so the press still does not
        // quietly start a basket — it asks, and names both ways out. Signing in remains one of
        // them and still lands on the sign-in screen, which is what this test was written to prove.
        await expect(page.getByTestId('meal-detail-guest-entry-dialog')).toBeVisible();
        await expect(page.getByTestId('meal-detail-guest-continue')).toBeVisible();

        await page.getByTestId('meal-detail-guest-sign-in').click();
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    });

    test('the meal record offers only the actions that work', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-actions')).toBeVisible();

        // The planner and the quotation document have no endpoints, so the three controls that
        // needed them are absent rather than explaining themselves on press.
        await expect(page.getByTestId('meal-detail-add-to-plan')).toHaveCount(0);
        await expect(page.getByTestId('meal-detail-replace')).toHaveCount(0);
        await expect(page.getByTestId('meal-detail-quotation')).toHaveCount(0);

        // The diet classification is still shown; it is simply no longer a link.
        await expect(page.getByTestId('meal-detail-diets')).toBeVisible();
    });
});

test.describe('subscription plans (en)', () => {
    test('browse, compare two, and open one of them', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-screen')).toBeVisible();
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await expect(page.getByTestId(`plan-card-${PLAN_SLUG}`)).toBeVisible();

        // A comparison of one plan is not a comparison.
        await expect(page.getByTestId('plans-compare-open')).toHaveAttribute(
            'aria-disabled',
            'true',
        );

        await page.getByTestId(`plan-card-${PLAN_SLUG}-compare`).click();
        await page.getByTestId('plan-card-lean-cut-compare').click();
        await expect(page.getByTestId('plans-compare-count')).toContainText('2');

        await page.getByTestId('plans-compare-open').click();
        await expect(page.getByTestId('plan-comparison-screen')).toBeVisible();
        await expect(page.getByTestId('plan-comparison-table')).toBeVisible();
        await expect(page.getByTestId('plan-comparison-caveat')).toBeVisible();

        await page.getByTestId(`plan-comparison-open-${PLAN_SLUG}`).click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expect(page.getByTestId('plan-detail-name')).toContainText(PLAN_NAME);
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
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();

        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expect(page.getByTestId('plan-detail-variant-picker')).toBeVisible();
        /*
         * The commitments, by name: the API publishes the 84-day option with `total_price: null`
         * (a multi-configuration plan carries no plan-level figure) and the screen derives the
         * selected variant's total instead — so the 12-week row must render, priced. If it
         * vanishes again, `mapDuration` has regressed to dropping null-total durations; see
         * `NO_PRICED_DURATIONS` in `helpers.ts`.
         */
        await expect(page.getByTestId('plan-detail-durations')).toBeVisible();
        await expect(page.getByTestId('plan-detail-duration-12w')).toBeVisible();
        await expect(page.getByTestId('plan-detail-delivery')).toBeVisible();
        await expect(page.getByTestId('plan-detail-sample-grid')).toBeVisible();
        await expect(page.getByTestId('plan-detail-price')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        /*
         * Changing the band changes the figures it governs — asserted on the **energy band**, not
         * on a macronutrient row.
         *
         * `plan-detail-macros` renders its heading and its "ranges, not point values" caption for
         * every plan, but the rows inside it come from the variant's macro ranges and the seeded
         * plan profile carries none: `plan-detail-macro-protein` does not exist against this API.
         * The energy band does, it is per-variant, and it is the figure the picker is actually for
         * — so the coupling between the two is proven on the field that carries it. The macro rows
         * come back into this assertion when the plan profile starts publishing ranges.
         */
        const before = await page.getByTestId('plan-detail-variant-band').innerText();
        await page
            .getByTestId('plan-detail-variant-picker')
            .locator('[data-testid^="plan-detail-variant-"][aria-selected="false"]')
            .first()
            .click();
        await expect(page.getByTestId('plan-detail-variant-band')).not.toHaveText(before);
    });

    test('an anonymous visitor is sent to sign in before configuring', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();

        await page.getByTestId('plan-detail-configure').click();
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
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
