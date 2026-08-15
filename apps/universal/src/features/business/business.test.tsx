import { ApiError, apiFailure } from '@healthy360/api-client';
import type { MeResponse } from '@healthy360/api-client';
import type {
    CatalogueFilter,
    CatalogueItem,
    CorporateProgramme,
    Kitchen,
    Quotation,
    QuotationFilter,
    QuotationState,
    RequestQuotationRequest,
    VolumeTier,
} from '@healthy360/api-client/contracts';
import {
    CorporateProgrammeId,
    KitchenId,
    QuotationId,
    VolumeTierId,
} from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
    ORGANISATION_OWNER_PERMISSIONS,
    TEST_ORGANISATION_ID,
    testActiveContext,
    testMeResponse,
    testMembership,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { validateDraft } from './draft.ts';
import type { DraftContact } from './draft.ts';
import {
    CONTRACT_PRICE_TEST_ID_PREFIX,
    contractPriceTestId,
    earliestSupplyDate,
    isMixedCurrency,
    lineValue,
    supplyDates,
    tierForQuantity,
    totalsByCurrency,
} from './format.ts';
import { CatalogueItemScreen } from './screens/catalogue-item-screen.tsx';
import { CorporateCatalogueScreen } from './screens/corporate-catalogue-screen.tsx';
import { CorporateDashboardScreen } from './screens/corporate-dashboard-screen.tsx';
import { PartnerCommitmentsScreen } from './screens/partner-commitments-screen.tsx';
import { PartnerScheduleScreen } from './screens/partner-schedule-screen.tsx';
import { QuotationBuilderScreen } from './screens/quotation-builder-screen.tsx';
import { QuotationsScreen } from './screens/quotations-screen.tsx';

/**
 * The B2B surfaces, against a world this file authors.
 *
 * Nothing here stubs a hook: the screens run through the real hooks and the real query client, over
 * stub repositories whose every answer is declared below. Anything a screen reaches for that this
 * file did not declare rejects with `StubNotConfiguredError` naming the surface, so a hole in the
 * test fails on first render rather than rendering an empty state over it.
 *
 * Four things this file exists to prove, and the authored data each one needs:
 *
 * 1. **A quotation submission genuinely mutates the world.** `requestQuotation` is on the contract,
 *    and {@link businessWorld} honours it against a mutable list the listing reads back — so the
 *    builder is a real form with a real result, and the count really does go up by one. A prototype
 *    notice in its place would have been a claim about the interface that is not true.
 * 2. **Money is never summed across currencies.** One authored line is priced in SAR and the other
 *    in USD; the totals helper groups before it adds, so a mixed list produces two totals rather
 *    than one wrong one.
 * 3. **Accepting a quotation is real too.** `acceptQuotation` moves the record in the same mutable
 *    list, the mutation invalidates the `business` root, and the refetched list no longer offers the
 *    control — which is the state machine, not an optimistic redraw.
 * 4. **The `contract-price-` marker has exactly one owner.** The partner screens render commitments
 *    derived from the same quotations and carry no marker at all, which is what makes the Playwright
 *    privacy sweep a meaningful assertion rather than a list of exceptions.
 */

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        setParams: jest.fn(),
        back: jest.fn(),
    }),
    usePathname: () => '/corporate',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: ReactNode }) => children,
    Slot: () => null,
    Stack: () => null,
}));

/* ══ the authored world ════════════════════════════════════════════════════════════════════════ */

/**
 * The B2B screens gate on nothing beyond "somebody is signed in" — the `partner` and `corporate`
 * areas are guarded by `AreaShell`, which is not what this file renders. So the session is a plain
 * organisation member, and the permission set is named rather than invented so it stays honest if a
 * screen ever does start reading one.
 */
function buyerSession(): MeResponse {
    return testMeResponse({
        memberships: [testMembership()],
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    });
}

function usd(amount: number): Money {
    return { amount, currency: 'USD' };
}

function sar(amount: number): Money {
    return { amount, currency: 'SAR' };
}

/**
 * Programme identifiers must be real UUIDs: both the catalogue and the builder run the route
 * parameter through `CorporateProgrammeId.safeParse`, and the "malformed address" cases below depend
 * on that being a genuine parse rather than a string comparison.
 */
const STAFF_PROGRAMME_ID = CorporateProgrammeId.unsafe('01920001-0000-7000-8000-000000000001');
const WHOLESALE_PROGRAMME_ID = CorporateProgrammeId.unsafe('01920001-0000-7000-8000-000000000002');

const VERDANT_KITCHEN_ID = KitchenId.unsafe('01920003-0000-7000-8000-000000000001');
const NORTHWIND_KITCHEN_ID = KitchenId.unsafe('01920003-0000-7000-8000-000000000002');

