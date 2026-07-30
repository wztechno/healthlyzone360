import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.ts';

/**
 * The accessibility gate for the Virtual Dietitian: zero serious or critical axe violations on the
 * entry screen and on a representative set of the twelve states.
 *
 * The states chosen are the ones with genuinely different structure — a live region and a reply box,
 * a proposal with an accordion and a checkbox-gated action, a form with a segmented control and a
 * multi-select, a modal dialog, and the four blocked outcomes — because sweeping twelve variations
 * of the same markup would cost minutes and prove one thing.
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

async function openVirtualDietitian(page: Page) {
    await signIn(page);
    await expect(page.getByTestId('organisation-picker-screen')).toBeVisible();
    await page.goto('/customer/virtual-dietitian');
    await expect(page.getByTestId('virtual-dietitian-screen')).toBeVisible();
}

test.describe('virtual dietitian accessibility (axe)', () => {
    test('entry screen', async ({ page }) => {
        await openVirtualDietitian(page);
        await expect(page.getByTestId('vd-sessions-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'vd-entry');
    });

    const STATES: ReadonlyArray<readonly [state: string, marker: string]> = [
        ['initial_interview', 'vd-composer-send'],
        ['missing_information', 'vd-missing-weeklyBudget'],
        ['suggested_targets', 'vd-targets-explanation'],
        ['suggested_meal_structure', 'vd-structure-mode'],
        ['draft_generated', 'vd-draft-summary'],
        ['restriction_conflict', 'vd-conflict-allergies'],
        ['no_suitable_meals', 'vd-no-meals-widenOne'],
        ['safety_escalation', 'vd-safety-contact'],
    ];

    for (const [state, marker] of STATES) {
        test(state, async ({ page }) => {
            await openVirtualDietitian(page);
            await page.getByTestId(`vd-session-${state}`).click();
            await expect(page.getByTestId(marker)).toBeVisible();
            await expectNoSeriousViolations(page, `vd-${state}`);
        });
    }

    test('the override dialog, once open', async ({ page }) => {
        await openVirtualDietitian(page);
        await page.getByTestId('vd-session-suggested_targets').click();
        await expect(page.getByTestId('vd-targets-adjust')).toBeVisible();

        await page.getByTestId('vd-targets-adjust').click();
        await expect(page.getByTestId('vd-override-dialog-consequences')).toBeVisible();
        await expectNoSeriousViolations(page, 'vd-override-dialog');
    });
});
