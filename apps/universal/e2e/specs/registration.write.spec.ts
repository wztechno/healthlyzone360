import { expect, test } from '@playwright/test';

import {
    JOURNEY_TIMEOUT,
    fetchVerificationLink,
    probeStack,
    readSessionToken,
    readUserId,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * **Registration and email verification against the real API.**
 *
 * A brand-new account is created through the UI, the backend really creates it, the verification
 * mail really arrives, and following the signed link really flips the account to verified. Nothing
 * seeded is involved at any point, which is also why it lives in `web-write`: every run leaves one
 * more account behind, and two workers registering at once would interleave two messages in the
 * same log file.
 *
 * The one thing the UI cannot do is *open* the link: it is a signed URL on the API host, and the API
 * requires the credential (session or bearer) that owns the address. A bearer client therefore
 * follows it with its own token attached — which is what a native application does when it handles
 * the deep link — so the test does the same through `page.request`.
 *
 * ## Why the mail is found by user id rather than by address
 *
 * The stack's mail logger redacts recipients (`To: a***@healthy360.test`), so the address this test
 * just typed appears nowhere in the logged message. The signed URL embeds the user's identifier —
 * `/verify-email/{id}/{hash}` — which cannot be redacted without breaking the link, so that is the
 * needle. `/me` is asked for it with the token the application is already holding.
 */

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    // Registration is a form submit, a `/me`, a poll of the mail log and a signed round trip back
    // to the API — several chained requests against a stack that answers each in seconds. The
    // project's 90 s default is a budget for one request, so this journey says what it costs.
    test.slow();
    skipUnlessStackIsUp(stack, true);
});

test('registers a new account, verifies it by mail, and reaches the verified state', async ({
    page,
}) => {
    const email = `e2e+${String(Date.now())}@healthy360.test`;
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

    /*
     * The account exists and is unverified: the application is holding a real bearer token and is
     * showing the "confirm your address" state rather than a workspace.
     *
     * On the journey budget rather than the per-assertion one. `POST /auth/register` opens an
     * account, writes a contact point, records two consents and queues the verification mail before
     * it answers, and the screen behind it only changes once `/me` has come back — several seconds
     * each on this stack, and the *first* thing this suite does after a cold start.
     */
    await expect(page.getByTestId('verify-email-screen')).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });
    await expect(page.getByTestId('verify-email-title')).toBeVisible();
    await expect(page.getByTestId('verify-email-body')).toContainText(email);

    const token = await readSessionToken(page);
    const userId = await readUserId(page.request, token);

    const link = await fetchVerificationLink(userId);
    expect(link).toContain('/api/v1/auth/verify-email/');
    expect(link).toContain('signature=');

    const verified = await page.request.get(link, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    expect(verified.status(), await verified.text()).toBe(200);
    expect(((await verified.json()) as { data: unknown }).data).toMatchObject({
        email_verified: true,
    });

    // Back in the UI: "check again" re-reads `/me` and the screen flips to the verified state.
    await page.getByTestId('verify-email-recheck').click();
    await expect(page.getByTestId('verify-email-verified')).toBeVisible();

    /*
     * A verified account with no membership is a consumer, and the landing resolver says so: in
     * `all-dev` a person with no active membership lands on the customer home rather than on an
     * organisation picker they could never fill (`packages/permissions/src/landing.ts`).
     */
    await page.getByTestId('verify-email-continue').click();
    await expect(
        page
            .getByTestId('consumer-home-screen')
            .or(page.getByTestId('organisation-picker-empty'))
            .first(),
    ).toBeVisible();
});

test('the development banner is absent in api mode', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    // Mock-mode visibility was a plan §18 requirement; its *absence* here is the proof that this
    // build is reading the real API.
    await expect(page.getByTestId('dev-banner')).toHaveCount(0);
});
