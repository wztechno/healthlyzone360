import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

/**
 * The accessibility gate for the B2B workspaces: zero serious or critical axe violations.
 *
 * Same threshold as the marketplace, catalogue, planner and commerce sweeps — moderate findings go
 * to the risk register rather than blocking here.
 *
 * Two surfaces are swept in an interactive state rather than only as they land, because that is
 * where the failures are: the quotation builder *after* it has been refused, since an error
 * associated with the wrong field is invisible until it exists; and the tier table at phone width,
 * where `Table` switches from an ARIA table to stacked cards and the labelled-field relationship has
 * to survive the switch.
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

const SAR_LINE_CODE = 'catalogue-wholesale-prepared-pallet';

async function openCorporate(page: Page) {
    await signIn(page);
    await selectCedarHamraContext(page);
    await page.goto('/corporate');
    await expect(page.getByTestId('corporate-dashboard-screen')).toBeVisible();
}

async function firstProgrammeBase(page: Page): Promise<string> {
    const control = page
        .locator('[data-testid^="corporate-programme-"][data-testid$="-open-catalogue"]')
        .first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The programme card carries no test id.');
    return testId.slice(0, testId.length - '-open-catalogue'.length);
}

test.describe('B2B accessibility (axe)', () => {
    test('the corporate dashboard', async ({ page }) => {
        await openCorporate(page);
        await expect(page.getByTestId('corporate-programme-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'corporate-dashboard');
    });

    test('the negotiated catalogue, with its filters', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-open-catalogue`).click();

        await expect(page.getByTestId('corporate-catalogue-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'corporate-catalogue');
    });

    test('a catalogue line and its volume-tier table', async ({ page }) => {
        await openCorporate(page);
        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill(SAR_LINE_CODE);
        await page.getByTestId('corporate-lookup-open').click();

        await expect(page.getByTestId('catalogue-item-tier-table')).toBeVisible();
        await expectNoSeriousViolations(page, 'catalogue-item');
    });

    test('the same tier table on a phone, where it becomes stacked cards', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openCorporate(page);
        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill(SAR_LINE_CODE);
        await page.getByTestId('corporate-lookup-open').click();

        await expect(page.getByTestId('catalogue-item-tier-table')).toBeVisible();
        await expectNoSeriousViolations(page, 'catalogue-item-narrow');
    });

    test('the quotation builder, and the builder after a refusal', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-request-quotation`).click();

        await expect(page.getByTestId('quotation-builder-lines')).toBeVisible();
        await expectNoSeriousViolations(page, 'quotation-builder');

        await page.getByTestId('quotation-builder-submit').click();
        await expect(page.getByTestId('quotation-builder-lines-error')).toBeVisible();
        await expectNoSeriousViolations(page, 'quotation-builder-refused');
    });

    test('the quotation list', async ({ page }) => {
        await openCorporate(page);
        await page.getByTestId('corporate-open-quotations').click();

        await expect(page.getByTestId('quotations-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'quotations');
    });

    test('the designed not-found states, which are screens in their own right', async ({
        page,
    }) => {
        await openCorporate(page);

        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill('catalogue-nothing-like-this');
        await page.getByTestId('corporate-lookup-open').click();
        await expect(page.getByTestId('catalogue-item-detail-error')).toBeVisible();
        await expectNoSeriousViolations(page, 'catalogue-item-not-found');
    });
});
