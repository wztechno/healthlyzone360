import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { CONSUMER_EMAIL, probeStack, signIn, skipUnlessStackIsUp } from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The accessibility gate for the marketplace and the consumer home: zero serious or critical axe
 * violations. Moderate findings are recorded in the risk register rather than blocked on here,
 * which matches the existing screen sweep.
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

test.describe('marketplace accessibility (axe)', () => {
    test('landing', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByTestId('landing-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'landing');
    });

    test('discover', async ({ page }) => {
        await page.goto('/discover');
        await expect(page.getByTestId('discover-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'discover');
    });

    test('kitchens', async ({ page }) => {
        await page.goto('/kitchens');
        await expect(page.getByTestId('kitchens-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchens');
    });

    test('kitchen profile and menu', async ({ page }) => {
        await page.goto('/kitchens');
        await page.getByTestId('kitchen-card-verdant-kitchen').click();
        await expect(page.getByTestId('kitchen-profile-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-profile');

        await page.getByTestId('kitchen-view-menu').click();
        await expect(page.getByTestId('kitchen-menu-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-menu');

        // The in-place drawer this sweep used to open was replaced by `/meals/{meal}` at the
        // catalogue wave; the meal record has its own sweep in `catalogue.a11y.spec.ts`, and what
        // matters here is that the menu card reaches it.
        await page
            .getByTestId('kitchen-menu-grid')
            .locator('[data-testid^="meal-card-"]')
            .first()
            .click();
        await expect(page.getByTestId('meal-detail-screen')).toBeVisible();
    });

    test('for business', async ({ page }) => {
        await page.goto('/for-business');
        await expect(page.getByTestId('for-business-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'for-business');
    });

    test('how it works', async ({ page }) => {
        await page.goto('/how-it-works');
        await expect(page.getByTestId('how-it-works-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'how-it-works');
    });

    test('consumer home', async ({ page }) => {
        // `signIn` waits for an authenticated landmark *and* for the token to reach storage, so the
        // `goto` below cannot race the credential the way the old "sign-in screen hidden" wait did.
        await signIn(page, CONSUMER_EMAIL);
        await page.goto('/customer');
        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();
        // The subscription card in whichever of its two real states this database is in — the seed
        // creates no subscription, so the empty state is the honest default. Both are swept.
        await expect(
            page
                .getByTestId('subscription-card-content')
                .or(page.getByTestId('consumer-subscription-browse'))
                .first(),
        ).toBeVisible();
        await expectNoSeriousViolations(page, 'consumer-home');
    });
});
