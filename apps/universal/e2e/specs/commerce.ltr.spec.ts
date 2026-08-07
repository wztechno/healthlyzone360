import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { saveAddress, signIn } from './helpers.ts';

/**
 * Basket, checkout and subscriptions, in English, against the exported static build.
 *
 * ## Why every journey stays inside one document
 *
 * The mock world is built when the document loads and lives in memory. A basket, therefore, only
 * exists for as long as the page does: a `page.goto` half way through would silently start a new
 * world and the second half of the journey would be testing an empty one. So each test performs
 * **one** navigation and then moves entirely through the application's own links — including
 * `page.goBack()`, which in an Expo Router build is a `popstate` handled client-side rather than a
 * reload.
 *
 * That constraint is also why the basket is filled through `/customer/cart`'s own empty state:
 * "browse meals" is a real in-application push, the meal record's *add to basket* is a real
 * mutation, and two history steps return to the basket with the line in it.
 *
 * ## Why the address book is filled before anything else
 *
 * Both the checkout and the subscription record take a delivery address by *identifier* now (D-084):
 * the zone, the window and the fee resolve from a saved entry, so neither screen offers a form to
 * type into. The fixture person starts with nothing saved — `mock/account/store.ts` opens with an
 * empty list in every scenario — so a journey that needs one has to create it, and by the paragraph
 * above it has to create it inside the same document. Hence `saveAddress`, and hence the single
 * `page.goto` landing on the address book rather than on the screen under test.
 *
 * ## What is deliberately never asserted
 *
 * A card. Payment is collected at the door, so there is no PAN field and no wallet control anywhere
 * in these flows, and the checkout test asserts that absence rather than assuming it.
 */

/** The plan the subscription journey configures. Stable slug, six delivery days out of seven. */
const PLAN_SLUG = 'balanced-week';

/**
 * The street line the subscription-management journey saves to the address book and then moves a
 * live subscription onto. Distinct from anything a fixture carries, so the closing assertion cannot
 * pass on a subscription nobody touched.
 */
const SAVED_LINE1 = 'Villa 12, Garden Row';

/** The street line the checkout journey orders to. */
const CHECKOUT_LINE1 = 'Apartment 4, Bay View';

/** The free-form address the configurator still falls back to when nothing is saved. */
async function fillAddress(page: Page, prefix: string, area: string) {
    await page.getByTestId(`${prefix}-label`).locator('input').first().fill('Home');
    await page
        .getByTestId(`${prefix}-line1`)
        .locator('input')
        .first()
        .fill('Apartment 4, Bay View');
    await page.getByTestId(`${prefix}-area`).locator('input').first().fill(area);
    await page.getByTestId(`${prefix}-city`).locator('input').first().fill('Dubai');
    await page.getByTestId(`${prefix}-countryCode`).locator('input').first().fill('AE');
}

