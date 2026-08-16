import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    JOURNEY_TIMEOUT,
    KITCHEN_OWNER,
    probeStack,
    selectVerdantKitchenContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The order desk, end to end, against the real API.
 *
 * ## Why this is a write spec and not three
 *
 * A counter sale is the single most consequential write in this application: one request performs
 * place → confirm → receipt → fulfil inside one transaction, so it creates an order, deducts stock,
 * writes a payment receipt and closes the order in a way nothing here can undo. It therefore belongs
 * to `web-write` — one worker, no retries — for the same reason the kitchen workspace's journeys do:
 * every row outlives the page.
 *
 * ## The persona has to be the owner
 *
 * The wizard is gated on `order.create_on_behalf_organisation`, and the placement endpoint requires
 * it too. `owner@verdant.test` holds `organisation_owner` at Verdant Kitchen, and every organisation
 * permission code is auto-granted to that role by design — so the owner reaches the desk without the
 * suite having to provision a `order_desk_agent` membership it would then have to clean up.
 *
 * The owner also holds `catalogue.view_organisation`, which the basket's picker needs. A dedicated
 * `order_desk_agent` does **not** — see the screen's own header. That gap is a real one and this
 * spec cannot cover it: proving it would mean asserting a `403`, which is a permission-registry test
 * rather than a journey.
 *
 * ## Screens are reached by address
 *
 * `/kitchen` fans out into forty-odd catalogue requests before its cards finish counting, and on the
 * Windows Docker stack that is a hundred seconds before anything can be pressed. The desk is opened
 * directly at `/kitchen/order-desk`, which costs the one queue read that screen actually needs — and
 * the "New sale" button this slice adds to the queue toolbar is then pressed as a real agent would,
 * because that link is part of what this spec is proving.
 *
 * ## What the sale is made of
 *
 * The picker is Verdant's own published catalogue, and the desk sells it through the `desk` sales
 * channel, which the provisioning backfill seeded as a mirror of the web shop. So the first row the
 * picker offers is expected to be **quotable** — if it is not, the assertion that fails is the total
 * appearing, and the reason will be the `channel_unavailable` refusal rendered inline on the line,
 * which is exactly the diagnosis somebody needs.
 *
 * Nothing here is uniquely *named* — a sale creates no named record — but a sale is not idempotent
 * either: every run of this file leaves one more fulfilled order and one more receipt in Verdant's
 * book, which is the same cost the commerce write spec pays for placing an order.
 */

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    // Signing in is three chained round trips and choosing an organisation is three more; the
    // project's default budget is for one screen.
    test.slow();
    skipUnlessStackIsUp(stack);
});

