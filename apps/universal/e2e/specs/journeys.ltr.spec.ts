import { expect, test } from '@playwright/test';

import {
    CEDAR_DIETITIAN,
    CEDAR_SLUG,
    VERDANT_SLUG,
    openOrganisationPicker,
    probeStack,
    selectCedarContext,
    signIn,
    signInExpectingRefusal,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * Authentication and workspace context, in English, against the real API.
 *
 * `dietitian@cedar.test` is seeded into two organisations — Cedar Clinic, branch-scoped to Hamra,
 * and Verdant Kitchen, organisation-wide — so the picker, the context selection and the workspace
 * shell are all driven by rows that came out of PostgreSQL rather than by a fixture built in the
 * browser.
 *
 * ## Two things this file used to assert and no longer can
 *
 * The **development banner** was a hard requirement in mock mode: fixtures had to be visibly
 * identified. This build reads the API, so the banner's *absence* is the assertion, and it is the
 * cheapest possible proof that `dist-api` was not accidentally exported in mock mode.
 *
 * **Device revocation** and **registration** both write, so they moved to `devices.write.spec.ts`
 * and `registration.write.spec.ts` where they run one worker at a time. What is left here is
 * read-only and safe to run in parallel with everything else.
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

test.describe('authentication and context journey (en)', () => {
    test('signs in, picks a real organisation, and reaches the workspace selector', async ({
        page,
    }) => {
        await signIn(page, CEDAR_DIETITIAN);

        await openOrganisationPicker(page);

        // Both seeded memberships, named by the server rather than by this spec.
        await expect(page.getByTestId(`organisation-${CEDAR_SLUG}`)).toBeVisible();
        await expect(page.getByTestId(`organisation-${VERDANT_SLUG}`)).toBeVisible();
        await expect(page.getByTestId(`organisation-${CEDAR_SLUG}-status`)).toContainText('active');

        await page.getByTestId(`organisation-${CEDAR_SLUG}`).click();

        // The Cedar membership is scoped to one branch, so `PUT /me/context` applies Hamra itself
        // and there is no branch to choose — the picker is skipped exactly as designed.
        await expect(page.getByTestId('workspace-selector-screen')).toBeVisible();
        await expect(page.getByTestId('workspace-organisation')).toContainText('Cedar Clinic');
        await expect(page.getByTestId('workspace-branch')).toContainText('Hamra');

        // The proof that this artefact is reading the API: the mock banner is unmissable when it
        // is there, so its absence is the whole assertion.
        await expect(page.getByTestId('dev-banner')).toHaveCount(0);
    });

    test('the profile screen renders the real /me payload', async ({ page }) => {
        await signIn(page, CEDAR_DIETITIAN);
        await selectCedarContext(page);

        await page.goto('/profile');
        await expect(page.getByTestId('profile-screen')).toBeVisible();

        await expect(page.getByTestId('profile-email')).toHaveText(CEDAR_DIETITIAN);
        await expect(page.getByTestId('profile-display-name')).toHaveText('Rami Khoury');
        await expect(page.getByTestId('profile-organisation')).toHaveText('Cedar Clinic');
        await expect(page.getByTestId('profile-branch')).toHaveText('Hamra');

        // Permissions come from the server's calculated set, never from client-side role inference.
        await expect(
            page.getByTestId('profile-permission-organisation.view_current'),
        ).toBeVisible();

        // Both memberships are listed even though only one is the active context.
        await expect(page.getByTestId(`profile-membership-${CEDAR_SLUG}`)).toBeVisible();
        await expect(page.getByTestId(`profile-membership-${VERDANT_SLUG}`)).toBeVisible();
    });

    test('rejects a wrong password with an inline error and no navigation', async ({ page }) => {
        await signInExpectingRefusal(page, CEDAR_DIETITIAN, 'wrong-password');
    });

    test('deep-linking an unpermitted area renders the forbidden page in place', async ({
        page,
    }) => {
        await signIn(page, CEDAR_DIETITIAN);
        await selectCedarContext(page);

        await page.goto('/platform-admin');
        await expect(page.locator('[data-testid$="forbidden"]').first()).toBeVisible();
    });

    test('the development banner is absent on every unauthenticated screen too', async ({
        page,
    }) => {
        for (const route of ['/', '/sign-in', '/register', '/meals']) {
            await page.goto(route);
            await expect(page.getByTestId('dev-banner')).toHaveCount(0);
        }
    });
});