function volumeTier(
    ordinal: number,
    minimumQuantity: number,
    maximumQuantity: number | null,
    unitPrice: Money,
    leadTimeDays: number,
): VolumeTier {
    return {
        id: VolumeTierId.unsafe(`01920004-0000-7000-8000-${String(ordinal).padStart(12, '0')}`),
        minimumQuantity,
        maximumQuantity,
        unitPrice,
        leadTimeDays,
    };
}

/** A line in the default currency, with a three-rung ladder and a weekday-only delivery pattern. */
const STAFF_LUNCH_BOX: CatalogueItem = {
    id: 'catalogue-staff-lunch-box',
    programmeId: STAFF_PROGRAMME_ID,
    kind: 'meal',
    name: 'Staff lunch box — herb chicken',
    description: 'A negotiated staff rate, delivered to reception before noon.',
    kitchenId: VERDANT_KITCHEN_ID,
    mealId: null,
    planId: null,
    minimumOrderQuantity: 40,
    volumeTiers: [
        volumeTier(1, 40, 99, usd(2600), 2),
        volumeTier(2, 100, 249, usd(2400), 3),
        volumeTier(3, 250, null, usd(2200), 4),
    ],
    contractPrice: usd(2600),
    leadTimeDays: 2,
    deliveryWeekdays: [1, 2, 3, 4, 5],
    channels: ['b2b', 'corporate', 'delivery'],
    supportsRecurringOrder: true,
    imagePlaceholderId: 'catalogue-staff-lunch-box',
};

/** The deliberately off-default line: priced in SAR, so nothing may total it beside the USD one. */
const WHOLESALE_PALLET: CatalogueItem = {
    id: 'catalogue-wholesale-prepared-pallet',
    programmeId: WHOLESALE_PROGRAMME_ID,
    kind: 'bulk_package',
    name: 'Wholesale prepared-meal pallet (SAR)',
    description: 'A cross-border wholesale line delivered to a depot rather than a site.',
    kitchenId: NORTHWIND_KITCHEN_ID,
    mealId: null,
    planId: null,
    minimumOrderQuantity: 200,
    volumeTiers: [volumeTier(4, 200, 499, sar(1150), 10), volumeTier(5, 500, null, sar(1050), 14)],
    contractPrice: sar(1150),
    leadTimeDays: 10,
    deliveryWeekdays: [2, 4],
    channels: ['b2b', 'delivery'],
    supportsRecurringOrder: false,
    imagePlaceholderId: 'catalogue-wholesale-prepared-pallet',
};

const STAFF_PROGRAMME: CorporateProgramme = {
    id: STAFF_PROGRAMME_ID,
    organisationId: TEST_ORGANISATION_ID,
    name: 'Cedar Clinic staff meal package',
    summary: 'A subsidised lunch for clinical and reception staff, five days a week.',
    kitchenIds: [VERDANT_KITCHEN_ID],
    deliveryLocations: ['Hamra clinic', 'Jounieh clinic'],
    headcount: 84,
    employeeSubsidy: usd(1200),
    startsAt: '2026-04-01',
    endsAt: '2027-03-31',
    accountManagerName: 'Dana Fakhoury',
    isActive: true,
};

const WHOLESALE_PROGRAMME: CorporateProgramme = {
    id: WHOLESALE_PROGRAMME_ID,
    organisationId: TEST_ORGANISATION_ID,
    name: 'Harbour Facilities wholesale offer',
    summary: 'Wholesale prepared meals for staff canteens, delivered by the pallet.',
    kitchenIds: [NORTHWIND_KITCHEN_ID],
    deliveryLocations: ['Dubai Industrial City depot', 'Sharjah depot'],
    headcount: 1200,
    employeeSubsidy: null,
    startsAt: '2026-02-01',
    endsAt: null,
    accountManagerName: null,
    isActive: false,
};

/** Still with the account manager: every line unpriced, which is what the list has to say. */
const SUBMITTED_QUOTATION: Quotation = {
    id: QuotationId.unsafe('01920002-0000-7000-8000-000000000001'),
    programmeId: STAFF_PROGRAMME_ID,
    state: 'submitted',
    reference: 'H360-Q-2026-0041',
    lines: [
        {
            catalogueItemId: STAFF_LUNCH_BOX.id,
            name: STAFF_LUNCH_BOX.name,
            quantity: 120,
            quotedUnitPrice: null,
            quotedTotal: null,
        },
    ],
    requestedTotal: null,
    requestedDeliveryDate: null,
    recurring: true,
    note: 'Weekly, Monday to Thursday. Reception delivery before 11:30 please.',
    requestedAt: '2026-07-28T07:20:00.000Z',
    respondedAt: null,
    expiresAt: null,
};

