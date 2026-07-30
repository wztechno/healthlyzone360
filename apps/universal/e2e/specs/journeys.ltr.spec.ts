import { expect, test } from '@playwright/test';

import { DIETITIAN_EMAIL, MOCK_PASSWORD, selectCedarHamraContext, signIn } from './helpers.ts';

test.describe('authentication and context journey (en)', () => {
    test('signs in, picks organisation and branch, reaches the workspace selector', async ({
        page,
    }) => {
        await signIn(page);
        await selectCedarHamraContext(page);

        await expect(page.getByTestId('workspace-organisation')).toContainText('Cedar Clinic');
        await expect(page.getByTestId('workspace-branch')).toContainText('Hamra');

        // The mock banner is a hard requirement: mock mode must be visibly identified.
        await expect(page.getByTestId('dev-banner')).toBeVisible();
        await expect(page.getByTestId('dev-banner-badge')).toBeVisible();
    });

    test('rejects a wrong password with an inline error and no navigation', async ({ page }) => {
        await signIn(page, DIETITIAN_EMAIL, 'wrong-password');
        await expect(page.getByTestId('sign-in-error')).toBeVisible();
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    });

    test('device revocation demands step-up and completes after password confirmation', async ({
        page,
    }) => {
        await signIn(page);
        await selectCedarHamraContext(page);

        await page.goto('/devices');
        await expect(page.getByTestId('devices-screen')).toBeVisible();

        // Revoke the first non-current device (the current session cannot revoke itself).
        const revokeButtons = page.locator('[data-testid$="-revoke"]');
        await expect(revokeButtons.first()).toBeVisible();
        await revokeButtons.first().click();

        await expect(page.getByTestId('revoke-dialog')).toBeVisible();
        await page.getByTestId('revoke-dialog-confirm').click();

        // The mock server, like the real one, answers auth.step_up_required.
        await expect(page.getByTestId('step-up-dialog')).toBeVisible();
        await page.getByTestId('step-up-password').locator('input').first().fill(MOCK_PASSWORD);
        await page.getByTestId('step-up-submit').click();

        await expect(page.getByTestId('device-revoked-toast')).toBeVisible();
    });

    test('deep-linking an unpermitted area renders the forbidden page in place', async ({
        page,
    }) => {
        await signIn(page);
        await selectCedarHamraContext(page);

        await page.goto('/platform-admin');
        await expect(page.locator('[data-testid$="forbidden"]').first()).toBeVisible();
    });

    test('registration walks into the verify-email state', async ({ page }) => {
        await page.goto('/register');
        await expect(page.getByTestId('register-screen')).toBeVisible();

        await page.getByTestId('register-name').locator('input').first().fill('Test Person');
        await page.getByTestId('register-email').locator('input').first().fill('new.person@example.com');
        await page.getByTestId('register-password').locator('input').first().fill('a-long-enough-password');
        await page.getByTestId('register-password-confirmation').locator('input').first().fill('a-long-enough-password');
        await page.getByTestId('register-accept-terms').click();
        await page.getByTestId('register-accept-privacy').click();
        await page.getByTestId('register-submit').click();

        await expect(page.getByTestId('verify-email-screen')).toBeVisible();
    });
});
