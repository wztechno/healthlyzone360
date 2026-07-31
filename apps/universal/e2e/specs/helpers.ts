import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** The default mock scenario account (multi-org-dietitian). */
export const DIETITIAN_EMAIL = 'layla.haddad@cedarclinic.example';
export const MOCK_PASSWORD = 'password';

/** Sign in through the real screen and wait for the post-login navigation. */
export async function signIn(page: Page, email = DIETITIAN_EMAIL, password = MOCK_PASSWORD) {
    await page.goto('/sign-in');
    await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    await page.getByTestId('sign-in-email').locator('input').first().fill(email);
    await page.getByTestId('sign-in-password').locator('input').first().fill(password);
    await page.getByTestId('sign-in-submit').click();
}

/** The Prompt 2 consumer account. Present in `consumer-prototype` and `consumer-onboarding`. */
export const CONSUMER_EMAIL = 'nour.saleh@example.com';

/**
 * Switch the mock world at runtime through the development banner's scenario control.
 *
 * Two properties of that control decide how this can be used, and both are the repository
 * provider's behaviour rather than this helper's:
 *
 * 1. **It clears the session token.** A world swap invalidates the account that belonged to the old
 *    world, so this must run *before* signing in — calling it on a guarded screen signs the person
 *    out and the gate redirects.
 * 2. **It survives a reload within the same tab, and only there.** The choice is written to
 *    `sessionStorage`, so a `page.goto` after this call keeps the chosen world; a fresh browser
 *    context (every Playwright test) still starts at the build's default scenario. Specs written
 *    before persistence use client-side navigation exclusively, which remains correct.
 */
export async function selectScenario(page: Page, scenario: string) {
    // The scenario switcher is tucked behind a toggle in the compact dev banner; expand it first.
    const toggle = page.getByTestId('dev-banner-toggle');
    if ((await toggle.count()) > 0) {
        await toggle.click();
    }
    await expect(page.getByTestId('dev-scenario')).toBeVisible();
    await page.getByTestId('dev-scenario-trigger').click();
    await page.getByTestId(`dev-scenario-option-${scenario}`).click();
    await expect(page.getByTestId('dev-banner-scenario')).toContainText(scenario);
}

/**
 * Complete the context journey for the default scenario: Cedar Clinic (two branches, so the
 * branch picker shows) then the Hamra branch, landing on the workspace selector.
 */
export async function selectCedarHamraContext(page: Page) {
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.getByTestId('organisation-cedar-clinic').click();
    await expect(page.getByTestId('branch-picker-screen')).toBeVisible();
    await page.getByTestId('branch-BEY-HAM').click();
    await expect(page.getByTestId('workspace-selector-screen')).toBeVisible();
}
