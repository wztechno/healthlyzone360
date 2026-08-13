import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    APP_URL,
    CORPORATE_BUYER,
    probeStack,
    selectAcmeContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

let stack: StackStatus;

test.beforeAll(async () => {
    stack = await probeStack();
});

test.beforeEach(async ({ context }) => {
    // Signing in is three chained round trips against the local Docker stack, and choosing an
    // organisation is three more; the project's 90 s default is a budget for one. `test.slow()`
    // triples it for the journeys that really do pay that cost, rather than raising the ceiling
    // for every test that reads a single endpoint.
    test.slow();
    skipUnlessStackIsUp(stack);
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is RTL from the first paint and no screen flashes left-to-right.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: APP_URL }]);
});

/**
 * The B2B workspace in Arabic.
 *
 * ## What a translated B2B screen has to get right that a consumer screen does not
 *
 * **The privacy statement has to read.** A negotiated catalogue is the one surface in this product
 * whose whole point is that its figures are private to one buyer; a sentence saying so that was
 * written once in English and never translated is worse than no sentence at all, because an Arabic
 * reader is then looking at prices with no idea who else can see them.
 *
 * **A refusal has to read.** The quotation builder's "this has no lines" error is derived copy the
 * interface assembles, which is exactly the kind of string that survives untranslated longest —
 * nobody opens a form only to submit it empty.
 *
 * The currency-code assertion this file used to carry is gone with the rest of the priced coverage;
 * see the header of `business.ltr.spec.ts` for why the seeded negotiated catalogue has no lines.
 */

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

test.describe('corporate workspace (ar, RTL)', () => {
    test('translates the dashboard rather than only mirroring it', async ({ page }) => {
        await openCorporate(page);

        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

        await expect(page.getByTestId('corporate-dashboard-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('corporate-programme-source')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('corporate-lookup-open')).toContainText(ARABIC_SCRIPT);
    });

    test('translates the negotiated catalogue, including its privacy statement', async ({
        page,
    }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-open-catalogue`).click();

        await expect(page.getByTestId('corporate-catalogue-screen')).toBeVisible();
        await expect(page.getByTestId('corporate-catalogue-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('corporate-catalogue-privacy')).toContainText(ARABIC_SCRIPT);
    });

    test('keeps the dashboard inside itself rather than scrolling the page sideways', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openCorporate(page);
        await expect(page.getByTestId('corporate-programme-list')).toBeVisible();

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });

    test('translates the quotation builder, including the refusal it can give', async ({
        page,
    }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-request-quotation`).click();

        await expect(page.getByTestId('quotation-builder-screen')).toBeVisible();
        await expect(page.getByTestId('quotation-builder-scope')).toContainText(ARABIC_SCRIPT);
        await page.getByTestId('quotation-builder-submit').click();
        await expect(page.getByTestId('quotation-builder-lines-error')).toContainText(
            ARABIC_SCRIPT,
        );
    });
});
