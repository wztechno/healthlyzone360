import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    CEDAR_DIETITIAN,
    DEMO_PASSWORD,
    JOURNEY_TIMEOUT,
    apiRequest,
    issueToken,
    probeStack,
    selectCedarContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * **Device management and real step-up authentication.**
 *
 * The sign-in registers this browser as a device; a second device is created through the token
 * endpoint so there is something to revoke that is not the current credential. Revoking it is
 * step-up protected, so the server answers `403 auth.step_up_required` for real, the screen opens
 * its password dialog, `POST /auth/confirm-password` unlocks the credential, and the revocation is
 * retried automatically.
 *
 * The last assertion is the one that matters: the revoked token is *dead*, not merely hidden.
 *
 * ## Re-runnable without a reseed
 *
 * Every device this file creates is named with a timestamp, so a second run never collides with the
 * first, and the one device that is deliberately *not* revoked by the journey revokes itself at the
 * end. A run therefore adds nothing permanent to the local database — which is the property that
 * lets `web-write` be run repeatedly against one seeded world instead of demanding a `migrate:fresh`
 * between attempts.
 */

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

/**
 * Signed in **and in a workspace**, which `/devices` turns out to require.
 *
 * `device.manage_own` looks like a permission a person carries everywhere, and it is not: the
 * session projects `permissions` from `me.active_context` alone (`src/session/machine.ts`), so an
 * account with no chosen organisation holds *no* permissions at all and the route's
 * `allOf: ['device.manage_own']` gate refuses — `devices-screen` never renders and the failure reads
 * as a screen that never loaded.
 *
 * It bit this file and not the others because `dietitian@cedar.test` is the one persona with **two**
 * memberships: the picker cannot auto-select for them, so a bare `signIn` leaves them contextless.
 * The state was invisible locally whenever `workspace.write.spec.ts` had run first and left a
 * remembered organisation behind, and reappeared on every freshly seeded database — which is exactly
 * the kind of order dependence a write suite must not have. Choosing Cedar explicitly makes the
 * precondition part of the journey instead of part of the luck.
 */
async function openDevices(page: Page): Promise<void> {
    await signIn(page, CEDAR_DIETITIAN);
    await selectCedarContext(page);
    await page.goto('/devices');
    await expect(page.getByTestId('devices-screen')).toBeVisible({ timeout: JOURNEY_TIMEOUT });
}

test('lists real devices and revokes one through the step-up dialog', async ({ page }) => {
    const secondDeviceName = `E2E phone ${String(Date.now())}`;

    // A second, independent credential — the thing under revocation.
    const second = await issueToken(page.request, CEDAR_DIETITIAN, secondDeviceName);

    const alive = await apiRequest(page.request, 'get', '/api/v1/me', { token: second.token });
    expect(alive.status()).toBe(200);

    await openDevices(page);

    // The browser's own device was created by the sign-in and is badged as current.
    const currentBadge = page.locator('[data-testid$="-current"]');
    await expect(currentBadge.first()).toBeVisible();

    const target = page.getByTestId(`device-${second.deviceId}`);
    await expect(target).toBeVisible({ timeout: JOURNEY_TIMEOUT });
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
    // Two chained writes — `POST /auth/confirm-password` then the retried `DELETE` — so the toast is
    // waited for on the journey budget rather than on the single-request one.
    await expect(page.getByTestId('device-revoked-toast')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
    await expect(page.getByTestId(`device-${second.deviceId}`)).toHaveCount(0, {
        timeout: JOURNEY_TIMEOUT,
    });

    const dead = await apiRequest(page.request, 'get', '/api/v1/me', { token: second.token });
    expect(dead.status()).toBe(401);
    expect(((await dead.json()) as { error: { code: string } }).error.code).toBe(
        'auth.unauthenticated',
    );
});

test('a wrong password is rejected by the step-up dialog', async ({ page }) => {
    const secondDeviceName = `E2E tablet ${String(Date.now())}`;

    const second = await issueToken(page.request, CEDAR_DIETITIAN, secondDeviceName);

    // The device is created *before* the screen is opened, so the list it renders already has it.
    await openDevices(page);
    await expect(page.getByTestId(`device-${second.deviceId}`)).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });

    await page.getByTestId(`device-${second.deviceId}-revoke`).click();
    await page.getByTestId('revoke-dialog-confirm').click();
    await expect(page.getByTestId('step-up-dialog')).toBeVisible({ timeout: JOURNEY_TIMEOUT });

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