/** Priced, so it carries a total and offers accept/decline. */
const QUOTED_QUOTATION: Quotation = {
    id: QuotationId.unsafe('01920002-0000-7000-8000-000000000002'),
    programmeId: WHOLESALE_PROGRAMME_ID,
    state: 'quoted',
    reference: 'H360-Q-2026-0039',
    lines: [
        {
            catalogueItemId: WHOLESALE_PALLET.id,
            name: WHOLESALE_PALLET.name,
            quantity: 500,
            quotedUnitPrice: sar(1050),
            quotedTotal: sar(1050 * 500),
        },
    ],
    requestedTotal: sar(1050 * 500),
    requestedDeliveryDate: null,
    recurring: false,
    note: 'Trial pallet run, four weeks.',
    requestedAt: '2026-07-21T06:05:00.000Z',
    respondedAt: '2026-07-23T12:40:00.000Z',
    expiresAt: '2026-08-20T23:59:59.000Z',
};

function kitchen(id: KitchenId, name: string, slug: string): Kitchen {
    return {
        id,
        name,
        slug,
        tagline: `${name} tagline`,
        description: `${name} description`,
        countryCode: 'AE',
        cuisines: [],
        dietClassifications: [],
        channels: {
            b2c: true,
            b2b: true,
            marketplace: true,
            pos: false,
            subscription: false,
            delivery: true,
            pickup: false,
            corporate: true,
        },
        branches: [],
        deliveryWindows: [],
        rating: null,
        ratingCount: 0,
        imagePlaceholderId: `kitchen-${slug}`,
        isVerified: true,
    };
}

const KITCHENS: readonly Kitchen[] = [
    kitchen(VERDANT_KITCHEN_ID, 'Verdant Kitchen', 'verdant-kitchen'),
    kitchen(NORTHWIND_KITCHEN_ID, 'Northwind Kitchen', 'northwind-kitchen'),
];

interface BusinessWorld {
    /**
     * The quotation store, mutable on purpose: `requestQuotation` and `acceptQuotation` write to it
     * and `listQuotations` reads it back, so a test can assert that a submission or a decision
     * really changed the world rather than that a screen redrew optimistically.
     */
    readonly quotations: Quotation[];
    readonly overrides: RepositoryOverrides;
}

interface WorldSeed {
    readonly programmes: readonly CorporateProgramme[];
    readonly catalogue: readonly CatalogueItem[];
    readonly quotations: readonly Quotation[];
}

/**
 * One programme-and-quotation world, fresh per test.
 *
 * The two listing overrides honour their filters rather than answering everything, because three
 * cases below turn on exactly that: the catalogue's kind filter, the quotation list's state filter,
 * and the dashboard reading one catalogue per programme card.
 */
