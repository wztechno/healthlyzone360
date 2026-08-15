import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
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
 * The accessibility gate for the commerce surfaces: zero serious or critical axe violations.
 *
 * Same threshold as the marketplace, catalogue and screen sweeps — moderate findings go to the risk
 * register rather than blocking here.
 *
 * ## Why an axe sweep lives in the write project
 *
 * Because the states worth sweeping do not exist until somebody creates them. A basket with no lines
 * has none of the controls that can go wrong; a subscription list with no subscription is an empty
 * state; a checkout with no address chosen never renders its review. Every one of those states is
 * reached by a **write**, so this file fills a basket, places an order and configures a subscription
 * exactly as `commerce.write.spec.ts` does — and therefore has to run where one worker owns the
 * seeded consumer's records. Running it under `a11y` in parallel would sweep a basket another test
 * was emptying.
 *
 * The read-only commerce sweeps stayed behind in the projects they belong to: the meal, plan and
 * comparison screens are in `catalogue.a11y.spec.ts` and the consumer home is in
 * `marketplace.a11y.spec.ts`.
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

/** Fill the basket with one named meal, starting from `/customer/cart` with it empty. */
async function fillBasket(page: Page): Promise<void> {
    await page.getByTestId('cart-browse').click();
    await expect(page.getByTestId('meals-screen')).toBeVisible();
    await page.getByTestId(`meal-card-${MEAL_SLUG}`).click();
    await page.getByTestId('meal-detail-add-to-basket').click();
    await expect(page.getByTestId('basket-added')).toBeVisible();
    await page.goBack();
    await page.goBack();
    await expect(page.getByTestId('cart-lines')).toBeVisible();
}

async function chooseFirstAddress(page: Page, prefix: string): Promise<void> {
    await page.getByTestId(`${prefix}-address-picker-trigger`).click();
    const option = page.locator(`[data-testid^="${prefix}-address-picker-option-"]`).first();
    await expect(option).toBeVisible();
    await option.click();
}

async function chooseSlot(page: Page, prefix: string): Promise<void> {
    const morning = page.getByTestId(`${prefix}-slot-morning`);
    if ((await morning.count()) > 0) {
        await morning.click();
        return;
    }
    await page.locator(`[data-testid^="${prefix}-slot-"]`).first().click();
}

test.describe('commerce accessibility (axe)', () => {
    test('the basket, with lines, a quantity stepper and a priced total', async ({ page }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/cart');
        await emptyBasket(page);
        await fillBasket(page);
        await expectNoSeriousViolations(page, 'cart');

        await emptyBasket(page);
    });

    test('the checkout, before and after the delivery details are committed', async ({ page }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/cart');
        await emptyBasket(page);
        await fillBasket(page);

        await page.getByTestId('cart-checkout').click();
        await expect(page.getByTestId('checkout-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'checkout');

        await chooseFirstAddress(page, 'checkout');
        await chooseSlot(page, 'checkout');
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
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
        await page.getByTestId('plan-detail-configure').click();

        /* step 1 — segmented control, macro ranges, disclaimer */
        await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
        await expectNoSeriousViolations(page, 'configurator-plan');

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
        // See NO_PRICED_DURATIONS: the seeded plan offers no commitment to choose, so there is no
        // delivery step to sweep beyond this point.
        test.skip(
            (await page.locator('[data-testid^="configurator-duration-"]').count()) === 0,
            NO_PRICED_DURATIONS,
        );
        await page.getByTestId('configurator-duration-4w').click();
        await page.getByTestId('configurator-next').click();
        await expect(page.getByTestId('configurator-step-dietary')).toBeVisible();
        await page.getByTestId('configurator-next').click();

        /* step 5 — the date field, the weekday chips, the address picker and the checkpoint */
        await expect(page.getByTestId('configurator-step-delivery')).toBeVisible();
        await chooseFirstAddress(page, 'configurator');
        await expectNoSeriousViolations(page, 'configurator-delivery');

        const repair = page.getByTestId('configurator-start-date-repair');
        if ((await repair.count()) > 0) await repair.click();
        const monday = page.getByTestId('configurator-weekday-1');
        if ((await monday.count()) > 0) await monday.click();
        await chooseSlot(page, 'configurator');

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
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/subscriptions');
        await expect(
            page
                .getByTestId('subscriptions-list')
                .or(page.getByTestId('subscriptions-empty'))
                .first(),
        ).toBeVisible();
        await expectNoSeriousViolations(page, 'subscriptions');

        if ((await page.getByTestId('subscriptions-list').count()) > 0) {
            await page.getByTestId('subscriptions-filter-ended').click();
            await expect(page.getByTestId('subscriptions-empty')).toBeVisible();
            await expectNoSeriousViolations(page, 'subscriptions-empty');
        }
    });

    /**
     * The subscription record and its two overlay patterns.
     *
     * Skipped rather than failed when this database has no subscription yet: the sweep is about the
     * dialogs, and a dialog that cannot be opened is not a finding about accessibility. Running
     * `commerce.write.spec.ts` first — which the project does, since files run in order under one
     * worker — creates one.
     */
    test('the subscription record, and the same record with a confirm dialog open', async ({
        page,
    }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/subscriptions');
        await expect(
            page
                .getByTestId('subscriptions-list')
                .or(page.getByTestId('subscriptions-empty'))
                .first(),
        ).toBeVisible();
        test.skip(
            (await page.getByTestId('subscriptions-list').count()) === 0,
            'No subscription exists in this database yet; the dialog sweeps have nothing to open.',
        );

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
