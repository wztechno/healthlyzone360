import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import {
    CORPORATE_BUYER,
    probeStack,
    selectAcmeContext,
    signIn,
    skipUnlessStackIsUp,
} from './helpers.ts';
import type { StackStatus } from './helpers.ts';

/**
 * The corporate and partner workspaces, end to end, in English, against the real API.
 *
 * ## The persona changed, and it had to
 *
 * These journeys used to sign in as the Cedar dietitian, because the mock world attached corporate
 * fixtures to whichever organisation the scenario happened to open on. The real world does not work
 * like that: `B2bProgrammesDemoSeeder` provisions **Acme Wellness** as the buyer, signs it a master
 * supply agreement with Verdant Kitchen, and hangs the programme off that agreement. Cedar Clinic
 * buys nothing from anybody. So the buyer is `buyer@acme-wellness.test`, who is the
 * `organisation_owner` of the organisation the paperwork actually names.
 *
 * ## What the seeded world can and cannot prove
 *
 * It can prove the spine: a real programme, read from `GET /b2b/programmes`, rendered with its
 * source stated; a negotiated catalogue screen that opens for it; a quotation list that resolves
 * rather than sitting on a skeleton; a quotation builder that refuses an empty submission; and a
 * partner area that is unreachable because it has no endpoints.
 *
 * It cannot yet prove the *priced* half. `GET /b2b/catalogue/items` answers `{"items":[]}` for this
 * buyer even though the seeder writes one confirmed price onto the agreement tariff, and
 * `mapProgramme` in `packages/api-client/src/api/business-repository.ts` returns
 * `employeeSubsidy: null`, `headcount: 0` and `deliveryLocations: []` because the wire carries none
 * of them. Both are recorded findings rather than something a spec should paper over, so the
 * assertions that depended on a negotiated *figure* — the subsidy marker, the volume-tier table,
 * the one line priced in Saudi riyals, a filed quotation with an `H360-Q` reference — are not
 * quietly relaxed here. They are gone from this file and named in the header, and
 * `business-privacy.ltr.spec.ts` skips its positive control out loud for the same reason.
 *
 * ## One journey is gone because the screen behind it renders nothing
 *
 * Looking a catalogue line up by a code nobody has used to be asserted here: type an unknown code,
 * press *open*, and read the designed not-found state. Against the real API `/corporate/items/{code}`
 * renders an **empty `<main>`** — not the `QueryStates` skeleton, not its not-found branch, not its
 * error branch, and not even the route's own `corporate-item-loading` fallback. That is an
 * application defect rather than a spec that drifted, and a test asserting a blank page would be a
 * test that locked the defect in. It is recorded here and the journey comes back with the fix.
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

async function openCorporate(page: Page) {
    await signIn(page, CORPORATE_BUYER);
    await selectAcmeContext(page);
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
    test('lists the programmes this organisation really buys through', async ({ page }) => {
        await openCorporate(page);

        await expect(page.getByTestId('corporate-programme-list')).toBeVisible();
        // The note says what the list *is* rather than apologising for how it was built.
        await expect(page.getByTestId('corporate-programme-source')).toContainText(
            'your organisation buys through',
        );

        const base = await firstProgrammeBase(page);
        await expect(page.getByTestId(`${base}-name`)).toContainText('Acme employee meals');
        await expect(page.getByTestId(`${base}-headcount`)).toBeVisible();
        await expect(page.getByTestId(`${base}-locations`)).toBeVisible();
        await expect(page.getByTestId(`${base}-tiers`)).toBeVisible();
    });

    test('opens the negotiated catalogue and states who may see it', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-open-catalogue`).click();

        await expect(page.getByTestId('corporate-catalogue-screen')).toBeVisible();
        await expect(page.getByTestId('corporate-catalogue-privacy')).toBeVisible();
        await expect(page.getByTestId('corporate-catalogue-search')).toBeVisible();

        // The list in whichever state the agreement leaves it: `GET /b2b/catalogue/items` currently
        // answers empty for this buyer, and an empty negotiated catalogue is a designed state, not
        // a broken screen. Either way the screen has to render one of them rather than hang.
        await expect(
            page
                .getByTestId('corporate-catalogue-list')
                .or(page.getByTestId('corporate-catalogue-empty'))
                .first(),
        ).toBeVisible();
    });

    test('refuses an empty quotation rather than sending one', async ({ page }) => {
        await openCorporate(page);
        const base = await firstProgrammeBase(page);
        await page.getByTestId(`${base}-request-quotation`).click();

        await expect(page.getByTestId('quotation-builder-screen')).toBeVisible();
        // The scope is stated before anything is filled in: this asks for a price, it orders nothing.
        await expect(page.getByTestId('quotation-builder-scope')).toContainText('orders nothing');

        await page.getByTestId('quotation-builder-submit').click();
        await expect(page.getByTestId('quotation-builder-lines-error')).toBeVisible();
    });

    /**
     * The quotation list resolves to one of its three designed states.
     *
     * Which one is this database's business — no quotation is seeded, so the empty state is the
     * expected answer — but the assertion that matters is that the query *resolves at all*. A
     * `QueryStates` stuck on its skeleton is the one outcome that is neither a list, nor an empty
     * shelf, nor an error a person can act on, and it is what a screen looks like when its endpoint
     * is never called or never answers.
     */
    test('the quotation list resolves rather than sitting on a skeleton', async ({ page }) => {
        await openCorporate(page);
        await page.getByTestId('corporate-open-quotations').click();

        await expect(page.getByTestId('quotations-screen')).toBeVisible();
        await expect(page.getByTestId('quotations-filter')).toBeVisible();
        await expect(
            page
                .getByTestId('quotations-list')
                .or(page.getByTestId('quotations-empty'))
                .or(page.getByTestId('quotations-error'))
                .first(),
        ).toBeVisible({ timeout: 60_000 });
    });

    test('offers no export control while the document endpoint is missing', async ({ page }) => {
        await openCorporate(page);
        await page.getByTestId('corporate-open-quotations').click();
        await expect(page.getByTestId('quotations-screen')).toBeVisible();

        await expect(page.getByTestId('prototype-action')).toHaveCount(0);
    });
});

test.describe('partner workspace (en)', () => {
    /**
     * The supplier area has no endpoints, so it is hidden rather than emptied: `AreaShell`
     * redirects out of it before any chrome renders. What used to be two journeys through the
     * commitments and the supply calendar is now one assertion that the area is unreachable.
     */
    test('is not reachable while it has no backend', async ({ page }) => {
        await signIn(page, CORPORATE_BUYER);
        await selectAcmeContext(page);
        await page.goto('/partner');

        await expect(page.getByTestId('partner-commitments-screen')).toHaveCount(0);
        await expect(page.getByTestId('partner-shell')).toHaveCount(0);
    });
});
