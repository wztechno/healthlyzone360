import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    APP_URL,
    CONSUMER_EMAIL,
    MEAL_SLUG,
    NO_PRICED_DURATIONS,
    PLAN_SLUG,
    emptyBasket,
    probeStack,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * Basket, checkout and subscriptions against the real API — the journeys that **write**.
 *
 * This file is the merge of three: the English commerce journeys that used to live in
 * `commerce.ltr.spec.ts`, the Arabic ones from `commerce.rtl.spec.ts`, and the acceptance suite's
 * `commerce.acceptance.spec.ts`. All three drove the same three writes — a placed order, a created
 * subscription, a managed subscription — so keeping them apart meant three implementations of one
 * checkout, two of which were about to rot.
 *
 * ## Why they are all here rather than spread across three projects
 *
 * A basket is a persisted row belonging to one account now. The seeded consumer has exactly one
 * basket, so two workers filling it concurrently price each other's lines, and a "quantity stepper
 * re-prices" assertion fails for a reason that has nothing to do with the stepper. `web-write` runs
 * one worker with no retries, which is the only arrangement in which these assertions mean what
 * they say.
 *
 * The Arabic cases sit here for the same reason and set the locale cookie themselves. The
 * application's direction comes from that cookie rather than from the browser context's locale, so
 * an Arabic write journey is a first-class citizen of this project rather than an exile from
 * `web-rtl`.
 *
 * ## Re-runnable without a reseed
 *
 * Nothing here assumes an empty database. The basket is emptied before it is filled, the
 * subscription journeys tolerate — and reuse — records a previous run left behind, and a
 * subscription found in a paused state is resumed before the pause/resume pair is driven. A run
 * therefore adds records rather than requiring the absence of them, which is what makes
 * `pnpm run e2e:write` something you can press twice.
 *
 * ## What is deliberately never asserted
 *
 * A card. Payment is collected at the door, so there is no PAN field and no wallet control anywhere
 * in these flows, and the checkout test asserts that absence rather than assuming it.
 */

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    // Signing in is three chained round trips against the local Docker stack, and choosing an
    // organisation is three more; the project's 90 s default is a budget for one. `test.slow()`
    // triples it for the journeys that really do pay that cost, rather than raising the ceiling
    // for every test that reads a single endpoint.
    test.slow();
    skipUnlessStackIsUp(stack);
});

/* ── shared journeys ─────────────────────────────────────────────────────────────────────────── */

/** Fill the basket with one published meal, starting from a basket that is known to be empty. */
async function fillBasket(page: Page): Promise<void> {
    await page.getByTestId('cart-browse').click();
    await expect(page.getByTestId('meals-screen')).toBeVisible();

    // A named meal rather than "the first card": `grilled-chicken-freekeh` is one of the three
    // Verdant meals `DemoTenantSeeder` writes by hand, so it carries a real price on the web-shop
    // tariff rather than the neutral preview row the ported fixture meals share.
    await page.getByTestId(`meal-card-${MEAL_SLUG}`).click();
    await expect(page.getByTestId('meal-detail-screen')).toBeVisible();

    await page.getByTestId('meal-detail-add-to-basket').click();
    await expect(page.getByTestId('basket-added')).toBeVisible();

    // Two history steps, no reload — cheaper than a navigation, and it proves the client cache was
    // invalidated by the mutation rather than merely re-fetched by a fresh document.
    await page.goBack();
    await expect(page.getByTestId('meals-screen')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('cart-screen')).toBeVisible();
    await expect(page.getByTestId('cart-lines')).toBeVisible();
}

/**
 * Stops the journey at the duration step when the plan offers no priced commitment.
 *
 * Expects the configurator to be on step three. See {@link NO_PRICED_DURATIONS} for why this is a
 * skip rather than a failure, and for what has to change before it stops skipping.
 */
async function skipUnlessDurationsArePriced(page: Page): Promise<void> {
    const options = page.locator('[data-testid^="configurator-duration-"]');
    test.skip((await options.count()) === 0, NO_PRICED_DURATIONS);
}

