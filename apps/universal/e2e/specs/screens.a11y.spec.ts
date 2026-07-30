import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

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
        await signIn(page);
        await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'organisation-picker');
    });

    test('workspace selector and devices', async ({ page }) => {
        await signIn(page);
        await selectCedarHamraContext(page);
        await expectNoSeriousViolations(page, 'workspace-selector');

        await page.goto('/devices');
        await expect(page.getByTestId('devices-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'devices');
    });

    test('forbidden page', async ({ page }) => {
        await signIn(page);
        await selectCedarHamraContext(page);
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
