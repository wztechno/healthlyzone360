import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { selectCedarHamraContext, signIn } from './helpers.ts';

/**
 * The corporate and partner workspaces, end to end, in English.
 *
 * ## What this journey is really checking
 *
 * A B2B prototype earns its keep by being honest about two things at once: it must show a buyer the
 * rates they have actually negotiated, and it must never show those rates to anybody else. So this
 * journey is the *positive* half of that pair — it proves the `contract-price-` markers really are
 * rendered here, which is what makes their absence everywhere else (`business-privacy.ltr.spec.ts`)
 * mean something. A sweep that only asserts an absence passes just as happily when the feature was
 * never built.
 *
 * The second thing it checks is that a quotation request is a real submission. `requestQuotation` is
 * on the contract and the prototype store honours it, so pressing send files a quotation with an
 * `H360-Q` reference and the list shows it. The controls that genuinely do not exist — accepting a
 * quote, exporting it, saving a draft, setting up a standing order — answer with the prototype
 * notice instead, and that distinction is asserted rather than assumed.
 *
 * ## Signing in
 *
 * `corporate` and `partner` are staff areas: they need an authenticated, verified person *and* a
 * server-confirmed organisation context, so the journey goes through the organisation and branch
 * pickers before it can reach either.
 */

/** The one catalogue line priced in SAR. A readable code, exactly as a purchase order would quote. */
const SAR_LINE_CODE = 'catalogue-wholesale-prepared-pallet';

async function openCorporate(page: Page) {
    await signIn(page);
    await selectCedarHamraContext(page);
    await page.goto('/corporate');
    await expect(page.getByTestId('corporate-dashboard-screen')).toBeVisible();
}

/** The `corporate-programme-{id}` prefix of the first programme card. */
async function firstProgrammeBase(page: Page): Promise<string> {
    const control = page
        .locator('[data-testid^="corporate-programme-"][data-testid$="-open-catalogue"]')
        .first();
    await expect(control).toBeVisible();
    const testId = await control.getAttribute('data-testid');
    if (testId === null) throw new Error('The programme card carries no test id.');
    return testId.slice(0, testId.length - '-open-catalogue'.length);
}

