import { expect, test } from '@playwright/test';

import { selectScenario, signIn } from './helpers.ts';

/**
 * The public marketplace and the signed-in consumer home, in English.
 *
 * These run against the exported static build, so every navigation below is the real router doing
 * real work — including the shell fallback that makes `/kitchens/{id}` resolve without a
 * pre-rendered page.
 */

/** Currency and price markers that must never appear on a business-facing consumer page. */
const PRICE_MARKER = /\b(AED|SAR|USD|KWD|BHD|OMR)\b|\bfrom\s+\d/i;

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

        // The featured strip is real data read through the repositories.
        await expect(page.getByTestId('landing-featured-grid')).toBeVisible();
        await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toBeVisible();
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
        await page.locator('[data-testid^="meal-card-"]').first().click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();
        await expect(page.getByTestId('meal-detail-facts')).toBeVisible();
        await expect(page.getByTestId('meal-detail-allergens')).toBeVisible();
        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    test('a kitchen filter narrows the directory and clears again', async ({ page }) => {
        await page.goto('/kitchens');
        await expect(page.getByTestId('kitchens-grid')).toBeVisible();

        await page.getByTestId('kitchens-filter-cuisine-Coastal').click();
        await expect(page.getByTestId('kitchen-card-saffron-and-sea')).toBeVisible();
        await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toHaveCount(0);

        await page.getByTestId('kitchens-filter-clear').click();
        await expect(page.getByTestId('kitchen-card-verdant-kitchen')).toBeVisible();
    });

    test('a dietitian profile marks its invented registration and answers honestly', async ({
        page,
    }) => {
        await page.goto('/dietitians');
        await expect(page.getByTestId('dietitians-grid')).toBeVisible();

        await page.locator('[data-testid^="dietitian-card-"]').first().click();
        await expect(page.getByTestId('dietitian-profile-screen')).toBeVisible();
        await expect(page.getByTestId('dietitian-synthetic-note')).toBeVisible();

        await page.getByTestId('prototype-action').first().click();
        await expect(page.getByTestId('prototype-notice')).toBeVisible();
        await expect(page.getByTestId('prototype-notice')).toContainText('Not built yet');
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

    test('the development scenario control swaps the mock world in place', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('landing-screen')).toBeVisible();

        await selectScenario(page, 'consumer-onboarding');

        // The world was rebuilt without a reload, and the public catalogue still reads.
        await expect(page.getByTestId('landing-featured-grid')).toBeVisible();
    });
});

test.describe('consumer home (en)', () => {
    test('shows the next meals, the nutrition snapshot and the running subscription', async ({
        page,
    }) => {
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        // The customer area needs an authenticated, verified person and no organisation context,
        // so it is reachable directly rather than through the workspace pickers.
        await page.goto('/customer');

        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();
        await expect(page.getByTestId('consumer-greeting')).toBeVisible();
        await expect(page.getByTestId('consumer-shell')).toBeVisible();

        await expect(page.getByTestId('nutrition-snapshot-content')).toBeVisible();
        await expect(page.getByTestId('nutrition-meter-energy')).toBeVisible();
        await expect(page.getByTestId('subscription-card-content')).toBeVisible();

        // The fixture week is anchored on a fixed Monday; either the entries or the designed empty
        // state is correct, and rendering neither is not.
        await expect(
            page.getByTestId('today-card-entries').or(page.getByTestId('today-card-empty')).first(),
        ).toBeVisible();

        await expect(page.getByTestId('medical-disclaimer').first()).toBeVisible();
    });

    test('the consumer navigation reaches the planner now that every destination is built', async ({
        page,
    }) => {
        await signIn(page);
        // Wait for the login to land before reloading: `signIn` submits the form and returns, and
        // a `goto` that races the mutation navigates before the session token has been written.
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer');
        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();

        // Wave 4 completed the consumer surface: a press navigates rather than explains.
        await expect(page.getByTestId('consumer-nav-home')).toBeVisible();
        await page.getByTestId('consumer-nav-planner').click();
        await expect(page.getByTestId('planner-week-screen')).toBeVisible();
        await expect(page.getByTestId('prototype-notice')).not.toBeVisible();
    });
});
