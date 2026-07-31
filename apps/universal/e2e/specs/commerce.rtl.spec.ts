import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;
/** Eastern Arabic-Indic digits — what a `-u-nu-arab` formatter would emit. */
const ARABIC_INDIC_DIGITS = /[٠-٩]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is right-to-left from the first paint and no screen flashes the other way.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

/**
 * The commerce surfaces in Arabic.
 *
 * Three things are worth pinning here and nowhere else.
 *
 * **The date field.** It is the one control in this wave with a platform split
 * (`date-field.web.tsx` / `.native.tsx`), and on web it is a native `input[type=date]` whose
 * internal segment order is the browser's business, not ours. What *is* ours is that its label, its
 * hint and its errors are Arabic and that the field sits inside a right-to-left document — so that
 * is what is asserted, rather than a segment order we do not control and should not pretend to.
 *
 * **The weekday chips.** A row of seven chips is the wave's clearest direction-sensitive layout. In
 * Arabic, Monday must render on the *right*, and the assertion is geometric rather than visual: the
 * first chip's box has to start further right than the last one's.
 *
 * **The digits.** `@healthy360/i18n` formats every figure through `Intl` with an explicit numbering
 * system whose default is Latin. That is a recorded, provisional product decision (plan §20), so the
 * assertion is two-sided: figures come out in the configured system and are not a mixture. When the
 * decision is revisited this fails loudly, which is the point of pinning it.
 */

test.describe('subscription configurator (ar, RTL)', () => {
    test('the delivery step renders right-to-left, in Arabic, with the checks before any price', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/plans');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId('plan-card-balanced-week-open').click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await page.getByTestId('plan-detail-configure').click();

        await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
        await expect(page.getByTestId('configurator-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('configurator-stepper')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('configurator-price-later')).toContainText(ARABIC_SCRIPT);

        // Figures go through the formatter, in the numbering system the locale is configured with.
        const band = await page.getByTestId('configurator-energy-band').innerText();
        expect(band).toMatch(/\d/);
        expect(band).not.toMatch(ARABIC_INDIC_DIGITS);

        for (let step = 0; step < 4; step += 1) {
            await page.getByTestId('configurator-next').click();
        }
        await expect(page.getByTestId('configurator-step-delivery')).toBeVisible();

        /* the date field: Arabic label and hint, inside a right-to-left document */
        const dateField = page.getByTestId('configurator-start-date-field');
        await expect(dateField).toBeVisible();
        await expect(dateField).toContainText(ARABIC_SCRIPT);

        /* the weekday chips: Monday leads, and in Arabic that means the right-hand side */
        const monday = await page.getByTestId('configurator-weekday-1').boundingBox();
        const sunday = await page.getByTestId('configurator-weekday-7').boundingBox();
        expect(monday).not.toBeNull();
        expect(sunday).not.toBeNull();
        expect(monday?.x ?? 0).toBeGreaterThan(sunday?.x ?? 0);

        /* the SUB-02 checkpoint is translated, and it is still before the price */
        await expect(page.getByTestId('configurator-checks')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('configurator-price')).toHaveCount(0);
        // Scoped to the delivery step: the plan record this configurator was opened from is still
        // mounted and hidden behind it, and its disclaimer is the first one in the document.
        await expect(
            page.getByTestId('configurator-step-delivery').getByTestId('medical-disclaimer'),
        ).toBeVisible();
    });
});

test.describe('subscription detail (ar, RTL)', () => {
    test('the record, the configuration table and the confirm dialogs are all Arabic', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/subscriptions');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('subscriptions-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('subscriptions-list')).toBeVisible();

        await page.locator('[data-testid$="-open"]').first().click();
        await expect(page.getByTestId('subscription-detail-screen')).toBeVisible();

        await expect(page.getByTestId('subscription-detail-timeline')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('subscription-detail-config-table')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('subscription-detail-next')).toContainText(ARABIC_SCRIPT);

        // A confirm dialog is where untranslated copy hides longest, because nobody opens it.
        await page.getByTestId('subscription-pause').click();
        await expect(page.getByTestId('subscription-pause-dialog')).toBeVisible();
        await expect(page.getByTestId('subscription-pause-dialog-title')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('subscription-pause-consequence')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('subscription-pause-until')).toContainText(ARABIC_SCRIPT);
    });
});

test.describe('basket and checkout (ar, RTL)', () => {
    test('the basket, its prices and the prototype checkout all read in Arabic', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/cart');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('cart-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('cart-empty')).toBeVisible();

        await page.getByTestId('cart-browse').click();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await page.getByTestId('meal-detail-add-to-basket').click();
        await expect(page.getByTestId('basket-added')).toBeVisible();

        await page.goBack();
        await page.goBack();
        await expect(page.getByTestId('cart-lines')).toBeVisible();

        const total = await page.getByTestId('cart-price-total-amount').innerText();
        expect(total).toMatch(/\d/);
        expect(total).not.toMatch(ARABIC_INDIC_DIGITS);

        await page.getByTestId('cart-checkout').click();
        await expect(page.getByTestId('checkout-screen')).toBeVisible();
        await expect(page.getByTestId('checkout-prototype-notice')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('checkout-date-field')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('checkout-address-form-storage-note')).toContainText(
            ARABIC_SCRIPT,
        );
    });
});