/** Choose the first saved delivery address in an open picker. */
async function chooseFirstAddress(page: Page, prefix: string): Promise<void> {
    await page.getByTestId(`${prefix}-address-picker-trigger`).click();
    const option = page.locator(`[data-testid^="${prefix}-address-picker-option-"]`).first();
    await expect(option).toBeVisible();
    await option.click();
}

/** Prefer a named delivery window, fall back to whichever the kitchen publishes. */
async function chooseSlot(page: Page, prefix: string): Promise<void> {
    const morning = page.getByTestId(`${prefix}-slot-morning`);
    if ((await morning.count()) > 0) {
        await morning.click();
        return;
    }
    await page.locator(`[data-testid^="${prefix}-slot-"]`).first().click();
}

/** Walk the configurator end to end and leave the page on the success screen. */
async function createSubscription(page: Page): Promise<void> {
    await page.goto('/plans');
    await expect(page.getByTestId('plans-grid')).toBeVisible();
    await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
    await expect(page.getByTestId('plan-detail-screen')).toBeVisible();

    await page.getByTestId('plan-detail-configure').click();
    await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-combination')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-duration')).toBeVisible();
    await skipUnlessDurationsArePriced(page);
    await page.getByTestId('configurator-duration-4w').click();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-dietary')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-delivery')).toBeVisible();
    await chooseFirstAddress(page, 'configurator');

    const repair = page.getByTestId('configurator-start-date-repair');
    if ((await repair.count()) > 0) await repair.click();

    const monday = page.getByTestId('configurator-weekday-1');
    if ((await monday.count()) > 0) {
        await monday.click();
    } else {
        await page.locator('[data-testid^="configurator-weekday-"]').first().click();
    }
    await chooseSlot(page, 'configurator');

    await page.getByTestId('configurator-checks-acknowledge-control').click();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-meals')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-summary')).toBeVisible();
    await expect(page.getByTestId('configurator-price-total-amount')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-confirm')).toBeVisible();
    await page.getByTestId('configurator-confirm-acknowledge-control').click();
    await page.getByTestId('configurator-create').click();

    await expect(page.getByTestId('configurator-success-screen')).toBeVisible();
}

/**
 * Open a live subscription, creating one first if this database has none.
 *
 * `DemoCustomerSeeder` opens a customer account and stops — it seeds no subscription, deliberately,
 * because a subscription nobody configured is a fiction. So the first run of this file creates one
 * and every later run reuses it, which is what "re-runnable without a reseed" means in practice.
 */
async function openLiveSubscription(page: Page): Promise<void> {
    await page.goto('/customer/subscriptions');
    await expect(
        page.getByTestId('subscriptions-list').or(page.getByTestId('subscriptions-empty')).first(),
    ).toBeVisible();

    if ((await page.getByTestId('subscriptions-list').count()) === 0) {
        await createSubscription(page);
        await page.goto('/customer/subscriptions');
        await expect(page.getByTestId('subscriptions-list')).toBeVisible();
    }

    await page.locator('[data-testid$="-open"]').first().click();
    await expect(page.getByTestId('subscription-detail-screen')).toBeVisible();

    // A previous run that failed between pause and resume would leave the record paused, and the
    // journey below is written against a live one. Put it back rather than failing on the state.
    if ((await page.getByTestId('subscription-resume').count()) > 0) {
        await page.getByTestId('subscription-resume').click();
        await expect(page.getByTestId('subscription-resume-dialog')).toBeVisible();
        await page.getByTestId('subscription-resume-confirm').click();
        await expect(page.getByTestId('subscription-pause')).toBeVisible();
    }
}

/* ── basket and checkout ─────────────────────────────────────────────────────────────────────── */