test.describe('basket and checkout (en)', () => {
    test('fill a basket from the marketplace, price it, and place a cash-on-delivery order', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        // One navigation, and it lands on the address book rather than the basket: placement takes
        // an address identifier, and the only thing that produces one is this pair of screens.
        await page.goto('/customer/account/addresses');
        await saveAddress(page, 'Home', CHECKOUT_LINE1);

        // Everything after this is the application's own routing.
        await page.getByTestId('consumer-nav-cart').click();
        await expect(page.getByTestId('cart-screen')).toBeVisible();
        await expect(page.getByTestId('cart-empty')).toBeVisible();

        await page.getByTestId('cart-browse').click();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();

        await page.getByTestId('meal-detail-add-to-basket').click();
        await expect(page.getByTestId('basket-added')).toBeVisible();

        // Two history steps, no reload: the basket the mutation created is still the live one.
        await page.goBack();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
        await page.goBack();
        await expect(page.getByTestId('cart-screen')).toBeVisible();

        await expect(page.getByTestId('cart-lines')).toBeVisible();
        await expect(page.getByTestId('cart-count')).toBeVisible();
        await expect(page.getByTestId('cart-price-total-amount')).toBeVisible();
        await expect(page.getByTestId('cart-price-no-payment')).toBeVisible();

        // A quantity stepper that genuinely re-prices, rather than a number that only looks changed.
        const total = await page.getByTestId('cart-price-total-amount').innerText();
        await page.locator('[data-testid$="-quantity-increment"]').first().click();
        await expect(page.getByTestId('cart-price-total-amount')).not.toHaveText(total);

        await page.getByTestId('cart-checkout').click();
        await expect(page.getByTestId('checkout-screen')).toBeVisible();

        // Cash at the door, said out loud — and the property that matters most is still an absence.
        await expect(page.getByTestId('checkout-payment-notice')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toHaveCount(0);
        await expect(page.locator('input[autocomplete*="cc-"]')).toHaveCount(0);

        // The address is chosen from the book. The delivery date is already the earliest the
        // kitchen accepts, so the only other decision is the window.
        await page.getByTestId('checkout-address-picker-trigger').click();
        await page.locator('[data-testid^="checkout-address-picker-option-"]').first().click();
        await page.getByTestId('checkout-slot-evening').click();

        // The quotation is the server's, and it is shown before anybody commits to it. The total
        // is captured here so the confirmation can be held to the same figure.
        await expect(page.getByTestId('checkout-price-subtotal-amount')).toBeVisible();
        await expect(page.getByTestId('checkout-price-total-amount')).toBeVisible();
        const committedTotal = await page.getByTestId('checkout-price-total-amount').innerText();

        await page.getByTestId('checkout-review').click();
        await expect(page.getByTestId('checkout-place-order')).toBeVisible();
        await expect(page.getByTestId('checkout-committed-address')).toContainText(CHECKOUT_LINE1);
        await expect(page.getByTestId('checkout-committed-slot')).toBeVisible();

        await page.getByTestId('checkout-place-order').click();
        await expect(page.getByTestId('checkout-success-screen')).toBeVisible();
        await expect(page.getByTestId('checkout-success-notice')).toBeVisible();
        // Cash on delivery, stated rather than implied by the absence of a receipt.
        await expect(page.getByTestId('checkout-success-cod')).toBeVisible();
        await expect(page.getByTestId('checkout-success-reference')).not.toBeEmpty();
        await expect(page.getByTestId('checkout-success-address')).toContainText(CHECKOUT_LINE1);
        await expect(page.getByTestId('checkout-success-slot')).toBeVisible();
        /*
         * The confirmation prices itself from the *placed order*, not the checkout preview —
         * placement empties the basket, which disables the preview query, and a price block fed
         * from there rendered nothing. The order's own figures are the ones the platform charged
         * for, so the total on the confirmation must equal the one decided on at review.
         */
        await expect(page.getByTestId('checkout-success-summary')).toBeVisible();
        await expect(page.getByTestId('checkout-success-price-subtotal-amount')).not.toBeEmpty();
        await expect(page.getByTestId('checkout-success-price-total-amount')).toHaveText(
            committedTotal,
        );

        // The basket *became* the order. Lines left behind would let one screen place the same
        // basket twice, so the emptiness is the assertion rather than an afterthought.
        await page.getByTestId('checkout-success-cart').click();
        await expect(page.getByTestId('cart-empty')).toBeVisible();
    });

    test('an empty basket says so and offers the marketplace rather than a dead checkout', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/checkout');
        await expect(page.getByTestId('checkout-empty')).toBeVisible();
        await page.getByTestId('checkout-browse').click();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
    });
});