/** Signed in, in the Verdant workspace, with the desk queue on screen. */
async function openOrderDesk(page: Page): Promise<void> {
    await signIn(page, KITCHEN_OWNER);
    await selectVerdantKitchenContext(page);
    await page.goto('/kitchen/order-desk');
    await expect(page.getByTestId('kitchen-order-desk-screen')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
}

/** The wizard, opened through the queue's own primary action rather than by address. */
async function openSaleWizard(page: Page): Promise<void> {
    await openOrderDesk(page);
    await page.getByTestId('kitchen-order-desk-new-sale').click();
    await expect(page.getByTestId('kitchen-order-desk-sale-type')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
}

test.describe('order desk', () => {
    test('a counter sale is rung up, completed, and comes back fulfilled', async ({ page }) => {
        await openSaleWizard(page);

        // Step 1 — counter is the default, and the wizard says so in four steps rather than five.
        await expect(page.getByTestId('kitchen-order-desk-sale-position')).toContainText('4', {
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-order-desk-sale-next').click();

        // Step 2 — the basket. The picker is the kitchen's published catalogue.
        await expect(page.getByTestId('kitchen-order-desk-sale-picker-rows')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        const firstAdd = page
            .getByTestId('kitchen-order-desk-sale-picker-rows')
            .getByRole('button', { name: 'Add' })
            .first();
        await firstAdd.click();

        // The total is the quote's, and it is the only price on this screen. If this never appears,
        // read the line's own refusals — the article is published but not offered at the counter.
        await expect(page.getByTestId('kitchen-order-desk-sale-basket-totals-total')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        // A counter sale has no delivery fee at all — null, which is not zero.
        await expect(page.getByTestId('kitchen-order-desk-sale-basket-totals-fee')).toBeHidden();

        const next = page.getByTestId('kitchen-order-desk-sale-next');
        await expect(next).toBeEnabled({ timeout: JOURNEY_TIMEOUT });
        await next.click();

        // Step 3 — the money at the till. Cash needs no reference.
        await expect(page.getByTestId('kitchen-order-desk-sale-payment')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-order-desk-sale-next').click();

        // Step 4 — read it back, then sell it.
        await expect(page.getByTestId('kitchen-order-desk-sale-review')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        const submit = page.getByTestId('kitchen-order-desk-sale-submit');
        await expect(submit).toBeEnabled({ timeout: JOURNEY_TIMEOUT });
        await submit.click();

        // One request performed the whole till transaction, so the screen shows a finished sale
        // rather than sending anybody to a queue this order is not in.
        await expect(page.getByTestId('kitchen-order-desk-sale-completed')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        const completed = page.getByTestId('kitchen-order-desk-sale-completed-state-title');
        await expect(completed).toContainText('H360-', { timeout: JOURNEY_TIMEOUT });
        // Already fulfilled — the whole observable difference between a counter sale and the others.
        await expect(page.getByTestId('kitchen-order-desk-sale-completed-status')).toContainText(
            'Fulfilled',
            { timeout: JOURNEY_TIMEOUT },
        );

        // The order number, quoted back the way a customer would quote it.
        const orderNumber = ((await completed.textContent()) ?? '').replace(/^\D*/, '').trim();
        expect(orderNumber).toMatch(/^H360-/);

        // And it is in the order book, fulfilled. The *queue* lists open work only, so a completed
        // counter sale is deliberately absent from it — the book is where it lands.
        await page.goto('/kitchen/orders');
        await expect(page.getByTestId('kitchen-orders-table')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-orders-search-input').fill(orderNumber);
        await expect(page.getByText(orderNumber).first()).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
    });

    test('starting another sale empties the basket rather than reusing it', async ({ page }) => {
        await openSaleWizard(page);
        await page.getByTestId('kitchen-order-desk-sale-next').click();

        await expect(page.getByTestId('kitchen-order-desk-sale-picker-rows')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page
            .getByTestId('kitchen-order-desk-sale-picker-rows')
            .getByRole('button', { name: 'Add' })
            .first()
            .click();
        await expect(page.getByTestId('kitchen-order-desk-sale-basket-totals-total')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });

        await page.getByTestId('kitchen-order-desk-sale-next').click();
        await expect(page.getByTestId('kitchen-order-desk-sale-payment')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-order-desk-sale-next').click();
        await page.getByTestId('kitchen-order-desk-sale-submit').click();

        await expect(page.getByTestId('kitchen-order-desk-sale-completed')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-order-desk-sale-completed-new').click();

        // Back at the beginning, with nothing carried over from the sale just made.
        await expect(page.getByTestId('kitchen-order-desk-sale-type')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        await page.getByTestId('kitchen-order-desk-sale-next').click();
        await expect(page.getByTestId('kitchen-order-desk-sale-basket-empty')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
    });

    test('a delivery asks for a customer before it will go any further', async ({ page }) => {
        await openSaleWizard(page);

        await page.getByTestId('kitchen-order-desk-sale-type-delivery').click();
        // Five steps now: the customer and the address have appeared.
        await expect(page.getByTestId('kitchen-order-desk-sale-position')).toContainText('5', {
            timeout: JOURNEY_TIMEOUT,
        });

        await page.getByTestId('kitchen-order-desk-sale-next').click();
        await expect(page.getByTestId('kitchen-order-desk-sale-customer')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
        // Nothing chosen, so the wizard will not move on — the server would refuse the placement
        // with `customer_required`, and this is that refusal asked before it costs a round trip.
        await expect(page.getByTestId('kitchen-order-desk-sale-next')).toBeDisabled();

        // Two characters never leave the browser: the endpoint refuses fewer than three with a 422.
        await page.getByTestId('kitchen-order-desk-sale-customer-search-input').fill('La');
        await expect(page.getByTestId('kitchen-order-desk-sale-customer-too-short')).toBeVisible({
            timeout: JOURNEY_TIMEOUT,
        });
    });
});
