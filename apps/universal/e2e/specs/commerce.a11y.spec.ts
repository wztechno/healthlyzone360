import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The accessibility gate for the commerce surfaces: zero serious or critical axe violations.
 *
 * Same threshold as the marketplace, catalogue and screen sweeps — moderate findings go to the risk
 * register rather than blocking here.
 *
 * Two of these screens are swept in states they only reach through interaction, because that is
 * where accessibility defects survive. A basket is swept **with lines in it**, since an empty state
 * has none of the controls that can go wrong; and the subscription record is swept **with a confirm
 * dialog open**, because an unnamed dialog or a missing focus trap is invisible until somebody
 * opens one.
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

/**
 * Fills the basket without leaving the document.
 *
 * The mock world lives for as long as the page does, so the basket is built through the empty
 * state's own "browse meals" push and two history steps back — never through a second `goto`, which
 * would start a new world with an empty basket.
 */
async function fillBasket(page: Page) {
    await page.goto('/customer/cart');
    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await page.getByTestId('cart-browse').click();
    await expect(page.getByTestId('meals-screen')).toBeVisible();
    await page.locator('[data-testid^="meal-card-"]').first().click();
    await page.getByTestId('meal-detail-add-to-basket').click();
    await expect(page.getByTestId('basket-added')).toBeVisible();
    await page.goBack();
    await page.goBack();
    await expect(page.getByTestId('cart-lines')).toBeVisible();
}

test.describe('commerce accessibility (axe)', () => {
    test('the basket, with lines, a quantity stepper and a priced total', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await fillBasket(page);
        await expectNoSeriousViolations(page, 'cart');
    });

    test('the prototype checkout, before and after the delivery details are committed', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await fillBasket(page);
        await page.getByTestId('cart-checkout').click();
        await expect(page.getByTestId('checkout-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'checkout');

        await page.getByTestId('checkout-address-form-label').locator('input').first().fill('Home');
        await page
            .getByTestId('checkout-address-form-line1')
            .locator('input')
            .first()
            .fill('Apartment 4, Bay View');
        await page
            .getByTestId('checkout-address-form-area')
            .locator('input')
            .first()
            .fill('Business Bay');
        await page.getByTestId('checkout-address-form-city').locator('input').first().fill('Dubai');
        await page
            .getByTestId('checkout-address-form-countryCode')
            .locator('input')
            .first()
            .fill('AE');
        await page.getByTestId('checkout-review').click();
        await expect(page.getByTestId('checkout-place-order')).toBeVisible();
        await expectNoSeriousViolations(page, 'checkout-reviewed');

        await page.getByTestId('checkout-place-order').click();
        await expect(page.getByTestId('checkout-success-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'checkout-success');
    });

    test('three configurator steps: the band, the delivery checks and the price', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId('plan-card-balanced-week-open').click();
        await page.getByTestId('plan-detail-configure').click();

        /* step 1 — segmented control, macro ranges, disclaimer */
        await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
        await expectNoSeriousViolations(page, 'configurator-plan');

        for (let step = 0; step < 4; step += 1) {
            await page.getByTestId('configurator-next').click();
        }

        /* step 5 — the date field, the weekday chips, the address form and the checkpoint */
        await expect(page.getByTestId('configurator-step-delivery')).toBeVisible();
        await page
            .getByTestId('configurator-address-form-label')
            .locator('input')
            .first()
            .fill('Home');
        await page
            .getByTestId('configurator-address-form-line1')
            .locator('input')
            .first()
            .fill('Apartment 4, Bay View');
        await page
            .getByTestId('configurator-address-form-area')
            .locator('input')
            .first()
            .fill('Business Bay');
        await page
            .getByTestId('configurator-address-form-city')
            .locator('input')
            .first()
            .fill('Dubai');
        await page
            .getByTestId('configurator-address-form-countryCode')
            .locator('input')
            .first()
            .fill('AE');
        await expectNoSeriousViolations(page, 'configurator-delivery');

        const repair = page.getByTestId('configurator-start-date-repair');
        if ((await repair.count()) > 0) await repair.click();
        await page.getByTestId('configurator-checks-acknowledge-control').click();
        await page.getByTestId('configurator-next').click();
        await expect(page.getByTestId('configurator-step-meals')).toBeVisible();
        await page.getByTestId('configurator-next').click();

        /* step 7 — the price breakdown */
        await expect(page.getByTestId('configurator-price-total-amount')).toBeVisible();
        await expectNoSeriousViolations(page, 'configurator-summary');
    });

    test('the subscriptions list, in both a populated and a filtered-empty state', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/subscriptions');
        await expect(page.getByTestId('subscriptions-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'subscriptions');

        await page.getByTestId('subscriptions-filter-ended').click();
        await expect(page.getByTestId('subscriptions-empty')).toBeVisible();
        await expectNoSeriousViolations(page, 'subscriptions-empty');
    });

    test('the subscription record, and the same record with a confirm dialog open', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/subscriptions');
        await expect(page.getByTestId('subscriptions-list')).toBeVisible();
        await page.locator('[data-testid$="-open"]').first().click();
        await expect(page.getByTestId('subscription-detail-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'subscription-detail');

        // The dialogs are where a missing accessible name or focus trap hides longest.
        await page.getByTestId('subscription-pause').click();
        await expect(page.getByTestId('subscription-pause-dialog')).toBeVisible();
        await expectNoSeriousViolations(page, 'subscription-pause-dialog');
        await page.getByTestId('subscription-pause-cancel').click();

        // The action sheet is a second overlay pattern with its own naming rules.
        await page.getByTestId('subscription-skip').click();
        await expect(page.getByTestId('subscription-skip-sheet')).toBeVisible();
        await expectNoSeriousViolations(page, 'subscription-skip-sheet');
    });
});
