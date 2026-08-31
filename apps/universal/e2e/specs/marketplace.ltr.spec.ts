import { expect, test } from '@playwright/test';

import {
    CONSUMER_EMAIL,
    LISTED_KITCHEN_SLUGS,
    UNLISTED_KITCHEN_SLUGS,
    probeStack,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The public marketplace and the signed-in consumer home, in English.
 *
 * These run against the exported static build reading the real API, so every navigation below is
 * the real router doing real work — including the shell fallback that makes `/kitchens/{id}` resolve
 * without a pre-rendered page — and every card is a row `MarketplaceKitchensSeeder` wrote.
 *
 * ## Why slugs rather than counts
 *
 * The seeded marketplace holds six kitchen organisations and eight published plans, and those totals
 * are true *today*. They are also the least interesting thing about it: a seeder that gains a
 * seventh kitchen is a normal change, and a spec that fails for it teaches nobody anything. So the
 * assertions are on **named** records — `kitchen-card-the-daily-pot` is either there or the preview
 * world did not seed — except where a total genuinely is the point.
 *
 * Four of those six reach the consumer directory; the other two sell only wholesale or only over the
 * counter and are asserted *absent*. See `LISTED_KITCHEN_SLUGS` in `helpers.ts`.
 */

/** Currency and price markers that must never appear on a business-facing consumer page. */
const PRICE_MARKER = /\b(AED|SAR|USD|KWD|BHD|OMR)\b|\bfrom\s+\d/i;

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

test.describe('public marketplace (en)', () => {
    test('the landing page is browsable with no account and offers no sign-out', async ({
        page,
    }) => {
        await page.goto('/');

        await expect(page.getByTestId('landing-screen')).toBeVisible();
        await expect(page.getByTestId('landing-title')).toBeVisible();
        await expect(page.getByTestId('brand-mark')).toBeVisible();
        await expect(page.getByTestId('marketplace-shell-navigation')).toBeVisible();
        await expect(page.getByTestId('marketplace-footer')).toBeVisible();
        await expect(page.getByTestId('skip-to-content')).toBeVisible();

        // An anonymous surface offers the two things an anonymous person can do, and nothing else.
        await expect(page.getByTestId('marketplace-sign-in')).toBeVisible();
        await expect(page.getByTestId('marketplace-register')).toBeVisible();
        await expect(page.getByTestId('sign-out')).toHaveCount(0);

        // The featured strip is real data, read from the API through the repositories.
        await expect(page.getByTestId('landing-featured-grid')).toBeVisible();
        await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toBeVisible();

        // This build reads the API, so the mock banner must not exist anywhere on it.
        await expect(page.getByTestId('dev-banner')).toHaveCount(0);
    });

    test('the directory lists every kitchen a shopper can buy from, and only those', async ({
        page,
    }) => {
        await page.goto('/kitchens');
        await expect(page.getByTestId('kitchens-grid')).toBeVisible();

        for (const slug of LISTED_KITCHEN_SLUGS) {
            await expect(
                page.getByTestId(`kitchen-card-${slug}`),
                `${slug} is missing from the directory`,
            ).toBeVisible();
        }

        // The other half of the claim, and the half a directory gets wrong: a kitchen with no
        // consumer channel is not a kitchen with an empty menu, it is one a shopper cannot order
        // from at all. `KitchensScreen` asks for `b2c_web`/`marketplace` and these two run neither.
        for (const slug of UNLISTED_KITCHEN_SLUGS) {
            await expect(
                page.getByTestId(`kitchen-card-${slug}`),
                `${slug} has no consumer channel and must not be listed`,
            ).toHaveCount(0);
        }
    });

    test('discover leads to a kitchen, its menu and the meal record', async ({ page }) => {
        await page.goto('/discover');
        await expect(page.getByTestId('discover-screen')).toBeVisible();

        await page.getByTestId('marketplace-nav-kitchens').click();
        await expect(page.getByTestId('kitchens-screen')).toBeVisible();
        await expect(page.getByTestId('kitchens-grid')).toBeVisible();

        await page.getByTestId('kitchen-card-verdant-kitchen').click();
        await expect(page.getByTestId('kitchen-profile-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-name')).toContainText('Verdant Kitchen');
        await expect(page.getByTestId('kitchen-branches')).toBeVisible();

        await page.getByTestId('kitchen-view-menu').click();
        await expect(page.getByTestId('kitchen-menu-screen')).toBeVisible();
        await expect(page.getByTestId('kitchen-menu-grid')).toBeVisible();

        // The in-place summary drawer this menu used before the catalogue wave is gone: the card
        // now navigates to the real record at `/meals/{meal}`.
        await page.locator('[data-testid$="-open"][data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();
        await expect(page.getByTestId('meal-detail-facts')).toBeVisible();
        await expect(page.getByTestId('meal-detail-allergens')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    /**
     * A term in the address really narrows the directory, and the reset chip really restores.
     *
     * This used to type into a search box on the page. There is no longer one: HealthZone's browse
     * screen filters with chips, and the marketplace bar owns text search for every surface, so a
     * second input writing the same `?q=` would be two things to keep in step. `KitchensScreen`
     * still *reads* the parameter — a shared or hand-written link with a term in it narrows the
     * directory — which is the half that is wired end to end and therefore the half worth driving:
     * the screen puts the term in `query`, the repository sends it, `GET /marketplace/kitchens`
     * filters on it.
     *
     * It has never pressed a *cuisine* chip, and now cannot: that control was inert against the API
     * (`listKitchens` builds its query from `query`, `country_code`, `area` and `channels` and never
     * sent `filter.cuisines`, and every seeded kitchen answers `cuisines: []`) and has been replaced
     * by channel and diet chips that do narrow. The reset chip is what this test exercises of the
     * new row, because it is the one whose effect does not depend on how the world is seeded.
     */
    test('a term in the address narrows the directory, and the reset chip restores it', async ({
        page,
    }) => {
        await page.goto('/kitchens?q=Saffron');
        await expect(page.getByTestId('kitchens-grid')).toBeVisible();
        await expect(page.getByTestId('kitchen-card-saffron-and-sea')).toBeVisible();
        await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toHaveCount(0);

        await page.getByTestId('kitchens-filter-all').click();
        await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toBeVisible();
    });

    test('the dietitian directory is not offered and its route redirects', async ({ page }) => {
        await page.goto('/discover');
        await expect(page.getByTestId('discover-screen')).toBeVisible();
        await expect(page.getByTestId('marketplace-nav-dietitians')).toHaveCount(0);
        await expect(page.getByTestId('footer-dietitians')).toHaveCount(0);

        await page.goto('/dietitians');
        await expect(page.getByTestId('discover-screen')).toBeVisible();
    });

    test('the business page carries no price of any kind', async ({ page }) => {
        await page.goto('/for-business');
        await expect(page.getByTestId('for-business-screen')).toBeVisible();
        await expect(page.getByTestId('for-business-programme-corporate')).toBeVisible();
        await expect(page.getByTestId('for-business-pricing')).toBeVisible();

        const body = (await page.getByTestId('for-business-screen').innerText()).replace(
            /Healthy360/g,
            '',
        );
        expect(body).not.toMatch(PRICE_MARKER);

        // The quotation control is navigation-shaped, so it offers real destinations.
        await page.getByTestId('for-business-request-quotation').click();
        await expect(page.getByTestId('for-business-enquiry')).toBeVisible();
        await page.getByTestId('for-business-enquiry-sign-in').click();
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    });

    test('how it works explains the product and links onward', async ({ page }) => {
        await page.goto('/how-it-works');
        await expect(page.getByTestId('how-it-works-screen')).toBeVisible();
        await expect(page.getByTestId('how-it-works-step-tell')).toBeVisible();
        await expect(page.getByTestId('how-it-works-step-eat')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer')).toBeVisible();

        await page.getByTestId('how-it-works-browse').click();
        await expect(page.getByTestId('kitchens-screen')).toBeVisible();
    });

    test('the sign-in call to action reaches the authentication screen', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('landing-screen')).toBeVisible();

        await page.getByTestId('marketplace-sign-in').click();
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    });

    test('the meal catalogue destination now resolves rather than disclosing', async ({ page }) => {
        await page.goto('/discover');
        await expect(page.getByTestId('discover-screen')).toBeVisible();

        // `meals` was a `planned` descriptor answering with a prototype notice until the catalogue
        // wave built the route. Flipping one `status` field was the whole handoff.
        await page.getByTestId('marketplace-nav-meals').click();
        await expect(page.getByTestId('meals-screen')).toBeVisible();
        await expect(page.getByTestId('prototype-notice')).toHaveCount(0);
    });
});

test.describe('consumer home (en)', () => {
    test('shows the subscription state it really has, and nothing that has no backend', async ({
        page,
    }) => {
        // The seeded consumer has no membership anywhere, so the landing resolver takes this
        // account straight to the customer area rather than through an organisation picker.
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer');
        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();
        await expect(page.getByTestId('consumer-greeting')).toBeVisible();
        await expect(page.getByTestId('consumer-shell')).toBeVisible();

        /*
         * Either a running subscription or the designed empty state — and which one depends on
         * whether `commerce.write.spec.ts` has run against this database yet. `DemoCustomerSeeder`
         * opens an account and stops; it seeds no subscription, deliberately, because a subscription
         * nobody created is a fiction. So the card is asserted as a *card in one of its two real
         * states* rather than as a promise the seed does not make.
         */
        await expect(
            page
                .getByTestId('subscription-card-content')
                .or(page.getByTestId('consumer-subscription-browse'))
                .first(),
        ).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();

        // The planner, nutrition and virtual-dietitian surfaces have no endpoints; nothing on
        // this page offers them.
        await expect(page.getByTestId('consumer-ai-band')).toHaveCount(0);
        await expect(page.getByTestId('consumer-today')).toHaveCount(0);
        await expect(page.getByTestId('consumer-nutrition')).toHaveCount(0);
    });

    test('the consumer navigation offers only the destinations that resolve', async ({ page }) => {
        await signIn(page, CONSUMER_EMAIL);
        await page.goto('/customer');
        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();

        await expect(page.getByTestId('consumer-nav-home')).toBeVisible();
        await expect(page.getByTestId('consumer-nav-planner')).toHaveCount(0);
        await expect(page.getByTestId('consumer-nav-nutrition')).toHaveCount(0);
        await expect(page.getByTestId('consumer-nav-virtual-dietitian')).toHaveCount(0);

        await page.getByTestId('consumer-nav-subscriptions').click();
        await expect(page.getByTestId('subscriptions-screen')).toBeVisible();
        await expect(page.getByTestId('prototype-notice')).not.toBeVisible();
    });

    /** A direct hit on a hidden route lands somewhere real rather than on a dead screen. */
    test('a hidden customer route redirects to the customer home', async ({ page }) => {
        await signIn(page, CONSUMER_EMAIL);

        await page.goto('/customer/planner');
        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();
    });
});