test.describe('subscription configurator (en)', () => {
    test('eight steps from a plan, no price until step seven, and a real subscription at the end', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();

        // The plan page's call to action is a real navigation now, carrying the chosen band.
        await page.getByTestId('plan-detail-configure').click();
        await expect(page).toHaveURL(/\/customer\/subscriptions\/new\?plan=/);
        await expect(page).toHaveURL(/variant=/);

        /* 1 — plan and calorie band */
        await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
        await expect(page.getByTestId('configurator-energy-band')).toBeVisible();
        await expect(page.getByTestId('configurator-macro-protein')).toBeVisible();
        // Scoped to the step, not to the document. Expo Router keeps the screen this one was
        // pushed from mounted and hidden, so its own disclaimer is still in the DOM and `.first()`
        // would resolve to that one — which proves nothing about the step in front of the reader.
        await expect(
            page.getByTestId('configurator-step-plan').getByTestId('medical-disclaimer'),
        ).toBeVisible();
        await expect(page.getByTestId('configurator-price-later')).toBeVisible();
        await expect(page.getByTestId('configurator-price')).toHaveCount(0);
        await page.getByTestId('configurator-next').click();

        /* 2 — meals and snacks, with the coupling stated */
        await expect(page.getByTestId('configurator-step-combination')).toBeVisible();
        await expect(page.getByTestId('configurator-combination-note')).toBeVisible();
        await page.getByTestId('configurator-next').click();

        /* 3 — duration, with the discount on the option itself */
        await expect(page.getByTestId('configurator-step-duration')).toBeVisible();
        await expect(page.getByTestId('configurator-duration-4w-discount')).toBeVisible();
        await expect(page.getByTestId('configurator-duration-12w-total')).toBeVisible();
        await page.getByTestId('configurator-duration-4w').click();
        await expect(page.getByTestId('configurator-price')).toHaveCount(0);
        await page.getByTestId('configurator-next').click();

        /* 4 — preferences and allergies, pre-filled from the profile */
        await expect(page.getByTestId('configurator-step-dietary')).toBeVisible();
        await expect(page.getByTestId('configurator-allergens')).toBeVisible();
        await page.getByTestId('configurator-next').click();

        /* 5 — delivery, and the two checks that precede any price (doc 17, SUB-02) */
        await expect(page.getByTestId('configurator-step-delivery')).toBeVisible();
        await expect(page.getByTestId('configurator-checks')).toBeVisible();

        // Pressing on without the checks names what is missing rather than doing nothing.
        await page.getByTestId('configurator-next').click();
        await expect(page.getByTestId('configurator-issues')).toBeVisible();

        await fillAddress(page, 'configurator-address-form', 'Business Bay');
        await expect(page.getByTestId('configurator-area-served')).toBeVisible();

        // Tomorrow is a delivery day most weeks and not on others; the repair chip is the designed
        // answer either way, so it is taken whenever it is offered.
        const repair = page.getByTestId('configurator-start-date-repair');
        if ((await repair.count()) > 0) await repair.click();

        await page.getByTestId('configurator-checks-acknowledge-control').click();
        await page.getByTestId('configurator-next').click();

        /* 6 — the sample week */
        await expect(page.getByTestId('configurator-step-meals')).toBeVisible();
        await expect(page.getByTestId('configurator-meals-note')).toBeVisible();
        await expect(page.getByTestId('configurator-price')).toHaveCount(0);
        await page.getByTestId('configurator-next').click();

        /* 7 — the first price anybody has seen */
        await expect(page.getByTestId('configurator-step-summary')).toBeVisible();
        await expect(page.getByTestId('configurator-price-total-amount')).toBeVisible();
        await expect(page.getByTestId('configurator-price-per-delivery-amount')).toBeVisible();
        await expect(page.getByTestId('configurator-summary-checks')).toBeVisible();
        await page.getByTestId('configurator-next').click();

        /* 8 — confirm, and a real creation */
        await expect(page.getByTestId('configurator-step-confirm')).toBeVisible();
        await page.getByTestId('configurator-create').click();
        await expect(page.getByTestId('configurator-issues')).toBeVisible();

        await page.getByTestId('configurator-confirm-acknowledge-control').click();
        await page.getByTestId('configurator-create').click();

        await expect(page.getByTestId('configurator-success-screen')).toBeVisible();
        await expect(page.getByTestId('configurator-success-state')).toBeVisible();
        await expect(page.getByTestId('configurator-success-next')).toBeVisible();

        /* and straight into managing it */
        await page.getByTestId('configurator-success-open').click();
        await expect(page.getByTestId('subscription-detail-screen')).toBeVisible();
        await expect(page.getByTestId('subscription-detail-config-table')).toBeVisible();
    });
});

