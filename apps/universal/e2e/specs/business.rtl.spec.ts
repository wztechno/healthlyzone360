import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

const ARABIC_SCRIPT = /[؀-ۿ]/;

test.beforeEach(async ({ context }) => {
    // The pre-hydration script in `+html.tsx` reads this cookie before any styles apply, so the
    // document is RTL from the first paint and no screen flashes left-to-right.
    await context.addCookies([{ name: 'h360_locale', value: 'ar', url: 'http://localhost:4173' }]);
});

/**
 * The B2B workspaces in Arabic.
 *
 * ## Two things a translated B2B screen has to get right that a consumer screen does not
 *
 * **A price keeps its own currency code.** Arabic numerals and Arabic currency names are the
 * formatter's business, but the *code* on a negotiated line is contractual: a buyer reading
 * `SAR` in an Arabic interface is reading the same fact as a buyer reading `SAR` in English, and a
 * screen that localised it into a converted dirham figure would have changed the agreement. So the
 * assertion here is that the line is still riyals, in Arabic.
 *
 * **A tier table has to stay inside itself.** The volume-tier table is the widest thing either
 * workspace renders; a table that pushes the document sideways is the defect the responsive
 * research (`08-responsive-behaviour.md`, RSP-01) is explicit about, and it is easiest to introduce
 * when the direction flips.
 */

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
        await expect(page.getByTestId('corporate-catalogue-currencies')).toContainText(
            ARABIC_SCRIPT,
        );
    });

    test('keeps a negotiated line in its own currency in Arabic', async ({ page }) => {
        await openCorporate(page);

        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill(SAR_LINE_CODE);
        await page.getByTestId('corporate-lookup-open').click();

        await expect(page.getByTestId('catalogue-item-screen')).toBeVisible();
        // The currency code is contractual, not copy: it survives translation.
        await expect(page.getByTestId(`contract-price-headline-${SAR_LINE_CODE}`)).toContainText(
            /SAR|ر\.س/,
        );
        await expect(page.getByTestId('catalogue-item-tier-note')).toContainText(ARABIC_SCRIPT);
    });

    test('keeps the tier table inside itself rather than scrolling the page sideways', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await openCorporate(page);

        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill(SAR_LINE_CODE);
        await page.getByTestId('corporate-lookup-open').click();
        await expect(page.getByTestId('catalogue-item-tier-table')).toBeVisible();

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
        await expect(page.getByTestId('quotation-builder-draft-note')).toContainText(ARABIC_SCRIPT);

        await page.getByTestId('quotation-builder-submit').click();
        await expect(page.getByTestId('quotation-builder-lines-error')).toContainText(
            ARABIC_SCRIPT,
        );
    });
});

test.describe('partner workspace (ar, RTL)', () => {
    test('translates the commitments and keeps the price boundary', async ({ page }) => {
        await signIn(page);
        await selectCedarHamraContext(page);
        await page.goto('/partner');

        await expect(page.getByTestId('partner-commitments-screen')).toBeVisible();
        await expect(page.getByTestId('partner-commitments-title')).toContainText(ARABIC_SCRIPT);
        await expect(page.getByTestId('partner-price-privacy')).toContainText(ARABIC_SCRIPT);
        await expect(page.locator('[data-testid^="contract-price-"]')).toHaveCount(0);
    });

    test('collapses the schedule to a narrow viewport without a sideways document', async ({
        page,
    }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await signIn(page);
        await selectCedarHamraContext(page);
        await page.goto('/partner/schedule');

        await expect(page.getByTestId('partner-schedule-screen')).toBeVisible();
        await expect(page.getByTestId('partner-schedule-title')).toContainText(ARABIC_SCRIPT);

        const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
    });
});
