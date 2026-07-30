import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

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

        // The open meal drawer, swept since the Drawer's aria-modal-on-roleless-wrapper defect
        // was fixed at the Wave 2 gate (accessibilityViewIsModal removed from the outer Modal).
        await page
            .getByTestId('kitchen-menu-grid')
            .locator('[data-testid^="meal-card-"]')
            .first()
            .click();
        await expect(page.getByTestId('meal-detail-drawer')).toBeVisible();
        await expectNoSeriousViolations(page, 'kitchen-menu-meal-drawer');
    });

    test('dietitians', async ({ page }) => {
        await page.goto('/dietitians');
        await expect(page.getByTestId('dietitians-grid')).toBeVisible();
        await expectNoSeriousViolations(page, 'dietitians');
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
        await signIn(page);
        // Wait for the login to land before reloading: `signIn` submits the form and returns, and
        // a `goto` that races the mutation navigates before the session token has been written.
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await page.goto('/customer');
        await expect(page.getByTestId('consumer-home-screen')).toBeVisible();
        await expect(page.getByTestId('nutrition-snapshot-content')).toBeVisible();
        await expectNoSeriousViolations(page, 'consumer-home');
    });
});
