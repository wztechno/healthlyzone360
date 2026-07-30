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