test.describe('basket and checkout (en)', () => {
    test('fill a basket from the marketplace, price it, and place a cash-on-delivery order', async ({
        page,
    }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/cart');
        await emptyBasket(page);
        await expect(page.getByTestId('cart-empty')).toBeVisible();

        await fillBasket(page);

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
        await expect(page.getByTestId('checkout-prototype-notice')).toHaveCount(0);
        await expect(page.locator('input[type="password"]')).toHaveCount(0);
        await expect(page.locator('input[autocomplete*="cc-"]')).toHaveCount(0);

        // The address is chosen from the book — `DemoCustomerSeeder` put one inside Verdant's
        // Al Quoz zone, which is the whole reason that persona exists.
        await chooseFirstAddress(page, 'checkout');
        await chooseSlot(page, 'checkout');

        // The quotation is the server's, and it is shown before anybody commits to it. The total
        // is captured here so the confirmation can be held to the same figure.
        await expect(page.getByTestId('checkout-price-subtotal-amount')).toBeVisible();
        await expect(page.getByTestId('checkout-price-total-amount')).toBeVisible();
        const committedTotal = await page.getByTestId('checkout-price-total-amount').innerText();

        await page.getByTestId('checkout-review').click();
        await expect(page.getByTestId('checkout-place-order')).toBeVisible();
        await expect(page.getByTestId('checkout-committed-address')).not.toBeEmpty();
        // The street line only, so the confirmation can be held to the *same address* without the
        // two components having to render it with identical surrounding copy.
        const committedAddress = (await page.getByTestId('checkout-committed-address').innerText())
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== '')[0] as string;
        await expect(page.getByTestId('checkout-committed-slot')).toBeVisible();

        await page.getByTestId('checkout-place-order').click();
        await expect(page.getByTestId('checkout-success-screen')).toBeVisible();
        await expect(page.getByTestId('checkout-success-notice')).toBeVisible();
        // Cash on delivery, stated rather than implied by the absence of a receipt.
        await expect(page.getByTestId('checkout-success-cod')).toBeVisible();
        await expect(page.getByTestId('checkout-success-reference')).not.toBeEmpty();
        await expect(page.getByTestId('checkout-success-address')).toContainText(committedAddress);
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
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/cart');
        await emptyBasket(page);

        await page.goto('/customer/checkout');
        await expect(page.getByTestId('checkout-empty')).toBeVisible();
        await page.getByTestId('checkout-browse').click();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
    });

    test('a signed-in visitor adds a meal to a real basket from the meal record', async ({
        page,
    }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/cart');
        await emptyBasket(page);

        await page.goto('/meals');
        await expect(page.getByTestId('meals-grid')).toBeVisible();
        await page.getByTestId(`meal-card-${MEAL_SLUG}`).click();
        await expect(page.getByTestId('meal-detail-add-to-basket')).toBeVisible();

        await page.getByTestId('meal-detail-add-to-basket').click();
        await expect(page.getByTestId('basket-added')).toBeVisible();

        // The line really reached the server: a fresh document finds it.
        await page.goto('/customer/cart');
        await expect(page.getByTestId('cart-lines')).toBeVisible();
        await emptyBasket(page);
    });
});

/* ── the subscription configurator ───────────────────────────────────────────────────────────── */