test.describe('corporate workspace (en)', () => {
    test('shows the programmes, their headcount and their negotiated subsidy', async ({ page }) => {
        await openCorporate(page);

        await expect(page.getByTestId('corporate-programme-list')).toBeVisible();
        // The derivation is a contract gap, and the screen says so rather than hiding it.
        await expect(page.getByTestId('corporate-programme-source')).toContainText(
            'Prototype limitation',
        );

        const base = await firstProgrammeBase(page);
        await expect(page.getByTestId(`${base}-name`)).toBeVisible();
        await expect(page.getByTestId(`${base}-headcount`)).toBeVisible();
        await expect(page.getByTestId(`${base}-locations`)).toBeVisible();
        await expect(page.getByTestId(`${base}-tiers`)).toBeVisible();

        // A per-person subsidy is a negotiated figure, so it carries the marker.
        await expect(
            page.locator('[data-testid^="contract-price-subsidy-"]').first(),
        ).toBeVisible();
    });

    test('opens a negotiated catalogue and shows the terms behind every line', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-open-catalogue`).click();

        await expect(page.getByTestId('corporate-catalogue-screen')).toBeVisible();
        await expect(page.getByTestId('corporate-catalogue-privacy')).toBeVisible();
        await expect(page.getByTestId('corporate-catalogue-currencies')).toBeVisible();

        const price = page.locator('[data-testid^="contract-price-catalogue-"]').first();
        await expect(price).toBeVisible();
        await expect(price).toContainText('USD');

        const line = page.locator('[data-testid^="catalogue-item-"][data-testid$="-minimum"]');
        await expect(line.first()).toBeVisible();
        await expect(
            page.locator('[data-testid^="catalogue-item-"][data-testid$="-lead-time"]').first(),
        ).toBeVisible();
        await expect(
            page.locator('[data-testid^="catalogue-item-"][data-testid$="-weekdays"]').first(),
        ).toBeVisible();
    });

    test('finds a line by the code on a purchase order, in its own currency', async ({ page }) => {
        await openCorporate(page);

        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill(SAR_LINE_CODE);
        await page.getByTestId('corporate-lookup-open').click();

        await expect(page.getByTestId('catalogue-item-screen')).toBeVisible();
        await expect(page.getByTestId('catalogue-item-name')).toBeVisible();

        // The deliberately non-AED line: shown in riyals, never converted into dirhams.
        await expect(page.getByTestId(`contract-price-headline-${SAR_LINE_CODE}`)).toContainText(
            'SAR',
        );

        await expect(page.getByTestId('catalogue-item-tier-table')).toBeVisible();
        await expect(page.locator('[data-testid^="contract-price-tier-"]').first()).toBeVisible();
        await expect(page.getByTestId('catalogue-item-tier-note')).toBeVisible();
        await expect(page.getByTestId('catalogue-item-eligibility')).toBeVisible();
    });

    test('answers a catalogue line code nobody has, without a failure', async ({ page }) => {
        await openCorporate(page);

        await page
            .getByTestId('corporate-lookup-code')
            .locator('input')
            .first()
            .fill('catalogue-nothing-like-this');
        await page.getByTestId('corporate-lookup-open').click();

        await expect(page.getByTestId('catalogue-item-detail-error')).toBeVisible();
    });

    test('composes a quotation and really files it', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-open-catalogue`).click();
        await expect(page.getByTestId('corporate-catalogue-screen')).toBeVisible();

        await page
            .locator('[data-testid^="catalogue-item-"][data-testid$="-quote"]')
            .first()
            .click();
        await expect(page.getByTestId('quotation-builder-screen')).toBeVisible();

        // The scope is stated before anything is filled in: this asks for a price, it orders nothing.
        await expect(page.getByTestId('quotation-builder-scope')).toContainText('orders nothing');

        // The line arrived seeded at its minimum order, so it already has an indicative value.
        await expect(page.locator('[data-testid^="contract-price-line-"]').first()).toBeVisible();
        await expect(
            page.locator('[data-testid^="contract-price-draft-total-"]').first(),
        ).toBeVisible();
        await expect(page.getByTestId('quotation-builder-value-note')).toBeVisible();

        await page
            .getByTestId('quotation-builder-contact-name')
            .locator('input')
            .first()
            .fill('Dana Fakhoury');
        await page
            .getByTestId('quotation-builder-contact-email')
            .locator('input')
            .first()
            .fill('dana.fakhoury@cedarclinic.example');
        await page
            .getByTestId('quotation-builder-note')
            .locator('textarea, input')
            .first()
            .fill('Reception delivery before 11:30 please.');

        await page.getByTestId('quotation-builder-submit').click();

        await expect(page.getByTestId('quotation-builder-success')).toContainText('H360-Q');
        await expect(page.getByTestId('quotation-builder-success-note')).toContainText(
            'No price has been agreed',
        );

        await page.getByTestId('quotation-builder-open-list').click();
        await expect(page.getByTestId('quotations-screen')).toBeVisible();
        await expect(page.locator('[data-testid^="quotation-H360-Q-"]').first()).toBeVisible();
    });

    test('refuses an empty quotation rather than sending one', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-request-quotation`).click();

        await expect(page.getByTestId('quotation-builder-screen')).toBeVisible();
        await page.getByTestId('quotation-builder-submit').click();
        await expect(page.getByTestId('quotation-builder-lines-error')).toBeVisible();
    });

    test('distinguishes a request awaiting a price from one already priced', async ({ page }) => {
        await openCorporate(page);
        await page.getByTestId('corporate-open-quotations').click();

        await expect(page.getByTestId('quotations-screen')).toBeVisible();
        await expect(page.getByTestId('quotations-list')).toBeVisible();

        // A submitted request carries no price at all: pricing is the account manager's act.
        await expect(page.locator('[data-testid$="-unpriced"]').first()).toContainText(
            'Awaiting a price',
        );
        // A quoted one does, and it is marked.
        await expect(
            page.locator('[data-testid^="contract-price-quoted-total-"]').first(),
        ).toBeVisible();
    });

    test('answers accepting and exporting a quotation honestly rather than with a dead control', async ({
        page,
    }) => {
        await openCorporate(page);
        await page.getByTestId('corporate-open-quotations').click();
        await expect(page.getByTestId('quotations-list')).toBeVisible();

        await page.getByTestId('prototype-action').first().click();
        await expect(page.getByTestId('prototype-notice')).toBeVisible();
    });
});

test.describe('partner workspace (en)', () => {
    test('shows what has to be made, and never the buyer negotiated rate', async ({ page }) => {
        await signIn(page);
        await selectCedarHamraContext(page);
        await page.goto('/partner');

        await expect(page.getByTestId('partner-commitments-screen')).toBeVisible();
        await expect(page.getByTestId('partner-price-privacy')).toContainText(
            'No buyer prices are shown here',
        );
        await expect(page.getByTestId('partner-commitment-list')).toBeVisible();

        await expect(
            page.locator('[data-testid^="partner-commitment-"][data-testid$="-quantity"]').first(),
        ).toBeVisible();
        await expect(
            page.locator('[data-testid^="partner-commitment-"][data-testid$="-lead-time"]').first(),
        ).toBeVisible();

        // The supplier side is inside the price-privacy boundary too.
        await expect(page.locator('[data-testid^="contract-price-"]')).toHaveCount(0);
    });

    test('projects the commitments onto a supply calendar', async ({ page }) => {
        await signIn(page);
        await selectCedarHamraContext(page);
        await page.goto('/partner');
        await expect(page.getByTestId('partner-commitments-screen')).toBeVisible();

        await page.getByTestId('partner-open-schedule').click();
        await expect(page.getByTestId('partner-schedule-screen')).toBeVisible();
        await expect(page.getByTestId('partner-schedule-derivation')).toContainText('lead time');
        await expect(page.getByTestId('partner-schedule-days')).toBeVisible();
        await expect(page.locator('[data-testid^="partner-schedule-day-"]').first()).toBeVisible();
        await expect(page.locator('[data-testid^="contract-price-"]')).toHaveCount(0);
    });
});
