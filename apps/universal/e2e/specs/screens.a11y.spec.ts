import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
    CEDAR_DIETITIAN,
    openOrganisationPicker,
    probeStack,
    selectCedarContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The accessibility gate: zero serious or critical axe violations on every functional screen
 * (plan gate; moderate findings are reported in the risk register, not blocked on here).
 */
async function expectNoSeriousViolations(page: Page, screen: string) {
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(
        blocking,
        `${screen}: ${blocking.map((v) => `${v.id} (${v.impact}): ${v.help}`).join('; ')}`,
    ).toEqual([]);
}

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

test.describe('accessibility smoke (axe)', () => {
    test('sign-in', async ({ page }) => {
        await page.goto('/sign-in');
        await expect(page.getByTestId('sign-in-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'sign-in');
    });

    test('register', async ({ page }) => {
        await page.goto('/register');
        await expect(page.getByTestId('register-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'register');
    });

    test('forgot password', async ({ page }) => {
        await page.goto('/forgot-password');
        await expect(page.getByTestId('forgot-password-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'forgot-password');
    });

    test('organisation picker', async ({ page }) => {
        await signIn(page, CEDAR_DIETITIAN);
        // Navigated to rather than assumed: the API remembers the last workspace on the profile, so
        // a second run would otherwise be routed straight past the screen under test.
        await openOrganisationPicker(page);
        await expectNoSeriousViolations(page, 'organisation-picker');
    });

    test('workspace selector and devices', async ({ page }) => {
        await signIn(page, CEDAR_DIETITIAN);
        await selectCedarContext(page);
        await expectNoSeriousViolations(page, 'workspace-selector');

        await page.goto('/devices');
        await expect(page.getByTestId('devices-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'devices');
    });

    test('forbidden page', async ({ page }) => {
        await signIn(page, CEDAR_DIETITIAN);
        await selectCedarContext(page);
        await page.goto('/platform-admin');
        await expect(page.locator('[data-testid$="forbidden"]').first()).toBeVisible();
        await expectNoSeriousViolations(page, 'forbidden');
    });

    test('design-system showcase', async ({ page }) => {
        await page.goto('/showcase');
        await expect(page.getByTestId('showcase-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'showcase');
    });
});
