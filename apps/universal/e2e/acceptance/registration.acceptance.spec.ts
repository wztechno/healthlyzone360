import { expect, test } from '@playwright/test';

import {
    fetchVerificationLink,
    probeStack,
    readSessionToken,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * **Acceptance (a): registration and email verification against the real API.**
 *
 * A brand-new account is created through the UI, the backend really creates it, the verification
 * mail really arrives, and following the signed link really flips the account to verified. No
 * fixture is involved at any point.
 *
 * The one thing the UI cannot do is *open* the link: it is a signed URL on the API host, and the
 * API requires the credential (session or bearer) that owns the address. A bearer client therefore
 * follows it with its own token attached — which is what a native application does when it handles
 * the deep link — so the test does the same through `page.request`.
 */

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    skipUnlessStackIsUp(stack, true);
});

test('registers a new account, verifies it by mail, and reaches the verified state', async ({
    page,
}) => {
    const email = `acceptance+${Date.now()}@healthy360.test`;
    const password = 'Acceptance123!';

    await page.goto('/register');
    await expect(page.getByTestId('register-screen')).toBeVisible();

    await page.getByTestId('register-name').locator('input').first().fill('Acceptance Tester');
    await page.getByTestId('register-email').locator('input').first().fill(email);
    await page.getByTestId('register-password').locator('input').first().fill(password);
    await page
        .getByTestId('register-password-confirmation')
        .locator('input')
        .first()
        .fill(password);
    // The consent controls are Pressables with `role="checkbox"`, not `<input>` elements, so the
    // row itself is the hit target (packages/design-system/src/forms/checkbox.tsx).
    await page.getByTestId('register-accept-terms').click();
    await page.getByTestId('register-accept-privacy').click();
    await page.getByTestId('register-submit').click();

    // The account exists and is unverified: the application is holding a real bearer token and is
    // showing the "confirm your address" state rather than a workspace.
    await expect(page.getByTestId('verify-email-screen')).toBeVisible();
    await expect(page.getByTestId('verify-email-title')).toBeVisible();
    await expect(page.getByTestId('verify-email-body')).toContainText(email);

    const token = await readSessionToken(page);

    const link = await fetchVerificationLink(email);
    expect(link).toContain('/api/v1/auth/verify-email/');
    expect(link).toContain('signature=');

    const verified = await page.request.get(link, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(verified.status(), await verified.text()).toBe(200);
    expect((await verified.json()).data).toMatchObject({ email_verified: true });

    // Back in the UI: "check again" re-reads `/me` and the screen flips to the verified state.
    await page.getByTestId('verify-email-recheck').click();
    await expect(page.getByTestId('verify-email-verified')).toBeVisible();

    // A verified account with no membership has nowhere to be but the organisation picker, which
    // says so rather than failing.
    await page.getByTestId('verify-email-continue').click();
    await expect(page.getByTestId('organisation-picker-empty')).toBeVisible();
});

test('the development banner is absent in api mode', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    // Mock-mode visibility is a plan §18 requirement; its *absence* here is the proof that this
    // build is reading the real API.
    await expect(page.getByTestId('dev-banner')).toHaveCount(0);
});