function businessWorld(seed: Partial<WorldSeed> = {}): BusinessWorld {
    const programmes = seed.programmes ?? [STAFF_PROGRAMME, WHOLESALE_PROGRAMME];
    const catalogue = seed.catalogue ?? [STAFF_LUNCH_BOX, WHOLESALE_PALLET];
    const quotations: Quotation[] = [
        ...(seed.quotations ?? [SUBMITTED_QUOTATION, QUOTED_QUOTATION]),
    ];
    let nextReference = 50;

    const move = (quotationId: QuotationId, state: QuotationState): Quotation => {
        const index = quotations.findIndex((candidate) => candidate.id === quotationId);
        const current = quotations[index];
        if (current === undefined) throw new ApiError(apiFailure('resource.not_found'));
        const next: Quotation = { ...current, state, respondedAt: '2026-08-01T09:00:00.000Z' };
        quotations[index] = next;
        return next;
    };

    const overrides: RepositoryOverrides = {
        business: {
            listCorporateProgrammes: async () => programmes,
            getCorporateProgramme: async (programmeId) => {
                const found = programmes.find((programme) => programme.id === programmeId);
                if (found === undefined) throw new ApiError(apiFailure('resource.not_found'));
                return found;
            },
            listCatalogue: async (filter: CatalogueFilter) =>
                page(
                    catalogue.filter((item) => {
                        if (item.programmeId !== filter.programmeId) return false;
                        if (filter.kinds !== undefined && !filter.kinds.includes(item.kind)) {
                            return false;
                        }
                        if (
                            filter.query !== undefined &&
                            !item.name.toLowerCase().includes(filter.query.toLowerCase())
                        ) {
                            return false;
                        }
                        return true;
                    }),
                ),
            getCatalogueItem: async (itemId) => {
                const found = catalogue.find((item) => item.id === itemId);
                if (found === undefined) throw new ApiError(apiFailure('resource.not_found'));
                return found;
            },
            listQuotations: async (filter?: QuotationFilter) =>
                page(
                    quotations.filter((quotation) => {
                        if (
                            filter?.programmeId !== undefined &&
                            quotation.programmeId !== filter.programmeId
                        ) {
                            return false;
                        }
                        const states = filter?.states ?? [];
                        return states.length === 0 || states.includes(quotation.state);
                    }),
                ),
            requestQuotation: async (request: RequestQuotationRequest) => {
                nextReference += 1;
                const filed: Quotation = {
                    id: QuotationId.unsafe(
                        `01920002-0000-7000-8000-${String(nextReference).padStart(12, '0')}`,
                    ),
                    programmeId: request.programmeId,
                    // A filed request carries no price at all: pricing is the account manager's act.
                    state: 'submitted',
                    reference: `H360-Q-2026-00${String(nextReference)}`,
                    lines: request.lines.map((line) => ({
                        catalogueItemId: line.catalogueItemId,
                        name:
                            catalogue.find((item) => item.id === line.catalogueItemId)?.name ??
                            line.catalogueItemId,
                        quantity: line.quantity,
                        quotedUnitPrice: null,
                        quotedTotal: null,
                    })),
                    requestedTotal: null,
                    requestedDeliveryDate: request.requestedDeliveryDate ?? null,
                    recurring: request.recurring ?? false,
                    note: request.note ?? null,
                    requestedAt: '2026-08-01T09:00:00.000Z',
                    respondedAt: null,
                    expiresAt: null,
                };
                quotations.push(filed);
                return filed;
            },
            acceptQuotation: async (quotationId) => move(quotationId, 'accepted'),
            declineQuotation: async (quotationId) => move(quotationId, 'declined'),
        },
        marketplace: { listKitchens: async () => page(KITCHENS) },
    };

    return { quotations, overrides };
}

/* ══ pure: money, tiers and the supply calendar ════════════════════════════════════════════════ */

describe('contract-price marker', () => {
    it('is built from one prefix, so a rename cannot leave half the markers behind', () => {
        expect(contractPriceTestId('anything')).toBe(`${CONTRACT_PRICE_TEST_ID_PREFIX}anything`);
        expect(CONTRACT_PRICE_TEST_ID_PREFIX).toBe('contract-price-');
    });
});

describe('money across currencies', () => {
    it('totals each currency separately rather than producing one wrong number', () => {
        const totals = totalsByCurrency([usd(1000), sar(500), usd(2500)]);

        expect(totals).toEqual([usd(3500), sar(500)]);
        expect(isMixedCurrency([usd(1000), sar(500)])).toBe(true);
        expect(isMixedCurrency([usd(1000), usd(500)])).toBe(false);
    });

    it('answers an empty list with no totals rather than a zero in some arbitrary currency', () => {
        expect(totalsByCurrency([])).toEqual([]);
        expect(isMixedCurrency([])).toBe(false);
    });

    it('keeps the off-default line in its own currency', () => {
        expect(WHOLESALE_PALLET.contractPrice?.currency).toBe('SAR');
        expect(STAFF_LUNCH_BOX.contractPrice?.currency).toBe('USD');

        const mixed = [WHOLESALE_PALLET.contractPrice, STAFF_LUNCH_BOX.contractPrice].filter(
            (value): value is Money => value !== null && value !== undefined,
        );
        expect(isMixedCurrency(mixed)).toBe(true);
        expect(totalsByCurrency(mixed)).toHaveLength(2);
    });
});

describe('volume tiers', () => {
    it('resolves a quantity to the tier it earns, and to nothing below the first one', () => {
        expect(tierForQuantity(STAFF_LUNCH_BOX.volumeTiers, 1)).toBeNull();
        expect(tierForQuantity(STAFF_LUNCH_BOX.volumeTiers, 40)?.minimumQuantity).toBe(40);
        expect(tierForQuantity(STAFF_LUNCH_BOX.volumeTiers, 120)?.minimumQuantity).toBe(100);
        // The last tier has no ceiling.
        expect(tierForQuantity(STAFF_LUNCH_BOX.volumeTiers, 100_000)?.maximumQuantity).toBeNull();
    });

    it('prices a line at its tier, and refuses to price one below the minimum order', () => {
        expect(lineValue(STAFF_LUNCH_BOX, 1)).toBeNull();

        const tier = tierForQuantity(STAFF_LUNCH_BOX.volumeTiers, 120);
        const value = lineValue(STAFF_LUNCH_BOX, 120);
        expect(value).not.toBeNull();
        expect(value?.currency).toBe(tier?.unitPrice.currency);
        expect(value?.amount).toBe((tier?.unitPrice.amount ?? 0) * 120);
    });
});

