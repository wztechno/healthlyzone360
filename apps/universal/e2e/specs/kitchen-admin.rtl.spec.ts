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
