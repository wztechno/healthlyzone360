import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import {
    CORPORATE_BUYER,
    probeStack,
    selectAcmeContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The accessibility gate for the B2B workspace: zero serious or critical axe violations.
 *
 * Same threshold as the marketplace, catalogue and commerce sweeps — moderate findings go to the
 * risk register rather than blocking here.
 *
 * One surface is swept in an interactive state rather than only as it lands: the quotation builder
 * *after* it has been refused, since an error associated with the wrong field is invisible until it
 * exists. The volume-tier table sweeps this file used to carry are gone with the rest of the priced
 * coverage; see the header of `business.ltr.spec.ts` — which also records why the not-found sweep
 * this file used to carry is gone: `/corporate/items/{unknown-code}` renders an empty `<main>`
 * against the real API, and there is no state there to sweep.
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

async function openCorporate(page: Page) {
    await signIn(page, CORPORATE_BUYER);
    await selectAcmeContext(page);
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

    test('the same dashboard on a phone, where the cards stack', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openCorporate(page);
        await expect(page.getByTestId('corporate-programme-list')).toBeVisible();
        await expectNoSeriousViolations(page, 'corporate-dashboard-narrow');
    });

    test('the negotiated catalogue, with its filters', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-open-catalogue`).click();

        await expect(page.getByTestId('corporate-catalogue-screen')).toBeVisible();
        await expect(page.getByTestId('corporate-catalogue-search')).toBeVisible();
        await expectNoSeriousViolations(page, 'corporate-catalogue');
    });

    test('the quotation builder, and the builder after a refusal', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-request-quotation`).click();

        await expect(page.getByTestId('quotation-builder-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'quotation-builder');

        await page.getByTestId('quotation-builder-submit').click();
        await expect(page.getByTestId('quotation-builder-lines-error')).toBeVisible();
        await expectNoSeriousViolations(page, 'quotation-builder-refused');
    });

    test('the quotation list', async ({ page }) => {
        await openCorporate(page);
        await page.getByTestId('corporate-open-quotations').click();

        await expect(page.getByTestId('quotations-screen')).toBeVisible();
        await expectNoSeriousViolations(page, 'quotations');
    });

});
