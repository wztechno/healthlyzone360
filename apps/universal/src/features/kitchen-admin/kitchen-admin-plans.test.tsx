import {
    apiFailure,
    conflictFailure,
    isPlanDurationConsistent,
    throwFailure,
    validationFailure,
} from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    CursorPage,
    PlanAdmin,
    PlanAdminFilter,
    PlanCombination,
    PlanDurationAdmin,
    PlanVariantAdmin,
    PriceListAdmin,
    PriceListEntry,
    PublishableStatus,
} from '@healthy360/api-client/contracts';
import {
    KitchenId,
    PlanVariantId,
    PriceListId,
    RoleId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import KitchenPlansRoute from '../../../app/kitchen/plans/index.tsx';
import {
    ORGANISATION_OWNER_PERMISSIONS,
    kitchenManagerSession,
    testActiveContext,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    combinationKey,
    energyBandKey,
    summarisePlanDurations,
    summarisePlanMatrix,
    summarisePlanPrices,
} from './format.ts';
import {
    combinationDraft,
    combinationErrors,
    durationErrors,
    durationRequest,
    matrixBands,
    matrixRows,
    toggleCell,
    variantDraft,
    variantErrors,
    variantRequest,
    withDurationKind,
} from './plan-matrix.ts';
import type { CombinationDraft, DurationDraft, VariantDraft } from './plan-matrix.ts';
import { PlanEditScreen } from './screens/plan-edit-screen.tsx';
import { PlansScreen } from './screens/plans-screen.tsx';

/**
 * The plan half of the kitchen workspace, against a world this file declares (K1.6).
 *
 * Nothing here stubs a hook: the screens still run through `Repositories`, the interface production
 * speaks. What changed is where the records come from — every plan, every price entry and every
 * rejection below is authored in this file and handed to `renderStubScreen`, so a count assertion is
 * a statement about what this test wrote rather than about somebody else's fixture world. The two
 * plan shapes are declared once ({@link spreadPlan}, {@link stackedPlan}) and the matrix maths in
 * every assertion is derived from them.
 *
 * Six things this file exists to prove:
 *
 * 1. **A cell of the matrix is a variant, and toggling one is a round trip.** Switching an empty
 *    cell on and saving puts a configuration in the repository at that combination and that band;
 *    switching it off and saving takes it away. Variant existence *is* the availability matrix
 *    (appendix D), so this is the whole slice in one assertion.
 * 2. **The two shapes both work.** This file authors a plan whose three configurations occupy three
 *    different cells and a plan whose three share one, and the summary and the cell both say so. The
 *    workbook structure the importer will bring is the second shape.
 * 3. **The `CHECK` cannot be broken through the interface.** Switching a duration to `one_off`
 *    clears its day count and takes the field away; switching back leaves the row incomplete and
 *    blocks the save until a positive count is typed.
 * 4. **A `null` discount survives, and is never a `0`.** The two are different answers — undecided
 *    versus "this commitment earns nothing" — and the row, the request and the repository all keep
 *    them apart.
 * 5. **Publishing states its refusals before they happen.** A plan with no confirmed price is
 *    refused, and the dialog says so from the same price lists the server reads.
 * 6. **The row machinery keeps its promises here too** — move with an announcement, remove, undo to
 *    the row's own position — and the route-level split still renders.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/kitchen/plans',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 *
 * Every builder is typed against its contract shape, so a contract that grows a required field
 * fails the typecheck here rather than producing a record the screen cannot render.
 * ---------------------------------------------------------------------------------------------- */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');
const PRICE_LIST_ID = PriceListId.unsafe('01935f6d-0000-7000-8000-00000000d001');

/** UUIDv7-shaped, because `PlanEditScreen` parses its route parameter with `SubscriptionPlanId`. */
function planIdentifier(ordinal: number): SubscriptionPlanId {
    return SubscriptionPlanId.unsafe(`01935f6d-0000-7000-8000-0000000b000${String(ordinal)}`);
}

function variantIdentifier(ordinal: number): PlanVariantId {
    return PlanVariantId.unsafe(
        `01935f6d-0000-7000-8000-0000000c00${String(ordinal).padStart(2, '0')}`,
    );
}

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'published',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

function planVariant(ordinal: number, overrides: Partial<PlanVariantAdmin> = {}): PlanVariantAdmin {
    return {
        id: variantIdentifier(ordinal),
        name: { en: `Configuration ${String(ordinal)}`, ar: `تهيئة ${String(ordinal)}` },
        energyBand: { min: 1400, max: 1600 },
        mealsPerDay: 3,
        snacksPerDay: 1,
        isActive: true,
        ...overrides,
    };
}

function planCombination(overrides: Partial<PlanCombination> = {}): PlanCombination {
    return {
        code: 'M3S1',
        label: { en: '3 meals, 1 snack', ar: 'ثلاث وجبات وسناك' },
        mealsPerDay: 3,
        snacksPerDay: 1,
        isAvailable: true,
        ...overrides,
    };
}

function planDuration(overrides: Partial<PlanDurationAdmin> = {}): PlanDurationAdmin {
    return { kind: 'fixed_days', days: 5, discountPercent: 0, ...overrides };
}

/**
 * A plan whose three configurations sit in three different cells — the common shape.
 *
 * Two combinations across three bands is a six-cell grid with three of them sold, which is what
 * makes `cells > filled` a real statement rather than an arithmetic coincidence. The first duration
 * earns `0` — a decision — and the second earns `10`, so "not set" has something to be distinct
 * from; neither is 20 days, which is the commitment the duration tests add.
 */
function spreadPlan(overrides: Partial<PlanAdmin> = {}): PlanAdmin {
    return {
        id: planIdentifier(1),
        meta: meta(),
        name: { en: 'Balanced reset', ar: 'إعادة توازن' },
        summary: { en: 'Three meals a day, portioned', ar: 'ثلاث وجبات يوميًا' },
        description: { en: 'A steady weekday plan.', ar: 'خطة أيام الأسبوع.' },
        kitchenId: KITCHEN_ID,
        categorySlugs: ['weight-management'],
        dietClassifications: [],
        variants: [
            planVariant(1, {
                name: { en: 'Light', ar: 'خفيف' },
                mealsPerDay: 3,
                snacksPerDay: 1,
                energyBand: { min: 1400, max: 1600 },
            }),
            planVariant(2, {
                name: { en: 'Standard', ar: 'قياسي' },
                mealsPerDay: 3,
                snacksPerDay: 1,
                energyBand: { min: 1700, max: 1900 },
            }),
            planVariant(3, {
                name: { en: 'Generous', ar: 'وفير' },
                mealsPerDay: 3,
                snacksPerDay: 2,
                energyBand: { min: 2000, max: 2300 },
            }),
        ],
        durations: [
            planDuration({ kind: 'fixed_days', days: 5, discountPercent: 0 }),
            planDuration({ kind: 'fixed_days', days: 30, discountPercent: 10 }),
        ],
        combinations: [
            planCombination({ code: 'M3S1', mealsPerDay: 3, snacksPerDay: 1 }),
            planCombination({
                code: 'M3S2',
                label: { en: '3 meals, 2 snacks', ar: 'ثلاث وجبات وسناكان' },
                mealsPerDay: 3,
                snacksPerDay: 2,
            }),
        ],
        changeCutOffHours: 24,
        deliveryWeekdays: [1, 2, 3, 4, 5],
        ...overrides,
    };
}

/**
 * A plan whose three configurations share one cell — the household-size shape an import brings.
 *
 * One combination, one band, three configurations in the single cell they make: the grid is full
 * and the plan is not thin.
 */
function stackedPlan(overrides: Partial<PlanAdmin> = {}): PlanAdmin {
    return {
        id: planIdentifier(2),
        meta: meta(),
        name: { en: 'Family table', ar: 'مائدة العائلة' },
        summary: { en: 'One dinner a day, by household size', ar: 'عشاء واحد يوميًا' },
        description: { en: 'Cooked for the whole table.', ar: 'يُطهى للمائدة كاملة.' },
        kitchenId: KITCHEN_ID,
        categorySlugs: [],
        dietClassifications: [],
        variants: [
            planVariant(4, {
                name: { en: 'Two people', ar: 'شخصان' },
                mealsPerDay: 1,
                snacksPerDay: 0,
                energyBand: { min: 1800, max: 2000 },
            }),
            planVariant(5, {
                name: { en: 'Three people', ar: 'ثلاثة أشخاص' },
                mealsPerDay: 1,
                snacksPerDay: 0,
                energyBand: { min: 1800, max: 2000 },
            }),
            planVariant(6, {
                name: { en: 'Four people', ar: 'أربعة أشخاص' },
                mealsPerDay: 1,
                snacksPerDay: 0,
                energyBand: { min: 1800, max: 2000 },
            }),
        ],
        durations: [planDuration({ kind: 'fixed_days', days: 20, discountPercent: null })],
        combinations: [
            planCombination({
                code: 'M1S0',
                label: { en: '1 meal', ar: 'وجبة واحدة' },
                mealsPerDay: 1,
                snacksPerDay: 0,
            }),
        ],
        changeCutOffHours: 24,
        deliveryWeekdays: [1, 2, 3, 4, 5, 6, 7],
        ...overrides,
    };
}

function priceEntry(
    plan: PlanAdmin,
    variant: PlanVariantAdmin | null,
    overrides: Partial<PriceListEntry> = {},
): PriceListEntry {
    return {
        item: {
            kind: 'plan',
            planId: plan.id,
            variantId: variant === null ? null : variant.id,
        },
        priceStatus: 'confirmed',
        amountMinor: 120_000,
        effectiveFrom: '2026-07-01',
        effectiveUntil: null,
        note: null,
        ...overrides,
    };
}

function priceList(
    entries: readonly PriceListEntry[],
    overrides: Partial<PriceListAdmin> = {},
): PriceListAdmin {
    return {
        id: PRICE_LIST_ID,
        meta: meta(),
        name: { en: 'Retail 2026', ar: 'التجزئة 2026' },
        currency: 'AED',
        kitchenId: KITCHEN_ID,
        channels: ['b2c'],
        entries,
        ...overrides,
    };
}

/** One confirmed price per configuration and none for the plan row itself — three of four decided. */
function pricedVariants(plan: PlanAdmin): readonly PriceListAdmin[] {
    return [priceList(plan.variants.map((variant) => priceEntry(plan, variant)))];
}

/* ------------------------------------------------------------------------------------------------
 * The repository answers
 * ---------------------------------------------------------------------------------------------- */

/**
 * A listing that reads its rows at call time.
 *
 * A function rather than a captured array, for the same reason the other kitchen suites take one:
 * it is what lets a test move the world on mid-flight and assert the refetch. The `query` and
 * `statuses` narrowing is done here because the screen sends both to the server and asserting the
 * filtered empty state means something only if somebody actually filters.
 */
function planListing(
    read: () => readonly PlanAdmin[],
): (filter?: PlanAdminFilter) => Promise<CursorPage<PlanAdmin>> {
    return async (filter) => {
        const needle = filter?.query?.trim().toLocaleLowerCase() ?? '';
        const statuses = filter?.statuses;

        return page(
            read().filter(
                (row) =>
                    (statuses === undefined || statuses.includes(row.meta.status)) &&
                    (needle === '' ||
                        row.name.en.toLocaleLowerCase().includes(needle) ||
                        row.name.ar.includes(needle)),
            ),
        );
    };
}

interface PlanWorld {
    /** The record as the world holds it *now* — the replacement for a mock-store reach-in. */
    read: () => PlanAdmin;
    /** Moves the record on behind the screen's back, the way another writer would. */
    write: (next: PlanAdmin) => void;
    readonly overrides: RepositoryOverrides;
}

/**
 * One plan, and the four lock-versioned writers that can change it.
 *
 * The lock version is enforced here rather than assumed, because that refusal *is* the conflict the
 * editor has to render: a write carrying a version the world has moved past rejects with
 * `resource.conflict` carrying the current one, exactly as the contract states (plan §4.13).
 *
 * `setPlanVariants` mints an identifier for every input that arrives with `id: null`, which is the
 * behaviour the "identity survives a second save" case turns on: a row still carrying `null` on the
 * next save would be minted a *fresh* identifier and orphan every price entry pointing at the old
 * one.
 */
function planWorld(initial: PlanAdmin, priceLists: readonly PriceListAdmin[] = []): PlanWorld {
    let stored = initial;
    let minted = 0;

    const requireVersion = (lockVersion: number): void => {
        if (lockVersion !== stored.meta.lockVersion) {
            throwFailure(conflictFailure({ currentLockVersion: stored.meta.lockVersion }));
        }
    };

    const commit = (
        next: Omit<Partial<PlanAdmin>, 'meta'>,
        status?: PublishableStatus,
    ): PlanAdmin => {
        stored = {
            ...stored,
            ...next,
            meta: {
                ...stored.meta,
                ...(status === undefined ? {} : { status }),
                lockVersion: stored.meta.lockVersion + 1,
                updatedAt: '2026-08-02T09:00:00.000Z',
            },
        };
        return stored;
    };

    return {
        read: () => stored,
        write: (next) => {
            stored = next;
        },
        overrides: {
            kitchenAdmin: {
                listPlans: planListing(() => [stored]),
                listPriceLists: async () => page(priceLists),
                getPlan: async () => stored,
                updatePlan: async (_planId, request) => {
                    requireVersion(request.lockVersion);
                    return commit({
                        ...(request.name === undefined ? {} : { name: request.name }),
                        ...(request.summary === undefined ? {} : { summary: request.summary }),
                    });
                },
                setPlanVariants: async (_planId, request) => {
                    requireVersion(request.lockVersion);
                    return commit({
                        variants: request.variants.map((input) => {
                            if (input.id !== null) {
                                return {
                                    id: input.id,
                                    name: input.name,
                                    energyBand: input.energyBand,
                                    mealsPerDay: input.mealsPerDay,
                                    snacksPerDay: input.snacksPerDay,
                                    isActive: input.isActive ?? true,
                                };
                            }
                            minted += 1;
                            return {
                                id: variantIdentifier(50 + minted),
                                name: input.name,
                                energyBand: input.energyBand,
                                mealsPerDay: input.mealsPerDay,
                                snacksPerDay: input.snacksPerDay,
                                isActive: input.isActive ?? true,
                            };
                        }),
                    });
                },
                setPlanDurations: async (_planId, request) => {
                    requireVersion(request.lockVersion);
                    return commit({ durations: [...request.durations] });
                },
                setPlanCombinations: async (_planId, request) => {
                    requireVersion(request.lockVersion);
                    return commit({ combinations: [...request.combinations] });
                },
                publishPlan: async (_planId, request) => {
                    requireVersion(request.lockVersion);
                    return commit({}, 'published');
                },
                retirePlan: async (_planId, request) => {
                    requireVersion(request.lockVersion);
                    return commit({}, 'retired');
                },
            },
        },
    };
}

/** An organisation owner: an organisation, a branch, and no catalogue permission at all. */
function organisationOwnerSession() {
    return testMeResponse({
        memberships: [
            testMembership({
                organisation: testOrganisation({
                    name: 'Cedar Clinic',
                    slug: 'cedar-clinic',
                    type: 'clinic',
                }),
                roles: [
                    {
                        id: RoleId.unsafe('01935f6d-0000-7000-8000-00000000e001'),
                        key: 'organisation_owner',
                        name: 'Owner',
                    },
                ],
            }),
        ],
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    });
}

/* ------------------------------------------------------------------------------------------------
 * Pure helpers
 * ---------------------------------------------------------------------------------------------- */

function variant(overrides: Partial<VariantDraft> = {}): VariantDraft {
    return {
        key: 'a',
        id: null,
        name: { en: 'Light', ar: 'خفيف' },
        mealsPerDay: 3,
        snacksPerDay: 1,
        energyMin: 1400,
        energyMax: 1600,
        isActive: true,
        ...overrides,
    };
}

function combination(overrides: Partial<CombinationDraft> = {}): CombinationDraft {
    return {
        key: 'c1',
        code: 'M3S1',
        label: { en: '3 meals, 1 snack', ar: '' },
        mealsPerDay: 3,
        snacksPerDay: 1,
        isAvailable: true,
        ...overrides,
    };
}

function duration(overrides: Partial<DurationDraft> = {}): DurationDraft {
    return { key: 'd1', kind: 'fixed_days', days: 20, discountPercent: null, ...overrides };
}

/** The test id of one plan's first duration row, built the way `durationDraft` keys it. */
function firstDurationRow(plan: PlanAdmin): string {
    const first = plan.durations[0]!;
    return `kitchen-plan-duration-rows-row-seed-duration-0-${first.kind}-${String(
        first.days ?? 'x',
    )}`;
}

/** The test id of one plan's first configuration row. */
function firstVariantRow(plan: PlanAdmin): string {
    return `kitchen-plan-variants-row-seed-variant-0-${String(plan.variants[0]!.id)}`;
}

/** The matrix cell one configuration sits in. */
function cellOf(variantRow: PlanVariantAdmin): string {
    return `kitchen-plan-matrix-grid-cell-${combinationKey(variantRow)}-${energyBandKey(
        variantRow.energyBand,
    )}`;
}

/**
 * Every cell of the plan's grid that no configuration occupies, in the order the grid draws them.
 *
 * Derived through the same model the editor draws with rather than hand-listed, so a change to how
 * rows and columns are assembled cannot leave this suite pressing a cell that is not there.
 */
function emptyCells(plan: PlanAdmin): readonly string[] {
    const rows = matrixRows(
        plan.combinations.map(combinationDraft),
        plan.variants.map(variantDraft),
    );
    const bands = matrixBands(plan.variants.map(variantDraft), []);
    const sold = new Set(
        plan.variants.map((row) => `${combinationKey(row)}-${energyBandKey(row.energyBand)}`),
    );

    return rows
        .flatMap((row) => bands.map((band) => `${row.key}-${band.key}`))
        .filter((key) => !sold.has(key));
}

const VARIANT_MESSAGES = {
    nameRequired: 'name required',
    servingsRequired: 'servings required',
    energyRequired: 'energy required',
    energyReversed: 'energy reversed',
};

const COMBINATION_MESSAGES = {
    codeRequired: 'code required',
    codeDuplicate: 'code duplicate',
    labelRequired: 'label required',
    servingsRequired: 'servings required',
};

const DURATION_MESSAGES = {
    daysRequired: 'days required',
    duplicate: 'duplicate',
    discountInvalid: 'discount invalid',
};

describe('the matrix, as a pure model', () => {
    const rows = [
        combination({ key: 'c1', code: 'M3S1', mealsPerDay: 3, snacksPerDay: 1 }),
        combination({ key: 'c2', code: 'M3S2', mealsPerDay: 3, snacksPerDay: 2 }),
    ];

    it('draws a column for every band a configuration carries, plus the ones added here', () => {
        const bands = matrixBands(
            [
                variant({ key: 'a', energyMin: 1700, energyMax: 1900 }),
                variant({ key: 'b', energyMin: 1400, energyMax: 1600 }),
            ],
            [{ min: 2000, max: 2300 }],
        );

        expect(bands.map((band) => band.key)).toEqual(['1400-1600', '1700-1900', '2000-2300']);
        // A band nothing occupies is drawn so its cells can be switched on, and says what it is.
        expect(bands.map((band) => band.isDeclaredOnly)).toEqual([false, false, true]);
    });

    it('draws a row for a shape no combination declares rather than hiding the configuration', () => {
        const drawn = matrixRows(rows, [variant({ key: 'x', mealsPerDay: 1, snacksPerDay: 0 })]);

        expect(drawn.map((row) => row.key)).toEqual(['3m1s', '3m2s', '1m0s']);
        // Declared rows keep their authored order; the undeclared one follows, and is marked.
        expect(drawn[0]?.combination?.code).toBe('M3S1');
        expect(drawn[2]?.combination).toBeNull();
    });

    it('switches an empty cell on with the row’s servings and the column’s band', () => {
        const drawn = matrixRows(rows, []);
        const bands = matrixBands([], [{ min: 1700, max: 1900 }]);
        const cell = { row: drawn[1]!, band: bands[0]! };

        const next = toggleCell([], cell.row, cell.band, {
            key: 'variant-1',
            name: { en: 'Generous', ar: '' },
        });

        expect(next).toHaveLength(1);
        expect(next[0]).toMatchObject({
            id: null,
            mealsPerDay: 3,
            snacksPerDay: 2,
            energyMin: 1700,
            energyMax: 1900,
            isActive: true,
        });

        // …and switching it off again is the inverse: the array is what it was.
        expect(
            toggleCell(next, cell.row, cell.band, { key: 'x', name: { en: '', ar: '' } }),
        ).toEqual([]);
    });

    it('takes every configuration in a shared cell, because a cell may hold several', () => {
        const stacked = [
            variant({ key: 'a', name: { en: 'Two people', ar: '' } }),
            variant({ key: 'b', name: { en: 'Three people', ar: '' } }),
            variant({ key: 'c', name: { en: 'Four people', ar: '' } }),
        ];
        const drawn = matrixRows([], stacked);
        const bands = matrixBands(stacked, []);

        const next = toggleCell(stacked, drawn[0]!, bands[0]!, {
            key: 'x',
            name: { en: '', ar: '' },
        });
        expect(next).toEqual([]);
    });

    it('summarises the two authored shapes the way the list column reads them', () => {
        const spread = summarisePlanMatrix(spreadPlan());
        expect(spread.variants).toBe(spreadPlan().variants.length);
        // Three bands across two combinations is six cells, of which three are sold.
        expect(spread.bands).toBe(3);
        expect(spread.cells).toBe(6);
        expect(spread.cells).toBeGreaterThan(spread.filled);
        expect(spread.filled).toBe(spreadPlan().variants.length);

        const stackedSummary = summarisePlanMatrix(stackedPlan());
        expect(stackedSummary.variants).toBe(stackedPlan().variants.length);
        // One cell, three configurations in it: the grid is full and the plan is not thin.
        expect(stackedSummary.cells).toBe(1);
        expect(stackedSummary.filled).toBe(1);
    });

    it('refuses a configuration with no name, no servings or a backwards band', () => {
        expect(
            variantErrors([variant({ name: { en: '', ar: '' } })], VARIANT_MESSAGES).get('a'),
        ).toBe('name required');
        expect(
            variantErrors([variant({ mealsPerDay: 0, snacksPerDay: 0 })], VARIANT_MESSAGES).get(
                'a',
            ),
        ).toBe('servings required');
        expect(variantErrors([variant({ energyMin: null })], VARIANT_MESSAGES).get('a')).toBe(
            'energy required',
        );
        expect(
            variantErrors([variant({ energyMin: 1900, energyMax: 1600 })], VARIANT_MESSAGES).get(
                'a',
            ),
        ).toBe('energy reversed');
        expect(variantErrors([variant()], VARIANT_MESSAGES).size).toBe(0);
    });

    it('refuses two combinations sharing one code, because the code is the identity', () => {
        const duplicates = combinationErrors(
            [combination({ key: 'c1' }), combination({ key: 'c2' })],
            COMBINATION_MESSAGES,
        );
        expect(duplicates.get('c1')).toBeUndefined();
        expect(duplicates.get('c2')).toBe('code duplicate');

        expect(
            combinationErrors([combination({ code: '  ' })], COMBINATION_MESSAGES).get('c1'),
        ).toBe('code required');
    });

    it('drops a half-answered configuration rather than sending a fabricated zero', () => {
        expect(variantRequest([variant({ energyMax: null })])).toEqual([]);
        expect(variantRequest([variant()])[0]).toMatchObject({
            energyBand: { min: 1400, max: 1600 },
            mealsPerDay: 3,
            snacksPerDay: 1,
        });
    });
});

describe('durations, as a pure model', () => {
    it('clears the day count when a duration becomes a one-off, and asks for one when it stops', () => {
        expect(withDurationKind(duration({ days: 20 }), 'one_off').days).toBeNull();
        // Switching back does not restore a count: the row is incomplete, not quietly 20 days.
        expect(withDurationKind(duration({ kind: 'one_off', days: null }), 'fixed_days').days).toBe(
            null,
        );
        // The discount is untouched in both directions — how it is measured is not what it earns.
        expect(withDurationKind(duration({ discountPercent: 0 }), 'one_off').discountPercent).toBe(
            0,
        );
    });

    it('is the same rule the contract states, in both directions', () => {
        expect(
            isPlanDurationConsistent({ kind: 'one_off', days: null, discountPercent: null }),
        ).toBe(true);
        expect(isPlanDurationConsistent({ kind: 'one_off', days: 5, discountPercent: null })).toBe(
            false,
        );
        expect(
            isPlanDurationConsistent({ kind: 'fixed_days', days: null, discountPercent: null }),
        ).toBe(false);
        expect(
            isPlanDurationConsistent({ kind: 'fixed_days', days: 0, discountPercent: null }),
        ).toBe(false);
        expect(
            isPlanDurationConsistent({ kind: 'fixed_days', days: 20, discountPercent: null }),
        ).toBe(true);
    });

    it('refuses an inconsistent row, a duplicate option and an impossible discount', () => {
        expect(
            durationErrors([duration({ kind: 'fixed_days', days: null })], DURATION_MESSAGES).get(
                'd1',
            ),
        ).toBe('days required');
        expect(
            durationErrors([duration({ kind: 'one_off', days: 5 })], DURATION_MESSAGES).get('d1'),
        ).toBe('days required');

        const duplicates = durationErrors(
            [duration({ key: 'd1', days: 20 }), duration({ key: 'd2', days: 20 })],
            DURATION_MESSAGES,
        );
        expect(duplicates.get('d1')).toBeUndefined();
        expect(duplicates.get('d2')).toBe('duplicate');

        expect(
            durationErrors([duration({ discountPercent: 140 })], DURATION_MESSAGES).get('d1'),
        ).toBe('discount invalid');
        expect(durationErrors([duration()], DURATION_MESSAGES).size).toBe(0);
    });

    it('carries the 5-, 20-, 40- and 60-day shape the source material needs', () => {
        const request = durationRequest([
            duration({ key: 'a', days: 5 }),
            duration({ key: 'b', days: 20 }),
            duration({ key: 'c', days: 40 }),
            duration({ key: 'd', days: 60 }),
            duration({ key: 'e', kind: 'one_off', days: null }),
        ]);

        expect(request.map((row) => row.days)).toEqual([5, 20, 40, 60, null]);
        expect(request.every((row) => isPlanDurationConsistent(row))).toBe(true);
        expect(summarisePlanDurations(request).dayCounts).toEqual([5, 20, 40, 60]);
    });

    it('keeps an undecided discount undecided, and a zero a zero', () => {
        const request = durationRequest([
            duration({ key: 'a', discountPercent: null }),
            duration({ key: 'b', days: 40, discountPercent: 0 }),
            duration({ key: 'c', days: 60, discountPercent: 15 }),
        ]);

        // The whole point: `null` is "nobody has decided", `0` is "this earns nothing", and a
        // request that turned one into the other would record a decision nobody took.
        expect(request.map((row) => row.discountPercent)).toEqual([null, 0, 15]);
        expect(request[0]?.discountPercent).not.toBe(0);

        const summary = summarisePlanDurations(request);
        expect(summary.undecidedDiscounts).toBe(1);
        expect(summary.total).toBe(3);
    });

    it('drops a fixed-days row with no count rather than sending a day count of nothing', () => {
        expect(durationRequest([duration({ days: null })])).toEqual([]);
        // …and a one-off never carries one, whatever the draft happens to hold.
        expect(durationRequest([duration({ kind: 'one_off', days: 5 })])[0]?.days).toBeNull();
    });
});

describe('price coverage, read from the lists rather than from the plan', () => {
    it('counts a plan’s priceable references and how many of them are decided', () => {
        const plan = spreadPlan();
        const coverage = summarisePlanPrices(plan, pricedVariants(plan));

        // The plan itself plus one reference per configuration.
        expect(coverage.references).toBe(plan.variants.length + 1);
        expect(
            coverage.confirmed + coverage.placeholder + coverage.marketPriced + coverage.unpriced,
        ).toBe(coverage.references);
        // This file prices every configuration and never the plan row itself.
        expect(coverage.confirmed).toBe(plan.variants.length);
        expect(coverage.unpriced).toBe(1);
    });

    it('ignores a confirmed entry with no amount, exactly as the publish gate does', () => {
        const plan = spreadPlan();
        const coverage = summarisePlanPrices({ id: String(plan.id), variants: [] }, [
            priceList([priceEntry(plan, null, { priceStatus: 'confirmed', amountMinor: null })]),
        ]);

        expect(coverage.confirmed).toBe(0);
        expect(coverage.unpriced).toBe(1);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

describe('the plan list', () => {
    /** Everything the list screen reads: the plans themselves, and the lists that price them. */
    function listRepositories(plans: readonly PlanAdmin[]): RepositoryOverrides {
        return {
            kitchenAdmin: {
                listPlans: planListing(() => plans),
                listPriceLists: async () => page(pricedVariants(plans[0] ?? spreadPlan())),
            },
        };
    }

    it('renders skeletons, then the authored rows with their matrix, durations and prices', async () => {
        const spread = spreadPlan();

        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a stub that resolves on a microtask.
        await renderStubScreen(<PlansScreen />, {
            session: kitchenManagerSession(),
            latencyMs: 40,
            repositories: listRepositories([spread, stackedPlan()]),
        });

        await untilVisible('kitchen-plans-loading');
        await untilVisible('kitchen-plans-table');

        const base = `kitchen-plan-${String(spread.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-variants-coverage`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-variants-count`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-durations-days`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-status`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();

        // The price column arrives from the price lists, and says how many prices are real.
        await waitFor(() => {
            expect(screen.getByTestId(`${base}-prices-confirmed`)).toBeTruthy();
        });
        expect(screen.getByTestId(`${base}-prices-confirmed`)).toHaveTextContent(
            new RegExp(String(spread.variants.length)),
        );
    });

    it('states the coverage of the grid rather than only the number of configurations', async () => {
        const spread = spreadPlan();

        await renderStubScreen(<PlansScreen />, {
            session: kitchenManagerSession(),
            repositories: listRepositories([spread]),
        });
        await untilVisible('kitchen-plans-table');

        const summary = summarisePlanMatrix(spread);
        expect(
            screen.getByTestId(`kitchen-plan-${String(spread.id)}-variants-coverage`),
        ).toHaveTextContent(new RegExp(String(summary.cells)));
    });

    it('marks a name that is standing in from the other language', async () => {
        // The reader's own language is empty, so the other one is standing in — and the row says
        // so rather than substituting silently, because the readiness evaluator will refuse to
        // publish the record for exactly this reason.
        const untranslated = spreadPlan({ name: { en: '', ar: 'إعادة توازن' } });

        await renderStubScreen(<PlansScreen />, {
            session: kitchenManagerSession(),
            repositories: listRepositories([untranslated]),
        });
        await untilVisible('kitchen-plans-table');

        expect(
            screen.getByTestId(`kitchen-plan-${String(untranslated.id)}-missing-arabic`),
        ).toBeTruthy();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderStubScreen(<PlansScreen />, {
            session: kitchenManagerSession(),
            repositories: listRepositories([spreadPlan(), stackedPlan()]),
        });
        await untilVisible('kitchen-plans-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-plans-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-plans-empty');
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<PlansScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPlans: () => throwFailure(apiFailure('server', { message: 'Boom.' })),
                    listPriceLists: async () => page([]),
                },
            },
        });

        await untilVisible('kitchen-plans-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        // No repository overrides at all: the gate refuses before the table can ask for anything,
        // so a screen that fetched here would fail loudly with StubNotConfiguredError.
        await renderStubScreen(<PlansScreen />, { session: organisationOwnerSession() });

        await untilVisible('kitchen-plans-forbidden');
        expect(screen.queryByTestId('kitchen-plans-table')).toBeNull();
    });

    it('renders through the lazy route boundary', async () => {
        await renderStubScreen(<KitchenPlansRoute />, {
            session: kitchenManagerSession(),
            repositories: listRepositories([spreadPlan()]),
        });
        await untilVisible('kitchen-plans-table');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The matrix, through the controls
 * ---------------------------------------------------------------------------------------------- */

describe('editing the matrix', () => {
    it('shows a not-found state for an identifier that is not one', async () => {
        await renderStubScreen(<PlanEditScreen plan="not-a-uuid" />, {
            session: kitchenManagerSession(),
            // The record query never runs — the identifier does not parse — but the category
            // derivation and the price coverage are unconditional hooks and still ask.
            repositories: {
                kitchenAdmin: {
                    listPlans: planListing(() => []),
                    listPriceLists: async () => page([]),
                },
            },
        });

        await untilVisible('kitchen-plan-not-found');
    });

    it('draws a cell for every combination and band, and marks the ones that are sold', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-matrix-grid');

        const sold = cellOf(spread.variants[0]!);
        expect(screen.getByTestId(sold)).toBeTruthy();
        expect(screen.getByTestId(`${sold}-control`).props.accessibilityState?.checked).toBe(true);

        // A cell the plan does not sell exists too — that is what makes the matrix a matrix.
        const empty = emptyCells(spread)[0];
        expect(empty).toBeDefined();
        expect(
            screen.getByTestId(`kitchen-plan-matrix-grid-cell-${String(empty)}-control`).props
                .accessibilityState?.checked,
        ).toBe(false);
    });

    it('says how many configurations share a cell, for the shape an import brings', async () => {
        const stacked = stackedPlan();
        const world = planWorld(stacked);

        await renderStubScreen(<PlanEditScreen plan={String(stacked.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-matrix-grid');

        expect(screen.getByTestId(`${cellOf(stacked.variants[0]!)}-count`)).toHaveTextContent(
            new RegExp(String(stacked.variants.length)),
        );
    });

    it('switches an empty cell on, saves it, and the repository holds the new configuration', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        const { repositories } = await renderStubScreen(
            <PlanEditScreen plan={String(spread.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: world.overrides,
            },
        );
        await untilVisible('kitchen-plan-matrix-grid');

        // The first cell in the grid that nothing occupies.
        const target = emptyCells(spread)[0];
        if (target === undefined)
            throw new Error('The authored plan fills every cell of its grid.');

        const cell = `kitchen-plan-matrix-grid-cell-${target}`;
        expect(screen.getByTestId(`${cell}-control`).props.accessibilityState?.checked).toBe(false);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${cell}-control`));
        });
        await waitFor(() => {
            expect(screen.getByTestId(`${cell}-control`).props.accessibilityState?.checked).toBe(
                true,
            );
        });
        // Editing arms the guard, which is the visible half of the unsaved-changes contract.
        expect(screen.getByTestId('kitchen-plan-editor-screen-dirty')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });

        await waitFor(() => {
            expect(world.read().variants).toHaveLength(spread.variants.length + 1);
        });

        // The write carried the version it was based on, rather than trusting the screen's optimism.
        expect(repositories.kitchenAdmin.setPlanVariants).toHaveBeenCalledWith(
            spread.id,
            expect.objectContaining({ lockVersion: spread.meta.lockVersion }),
        );

        // The server minted an identifier for the configuration the cell created.
        const added = world.read().variants[world.read().variants.length - 1]!;
        expect(String(added.id)).not.toBe('');
        expect(`${combinationKey(added)}-${energyBandKey(added.energyBand)}`).toBe(target);
    });

    /**
     * Identity survives a second save, which is what stops a saved configuration losing its price.
     *
     * A configuration a cell created goes up with `id: null` and comes back with the identifier the
     * server minted. `setPlanVariants` is a whole-set replacement, so a row still carrying `null` on
     * the *next* save is minted a **fresh identifier** — the count would look right and every price
     * list entry pointing at the old one would silently be orphaned, because a plan variant is
     * priced by `variantId` (`CatalogueItemRef`).
     *
     * The whole-record rebuild that would otherwise refresh the drafts is deliberately skipped while
     * another section is still dirty — it has to be, or it would discard unsaved work — so this
     * drives exactly that state: a dirty duration row, a saved cell, and a second save.
     */
    it('keeps a saved configuration’s identifier when another section is still unsaved', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-matrix-grid');

        const empty = screen
            .getAllByTestId(/^kitchen-plan-matrix-grid-cell-.*-control$/, { exact: false })
            .find((node) => node.props.accessibilityState?.checked === false);
        if (empty === undefined) throw new Error('The authored plan fills every cell of its grid.');

        await act(async () => {
            fireEvent.press(empty);
        });
        // A second section left dirty is what suppresses the whole-record rebuild.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-durations-add'));
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });
        await waitFor(() => {
            expect(world.read().variants).toHaveLength(spread.variants.length + 1);
        });
        const once = world.read();

        // The second save is awaited by its *lock version*, not by its toast: the first toast is
        // still on screen, and waiting for one would assert nothing about the write.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });
        await waitFor(() => {
            expect(world.read().meta.lockVersion).toBeGreaterThan(once.meta.lockVersion);
        });

        const twice = world.read();
        expect(twice.variants).toHaveLength(spread.variants.length + 1);
        // The identifiers are the ones the first save minted, not a fresh set.
        expect(twice.variants.map((row) => String(row.id))).toEqual(
            once.variants.map((row) => String(row.id)),
        );
    });

    it('switches a sold cell off, saves it, and the configuration is gone', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-matrix-grid');

        const first = spread.variants[0]!;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${cellOf(first)}-control`));
        });
        // A cell can hold several configurations, so the removal is undoable rather than final.
        await untilVisible('kitchen-plan-matrix-undo');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });

        await waitFor(() => {
            expect(world.read().variants.some((row) => row.id === first.id)).toBe(false);
        });
        expect(world.read().variants).toHaveLength(spread.variants.length - 1);
    });

    it('puts an undone cell back rather than losing the configurations that were in it', async () => {
        const stacked = stackedPlan();
        const world = planWorld(stacked);

        await renderStubScreen(<PlanEditScreen plan={String(stacked.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-matrix-grid');

        const cell = cellOf(stacked.variants[0]!);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${cell}-control`));
        });
        expect(screen.getByTestId('kitchen-plan-matrix-removed')).toHaveTextContent(
            new RegExp(String(stacked.variants.length)),
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-matrix-undo'));
        });
        await waitFor(() => {
            expect(screen.getByTestId(`${cell}-control`).props.accessibilityState?.checked).toBe(
                true,
            );
        });
    });

    it('moves a configuration with an announcement, removes one and undoes it in place', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-variants');

        const firstRow = firstVariantRow(spread);
        const secondRow = `kitchen-plan-variants-row-seed-variant-1-${String(
            spread.variants[1]!.id,
        )}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${secondRow}-move-up`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-plan-variants-announcer')).toHaveTextContent(/1/);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${firstRow}-remove`));
        });
        expect(screen.queryByTestId(firstRow)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-removed-bar-undo'));
        });
        await untilVisible(firstRow);
    });

    it('blocks the save while a configuration has no name', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-variants');

        const row = firstVariantRow(spread);
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-name-en-input`), '');
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-plan-variants-save').props.accessibilityState?.disabled,
            ).toBe(true);
        });
        expect(screen.getByTestId(`${row}-error`)).toBeTruthy();
    });

    it('offers reload-or-keep when somebody else has moved the plan on', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-matrix-grid');

        // Another writer saves first: the record keeps one configuration and moves its version on,
        // which is exactly the state the editor's `lockVersion` is now stale against.
        world.write({
            ...spread,
            meta: { ...spread.meta, lockVersion: spread.meta.lockVersion + 1 },
            variants: spread.variants.slice(0, 1),
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${cellOf(spread.variants[0]!)}-control`));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });

        await untilVisible('kitchen-plan-editor-screen-conflict-dialog');

        // The other writer's version stands: nothing was overwritten behind its back.
        expect(world.read().variants).toHaveLength(1);
    });

    it('asks before throwing away an unsaved change', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-durations-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-durations-add'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-editor-screen-back'));
        });

        await untilVisible('kitchen-plan-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalledWith('/kitchen/plans');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-editor-screen-unsaved-discard'));
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/plans');
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * Durations, through the controls
 * ---------------------------------------------------------------------------------------------- */