describe('the supply calendar', () => {
    it('opens a window at the request date plus the lead time on the line', () => {
        expect(earliestSupplyDate('2026-07-28T07:20:00.000Z', 2)).toBe('2026-07-30');
        expect(earliestSupplyDate('not a date', 2)).toBeNull();
    });

    it('projects that window onto the delivery weekdays agreed for the line', () => {
        // The submitted request was raised on 28 July 2026 against a line with a two-day lead time,
        // so nothing may fall before 30 July.
        const dates = supplyDates(SUBMITTED_QUOTATION, STAFF_LUNCH_BOX, 4);
        expect(dates).toHaveLength(4);

        for (const date of dates) {
            const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
            // The staff-lunch line delivers Monday to Friday only.
            expect(weekday).not.toBe(0);
            expect(weekday).not.toBe(6);
            expect(date >= '2026-07-30').toBe(true);
        }
    });

    it('produces nothing for a line with no agreed delivery days', () => {
        expect(
            supplyDates(SUBMITTED_QUOTATION, { ...STAFF_LUNCH_BOX, deliveryWeekdays: [] }, 4),
        ).toEqual([]);
    });
});

describe('quotation draft validation', () => {
    const translate = (key: string) => key;
    const contact: DraftContact = {
        name: 'Dana',
        email: 'dana@example.com',
        note: '',
        requestedDeliveryDate: null,
        recurring: false,
    };

    it('refuses an empty draft', () => {
        const errors = validateDraft([STAFF_LUNCH_BOX], {}, contact, translate);
        expect(errors.lines).toBe('business:builder.errorNoLines');
    });

    it('refuses a line below its minimum order', () => {
        const errors = validateDraft(
            [STAFF_LUNCH_BOX],
            { [STAFF_LUNCH_BOX.id]: 1 },
            contact,
            translate,
        );
        expect(errors.lines).toBe('business:builder.errorBelowMinimum');
    });

    it('requires a contact who can actually be replied to', () => {
        const quantities = { [STAFF_LUNCH_BOX.id]: STAFF_LUNCH_BOX.minimumOrderQuantity };
        expect(
            validateDraft([STAFF_LUNCH_BOX], quantities, { ...contact, name: '  ' }, translate)
                .name,
        ).toBe('errors:validation.required');
        expect(
            validateDraft([STAFF_LUNCH_BOX], quantities, { ...contact, email: 'dana' }, translate)
                .email,
        ).toBe('errors:validation.email');
        expect(validateDraft([STAFF_LUNCH_BOX], quantities, contact, translate)).toEqual({});
    });
});

/* ══ the corporate dashboard ═══════════════════════════════════════════════════════════════════ */

describe('corporate dashboard', () => {
    it('lists every programme the account buys through, and says where the list comes from', async () => {
        const world = businessWorld();
        await renderStubScreen(<CorporateDashboardScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        expect(screen.getByTestId('corporate-programme-source')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('corporate-programme-list')).toBeTruthy();
        });

        // Two programmes authored, two cards — the count is derived from the world, not written down.
        await waitFor(() => {
            expect(screen.getAllByTestId(/^corporate-programme-.+-name$/)).toHaveLength(2);
        });
        for (const programme of [STAFF_PROGRAMME, WHOLESALE_PROGRAMME]) {
            const base = `corporate-programme-${String(programme.id)}`;
            expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
            expect(screen.getByTestId(`${base}-headcount`)).toBeTruthy();
            expect(screen.getByTestId(`${base}-locations`)).toBeTruthy();
        }
    });

    it('marks the per-person subsidy as a contract price, because it is one', async () => {
        const world = businessWorld();
        await renderStubScreen(<CorporateDashboardScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(
                screen.getByTestId(contractPriceTestId(`subsidy-${String(STAFF_PROGRAMME.id)}`)),
            ).toBeTruthy();
        });
        // The unsubsidised programme says so rather than rendering a marked zero.
        expect(
            screen.getByTestId(`corporate-programme-${String(WHOLESALE_PROGRAMME.id)}-no-subsidy`),
        ).toBeTruthy();
    });

    it('summarises the outstanding quotations by reference', async () => {
        const world = businessWorld();
        await renderStubScreen(<CorporateDashboardScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(
                screen.getByTestId(`corporate-quotation-${SUBMITTED_QUOTATION.reference}`),
            ).toBeTruthy();
        });
        expect(
            screen.getByTestId(`corporate-quotation-${QUOTED_QUOTATION.reference}`),
        ).toBeTruthy();
    });
});