test.describe('subscription configurator (en)', () => {
    test('eight steps from a plan, no price until step seven, and a real subscription at the end', async ({
        page,
    }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();

        // The plan page's call to action is a real navigation, carrying the chosen band.
        await page.getByTestId('plan-detail-configure').click();
        await expect(page).toHaveURL(/\/customer\/subscriptions\/new\?plan=/);
        await expect(page).toHaveURL(/variant=/);

        /* 1 — plan and calorie band */
        await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
        // The band, which the seeded plan profile carries. Not the macro rows: `configurator-macro-
        // ranges` renders its heading for every plan but its rows come from the variant's macro
        // ranges, and the API's plan profile publishes none — the same gap `catalogue.ltr.spec.ts`
        // records on the plan record itself.
        await expect(page.getByTestId('configurator-energy-band')).toBeVisible();
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
        await skipUnlessDurationsArePriced(page);
        await expect(page.getByTestId('configurator-duration-4w-discount')).toBeVisible();
        await expect(page.getByTestId('configurator-duration-12w-total')).toBeVisible();
        await page.getByTestId('configurator-duration-4w').click();
        await expect(page.getByTestId('configurator-price')).toHaveCount(0);
        await page.getByTestId('configurator-next').click();

        /* 4 — preferences and allergies, pre-filled from the seeded dietary profile */
        await expect(page.getByTestId('configurator-step-dietary')).toBeVisible();
        await expect(page.getByTestId('configurator-allergens')).toBeVisible();
        await page.getByTestId('configurator-next').click();

        /* 5 — delivery, and the two checks that precede any price (doc 17, SUB-02) */
        await expect(page.getByTestId('configurator-step-delivery')).toBeVisible();
        await expect(page.getByTestId('configurator-checks')).toBeVisible();

        // Pressing on without the checks names what is missing rather than doing nothing.
        await page.getByTestId('configurator-next').click();
        await expect(page.getByTestId('configurator-issues')).toBeVisible();

        await chooseFirstAddress(page, 'configurator');

        // Tomorrow is a delivery day most weeks and not on others; the repair chip is the designed
        // answer either way, so it is taken whenever it is offered.
        const repair = page.getByTestId('configurator-start-date-repair');
        if ((await repair.count()) > 0) await repair.click();

        const monday = page.getByTestId('configurator-weekday-1');
        if ((await monday.count()) > 0) await monday.click();
        await chooseSlot(page, 'configurator');

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

/* ── managing a subscription ─────────────────────────────────────────────────────────────────── */

test.describe('subscription management (en)', () => {
    test('pause, resume, skip a delivery and change the window — all real transitions', async ({
        page,
    }) => {
        await signIn(page, CONSUMER_EMAIL);

        /*
         * No second address is created first, and that is a change from the mock-era journey.
         *
         * `DemoCustomerSeeder` already gives this account one saved address inside Verdant's Al Quoz
         * zone, which is what the picker needs; adding another meant driving
         * `/customer/account/addresses/new`, and that editor did not render its fields inside seven
         * and a half minutes on this stack — see the note on `saveAddress`. The dialog, the picker
         * and the server's acceptance of the change are all still exercised below; what is no longer
         * asserted is that the address *changed to a different one*, which needs two.
         */
        await openLiveSubscription(page);
        await expect(page.getByTestId('subscription-detail-timeline')).toBeVisible();

        // Resume is not offered while the subscription is live: the server would refuse it.
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
        await chooseSlot(page, 'subscription');
        await page.getByTestId('subscription-slot-confirm').click();
        await expect(page.getByTestId('subscription-detail-config-table')).toBeVisible();
        await expect(page.getByTestId('subscription-detail-error')).toHaveCount(0);

        /* change the address, by choosing a saved one from the book */
        await page.getByTestId('subscription-change-address').click();
        await expect(page.getByTestId('subscription-address-dialog')).toBeVisible();
        await page.getByTestId('subscription-address-picker-trigger').click();
        await page.locator('[data-testid^="subscription-address-picker-option-"]').last().click();
        await page.getByTestId('subscription-address-confirm').click();
        await expect(page.getByTestId('subscription-detail-config-table')).toBeVisible();
        await expect(page.getByTestId('subscription-detail-error')).toHaveCount(0);
    });

    test('a state filter with nothing in it is a real empty state, not a blank list', async ({
        page,
    }) => {
        await signIn(page, CONSUMER_EMAIL);
        await openLiveSubscription(page);

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
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/subscriptions/not-a-uuid');
        await expect(page.getByTestId('subscription-detail-empty')).toBeVisible();
    });
});

/* ── the same surfaces in Arabic ─────────────────────────────────────────────────────────────── */

const ARABIC_SCRIPT = /[؀-ۿ]/;
/** Eastern Arabic-Indic digits — what a `-u-nu-arab` formatter would emit. */
const ARABIC_INDIC_DIGITS = /[٠-٩]/;

test.describe('commerce (ar, RTL)', () => {
    test.beforeEach(async ({ context }) => {
        // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
        // document is right-to-left from the first paint and no screen flashes the other way.
        await context.addCookies([{ name: 'h360_locale', value: 'ar', url: APP_URL }]);
    });

    /**
     * Three things are worth pinning in Arabic and nowhere else.
     *
     * **The weekday chips.** A row of seven chips is the clearest direction-sensitive layout in the
     * product. In Arabic, Monday must render on the *right*, and the assertion is geometric rather
     * than visual.
     *
     * **The digits.** `@healthy360/i18n` formats every figure through `Intl` with an explicit
     * numbering system whose default is Latin. That is a recorded, provisional product decision
     * (plan §20), so the assertion is two-sided: figures come out in the configured system and are
     * not a mixture. When the decision is revisited this fails loudly, which is the point.
     *
     * **"Cash at the door".** It is the sentence most likely to be written once in English and
     * never translated, and it is the one a person needs before they commit to an order.
     */
    test('the configurator and the checkout both read in Arabic', async ({ page }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/plans');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await page.getByTestId('plan-detail-configure').click();

        await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
        await expect(page.getByTestId('configurator-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('configurator-stepper')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('configurator-price-later')).toContainText(ARABIC_SCRIPT);

        const band = await page.getByTestId('configurator-energy-band').innerText();
        expect(band).toMatch(/\d/);
        expect(band).not.toMatch(ARABIC_INDIC_DIGITS);

        /*
         * Stepped through one at a time rather than by pressing *next* four times.
         *
         * The duration step will not advance until a commitment is chosen, so a blind loop stops
         * there and every assertion after it is about the wrong screen. Naming each step also makes
         * a failure say which one it stopped on.
         */
        await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
        await page.getByTestId('configurator-next').click();
        await expect(page.getByTestId('configurator-step-combination')).toBeVisible();
        await page.getByTestId('configurator-next').click();
        await expect(page.getByTestId('configurator-step-duration')).toBeVisible();
        await skipUnlessDurationsArePriced(page);
        await page.getByTestId('configurator-duration-4w').click();
        await page.getByTestId('configurator-next').click();
        await expect(page.getByTestId('configurator-step-dietary')).toBeVisible();
        await page.getByTestId('configurator-next').click();
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

        /* …and the basket half of the same language pass */
        await page.goto('/customer/cart');
        await emptyBasket(page);
        await expect(page.getByTestId('cart-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('cart-empty')).toBeVisible();

        await fillBasket(page);

        const total = await page.getByTestId('cart-price-total-amount').innerText();
        expect(total).toMatch(/\d/);
        expect(total).not.toMatch(ARABIC_INDIC_DIGITS);

        await page.getByTestId('cart-checkout').click();
        await expect(page.getByTestId('checkout-screen')).toBeVisible();
        await expect(page.getByTestId('checkout-payment-notice')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('checkout-date-field')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('checkout-address-picker')).toContainText(ARABIC_SCRIPT);

        // Leave the basket as it was found.
        await page.goto('/customer/cart');
        await emptyBasket(page);
    });

    test('the subscription record and its confirm dialogs are all Arabic', async ({ page }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/subscriptions');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('subscriptions-title')).toContainText(ARABIC_SCRIPT);

        await openLiveSubscription(page);

        await expect(page.getByTestId('subscription-detail-timeline')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('subscription-detail-config-table')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('subscription-detail-next')).toContainText(ARABIC_SCRIPT);

        // A confirm dialog is where untranslated copy hides longest, because nobody opens it. This
        // one is opened and then dismissed: the pause itself belongs to the English journey, which
        // owns putting the record back.
        await page.getByTestId('subscription-pause').click();
        await expect(page.getByTestId('subscription-pause-dialog')).toBeVisible();
        await expect(page.getByTestId('subscription-pause-dialog-title')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('subscription-pause-consequence')).toContainText(
            ARABIC_SCRIPT,
        );
        await expect(page.getByTestId('subscription-pause-until')).toContainText(ARABIC_SCRIPT);
        await page.getByTestId('subscription-pause-cancel').click();
    });
});
