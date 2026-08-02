import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectVerdantKitchenContext, signIn } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is RTL from the first paint and no screen flashes left-to-right.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

/**
 * The kitchen workspace in Arabic.
 *
 * ## The one thing a bilingual admin form has to get right that no other screen does
 *
 * Every other screen in this application has exactly one direction: the interface's. A record
 * editor has three. The chrome follows the reader — right to left here — while the two halves of a
 * bilingual name each follow *their own language*, because the person filling this form is
 * responsible for both and an Arabic-reading kitchen manager typing an English ingredient name needs
 * a left-to-right caret in that field and a right-to-left one in the other.
 *
 * So this spec asserts the override in the direction where it is hardest to get right: the document
 * is `rtl`, and the English input must still compute to `direction: ltr` while the Arabic input
 * computes to `rtl`. Getting that wrong is invisible in English and makes the form unusable here.
 */

async function openKitchen(page: Page) {
    await signIn(page);
    await selectVerdantKitchenContext(page);
    await page.goto('/kitchen');
    await expect(page.getByTestId('kitchen-home-screen')).toBeVisible();
}

/**
 * The `…-row-seed-0-{itemKey}` prefix of the first price entry in an open editor.
 *
 * Anchored on the status label, which every row has, rather than on the amount field, which only a
 * confirmed price has.
 */
async function firstEntryRowId(page: Page): Promise<string> {
    const control = page
        .locator('[data-testid^="kitchen-price-list-entries-row-"][data-testid$="-status-label"]')
        .first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The entry row carries no test id.');
    return testId.slice(0, testId.length - '-status-label'.length);
}

async function openFirstIngredient(page: Page) {
    await openKitchen(page);
    await page.getByTestId('kitchen-family-ingredients-open').click();
    await expect(page.getByTestId('kitchen-ingredients-table')).toBeVisible();
    await page
        .locator('[data-testid^="kitchen-ingredient-"][data-testid$="-open"]')
        .first()
        .click();
    await expect(page.getByTestId('kitchen-ingredient-editor-screen')).toBeVisible();
}

