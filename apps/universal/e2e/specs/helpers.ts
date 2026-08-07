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
 * Put one address in the signed-in account's book, through the two screens that own it.
 *
 * Checkout and the subscription record both take a delivery address by *identifier* (D-084) — the
 * zone, the window and the fee resolve from a saved entry — so neither offers a form to type into.
 * Nobody in the mock world starts with one: `mock/account/store.ts` opens with an empty list in
 * every scenario, deliberately, because "add an address" is one of the steps the account area exists
 * to walk somebody through. A journey that needs one therefore has to create it, and because the
 * mock world lives only as long as the document, it has to create it in the *same* document.
 *
 * Expects the page to already be on `/customer/account/addresses`, and leaves it there with the list
 * no longer empty — so the caller carries on through the shell's own navigation rather than through
 * a second `page.goto`, which would start a new world with an empty book.
 *
 * Driven entirely by test identifier, so it is direction- and locale-agnostic.
 */
export async function saveAddress(page: Page, label: string, line1: string) {
    await expect(page.getByTestId('addresses-screen')).toBeVisible();
    await page.getByTestId('addresses-screen-add').click();
    await expect(page.getByTestId('address-editor')).toBeVisible();

    await page.getByTestId('address-editor-label').locator('input').first().fill(label);
    // The area is a foreign key into the platform's service areas, so it is chosen, never typed.
    await page.getByTestId('address-editor-area-trigger').click();
    await page.locator('[data-testid^="address-editor-area-option-"]').first().click();
    await page.getByTestId('address-editor-line1').locator('input').first().fill(line1);
    await page.getByTestId('address-editor-save').click();

    // The save reached the store rather than merely the form: the empty state is gone.
    await expect(page.getByTestId('addresses-screen-list')).toBeVisible();
}

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
 * The kitchen half of the default scenario: Verdant Kitchen, where the dietitian holds the
 * `kitchen_manager` role.
 *
 * No branch step, and that is the server's doing rather than an omission: the membership has exactly
 * one branch, so `setContext` applies it and the branch picker auto-skips (`mock/store.ts`). The
 * journey therefore goes organisation picker → workspace selector.
 */
export async function selectVerdantKitchenContext(page: Page) {
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.getByTestId('organisation-verdant-kitchen').click();
    await expect(page.getByTestId('workspace-selector-screen')).toBeVisible();
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