/* ══ the negotiated catalogue ══════════════════════════════════════════════════════════════════ */

describe('corporate catalogue', () => {
    it('renders a contract price, a minimum order and a lead time on every line', async () => {
        const world = businessWorld();
        await renderStubScreen(
            <CorporateCatalogueScreen programmeId={String(STAFF_PROGRAMME_ID)} />,
            { session: buyerSession(), repositories: world.overrides },
        );

        await waitFor(() => {
            expect(screen.getByTestId(`catalogue-item-${STAFF_LUNCH_BOX.id}`)).toBeTruthy();
        });
        expect(screen.getByTestId(contractPriceTestId(STAFF_LUNCH_BOX.id))).toBeTruthy();
        expect(screen.getByTestId(`catalogue-item-${STAFF_LUNCH_BOX.id}-minimum`)).toBeTruthy();
        expect(screen.getByTestId(`catalogue-item-${STAFF_LUNCH_BOX.id}-lead-time`)).toBeTruthy();
        expect(screen.getByTestId(`catalogue-item-${STAFF_LUNCH_BOX.id}-weekdays`)).toBeTruthy();
        expect(screen.getByTestId('corporate-catalogue-currencies')).toBeTruthy();

        // The catalogue is scoped to the programme by the contract, so the other programme's line
        // must not be here.
        expect(screen.queryByTestId(`catalogue-item-${WHOLESALE_PALLET.id}`)).toBeNull();
    });

    it('shows the SAR line in its own currency rather than converting it', async () => {
        const world = businessWorld();
        await renderStubScreen(
            <CorporateCatalogueScreen programmeId={String(WHOLESALE_PROGRAMME_ID)} />,
            { session: buyerSession(), repositories: world.overrides },
        );

        await waitFor(() => {
            expect(screen.getByTestId(contractPriceTestId(WHOLESALE_PALLET.id))).toBeTruthy();
        });
        expect(screen.getAllByText(/SAR/).length).toBeGreaterThan(0);
    });

    it('filters to a kind, then offers a way back out of an empty result', async () => {
        const world = businessWorld();
        await renderStubScreen(
            <CorporateCatalogueScreen programmeId={String(WHOLESALE_PROGRAMME_ID)} />,
            { session: buyerSession(), repositories: world.overrides },
        );

        await waitFor(() => {
            expect(screen.getByTestId(`catalogue-item-${WHOLESALE_PALLET.id}`)).toBeTruthy();
        });

        // The wholesale programme holds a bulk package and no meals.
        fireEvent.press(screen.getByTestId('corporate-catalogue-kind-meal'));
        await waitFor(() => {
            expect(screen.getByTestId('corporate-catalogue-empty')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('corporate-catalogue-clear'));
        await waitFor(() => {
            expect(screen.getByTestId(`catalogue-item-${WHOLESALE_PALLET.id}`)).toBeTruthy();
        });
    });

    it('answers a malformed programme address with a not-found rather than a failure', async () => {
        const world = businessWorld();
        await renderStubScreen(<CorporateCatalogueScreen programmeId="not-a-programme" />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        expect(screen.getByTestId('corporate-catalogue-not-found')).toBeTruthy();
    });
});

describe('catalogue line detail', () => {
    it('prices every volume tier, and marks each one', async () => {
        const world = businessWorld();
        await renderStubScreen(<CatalogueItemScreen itemId={STAFF_LUNCH_BOX.id} />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('catalogue-item-name')).toBeTruthy();
        });
        expect(
            screen.getByTestId(contractPriceTestId(`headline-${STAFF_LUNCH_BOX.id}`)),
        ).toBeTruthy();
        for (const tier of STAFF_LUNCH_BOX.volumeTiers) {
            expect(screen.getByTestId(contractPriceTestId(`tier-${String(tier.id)}`))).toBeTruthy();
        }
        // Three authored rungs, three marked prices plus the headline.
        expect(screen.getAllByTestId(/^contract-price-tier-/)).toHaveLength(3);
    });

    it('answers an unknown line with an error state rather than a blank screen', async () => {
        const world = businessWorld();
        await renderStubScreen(<CatalogueItemScreen itemId="catalogue-does-not-exist" />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('catalogue-item-detail-error')).toBeTruthy();
        });
    });
});

/* ══ the quotation builder ═════════════════════════════════════════════════════════════════════ */