describe('editing the durations', () => {
    it('takes the day field away when a duration becomes a one-off, and blocks the save when it returns empty', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-duration-rows');

        const row = firstDurationRow(spread);
        expect(screen.getByTestId(`${row}-days-input`).props.value).not.toBe('');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-kind-one_off`));
        });

        // Removed rather than greyed — the K1.5 pattern, for the same two reasons.
        await waitFor(() => {
            expect(screen.queryByTestId(`${row}-days-input`)).toBeNull();
        });
        expect(screen.getByTestId(`${row}-days-absent`)).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${row}-kind-fixed_days`));
        });
        await waitFor(() => {
            expect(screen.getByTestId(`${row}-days-input`).props.value).toBe('');
        });
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-plan-durations-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-days-input`), '20');
        });
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-plan-durations-save').props.accessibilityState
                    ?.disabled,
            ).toBe(false);
        });
    });

    it('saves a 20-day commitment, which the weekly union could never have expressed', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-durations-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-durations-add'));
        });
        const added = 'kitchen-plan-duration-rows-row-duration-1';
        await untilVisible(added);

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-days-input`), '20');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-durations-save'));
        });

        await waitFor(() => {
            expect(
                world.read().durations.some((row) => row.kind === 'fixed_days' && row.days === 20),
            ).toBe(true);
        });

        // …and it arrived with an undecided discount rather than a fabricated zero.
        const twenty = world.read().durations.find((row) => row.days === 20)!;
        expect(twenty.discountPercent).toBeNull();
    });

    it('keeps “not set” and “no discount” apart, in the row and on the wire', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-duration-rows');

        const row = firstDurationRow(spread);
        // The shortest commitment earns nothing, which is a decision rather than a blank.
        expect(spread.durations[0]!.discountPercent).toBe(0);
        expect(screen.getByTestId(`${row}-discount-state`)).toHaveTextContent(/decision/i);
        expect(screen.getByTestId(`${row}-discount-input`).props.value).toBe('0');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-discount-input`), '');
        });
        await waitFor(() => {
            expect(screen.getByTestId(`${row}-discount-state`)).toHaveTextContent(/unknown/i);
        });
        expect(screen.getByTestId(`${row}-badge`)).toHaveTextContent(/not set/i);

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-durations-save'));
        });

        await waitFor(() => {
            expect(world.read().durations[0]?.discountPercent).toBeNull();
        });
        expect(world.read().durations[0]?.discountPercent).not.toBe(0);
        // The rows that carried a real percentage are untouched.
        expect(world.read().durations[1]?.discountPercent).toBe(
            spread.durations[1]?.discountPercent,
        );
    });

    it('refuses a duplicate duration rather than offering one option twice', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-durations-add');

        const existing = spread.durations[0]!.days!;

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-durations-add'));
        });
        const added = 'kitchen-plan-duration-rows-row-duration-1';
        await untilVisible(added);

        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-days-input`), String(existing));
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-plan-durations-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });
    });

    it('moves a duration with an announcement, removes one and undoes it in place', async () => {
        const spread = spreadPlan();
        const world = planWorld(spread, pricedVariants(spread));

        await renderStubScreen(<PlanEditScreen plan={String(spread.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-duration-rows');

        const first = firstDurationRow(spread);
        const second = spread.durations[1]!;
        const secondRow = `kitchen-plan-duration-rows-row-seed-duration-1-${second.kind}-${String(
            second.days ?? 'x',
        )}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${secondRow}-move-up`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-plan-duration-rows-announcer')).toHaveTextContent(
                /1/,
            );
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${first}-remove`));
        });
        expect(screen.queryByTestId(first)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-duration-rows-removed-bar-undo'));
        });
        await untilVisible(first);
    });
});

/* ------------------------------------------------------------------------------------------------
 * Publication
 * ---------------------------------------------------------------------------------------------- */

describe('publishing a plan', () => {
    it('creates a plan as a draft rather than publishing one on sight', async () => {
        let created: PlanAdmin | null = null;

        const { repositories } = await renderStubScreen(<PlanEditScreen plan="new" />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listPlans: planListing(() => (created === null ? [] : [created])),
                    listPriceLists: async () => page([]),
                    createPlan: async (request) => {
                        created = {
                            id: planIdentifier(9),
                            meta: meta({ status: 'draft', lockVersion: 1 }),
                            name: request.name,
                            summary: request.summary,
                            description: request.description,
                            kitchenId: KITCHEN_ID,
                            categorySlugs: request.categorySlugs ?? [],
                            dietClassifications: request.dietClassifications ?? [],
                            variants: [],
                            durations: [],
                            combinations: [],
                            changeCutOffHours: request.changeCutOffHours ?? 24,
                            deliveryWeekdays: request.deliveryWeekdays ?? [1, 2, 3, 4, 5],
                        };
                        return created;
                    },
                },
            },
        });
        await untilVisible('kitchen-plan-details');

        // Nothing below the details is offered until the record exists — there is no identifier to
        // hang `setPlanVariants` on, and a matrix nobody could save would be a lie.
        expect(screen.getByTestId('kitchen-plan-matrix-unavailable')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-plan-publish')).toBeNull();

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-plan-name-en-input'), 'Autumn reset');
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-plan-name-ar-input'),
                'إعادة ضبط الخريف',
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-editor-screen-save'));
        });

        await untilVisible('kitchen-plan-created-toast');

        expect(repositories.kitchenAdmin.createPlan).toHaveBeenCalledTimes(1);
        expect(repositories.kitchenAdmin.createPlan).toHaveBeenCalledWith(
            expect.objectContaining({
                name: { en: 'Autumn reset', ar: 'إعادة ضبط الخريف' },
            }),
        );
        /*
         * "Created as a draft" is a claim about the *request*: the create carries no lifecycle
         * field at all — `CreatePlanRequest` has none — and this screen never offers publication
         * until the record exists, so nothing here could have published one on sight.
         */
        expect(repositories.kitchenAdmin.publishPlan).not.toHaveBeenCalled();
        expect(screen.queryByTestId('kitchen-plan-publish')).toBeNull();
        // The create landed on the record's own address.
        expect(routerMock.__replace).toHaveBeenCalledWith(
            `/kitchen/plans/${String(planIdentifier(9))}`,
        );
    });

    it('lists every reason a half-built plan cannot be published', async () => {
        // Withdrawn, emptied of configurations and emptied of durations, and priced nowhere: the
        // state an import leaves a plan in before anybody has finished it.
        const halfBuilt = spreadPlan({
            meta: meta({ status: 'retired' }),
            variants: [],
            durations: [],
        });
        const world = planWorld(halfBuilt, [priceList([])]);

        await renderStubScreen(<PlanEditScreen plan={String(halfBuilt.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-publish');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish'));
        });
        await untilVisible('kitchen-plan-publish-dialog');

        expect(screen.getByTestId('kitchen-plan-publish-blocked')).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-plan-publish-confirm').props.accessibilityState?.disabled,
        ).toBe(true);
        // Sells nothing, commits to nothing — and, once the price lists have answered, carries no
        // confirmed price either, which is the refusal the server would otherwise spring later.
        expect(screen.getByTestId('kitchen-plan-publish-blocked')).toHaveTextContent(/sells/i);
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-plan-publish-blocked')).toHaveTextContent(
                /confirmed price/i,
            );
        });
    });

    it('publishes a plan whose configurations, durations and prices are all real', async () => {
        // Withdrawn first — the state a person publishing from this screen is actually in.
        const ready = spreadPlan({ meta: meta({ status: 'retired' }) });
        const world = planWorld(ready, pricedVariants(ready));

        await renderStubScreen(<PlanEditScreen plan={String(ready.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-publish');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish'));
        });
        await untilVisible('kitchen-plan-publish-dialog');

        expect(screen.getByTestId('kitchen-plan-publish-consequence')).toHaveTextContent(
            new RegExp(String(ready.variants.length)),
        );
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-plan-publish-blocked')).toBeNull();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish-confirm'));
        });

        await waitFor(() => {
            expect(world.read().meta.status).toBe('published');
        });
        await untilVisible('kitchen-plan-published');
        // A published plan offers withdrawal instead of a second publish.
        expect(screen.queryByTestId('kitchen-plan-publish')).toBeNull();
        expect(screen.getByTestId('kitchen-plan-retire')).toBeTruthy();
    });

    it('renders the server’s refusal when no confirmed price exists', async () => {
        const ready = spreadPlan({ meta: meta({ status: 'retired' }) });
        const world = planWorld(ready, pricedVariants(ready));

        await renderStubScreen(<PlanEditScreen plan={String(ready.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...world.overrides.kitchenAdmin,
                    publishPlan: () =>
                        throwFailure(
                            validationFailure(
                                {
                                    price: [
                                        'No confirmed price exists for this plan, so publishing ' +
                                            'it would advertise a placeholder.',
                                    ],
                                },
                                { message: 'Refused.' },
                            ),
                        ),
                },
            },
        });
        await untilVisible('kitchen-plan-publish');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish'));
        });
        await untilVisible('kitchen-plan-publish-dialog');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish-confirm'));
        });

        await untilVisible('kitchen-plan-publish-refused-price');
    });

    it('renders the quarantine refusal distinctly from every other one', async () => {
        const ready = spreadPlan({ meta: meta({ status: 'retired' }) });
        const world = planWorld(ready, pricedVariants(ready));

        await renderStubScreen(<PlanEditScreen plan={String(ready.id)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    ...world.overrides.kitchenAdmin,
                    publishPlan: () =>
                        throwFailure(
                            validationFailure(
                                { status: ['This plan is quarantined for review.'] },
                                { message: 'Refused.' },
                            ),
                        ),
                },
            },
        });
        await untilVisible('kitchen-plan-publish');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish'));
        });
        await untilVisible('kitchen-plan-publish-dialog');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish-confirm'));
        });

        await untilVisible('kitchen-plan-publish-refused-quarantine');
    });

    it('withdraws a published plan behind a confirmation that says nothing is deleted', async () => {
        const published = spreadPlan({ meta: meta({ status: 'published' }) });
        const world = planWorld(published, pricedVariants(published));

        await renderStubScreen(<PlanEditScreen plan={String(published.id)} />, {
            session: kitchenManagerSession(),
            repositories: world.overrides,
        });
        await untilVisible('kitchen-plan-retire');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-retire'));
        });
        await untilVisible('kitchen-plan-retire-dialog');
        expect(screen.getByTestId('kitchen-plan-retire-consequence')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-retire-confirm'));
        });

        await waitFor(() => {
            expect(world.read().meta.status).toBe('retired');
        });
        await untilVisible('kitchen-plan-retired');
    });
});
