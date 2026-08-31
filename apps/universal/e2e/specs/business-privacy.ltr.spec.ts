import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    CONSUMER_EMAIL,
    CORPORATE_BUYER,
    PLAN_SLUG,
    probeStack,
    selectAcmeContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

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
 * 2. **`SAR`** — a currency no consumer surface prices anything in. Every seeded consumer price is
 *    USD, so `SAR` on a public or customer route means a negotiated figure leaked, even if it
 *    arrived as loose copy rather than as a component.
 * 3. **`H360-Q`** — the quotation reference prefix. Also corporate-only, and it catches a leak of
 *    the *paperwork* rather than of the price.
 *
 * ## A sweep that only asserts an absence proves nothing — and right now it cannot prove otherwise
 *
 * The first test is the positive control: it exists to prove the markers really are rendered
 * somewhere, so that their absence everywhere else means something. Against the seeded API it
 * **cannot run**, and the honest thing is to say so rather than to let it pass vacuously.
 * `GET /b2b/catalogue/items` answers `{"items":[]}` for the seeded buyer and `mapProgramme` returns
 * `employeeSubsidy: null`, so no `contract-price-` marker is rendered anywhere in the product and
 * no quotation with an `H360-Q` reference exists to leak. The control therefore skips at runtime
 * with that sentence attached, and the day the negotiated catalogue seeds a priced line it starts
 * running again on its own — which is exactly the behaviour a pinned gap should have.
 */

const CONTRACT_PRICE_SELECTOR = '[data-testid^="contract-price-"]';

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

/**
 * Customer surfaces, and the anchor each one really lands on.
 *
 * Two anchors changed with the world. `/customer/checkout` reaches `checkout-empty` rather than
 * `checkout-screen`, because the seeded consumer's basket is empty until a write journey fills it;
 * and `/customer/subscriptions` shows its empty state for the same reason. Both are the designed
 * states of those routes, and both are exactly as capable of leaking a negotiated figure as the
 * populated ones — a leak in an empty state is still a leak.
 */
const CUSTOMER_SURFACES: readonly Surface[] = [
    { route: '/customer', anchor: 'consumer-home-screen' },
    { route: '/customer/subscriptions', anchor: 'subscriptions-screen' },
    { route: '/customer/cart', anchor: 'cart-screen' },
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
        `${surface}: SAR appears, and no consumer surface prices anything in Saudi riyals`,
    ).not.toContain('SAR');
    expect(text, `${surface}: a quotation reference appears`).not.toContain('H360-Q');
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

test.describe('B2B price privacy', () => {
    test('positive control: the corporate screens really do carry the markers', async ({
        page,
    }) => {
        await signIn(page, CORPORATE_BUYER);
        await selectAcmeContext(page);

        await page.goto('/corporate');
        await expect(page.getByTestId('corporate-dashboard-screen')).toBeVisible();

        const markers = await page.locator(CONTRACT_PRICE_SELECTOR).count();
        test.skip(
            markers === 0,
            'The seeded B2B world renders no negotiated figure: GET /b2b/catalogue/items answers ' +
                '{"items":[]} for buyer@acme-wellness.test and the programme mapper returns ' +
                'employeeSubsidy: null. Until one of those carries a price, this control cannot ' +
                'prove the marker exists — and the absence sweeps below are correspondingly weaker.',
        );

        await expect(page.locator(CONTRACT_PRICE_SELECTOR).first()).toBeVisible();
    });

    for (const surface of PUBLIC_SURFACES) {
        test(`no negotiated price reaches the public route ${surface.route}`, async ({ page }) => {
            await page.goto(surface.route);
            await expect(page.getByTestId(surface.anchor)).toBeVisible();
            await expectNoContractPricing(page, surface.route);
        });
    }

    test('no negotiated price reaches a kitchen, its menu, a meal or a plan', async ({ page }) => {
        // Addressed by identifier, so reached by navigation rather than by a hard-coded URL — and
        // that is not a preference any more: every primary key is a UUIDv7 minted at seed time.
        await page.goto('/kitchens');
        await page.locator('[data-testid^="kitchen-card-"]').first().click();
        await expect(page.getByTestId('kitchen-profile-screen')).toBeVisible();
        await expectNoContractPricing(page, 'kitchen profile');

        await page.getByTestId('kitchen-view-menu').click();
        await expect(page.getByTestId('kitchen-menu-screen')).toBeVisible();
        await expectNoContractPricing(page, 'kitchen menu');

        await page.goto('/meals');
        await page.locator('[data-testid$="-open"][data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();
        await expectNoContractPricing(page, 'meal detail');

        await page.goto('/plans');
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
        await expect(page.getByTestId('plan-detail-screen')).toBeVisible();
        await expectNoContractPricing(page, 'plan detail');
    });

    for (const surface of CUSTOMER_SURFACES) {
        test(`no negotiated price reaches the customer route ${surface.route}`, async ({
            page,
        }) => {
            await signIn(page, CONSUMER_EMAIL);
            await page.goto(surface.route);
            await expect(page.getByTestId(surface.anchor)).toBeVisible();
            await expectNoContractPricing(page, surface.route);
        });
    }

    test('no negotiated price reaches the subscription configurator', async ({ page }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/plans');
        await expect(page.getByTestId('plans-grid')).toBeVisible();
        await page.getByTestId(`plan-card-${PLAN_SLUG}-open`).click();
        await page.getByTestId('plan-detail-configure').click();
        await expect(page.getByTestId('configurator-screen')).toBeVisible();

        await expectNoContractPricing(page, 'subscription configurator');
    });
});