test.describe('subscription management (en)', () => {
    test('pause, resume, skip a delivery and change the window — all real transitions', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        // The change-address dialog at the end of this journey is a picker over saved addresses, so
        // the book is filled before the record is opened. See the header for why that ordering is
        // forced rather than chosen.
        await page.goto('/customer/account/addresses');
        await saveAddress(page, 'Garden', SAVED_LINE1);

        await page.getByTestId('consumer-nav-subscriptions').click();
        await expect(page.getByTestId('subscriptions-screen')).toBeVisible();
        await expect(page.getByTestId('subscriptions-list')).toBeVisible();

        await page.locator('[data-testid$="-open"]').first().click();
        await expect(page.getByTestId('subscription-detail-screen')).toBeVisible();
        await expect(page.getByTestId('subscription-detail-timeline')).toBeVisible();

        // Resume is not offered while the subscription is live: the repository would refuse it.
        await expect(page.getByTestId('subscription-resume')).toHaveCount(0);

        /* pause */
        await page.getByTestId('subscription-pause').click();
        await expect(page.getByTestId('subscription-pause-consequence')).toBeVisible();
        await page.getByTestId('subscription-pause-confirm').click();
        // A paused subscription offers resume and withdraws pause: the controls follow the state.
        await expect(page.getByTestId('subscription-resume')).toBeVisible();
        await expect(page.getByTestId('subscription-pause')).toHaveCount(0);

        /* resume */
        await page.getByTestId('subscription-resume').click();
        await expect(page.getByTestId('subscription-resume-dialog')).toBeVisible();
        await page.getByTestId('subscription-resume-confirm').click();
        await expect(page.getByTestId('subscription-pause')).toBeVisible();
        await expect(page.getByTestId('subscription-resume')).toHaveCount(0);

        /* skip one delivery, chosen from the upcoming days */
        await page.getByTestId('subscription-skip').click();
        await expect(page.getByTestId('subscription-skip-sheet')).toBeVisible();
        await page.locator('[data-testid^="subscription-skip-option-"]').first().click();
        await expect(page.getByTestId('subscription-skip-consequence')).toBeVisible();
        await page.getByTestId('subscription-skip-confirm').click();
        await expect(page.getByTestId('subscription-timeline-skipped-value')).toBeVisible();

        /* change the delivery window */
        await page.getByTestId('subscription-change-slot').click();
        await expect(page.getByTestId('subscription-slot-picker')).toBeVisible();
        await page.getByTestId('subscription-slot-evening').click();
        await page.getByTestId('subscription-slot-confirm').click();
        await expect(page.getByTestId('subscription-detail-config-table')).toBeVisible();
        await expect(page.getByTestId('subscription-detail-error')).toHaveCount(0);

        /* change the address, by choosing the saved one this journey put in the book */
        await expect(page.getByTestId('subscription-detail-config-table')).not.toContainText(
            SAVED_LINE1,
        );
        await page.getByTestId('subscription-change-address').click();
        await expect(page.getByTestId('subscription-address-dialog')).toBeVisible();
        await page.getByTestId('subscription-address-picker-trigger').click();
        await page.locator('[data-testid^="subscription-address-picker-option-"]').first().click();
        await page.getByTestId('subscription-address-confirm').click();
        await expect(page.getByTestId('subscription-detail-config-table')).toContainText(
            SAVED_LINE1,
        );
    });

    test('a state filter with nothing in it is a real empty state, not a blank list', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/subscriptions');
        await expect(page.getByTestId('subscriptions-list')).toBeVisible();

        await page.getByTestId('subscriptions-filter-ended').click();
        await expect(page.getByTestId('subscriptions-empty')).toBeVisible();
        await page.getByTestId('subscriptions-clear-filter').click();
        await expect(page.getByTestId('subscriptions-list')).toBeVisible();
    });

    test('an unknown subscription is a not-found state rather than a stuck skeleton', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/subscriptions/not-a-uuid');
        await expect(page.getByTestId('subscription-detail-empty')).toBeVisible();
    });
});
