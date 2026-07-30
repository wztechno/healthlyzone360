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
 * 2. **It does not survive a reload.** The scenario is React state, not storage, so the chosen world
 *    lasts exactly as long as the document. Everything after this call has to be client-side
 *    navigation; a `page.goto` puts the build's default scenario back.
 */
export async function selectScenario(page: Page, scenario: string) {
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
