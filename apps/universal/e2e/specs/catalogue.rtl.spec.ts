import { expect, test } from '@playwright/test';

import { APP_URL, PLAN_SLUG, probeStack, skipUnlessStackIsUp } from './helpers.ts';
import type { StackStatus } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;
/** Eastern Arabic-Indic digits — what a `-u-nu-arab` formatter would emit. */
const ARABIC_INDIC_DIGITS = /[٠-٩]/;

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(async ({ context }) => {
    skipUnlessStackIsUp(stack);
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is RTL from the first paint and the catalogue never flashes left-to-right either.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: APP_URL }]);
});

/**
 * The catalogue in Arabic.
 *
 * ## What the digit assertions are pinning
 *
 * `@healthy360/i18n` formats every number through `Intl` with an explicit numbering system, and the
 * default is **Latin** (`DEFAULT_NUMBERING_SYSTEM = 'latn'`). That is a recorded, provisional
 * product decision rather than a technical constraint — plan §20 forbids permanently forcing Latin
 * digits on Arabic readers, and the formatter takes `numberingSystem` per instance so the default
 * can be flipped without touching a call site.
 *
 * So the assertion below is deliberately two-sided: the figures must come out in the *configured*
 * system, and they must not be a mixture. When the decision is revisited and the default becomes
 * `arab`, this test fails loudly and is updated on purpose — which is the whole point of pinning a
 * provisional decision rather than leaving it implicit.
 */
test.describe('catalogue (ar, RTL)', () => {
    test('the meal record renders right-to-left and in Arabic', async ({ page }) => {
        await page.goto('/meals');
        await expect(page.getByTestId('meals-screen')).toBeVisible();

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(page.getByTestId('meals-title')).toContainText(ARABIC_SCRIPT);

        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();

        // Section headings, the facts panel and the actions are all translated.
        await expect(page.getByTestId('meal-detail-serving')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('meal-detail-allergens')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('meal-detail-facts')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('meal-detail-add-to-basket')).toContainText(ARABIC_SCRIPT);

        // Figures go through the formatter, in the numbering system the locale is configured with.
        const energy = await page.getByTestId('meal-detail-facts-amount-energy').innerText();
        expect(energy).toMatch(/\d/);
        expect(energy).not.toMatch(ARABIC_INDIC_DIGITS);
    });

    test('the facts panel keeps both bases and its provenance in Arabic', async ({ page }) => {
        await page.goto('/meals');
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-facts')).toBeVisible();

        const perServing = await page.getByTestId('meal-detail-facts-amount-energy').innerText();
        await page.getByTestId('meal-detail-facts-basis-per-100g').click();
        await expect(page.getByTestId('meal-detail-facts-amount-energy')).not.toHaveText(
            perServing,
        );

        await expect(page.getByTestId('meal-detail-facts-version')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('meal-detail-facts-calculated-at')).toContainText(
            ARABIC_SCRIPT,
        );
    });

    test('the plan comparison table lays out from the right', async ({ page }) => {
        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();

        await page.getByTestId(`plan-card-${PLAN_SLUG}-compare`).click();
        await page.getByTestId('plan-card-lean-cut-compare').click();
        await page.getByTestId('plans-compare-open').click();

        await expect(page.getByTestId('plan-comparison-table')).toBeVisible();
        await expect(page.getByTestId('plan-comparison-title')).toContainText(ARABIC_SCRIPT);

        // The metric column is the leading one, and in Arabic the leading edge is the right-hand
        // side — the table mirrors because it is a `flex-row` in source order, with no transform.
        const geometry = await page
            .getByTestId('plan-comparison-table-columnheader-metric')
            .evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return { centre: rect.left + rect.width / 2, width: window.innerWidth };
            });
        expect(geometry.centre).toBeGreaterThan(geometry.width / 2);
    });
});