describe('quotation builder', () => {
    it('states that it asks for a price and orders nothing', async () => {
        const world = businessWorld();
        await renderStubScreen(
            <QuotationBuilderScreen programmeId={String(STAFF_PROGRAMME_ID)} />,
            { session: buyerSession(), repositories: world.overrides },
        );

        expect(screen.getByTestId('quotation-builder-scope')).toBeTruthy();
    });

    it('refuses an empty draft and says which rule it broke', async () => {
        const world = businessWorld();
        await renderStubScreen(
            <QuotationBuilderScreen programmeId={String(STAFF_PROGRAMME_ID)} />,
            { session: buyerSession(), repositories: world.overrides },
        );

        await waitFor(() => {
            expect(screen.getByTestId(`quotation-line-${STAFF_LUNCH_BOX.id}`)).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('quotation-builder-submit'));
        await waitFor(() => {
            expect(screen.getByTestId('quotation-builder-lines-error')).toBeTruthy();
        });

        // Nothing was filed: the refusal is local, and the contract was never called.
        expect(world.quotations).toHaveLength(2);
    });

    it('seeds the line the catalogue sent it at that minimum order, and values it', async () => {
        const world = businessWorld();
        await renderStubScreen(
            <QuotationBuilderScreen
                programmeId={String(STAFF_PROGRAMME_ID)}
                initialItemId={STAFF_LUNCH_BOX.id}
            />,
            { session: buyerSession(), repositories: world.overrides },
        );

        await waitFor(() => {
            expect(
                screen.getByTestId(contractPriceTestId(`line-${STAFF_LUNCH_BOX.id}`)),
            ).toBeTruthy();
        });
        // The draft total is keyed by the currency the line is stated in. Read it off the line
        // rather than writing it down twice.
        const currency = STAFF_LUNCH_BOX.contractPrice?.currency;
        expect(currency).toBeDefined();
        expect(
            screen.getByTestId(contractPriceTestId(`draft-total-${String(currency)}`)),
        ).toBeTruthy();
    });

    it('really files a quotation, and the world really has one more', async () => {
        const world = businessWorld();
        const { repositories } = await renderStubScreen(
            <QuotationBuilderScreen
                programmeId={String(STAFF_PROGRAMME_ID)}
                initialItemId={STAFF_LUNCH_BOX.id}
            />,
            { session: buyerSession(), repositories: world.overrides },
        );

        const before = world.quotations.length;

        // The seeded line has to have arrived before the form is worth submitting.
        await waitFor(() => {
            expect(
                screen.getByTestId(contractPriceTestId(`line-${STAFF_LUNCH_BOX.id}`)),
            ).toBeTruthy();
        });

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('quotation-builder-contact-name-input'),
                'Dana Fakhoury',
            );
            fireEvent.changeText(
                screen.getByTestId('quotation-builder-contact-email-input'),
                'dana@example.com',
            );
        });

        fireEvent.press(screen.getByTestId('quotation-builder-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('quotation-builder-success')).toBeTruthy();
        });

        expect(repositories.business.requestQuotation).toHaveBeenCalledWith(
            expect.objectContaining({
                programmeId: STAFF_PROGRAMME_ID,
                contactName: 'Dana Fakhoury',
                contactEmail: 'dana@example.com',
                lines: [
                    {
                        catalogueItemId: STAFF_LUNCH_BOX.id,
                        quantity: STAFF_LUNCH_BOX.minimumOrderQuantity,
                    },
                ],
            }),
        );
        expect(world.quotations).toHaveLength(before + 1);
        // Filed unpriced: a prototype that quoted a total back would have invented a commitment.
        expect(world.quotations.at(-1)?.state).toBe('submitted');
        expect(world.quotations.at(-1)?.requestedTotal).toBeNull();
    });

    it('offers neither a draft control nor a note apologising for its absence', async () => {
        const world = businessWorld();
        await renderStubScreen(
            <QuotationBuilderScreen programmeId={String(STAFF_PROGRAMME_ID)} />,
            { session: buyerSession(), repositories: world.overrides },
        );

        expect(screen.queryByTestId('quotation-builder-draft-note')).toBeNull();
        expect(screen.queryAllByTestId('prototype-action')).toEqual([]);
    });

    it('answers a malformed programme address with a not-found', async () => {
        const world = businessWorld();
        await renderStubScreen(<QuotationBuilderScreen programmeId="nonsense" />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        expect(screen.getByTestId('quotation-builder-not-found')).toBeTruthy();
    });
});

/* ══ the quotation list ════════════════════════════════════════════════════════════════════════ */

