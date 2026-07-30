import { expect, test } from '@playwright/test';

import {
    CEDAR_DIETITIAN,
    apiRequest,
    probeStack,
    readSessionToken,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * **Acceptance (b) and (c): real memberships, real context, real cross-organisation refusal.**
 *
 * `dietitian@cedar.test` is seeded into two organisations — Cedar Clinic (branch-scoped to Hamra)
 * and Verdant Kitchen (organisation-wide) — so the picker, the context selection and the workspace
 * shell are all driven by data that came out of PostgreSQL.
 *
 * The picker is reached by navigating to it rather than by assuming the sign-in lands there: the
 * API *remembers* the last workspace on the profile, so a second run of this suite would otherwise
 * be routed straight past the screen under test. Navigating makes the test idempotent without
 * weakening it — the memberships it asserts are still the real ones.
 */

const CEDAR_SLUG = 'cedar-clinic';
const VERDANT_SLUG = 'verdant-kitchen';

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(() => {
    skipUnlessStackIsUp(stack);
});

test('signs in and selects a real organisation, landing in the workspace', async ({ page }) => {
    await signIn(page, CEDAR_DIETITIAN);

    await page.goto('/select-organisation');
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();

    // Both seeded memberships, named by the server.
    await expect(page.getByTestId(`organisation-${CEDAR_SLUG}`)).toBeVisible();
    await expect(page.getByTestId(`organisation-${VERDANT_SLUG}`)).toBeVisible();
    // The badge renders a tick glyph alongside the label.
    await expect(page.getByTestId(`organisation-${CEDAR_SLUG}-status`)).toContainText('active');

    await page.getByTestId(`organisation-${CEDAR_SLUG}`).click();

    // The Cedar membership is scoped to one branch, so `PUT /me/context` applies Hamra itself and
    // there is no branch to choose — the picker is skipped exactly as it is designed to be.
    await expect(page.getByTestId('workspace-selector-screen')).toBeVisible();
    // Badges prefix their label with a tone glyph, so these match on content.
    await expect(page.getByTestId('workspace-organisation')).toContainText('Cedar Clinic');
    await expect(page.getByTestId('workspace-branch')).toContainText('Hamra');

    await expect(page.getByTestId('dev-banner')).toHaveCount(0);
});

test('the profile screen renders the real /me payload', async ({ page }) => {
    await signIn(page, CEDAR_DIETITIAN);

    await page.goto('/select-organisation');
    await page.getByTestId(`organisation-${CEDAR_SLUG}`).click();
    await expect(page.getByTestId('workspace-selector-screen')).toBeVisible();

    await page.goto('/profile');
    await expect(page.getByTestId('profile-screen')).toBeVisible();

    await expect(page.getByTestId('profile-email')).toHaveText(CEDAR_DIETITIAN);
    await expect(page.getByTestId('profile-display-name')).toHaveText('Rami Khoury');
    await expect(page.getByTestId('profile-organisation')).toHaveText('Cedar Clinic');
    await expect(page.getByTestId('profile-branch')).toHaveText('Hamra');

    // Permissions come from the server's calculated set, never from client-side role inference.
    await expect(page.getByTestId('profile-permission-organisation.view_current')).toBeVisible();

    // Both memberships are listed even though only one is active context.
    await expect(page.getByTestId(`profile-membership-${CEDAR_SLUG}`)).toBeVisible();
    await expect(page.getByTestId(`profile-membership-${VERDANT_SLUG}`)).toBeVisible();
});

/**
 * Acceptance (c): a context the caller has no membership in is refused with its own code, and the
 * message never reveals whether the organisation exists (docs/api/conventions.md).
 */
test('claiming another organisation is refused with context.organisation_forbidden', async ({
    page,
}) => {
    await signIn(page, CEDAR_DIETITIAN);
    const token = await readSessionToken(page);

    const response = await apiRequest(page.request, 'get', '/api/v1/organisations/current', {
        token,
        headers: { 'X-Organisation-Id': '019fb11f-0000-7000-8000-000000000000' },
    });

    expect(response.status()).toBe(403);
    const body = (await response.json()) as {
        error: { code: string; message: string; correlation_id: string };
    };
    expect(body.error.code).toBe('context.organisation_forbidden');
    expect(body.error.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.error.message).not.toContain('019fb11f-0000');

    // The context the caller *does* hold still works, so the refusal was about the claim and not
    // about the credential.
    const allowed = await apiRequest(page.request, 'get', '/api/v1/me', { token });
    expect(allowed.status()).toBe(200);
});
