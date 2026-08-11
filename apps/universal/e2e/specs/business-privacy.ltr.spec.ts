import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

/**
 * The B2B price-privacy sweep: **"customer screens must not expose private B2B prices."**
 *
 * ## Why this file exists when the type system already forbids it
 *
 * `contracts/business.ts` is the only module in which a negotiated price is representable, and no
 * consumer screen has a repository to fetch one from. That is the real enforcement, and it is the
 * part that survives a refactor. What it cannot catch is somebody passing a figure down as a plain
 * number, or a future screen reaching into the wrong hook — so this walks the rendered pages too.
 *
 * ## The three markers
 *
 * 1. **`data-testid^="contract-price-"`** — the structural marker. Every negotiated figure the
 *    corporate screens render carries it, built in one place
 *    (`src/features/business/format.ts`), and no other area applies it. This is the primary
 *    assertion.
 * 2. **`SAR`** — the fixture marker. Exactly one amount in the entire prototype world is priced in
 *    Saudi riyals and it is a corporate catalogue line (`mock/prototype/fixtures/business.ts`);
 *    every consumer-facing price is AED. So `SAR` appearing on a public or customer route means a
 *    negotiated figure leaked, even if it arrived as loose copy rather than as a component.
 * 3. **`H360-Q`** — the quotation reference prefix. Also corporate-only, and it catches a leak of
 *    the *paperwork* rather than of the price.
 *
 * ## A sweep that only asserts an absence proves nothing
 *
 * A marker nobody applies is trivially absent everywhere. So the first test is a positive control:
 * it proves all three markers really are rendered on the corporate screens. If that test starts
 * failing, everything below it has quietly stopped meaning anything — and it will say so loudly
 * instead.
 *
 * ## Why the default mock world is used throughout
 *
 * The prototype store seeds the generated week, the basket, the subscription and the corporate
 * fixtures in every world that has completed onboarding, and `/customer/**` needs an authenticated,
 * verified person but no organisation context. So one sign-in reaches both halves of the sweep, and
 * nothing here depends on a runtime scenario switch that a `page.goto` would undo.
 */

const CONTRACT_PRICE_SELECTOR = '[data-testid^="contract-price-"]';

/** The one catalogue line priced in SAR. A readable code, exactly as a purchase order would quote. */
const SAR_LINE_CODE = 'catalogue-wholesale-prepared-pallet';

interface Surface {
    readonly route: string;
    /** What has to be on screen before the page is worth reading. */
    readonly anchor: string;
}

/** Public marketplace surfaces. Reachable with no session at all. */
const PUBLIC_SURFACES: readonly Surface[] = [
    { route: '/', anchor: 'landing-screen' },
    { route: '/discover', anchor: 'discover-screen' },
    { route: '/kitchens', anchor: 'kitchens-screen' },
    { route: '/meals', anchor: 'meals-screen' },
    { route: '/plans', anchor: 'plans-screen' },
    { route: '/plans/compare', anchor: 'plan-comparison-screen' },
    { route: '/how-it-works', anchor: 'how-it-works-screen' },
    // The corporate *sales* page: it presents B2B programmes to the public, which makes it the
    // single most likely place for a negotiated rate to be quoted by accident.
    { route: '/for-business', anchor: 'for-business-screen' },
];

/** Customer surfaces. Reachable once any verified person has signed in. */
const CUSTOMER_SURFACES: readonly Surface[] = [
    { route: '/customer', anchor: 'consumer-home-screen' },
    { route: '/customer/subscriptions', anchor: 'subscriptions-screen' },
    { route: '/customer/subscriptions/new', anchor: 'configurator-screen' },
    { route: '/customer/cart', anchor: 'cart-screen' },
    { route: '/customer/checkout', anchor: 'checkout-screen' },
];

/**
 * Asserts that nothing on the current page carries a corporate marker.
 *
 * The text checks read `body.innerText` rather than a locator, because a leak is as likely to be
 * loose copy — "SAR 11.50 for corporate buyers" — as it is to be a component with a test id.
 */
async function expectNoContractPricing(page: Page, surface: string) {
    await expect(
        page.locator(CONTRACT_PRICE_SELECTOR),
        `${surface}: a contract-price marker reached a consumer surface`,
    ).toHaveCount(0);

    const text = await page.evaluate(() => document.body.innerText);
    expect(
        text,
        `${surface}: SAR appears, and the only SAR amount in the world is a corporate catalogue line`,
    ).not.toContain('SAR');
    expect(text, `${surface}: a quotation reference appears`).not.toContain('H360-Q');
}

test.describe('B2B price privacy', () => {
    test('positive control: the corporate screens really do carry all three markers', async ({
        page,
    }) => {
        await signIn(page);
        await selectCedarHamraContext(page);

        await page.goto('/corporate');
        await expect(page.getByTestId('corporate-dashboard-screen')).toBeVisible();

        // 1. The structural marker — a negotiated per-person subsidy.
        await expect(page.locator(CONTRACT_PRICE_SELECTOR).first()).toBeVisible();

        // 3. The quotation reference.
        await expect(page.getByTestId('corporate-quotation-summary')).toContainText('H360-Q');

        // 2. The fixture marker: the one line priced in Saudi riyals.
        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill(SAR_LINE_CODE);
        await page.getByTestId('corporate-lookup-open').click();
        await expect(page.getByTestId('catalogue-item-screen')).toBeVisible();
        await expect(page.getByTestId(`contract-price-headline-${SAR_LINE_CODE}`)).toContainText(
            'SAR',
        );
    });

    for (const surface of PUBLIC_SURFACES) {
        test(`no negotiated price reaches the public route ${surface.route}`, async ({ page }) => {
            await page.goto(surface.route);
            await expect(page.getByTestId(surface.anchor)).toBeVisible();
            await expectNoContractPricing(page, surface.route);
        });
    }

    test('no negotiated price reaches a kitchen, its menu, a meal or a plan', async ({ page }) => {
        // Addressed by identifier, so reached by navigation rather than by a hard-coded URL — a
        // fixture identifier in a spec is a fixture leak wearing a constant's clothing.
        await page.goto('/kitchens');
        await page.locator('[data-testid^="kitchen-card-"]').first().click();
        await expect(page.getByTestId('kitchen-profile-screen')).toBeVisible();
        await expectNoContractPricing(page, 'kitchen profile');

        await page.getByTestId('kitchen-view-menu').click();
        await expect(page.getByTestId('kitchen-menu-screen')).toBeVisible();
        await expectNoContractPricing(page, 'kitchen menu');

        await page.goto('/meals');
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();
        await expectNoContractPricing(page, 'meal detail');

        await page.goto('/plans');
        await page.locator('[data-testid^="plan-card-"][data-testid$="-open"]').first().click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expectNoContractPricing(page, 'plan detail');
    });

    for (const surface of CUSTOMER_SURFACES) {
        test(`no negotiated price reaches the customer route ${surface.route}`, async ({
            page,
        }) => {
            await signIn(page);
            await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
            await page.goto(surface.route);
            await expect(page.getByTestId(surface.anchor)).toBeVisible();
            await expectNoContractPricing(page, surface.route);
        });
    }

    test('no negotiated price reaches a subscription record', async ({ page }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

        await page.goto('/customer/subscriptions');
        await expect(page.getByTestId('subscriptions-screen')).toBeVisible();
        await page
            .locator('[data-testid^="subscription-row-"][data-testid$="-open"]')
            .first()
            .click();
        await expect(page.getByTestId('subscription-detail-screen')).toBeVisible();
        await expectNoContractPricing(page, 'subscription detail');
    });
});