describe('quotation list', () => {
    it('shows an unpriced request as awaiting a price rather than inventing a total', async () => {
        const world = businessWorld();
        await renderStubScreen(<QuotationsScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        const line = SUBMITTED_QUOTATION.lines[0];
        expect(line).toBeDefined();
        if (line === undefined) return;

        await waitFor(() => {
            expect(screen.getByTestId(`quotation-${SUBMITTED_QUOTATION.reference}`)).toBeTruthy();
        });
        expect(
            screen.getByTestId(
                `quotation-${SUBMITTED_QUOTATION.reference}-line-${line.catalogueItemId}-unpriced`,
            ),
        ).toBeTruthy();
        // …and no total is marked for it, because nobody has priced it.
        expect(
            screen.queryByTestId(
                contractPriceTestId(`quoted-total-${SUBMITTED_QUOTATION.reference}`),
            ),
        ).toBeNull();
    });

    it('marks a priced quotation as carrying contract prices', async () => {
        const world = businessWorld();
        await renderStubScreen(<QuotationsScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(
                screen.getByTestId(
                    contractPriceTestId(`quoted-total-${QUOTED_QUOTATION.reference}`),
                ),
            ).toBeTruthy();
        });
    });

    it('filters to a group and back', async () => {
        const world = businessWorld();
        await renderStubScreen(<QuotationsScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('quotations-list')).toBeTruthy();
        });

        // Neither authored quotation is closed, so the closed group is genuinely empty.
        fireEvent.press(screen.getByTestId('quotations-filter-closed'));
        await waitFor(() => {
            expect(screen.getByTestId('quotations-empty')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('quotations-clear-filter'));
        await waitFor(() => {
            expect(screen.getByTestId('quotations-list')).toBeTruthy();
        });
    });

    it('accepts a quoted quotation for real, and offers no export control', async () => {
        const world = businessWorld();
        const { repositories } = await renderStubScreen(<QuotationsScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('quotations-list')).toBeTruthy();
        });

        const testId = `quotation-${QUOTED_QUOTATION.reference}-accept`;
        fireEvent.press(await screen.findByTestId(testId));
        await waitFor(() => {
            expect(screen.queryByTestId(testId)).toBeNull();
        });

        // The control is gone because the record moved, not because the screen hid it.
        expect(repositories.business.acceptQuotation).toHaveBeenCalledWith(QUOTED_QUOTATION.id);
        expect(
            world.quotations.find((quotation) => quotation.id === QUOTED_QUOTATION.id)?.state,
        ).toBe('accepted');

        // `quotationExport` is unavailable, so there is no document control to press.
        expect(screen.queryAllByTestId('prototype-action')).toEqual([]);
    });
});

/* ══ the partner workspace ═════════════════════════════════════════════════════════════════════ */

describe('partner workspace', () => {
    it('shows quantities and lead times, and no contract price anywhere', async () => {
        const world = businessWorld();
        await renderStubScreen(<PartnerCommitmentsScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('partner-commitment-list')).toBeTruthy();
        });

        expect(screen.getByTestId('partner-price-privacy')).toBeTruthy();
        expect(screen.getByTestId('partner-source-note')).toBeTruthy();
        expect(screen.queryAllByTestId(/^contract-price-/)).toEqual([]);
    });

    it('narrows the commitments to one kitchen and back', async () => {
        const world = businessWorld();
        await renderStubScreen(<PartnerCommitmentsScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('partner-commitment-list')).toBeTruthy();
        });

        // Two authored quotations, one line each, on two different kitchens.
        await waitFor(() => {
            expect(screen.queryAllByTestId(/^partner-commitment-.+-quantity$/)).toHaveLength(2);
        });

        fireEvent.press(screen.getByTestId(`partner-kitchen-${String(NORTHWIND_KITCHEN_ID)}`));
        await waitFor(() => {
            expect(screen.queryAllByTestId(/^partner-commitment-.+-quantity$/)).toHaveLength(1);
        });
        expect(
            screen.getByTestId(
                `partner-commitment-${QUOTED_QUOTATION.reference}-${WHOLESALE_PALLET.id}-quantity`,
            ),
        ).toBeTruthy();

        fireEvent.press(screen.getByTestId('partner-kitchen-all'));
        await waitFor(() => {
            expect(screen.queryAllByTestId(/^partner-commitment-.+-quantity$/)).toHaveLength(2);
        });
    });

    it('groups the schedule by date and explains where the dates come from', async () => {
        const world = businessWorld();
        await renderStubScreen(<PartnerScheduleScreen />, {
            session: buyerSession(),
            repositories: world.overrides,
        });

        expect(screen.getByTestId('partner-schedule-derivation')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('partner-schedule-days')).toBeTruthy();
        });
        // The staff line's window opens on 30 July 2026 — 28 July plus its two-day lead time.
        expect(screen.getByTestId('partner-schedule-day-2026-07-30')).toBeTruthy();
        expect(screen.queryAllByTestId(/^contract-price-/)).toEqual([]);
    });
});
