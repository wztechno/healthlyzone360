import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    APP_URL,
    KITCHEN_OWNER,
    probeStack,
    selectVerdantKitchenContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(async ({ context }) => {
    // Signing in is three chained round trips against the local Docker stack, and choosing an
    // organisation is three more; the project's 90 s default is a budget for one. `test.slow()`
    // triples it for the journeys that really do pay that cost, rather than raising the ceiling
    // for every test that reads a single endpoint.
    test.slow();
    skipUnlessStackIsUp(stack);
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is RTL from the first paint and no screen flashes left-to-right.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: APP_URL }]);
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
    await signIn(page, KITCHEN_OWNER);
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

        // Narrowed to a product that already has a pack: the first row alphabetically is a draft
        // with none, and a pack label cannot be direction-tested on a product that has no packs.
        await page
            .getByTestId('kitchen-products-toolbar-search')
            .locator('input')
            .first()
            .fill('Marinated');
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
        // The amount field only exists on a confirmed row, and which status the first seeded entry
        // carries is the seeder's business rather than this test's. Nothing is saved.
        await page.getByTestId(`${row}-status-confirmed`).click();
        const amount = page.getByTestId(`${row}-amount`).locator('input').first();
        await expect(amount).toBeEditable();
        await amount.fill('5.50');
        await expect(amount).toHaveValue('5.50');

        // The status control and its honest badge are translated; the rule they enforce is not
        // language-dependent, so the field goes away here exactly as it does in English.
        await page.getByTestId(`${row}-status-placeholder`).click();
        await expect(page.getByTestId(`${row}-amount`)).toHaveCount(0);
        await expect(page.getByTestId(`${row}-badge`)).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId(`${row}-no-amount`)).toContainText(ARABIC_SCRIPT);
    });

    /**
     * The plan editor in Arabic, which holds the workspace's two hardest direction rules at once.
     *
     * The **day count and the discount are numbers on their way to integer columns**, so they stay
     * in Latin digits in a right-to-left document — the same rule the recipe quantity and the price
     * amount follow, and the one that would make round-tripping a 20-day commitment depend on the
     * interface language if it were broken. The **configuration name** is a bilingual field inside a
     * repeated card, so each half has to follow its own language rather than the interface's.
     *
     * And the discount carries the distinction this slice exists to protect: an empty field is "not
     * set" and a typed `0` is "earns nothing". The badge has to say which, in Arabic.
     */
    test('keeps a duration in Latin digits and says whether a discount is undecided', async ({
        page,
    }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-plans-open').click();
        await expect(page.getByTestId('kitchen-plans-table')).toBeVisible();

        await expect(page.getByTestId('kitchen-plans-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-plans-subtitle')).toContainText(ARABIC_SCRIPT);

        // The table must stay inside itself: a matrix is the easiest place to push a document
        // sideways, and the responsive research is explicit that it must not reach the document.
        const listOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(listOverflow).toBeLessThanOrEqual(1);

        await page.locator('[data-testid^="kitchen-plan-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('kitchen-plan-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-plan-matrix-grid')).toBeVisible();

        // The matrix is a table, and it stays inside itself here too.
        const gridOverflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(gridOverflow).toBeLessThanOrEqual(1);

        const first = page
            .locator('[data-testid^="kitchen-plan-duration-rows-row-seed-duration-0-"]')
            .first();
        const testId = await first.getAttribute('data-testid');
        if (testId === null) throw new Error('The duration row carries no test id.');

        // Latin digits, in an Arabic interface: the value is on its way to an integer column.
        const days = page.getByTestId(`${testId}-days-input`);
        await expect(days).toHaveValue(/^[0-9]+$/);
        await days.fill('20');
        await expect(days).toHaveValue('20');

        const discount = page.getByTestId(`${testId}-discount-input`);
        await expect(discount).toHaveValue(/^[0-9]*$/);
        await discount.fill('15');
        await expect(discount).toHaveValue('15');
        await expect(page.getByTestId(`${testId}-badge`)).toContainText('15');

        // Emptying it is "not set", not "no discount" — and the row says so in Arabic.
        await discount.fill('');
        await expect(page.getByTestId(`${testId}-badge`)).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId(`${testId}-discount-state`)).toContainText(ARABIC_SCRIPT);

        // The kind control is translated, and the rule it enforces is not language-dependent.
        await page.getByTestId(`${testId}-kind-one_off`).click();
        await expect(page.getByTestId(`${testId}-days-input`)).toHaveCount(0);
        await expect(page.getByTestId(`${testId}-days-absent`)).toContainText(ARABIC_SCRIPT);

        // A configuration name is bilingual inside a repeated card: each half keeps its own
        // direction, which is invisible in English and makes the form unusable here if wrong.
        const english = page
            .locator('[data-testid^="kitchen-plan-variants-row-"][data-testid$="-name-en-input"]')
            .first();
        const arabic = page
            .locator('[data-testid^="kitchen-plan-variants-row-"][data-testid$="-name-ar-input"]')
            .first();
        await expect(english).toBeVisible();
        await expect(english).toHaveCSS('direction', 'ltr');
        await expect(arabic).toHaveCSS('direction', 'rtl');
    });

    /**
     * The delivery slice in Arabic, where the two direction rules meet the two *time* rules.
     *
     * A **time is a value on its way to a column**, so it stays in Latin digits in a right-to-left
     * document — the same rule the recipe quantity, the price amount and the plan's day count
     * follow. And a **week is laid out by the document, never by the array**: the weekday chips are
     * rendered in ISO order 1…7 and `Inline` mirrors them, so Monday is on the *right* here. Nothing
     * in the source reverses the list, because a hand-mirrored week is a left-to-right week inside a
     * right-to-left interface exactly once — on the day somebody "fixes" the order.
     */
    test('keeps times in Latin digits and lays the week out right to left', async ({ page }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-delivery-zones-open').click();
        await expect(page.getByTestId('kitchen-zones-table')).toBeVisible();

        await expect(page.getByTestId('kitchen-zones-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-zones-subtitle')).toContainText(ARABIC_SCRIPT);

        await page.locator('[data-testid^="kitchen-zone-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('kitchen-zone-editor-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-zone-window-rows')).toBeVisible();

        // The zone name is bilingual: each half follows its own language, not the interface's.
        await expect(page.getByTestId('kitchen-zone-name-en-input')).toHaveCSS('direction', 'ltr');
        await expect(page.getByTestId('kitchen-zone-name-ar-input')).toHaveCSS('direction', 'rtl');

        // A fee is a value on its way to an integer minor-unit column: Latin digits, either way.
        const fee = page.getByTestId('kitchen-zone-fee-input');
        await fee.fill('12.50');
        await expect(fee).toHaveValue('12.50');
        await expect(page.getByTestId('kitchen-zone-fee-state')).toContainText(ARABIC_SCRIPT);

        const row = page.locator('[data-testid^="kitchen-zone-window-rows-row-"]').first();
        const rowId = await row.getAttribute('data-testid');
        if (rowId === null) throw new Error('The window row carries no test id.');

        const starts = page.getByTestId(`${rowId}-starts-input`);
        await expect(starts).toHaveValue(/^[0-9:]+$/);
        await starts.fill('08:30');
        await expect(starts).toHaveValue('08:30');

        // Monday is 1 in every language, and in a right-to-left document it sits to the right of
        // Tuesday. The chips carry the translated day names, and the geometry is the document's.
        const monday = page.getByTestId(`${rowId}-weekday-1`);
        const tuesday = page.getByTestId(`${rowId}-weekday-2`);
        await expect(monday).toContainText(ARABIC_SCRIPT);
        const mondayBox = await monday.boundingBox();
        const tuesdayBox = await tuesday.boundingBox();
        if (mondayBox === null || tuesdayBox === null) {
            throw new Error('A weekday chip has no box.');
        }
        expect(mondayBox.x).toBeGreaterThan(tuesdayBox.x);

        // And the editor must stay inside itself in this direction too.
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });

    /**
     * The trading week in Arabic: the same two rules one screen further out, plus the one piece of
     * copy that must read before it is agreed to — a day being closed.
     */
    test('keeps opening hours in Latin digits and states a closed day in Arabic', async ({
        page,
    }) => {
        await openKitchen(page);
        await page.getByTestId('kitchen-family-branch-operating-open').click();
        await expect(page.getByTestId('kitchen-branch-hours-screen')).toBeVisible();

        await expect(page.getByTestId('kitchen-branch-hours-rows-day-1-name')).toContainText(
            ARABIC_SCRIPT,
        );

        // Monday sits to the right of Tuesday, because the week is drawn in ISO order and mirrored
        // by the document rather than by the array.
        const monday = await page.getByTestId('kitchen-branch-hours-rows-day-1').boundingBox();
        const tuesday = await page.getByTestId('kitchen-branch-hours-rows-day-2').boundingBox();
        if (monday === null || tuesday === null) throw new Error('A weekday row has no box.');
        // The rows stack vertically, so the ordering assertion is the vertical one: Monday first.
        expect(monday.y).toBeLessThan(tuesday.y);

        const opens = page.getByTestId('kitchen-branch-hours-rows-day-1-opens-input');
        await expect(opens).toHaveValue(/^[0-9:]*$/);
        await opens.fill('09:15');
        await expect(opens).toHaveValue('09:15');

        // Closing a day removes the fields in either direction; the note that replaces them reads.
        await page.getByTestId('kitchen-branch-hours-rows-day-2-closed-control').click();
        await expect(page.getByTestId('kitchen-branch-hours-rows-day-2-opens-input')).toHaveCount(
            0,
        );
        await expect(page.getByTestId('kitchen-branch-hours-rows-day-2-closed-note')).toContainText(
            ARABIC_SCRIPT,
        );

        // The time zone is an IANA identifier, not copy: it reads the same in either language.
        await expect(page.getByTestId('kitchen-branch-hours-timezone')).not.toContainText(/[٠-٩]/);
    });

    /**
     * The review queue in Arabic (K1.8).
     *
     * The queue is the one screen whose whole content is *derived copy* — every reason on every row
     * is a code this interface translates, not a sentence a server wrote — so an untranslated
     * catalogue shows up here as English chips on an Arabic page and nowhere else. The record names
     * inside those rows are the opposite case: they are bilingual data, and the ones the seed ships
     * are untranslated by construction (`untranslated()` mirrors English into `ar`), so they are
     * deliberately *not* asserted to be Arabic. Confusing the two is how a queue ends up "fixed" by
     * translating the data.
     */
    test('translates the review queue’s reasons and scope, and mirrors it', async ({ page }) => {
        await openKitchen(page);

        await expect(page.getByTestId('kitchen-family-review-name')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-family-review-total')).toContainText(ARABIC_SCRIPT);

        await page.getByTestId('kitchen-family-review-open').click();
        await expect(page.getByTestId('kitchen-review-screen')).toBeVisible();

        await expect(page.getByTestId('kitchen-review-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-review-subtitle')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-review-summary')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-review-section-ingredients-title')).toContainText(
            ARABIC_SCRIPT,
        );

        // The reason chip is the derived copy this screen is made of, and the row's control with it.
        const reason = page
            .locator(
                '[data-testid^="kitchen-review-ingredients-"][data-testid$="-reason-quarantined"]',
            )
            .first();
        await expect(reason).toBeVisible();
        await expect(reason).toContainText(ARABIC_SCRIPT);

        // Both scope statements read, because an untranslated "what was checked" is worse than none.
        await expect(page.getByTestId('kitchen-review-scope')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('kitchen-review-not-checked')).toContainText(ARABIC_SCRIPT);

        // The queue must stay inside itself: nothing here pushes the document sideways.
        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
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
