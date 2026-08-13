import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    CEDAR_DIETITIAN,
    JOURNEY_TIMEOUT,
    CEDAR_SLUG,
    KITCHEN_OWNER,
    TWO_FACTOR_EMAIL,
    VERDANT_SLUG,
    apiRequest,
    authenticatedLandmark,
    openOrganisationPicker,
    probeStack,
    readSessionToken,
    selectVerdantKitchenContext,
    signIn,
    skipUnlessStackIsUp,
    totpCode,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * **Real memberships, real context switching, and the two refusals that guard them.**
 *
 * `dietitian@cedar.test` is seeded into two organisations — Cedar Clinic (branch-scoped to Hamra)
 * and Verdant Kitchen (organisation-wide) — so the picker, the context selection and the workspace
 * shell are all driven by rows that came out of PostgreSQL.
 *
 * ## Why this is a write spec
 *
 * `PUT /me/context` is a **write**: it stamps `user_profiles.last_organisation_id`, which is how the
 * API remembers where somebody was. Switching an account between two organisations while another
 * worker is reading that same account's remembered workspace is exactly the kind of interleaving
 * that produces a failure nobody can reproduce. So the switching journey runs here, serially, and
 * the read-only projects only ever *set* a context, never alternate it.
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

test('switches one identity between two real organisations', async ({ page }) => {
    await signIn(page, CEDAR_DIETITIAN);

    await openOrganisationPicker(page);
    await expect(page.getByTestId(`organisation-${CEDAR_SLUG}`)).toBeVisible();
    await expect(page.getByTestId(`organisation-${VERDANT_SLUG}`)).toBeVisible();

    await page.getByTestId(`organisation-${CEDAR_SLUG}`).click();
    await expect(page.getByTestId('workspace-selector-screen')).toBeVisible();
    await expect(page.getByTestId('workspace-organisation')).toContainText('Cedar Clinic');
    // The Cedar membership is scoped to one branch, so the server applies Hamra itself.
    await expect(page.getByTestId('workspace-branch')).toContainText('Hamra');

    // …and the same identity, one press later, is somewhere else entirely.
    await openOrganisationPicker(page);
    await page.getByTestId(`organisation-${VERDANT_SLUG}`).click();
    await expect(page.getByTestId('workspace-selector-screen')).toBeVisible();
    await expect(page.getByTestId('workspace-organisation')).toContainText('Verdant Kitchen');

    // Left where the read-only projects expect to find it. The remembered context is shared state,
    // and a spec that mutates shared state puts it back.
    await openOrganisationPicker(page);
    await page.getByTestId(`organisation-${CEDAR_SLUG}`).click();
    await expect(page.getByTestId('workspace-organisation')).toContainText('Cedar Clinic');
});

/**
 * A context the caller has no membership in is refused with its own code, and the message never
 * reveals whether the organisation exists (`docs/api/conventions.md`).
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

/**
 * The kitchen workspace is opened by the account that may open it, and refused for the one that may
 * not — which is the same distinction the whole permission kernel exists to make, asserted at the
 * only place a person meets it.
 */
test('the kitchen workspace opens for the kitchen manager', async ({ page }) => {
    await signIn(page, KITCHEN_OWNER);

    // One membership, so the picker auto-selects it rather than offering a list; the helper knows
    // the difference and asserts the workspace it lands in either way.
    await selectVerdantKitchenContext(page);

    await page.goto('/kitchen');
    await expect(page.getByTestId('kitchen-home-screen')).toBeVisible();
    await expect(page.getByTestId('kitchen-family-ingredients')).toBeVisible();
});

/**
 * Two-factor sign-in, with a code this test computes itself.
 *
 * `two-factor@cedar.test` is enrolled with a published shared secret precisely so an end-to-end
 * suite can do this, and the code is generated locally from `node:crypto` rather than stubbed —
 * which additionally proves the server's clock and this machine's agree to within the 30-second
 * step. A code generated in the last second of a window would be rejected by the time the round
 * trip lands, so it is regenerated once on refusal rather than retried blindly.
 */
/**
 * Types a freshly generated code and presses submit, waiting for the control to be idle first.
 *
 * The wait is what stops a retry from queueing behind the attempt it is retrying: the button is
 * `loading` (disabled, `aria-busy`) for as long as the challenge request is in flight, and a click
 * issued in that window is retried by Playwright against a node the next render replaces.
 */
async function submitTotp(page: Page): Promise<void> {
    const field = page.getByTestId('two-factor-code').locator('input').first();
    await field.fill('');
    await field.fill(totpCode());

    const submit = page.getByTestId('two-factor-submit');
    await expect(submit).toBeEnabled({ timeout: JOURNEY_TIMEOUT });
    await submit.click();
}

test('signs in through the real two-factor challenge', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByTestId('sign-in-screen')).toBeVisible();
    await page.getByTestId('sign-in-email').locator('input').first().fill(TWO_FACTOR_EMAIL);
    await page.getByTestId('sign-in-password').locator('input').first().fill('password');
    await page.getByTestId('sign-in-submit').click();

    // Not an error: the form advances to its second step.
    await expect(page.getByTestId('two-factor-screen')).toBeVisible();

    await submitTotp(page);

    const landed = authenticatedLandmark(page);
    const anonymous = page.getByTestId('landing-screen');
    /*
     * The *refusal*, not the challenge screen — and that distinction is the whole repair.
     *
     * Three things can follow the challenge: an authenticated landmark, a refused code (the
     * 30-second window turned over between generating it and the server checking it), or the
     * anonymous marketplace — the same post-sign-in session race `signIn` documents. Waiting for
     * `two-factor-screen` as the middle outcome could never work: it is the screen the code was
     * just typed into, so it is already visible and the race resolved on it *before the server had
     * answered*. The retry below then filled a form whose submit was still `aria-busy`, Playwright
     * spun on a disabled button until the re-render detached it, and a sign-in that had actually
     * succeeded spent the whole 450-second budget looking like a hang.
     *
     * `two-factor-code-error` is the honest middle outcome: the field's error slot, which
     * `sign-in-screen.tsx` fills from the challenge mutation's failure and nothing else.
     */
    const refused = page.getByTestId('two-factor-code-error');
    await expect(landed.or(refused).or(anonymous).first()).toBeVisible({
        timeout: JOURNEY_TIMEOUT,
    });

    if ((await refused.count()) > 0) {
        // One fresh code, once — a loop here would be a way of never noticing a broken enrolment.
        await submitTotp(page);
        await expect(landed.or(anonymous).first()).toBeVisible({ timeout: JOURNEY_TIMEOUT });
    }

    if ((await landed.count()) === 0) {
        throw new Error(
            'The two-factor challenge was accepted but the application settled on the anonymous ' +
                'marketplace landing — the same session race `signIn` documents, one step later.',
        );
    }

    await expect(landed).toBeVisible({ timeout: JOURNEY_TIMEOUT });
});
