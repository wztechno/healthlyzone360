import { expect, test } from '@playwright/test';

import {
    CEDAR_DIETITIAN,
    DEMO_PASSWORD,
    apiRequest,
    issueToken,
    probeStack,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * **Acceptance (d): device management and real step-up authentication.**
 *
 * The sign-in registers this browser as a device; a second device is created through the token
 * endpoint so there is something to revoke that is not the current credential. Revoking it is
 * step-up protected, so the server answers `403 auth.step_up_required` for real, the screen opens
 * its password dialog, `POST /auth/confirm-password` unlocks the credential, and the revocation is
 * retried automatically.
 *
 * The last assertion is the one that matters: the revoked token is *dead*, not merely hidden.
 */

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    skipUnlessStackIsUp(stack);
});

test('lists real devices and revokes one through the step-up dialog', async ({ page }) => {
    const secondDeviceName = `Acceptance phone ${Date.now()}`;

    await signIn(page, CEDAR_DIETITIAN);

    // A second, independent credential — the thing under revocation.
    const second = await issueToken(page.request, CEDAR_DIETITIAN, secondDeviceName);

    const alive = await apiRequest(page.request, 'get', '/api/v1/me', { token: second.token });
    expect(alive.status()).toBe(200);

    await page.goto('/devices');
    await expect(page.getByTestId('devices-screen')).toBeVisible();

    // The browser's own device was created by the sign-in and is badged as current.
    const currentBadge = page.locator('[data-testid$="-current"]');
    await expect(currentBadge.first()).toBeVisible();

    const target = page.getByTestId(`device-${second.deviceId}`);
    await expect(target).toBeVisible();
    await expect(target).toContainText(secondDeviceName);

    await page.getByTestId(`device-${second.deviceId}-revoke`).click();
    await expect(page.getByTestId('revoke-dialog')).toBeVisible();
    await page.getByTestId('revoke-dialog-confirm').click();

    // The real 403: the server demands a recent password confirmation before it will cut a device
    // off, and the screen turns that into a dialog rather than an error.
    await expect(page.getByTestId('step-up-dialog')).toBeVisible();
    await page.getByTestId('step-up-password').locator('input').first().fill(DEMO_PASSWORD);
    await page.getByTestId('step-up-submit').click();

    // Confirmation unlocks the credential and the original revocation is retried for the user.
    await expect(page.getByTestId('device-revoked-toast')).toBeVisible();
    await expect(page.getByTestId(`device-${second.deviceId}`)).toHaveCount(0);

    const dead = await apiRequest(page.request, 'get', '/api/v1/me', { token: second.token });
    expect(dead.status()).toBe(401);
    expect(((await dead.json()) as { error: { code: string } }).error.code).toBe(
        'auth.unauthenticated',
    );
});

test('a wrong password is rejected by the step-up dialog', async ({ page }) => {
    const secondDeviceName = `Acceptance tablet ${Date.now()}`;

    await signIn(page, CEDAR_DIETITIAN);
    const second = await issueToken(page.request, CEDAR_DIETITIAN, secondDeviceName);

    await page.goto('/devices');
    await expect(page.getByTestId(`device-${second.deviceId}`)).toBeVisible();

    await page.getByTestId(`device-${second.deviceId}-revoke`).click();
    await page.getByTestId('revoke-dialog-confirm').click();
    await expect(page.getByTestId('step-up-dialog')).toBeVisible();

    await page.getByTestId('step-up-password').locator('input').first().fill('not-the-password');
    await page.getByTestId('step-up-submit').click();

    // The dialog stays open with the server's rejection, and the device is untouched.
    await expect(page.getByTestId('step-up-dialog')).toBeVisible();
    await expect(page.getByTestId(`device-${second.deviceId}`)).toBeVisible();

    const alive = await apiRequest(page.request, 'get', '/api/v1/me', { token: second.token });
    expect(alive.status()).toBe(200);

    // Clean up after ourselves: the device would otherwise pile up in the local database on every
    // run. The credential revokes itself, which needs its own step-up confirmation.
    await apiRequest(page.request, 'post', '/api/v1/auth/confirm-password', {
        token: second.token,
        data: { password: DEMO_PASSWORD },
    });
    await apiRequest(page.request, 'delete', `/api/v1/me/devices/${second.deviceId}`, {
        token: second.token,
    });
});