test.describe('kitchen workspace (ar, RTL)', () => {
    test('translates the hub rather than only mirroring it', async ({ page }) => {
        await openKitchen(page);

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('kitchen-home-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-home-subtitle')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-family-ingredients-name')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-family-ingredients-description')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-family-allergen-classes-name')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-family-products-name')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-family-meals-description')).toContainText(
            ARABIC_SCRIPT,
        );
    });

    test('translates the list, its filters and its column headers', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-ingredients-open').click();

        await expect(page.getByTestId('kitchen-ingredients-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-ingredients-toolbar-status-label')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-ingredients-toolbar-create')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-ingredients-table-columnheader-name')).toContainText(
            ARABIC_SCRIPT,
        );

        // The table must stay inside itself: a table that pushes the document sideways is the
        // defect the responsive research is explicit about, and it is easiest to introduce here.
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });

    test('pins each half of a bilingual name to its own writing direction', async ({ page }) => {
        await openFirstIngredient(page);

        const english = page.getByTestId('kitchen-ingredient-name-en-input');
        const arabic = page.getByTestId('kitchen-ingredient-name-ar-input');

        await expect(english).toBeVisible();
        await expect(arabic).toBeVisible();

        // The document is right-to-left; the English field is not, and the Arabic one is.
        await expect(english).toHaveCSS('direction', 'ltr');
        await expect(arabic).toHaveCSS('direction', 'rtl');

        // Both labels are translated, and the hint says which way each field writes.
        await expect(page.getByTestId('kitchen-ingredient-name-en-label')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-ingredient-name-ar-hint')).toContainText(
            ARABIC_SCRIPT,
        );
    });

    test('translates the allergen safety notice and the mapping controls', async ({ page }) => {
        await openFirstIngredient(page);

        await expect(page.getByTestId('kitchen-ingredient-allergen-safety-title')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-ingredient-allergen-safety-body')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-ingredient-mapping-add')).toContainText(
            ARABIC_SCRIPT,
        );
    });

    /**
     * The recipe editor is where the direction rules are hardest, because it holds all three at
     * once: right-to-left chrome, a *number* that must stay in Latin digits because it is on its way
     * to a decimal column, and a bilingual step field whose two halves each follow their own
     * language. Getting any of the three wrong is invisible in English.
     */
    test('keeps quantities in Latin digits and announces a reorder in Arabic', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-recipes-open').click();
        await expect(page.getByTestId('kitchen-recipes-table')).toBeVisible();

        await page
            .locator('[data-testid^="kitchen-recipe-"][data-testid$="-open"]')
            .first()
            .click();
        await expect(page.getByTestId('kitchen-recipe-editor-screen')).toBeVisible();

        // A published version is read-only; the successor draft is what carries the line editor.
        await page.getByTestId('kitchen-recipe-new-draft').click();
        await expect(page.getByTestId('kitchen-recipe-lines-add')).toBeVisible();

        const quantity = page
            .getByTestId('kitchen-recipe-lines-row-line-1-quantity')
            .locator('input')
            .first();
        await expect(quantity).toBeVisible();
        // Latin digits, in an Arabic interface. The displayed *figures* localise; the value being
        // edited does not, or a round trip through the form would depend on the interface language.
        await expect(quantity).toHaveValue(/^[0-9.]+$/);
        await quantity.fill('275');
        await expect(quantity).toHaveValue('275');

        // Reordering is two buttons and an announcement — there is no drag anywhere in this
        // workspace, and the announcement is the only thing a screen-reader user gets.
        const announcer = page.getByTestId('kitchen-recipe-lines-announcer');
        await expect(announcer).toHaveAttribute('role', 'status');
        await page.getByTestId('kitchen-recipe-lines-row-line-1-move-down').click();
        await expect(announcer).toContainText(ARABIC_SCRIPT);

        // The labels around it are translated too, not merely mirrored.
        await expect(page.getByTestId('kitchen-recipe-lines-add')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-recipe-rollup-title')).toContainText(ARABIC_SCRIPT);
    });

    test('pins each half of a bilingual step to its own writing direction', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-recipes-open').click();
        await expect(page.getByTestId('kitchen-recipes-table')).toBeVisible();
        await page
            .locator('[data-testid^="kitchen-recipe-"][data-testid$="-open"]')
            .first()
            .click();
        await expect(page.getByTestId('kitchen-recipe-editor-screen')).toBeVisible();

        const english = page.getByTestId('kitchen-recipe-steps-row-step-1-instruction-en-input');
        const arabic = page.getByTestId('kitchen-recipe-steps-row-step-1-instruction-ar-input');

        await expect(english).toBeVisible();
        await expect(arabic).toBeVisible();

        // The document is right-to-left; the English half is not, and the Arabic half is.
        await expect(english).toHaveCSS('direction', 'ltr');
        await expect(arabic).toHaveCSS('direction', 'rtl');
    });

    /**
     * The product editor holds the same three directions the recipe editor does, plus a bilingual
     * *pack label* — which is the one bilingual field in this workspace that sits inside a repeated
     * row, and therefore the easiest one to render with the wrong direction without noticing.
     */
    test('pins each half of a bilingual pack label to its own writing direction', async ({
        page,
    }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-products-open').click();
        await expect(page.getByTestId('kitchen-products-table')).toBeVisible();

        await expect(page.getByTestId('kitchen-products-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-products-table-columnheader-name')).toContainText(
            ARABIC_SCRIPT,
        );

        await page
            .locator('[data-testid^="kitchen-product-"][data-testid$="-open"]')
            .first()
            .click();
        await expect(page.getByTestId('kitchen-product-editor-screen')).toBeVisible();

        const english = page.getByTestId('kitchen-product-name-en-input');
        const arabic = page.getByTestId('kitchen-product-name-ar-input');
        await expect(english).toHaveCSS('direction', 'ltr');
        await expect(arabic).toHaveCSS('direction', 'rtl');

        const packLabel = page
            .locator(
                '[data-testid^="kitchen-product-pack-editor-row-"][data-testid$="-label-en-input"]',
            )
            .first();
        const packLabelArabic = page
            .locator(
                '[data-testid^="kitchen-product-pack-editor-row-"][data-testid$="-label-ar-input"]',
            )
            .first();
        await expect(packLabel).toBeVisible();
        await expect(packLabel).toHaveCSS('direction', 'ltr');
        await expect(packLabelArabic).toHaveCSS('direction', 'rtl');

        // A pack code is an identity a price points at, not copy: it stays in Latin either way.
        const code = page
            .locator(
                '[data-testid^="kitchen-product-pack-editor-row-"][data-testid$="-code-input"]',
            )
            .first();
        await expect(code).toHaveValue(/^[A-Z0-9_-]+$/);

        // And the table must stay inside itself in this direction too.
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });

    /**
     * The meal editor's own direction trap: a portion factor is a *number* on its way to a decimal
     * column, so it stays in Latin digits while everything around it is Arabic — and the publication
     * dialog, which is the one place a consequence has to be readable before it is agreed to.
     */
    test('keeps the portion in Latin digits and states the publication consequence in Arabic', async ({
        page,
    }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-meals-open').click();
        await expect(page.getByTestId('kitchen-meals-table')).toBeVisible();

        await expect(page.getByTestId('kitchen-meals-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-meals-toolbar-create')).toContainText(ARABIC_SCRIPT);

        await page.locator('[data-testid^="kitchen-meal-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('kitchen-meal-editor-screen')).toBeVisible();

        const english = page.getByTestId('kitchen-meal-name-en-input');
        const arabic = page.getByTestId('kitchen-meal-name-ar-input');
        await expect(english).toHaveCSS('direction', 'ltr');
        await expect(arabic).toHaveCSS('direction', 'rtl');

        const portion = page.getByTestId('kitchen-meal-portion').locator('input').first();
        await expect(portion).toHaveValue(/^[0-9.]+$/);
        await portion.fill('1.5');
        await expect(portion).toHaveValue('1.5');

        // The confidential panel is translated, and still says what it is.
        await expect(page.getByTestId('kitchen-meal-confidential-badge')).toContainText(
            ARABIC_SCRIPT,
        );

        // A published meal offers withdrawal; the consequence dialog is the thing that must read.
        await page.getByTestId('kitchen-meal-retire').click();
        await expect(page.getByTestId('kitchen-meal-retire-dialog')).toBeVisible();
        await expect(page.getByTestId('kitchen-meal-retire-consequence')).toContainText(
            ARABIC_SCRIPT,
        );
    });

    /**
     * The price editor in Arabic, where the money has to stay in Latin digits (K1.5).
     *
     * `@healthy360/i18n` defaults to `latn` and the *display* of a figure follows that default, but
     * an amount being **edited** is a different thing again: it is on its way to an integer minor-unit
     * column, `parseMinorAmount` accepts Latin digits and nothing else, and a field that accepted
     * `٥٫٥٠` would make round-tripping a price depend on the interface language. So the assertion is
     * the strict one — the value is `[0-9.]` after a fill, in a document that is `rtl`.
     *
     * The currency code is asserted *not* to be translated, for the reason an allergen code is not:
     * `USD` is an ISO identity, not copy.
     */
    test('keeps a price in Latin digits, and the currency code verbatim', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-price-lists-open').click();
        await expect(page.getByTestId('kitchen-price-lists-table')).toBeVisible();

        await expect(page.getByTestId('kitchen-price-lists-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-price-lists-subtitle')).toContainText(ARABIC_SCRIPT);

        await page
            .locator('[data-testid^="kitchen-price-list-"][data-testid$="-open"]')
            .first()
            .click();
        await expect(page.getByTestId('kitchen-price-list-editor-screen')).toBeVisible();

        await expect(page.getByTestId('kitchen-price-list-readonly-note')).toContainText(
            ARABIC_SCRIPT,
        );
        // The currency is a code, not copy: it reads the same in either language.
        await expect(page.getByTestId('kitchen-price-list-currency')).not.toContainText(/[٠-٩]/);

        const row = await firstEntryRowId(page);
        const amount = page.getByTestId(`${row}-amount`).locator('input').first();
        await expect(amount).toHaveValue(/^[0-9.]+$/);
        await amount.fill('5.50');
        await expect(amount).toHaveValue('5.50');

        // The status control and its honest badge are translated; the rule they enforce is not
        // language-dependent, so the field goes away here exactly as it does in English.
        await page.getByTestId(`${row}-status-placeholder`).click();
        await expect(page.getByTestId(`${row}-amount`)).toHaveCount(0);
        await expect(page.getByTestId(`${row}-badge`)).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId(`${row}-no-amount`)).toContainText(ARABIC_SCRIPT);
    });

    test('translates the allergen reference, keeping the codes verbatim', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-allergen-classes-open').click();

        await expect(page.getByTestId('kitchen-allergen-classes-title')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('kitchen-allergen-classes-governance-body')).toContainText(
            ARABIC_SCRIPT,
        );

        // A class *code* is a regulatory identity, not copy: it stays exactly as the platform
        // publishes it in either language.
        const code = page
            .locator('[data-testid^="kitchen-allergen-class-"][data-testid$="-code"]')
            .first();
        await expect(code).toBeVisible();
        await expect(code).not.toContainText(ARABIC_SCRIPT);
    });
});
