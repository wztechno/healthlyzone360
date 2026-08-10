import { expect, test } from '@playwright/test';

import { DEMO_PASSWORD, probeStack, signIn, skipUnlessStackIsUp } from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * **Phase C acceptance: browse → cart → COD order against the live API.**
 *
 * Uses the seeded consumer `nour@healthy360.test` (DemoCustomerSeeder): verified
 * email, activated account, and a delivery address in Verdant's Al Quoz zone.
 * Meals come from Verdant's published marketplace menu.
 *
 * Skips cleanly when Docker/API is down — same posture as the other acceptance
 * specs. Requires `dist-api` built with `EXPO_PUBLIC_DATA_MODE=api`.
 */

const CONSUMER_EMAIL = 'nour@healthy360.test';
const PUBLISHED_MEAL_SLUG = 'grilled-chicken-freekeh';
const PUBLISHED_PLAN_SLUG = 'marketplace-balanced-plan';

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    skipUnlessStackIsUp(stack);
});

test('browse a published meal, add to basket, preview, and place a COD order', async ({ page }) => {
    await signIn(page, CONSUMER_EMAIL, DEMO_PASSWORD);

    // Consumer accounts skip the organisation picker; land in the customer area.
    await expect(page.getByTestId('dev-banner')).toHaveCount(0);

    await page.goto('/customer/cart');
    await expect(page.getByTestId('cart-screen')).toBeVisible();

    // Prefer a clean basket. If lines remain from a prior run, strip them.
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if ((await page.getByTestId('cart-empty').count()) > 0) break;
        const remove = page.locator('[data-testid$="-remove"]').first();
        if ((await remove.count()) === 0) break;
        await remove.click();
        await expect(
            page.getByTestId('cart-lines').or(page.getByTestId('cart-empty')),
        ).toBeVisible();
    }

    await page.getByTestId('cart-browse').click();

    await expect(page.getByTestId('meals-screen')).toBeVisible();
    await page.getByTestId(`meal-card-${PUBLISHED_MEAL_SLUG}`).click();
    await expect(page.getByTestId('meal-detail-screen')).toBeVisible();

    await page.getByTestId('meal-detail-add-to-basket').click();
    await expect(page.getByTestId('basket-added')).toBeVisible();

    await page.goto('/customer/cart');
    await expect(page.getByTestId('cart-lines')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toBeVisible();

    await page.getByTestId('cart-checkout').click();
    await expect(page.getByTestId('checkout-screen')).toBeVisible();

    // Real checkout: no prototype notice, no card fields.
    await expect(page.getByTestId('checkout-prototype-notice')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('input[autocomplete*="cc-"]')).toHaveCount(0);

    // Seeded address from DemoCustomerSeeder — pick the first option.
    await page.getByTestId('checkout-address-picker-trigger').click();
    const addressOption = page.locator('[data-testid^="checkout-address-picker-option-"]').first();
    await expect(addressOption).toBeVisible();
    await addressOption.click();

    // Verdant publishes morning + evening windows (not midday). Prefer morning.
    const morning = page.getByTestId('checkout-slot-morning');
    if ((await morning.count()) > 0) {
        await morning.click();
    }

    await page.getByTestId('checkout-review').click();
    await expect(page.getByTestId('checkout-place-order')).toBeVisible();
    await expect(page.getByTestId('checkout-committed-address')).toBeVisible();

    await page.getByTestId('checkout-place-order').click();
    await expect(page.getByTestId('checkout-success-screen')).toBeVisible();
    await expect(page.getByTestId('checkout-success-cod')).toBeVisible();
    await expect(page.getByTestId('checkout-success-reference')).not.toHaveText('');
});

test('an empty basket offers the marketplace rather than a dead checkout', async ({ page }) => {
    await signIn(page, CONSUMER_EMAIL, DEMO_PASSWORD);
    await expect(page.getByTestId('dev-banner')).toHaveCount(0);

    await page.goto('/customer/checkout');
    await expect(page.getByTestId('checkout-empty')).toBeVisible();
    await page.getByTestId('checkout-browse').click();
    await expect(page.getByTestId('meals-screen')).toBeVisible();
});

test('configure and create a subscription on a published plan', async ({ page }) => {
    await signIn(page, CONSUMER_EMAIL, DEMO_PASSWORD);
    await expect(page.getByTestId('dev-banner')).toHaveCount(0);

    await page.goto('/plans');
    await expect(page.getByTestId('plans-screen')).toBeVisible();
    await page.getByTestId(`plan-card-${PUBLISHED_PLAN_SLUG}`).click();
    await expect(page.getByTestId('plan-detail-screen')).toBeVisible();

    await page.getByTestId('plan-detail-configure').click();
    await expect(page).toHaveURL(/\/customer\/subscriptions\/new\?plan=/);
    await expect(page.getByTestId('configurator-screen')).toBeVisible();

    // plan → combination → duration
    await expect(page.getByTestId('configurator-step-plan')).toBeVisible();
    await page.getByTestId('configurator-next').click();
    await expect(page.getByTestId('configurator-step-combination')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-duration')).toBeVisible();
    await page.getByTestId('configurator-duration-4w').click();
    await page.getByTestId('configurator-next').click();

    // dietary — seeded profile may already carry exclusions; nothing to invent
    await expect(page.getByTestId('configurator-step-dietary')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    // delivery — use the saved Al Quoz address from DemoCustomerSeeder
    await expect(page.getByTestId('configurator-step-delivery')).toBeVisible();
    await page.getByTestId('configurator-address-picker-trigger').click();
    const addressOption = page
        .locator('[data-testid^="configurator-address-picker-option-"]')
        .first();
    await expect(addressOption).toBeVisible();
    await addressOption.click();

    const repair = page.getByTestId('configurator-start-date-repair');
    if ((await repair.count()) > 0) await repair.click();

    // Prefer Monday when the kitchen offers it; otherwise take the first weekday chip.
    const monday = page.getByTestId('configurator-weekday-1');
    if ((await monday.count()) > 0) {
        await monday.click();
    } else {
        await page.locator('[data-testid^="configurator-weekday-"]').first().click();
    }

    const morning = page.getByTestId('configurator-slot-morning');
    if ((await morning.count()) > 0) {
        await morning.click();
    } else {
        await page.locator('[data-testid^="configurator-slot-"]').first().click();
    }

    await page.getByTestId('configurator-checks-acknowledge-control').click();
    await page.getByTestId('configurator-next').click();

    // sample week → summary (first price) → confirm
    await expect(page.getByTestId('configurator-step-meals')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-summary')).toBeVisible();
    await expect(page.getByTestId('configurator-price-total-amount')).toBeVisible();
    await page.getByTestId('configurator-next').click();

    await expect(page.getByTestId('configurator-step-confirm')).toBeVisible();
    await page.getByTestId('configurator-confirm-acknowledge-control').click();
    await page.getByTestId('configurator-create').click();

    await expect(page.getByTestId('configurator-success-screen')).toBeVisible();
    await expect(page.getByTestId('configurator-success-state')).toBeVisible();
});
