import { createMemoryTokenStore } from '@healthy360/api-client';
import {
    apiFailure,
    isPlanDurationConsistent,
    throwFailure,
    validationFailure,
} from '@healthy360/api-client/contracts';
import type { PlanAdmin } from '@healthy360/api-client/contracts';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import KitchenPlansRoute from '../../../app/kitchen/plans/index.tsx';
import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import {
    combinationKey,
    energyBandKey,
    summarisePlanDurations,
    summarisePlanMatrix,
    summarisePlanPrices,
} from './format.ts';
import {
    combinationErrors,
    durationErrors,
    durationRequest,
    matrixBands,
    matrixRows,
    toggleCell,
    variantErrors,
    variantRequest,
    withDurationKind,
} from './plan-matrix.ts';
import type { CombinationDraft, DurationDraft, VariantDraft } from './plan-matrix.ts';
import { PlanEditScreen } from './screens/plan-edit-screen.tsx';
import { PlansScreen } from './screens/plans-screen.tsx';

/**
 * The plan half of the kitchen workspace, against the real mock repositories (K1.6).
 *
 * Nothing here stubs a hook. Six things this file exists to prove:
 *
 * 1. **A cell of the matrix is a variant, and toggling one is a round trip.** Switching an empty
 *    cell on and saving puts a configuration in the repository at that combination and that band;
 *    switching it off and saving takes it away. Variant existence *is* the availability matrix
 *    (appendix D), so this is the whole slice in one assertion.
 * 2. **The two shapes both work.** The seeded catalogue holds a plan whose three variants occupy
 *    three different cells and a plan whose three variants share one, and the summary and the cell
 *    both say so. The workbook structure the importer will bring is the second shape.
 * 3. **The `CHECK` cannot be broken through the interface.** Switching a duration to `one_off`
 *    clears its day count and takes the field away; switching back leaves the row incomplete and
 *    blocks the save until a positive count is typed.
 * 4. **A `null` discount survives, and is never a `0`.** The two are different answers — undecided
 *    versus "this commitment earns nothing" — and the row, the request and the repository all keep
 *    them apart.
 * 5. **Publishing states its refusals before they happen.** A plan with no confirmed price is
 *    refused by the store, and the dialog says so from the same price lists the store reads.
 * 6. **The row machinery keeps its promises here too** — move with an announcement, remove, undo to
 *    the row's own position — and the route-level split still renders.
 */

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;
const CLINIC_OWNER = MOCK_SCENARIOS['single-org-owner'].primaryEmail;

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

interface Harness {
    readonly repositories: MockRepositories;
}

/** Signs in, applies the organisation context, lets a test arrange the world, then renders. */
async function renderKitchen(
    node: ReactNode,
    options: {
        readonly email?: string;
        readonly organisationSlug?: string;
        readonly latencyMs?: number;
        readonly prepare?: (repositories: MockRepositories) => void;
    } = {},
): Promise<Harness> {
    const email = options.email ?? KITCHEN_MANAGER;
    const slug = options.organisationSlug ?? 'verdant-kitchen';

    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: email === CLINIC_OWNER ? 'single-org-owner' : 'multi-org-dietitian',
        latencyMs: options.latencyMs ?? 1,
        tokenStore,
    });
    await repositories.auth.login({ email, password: 'password' });

    const me = await repositories.session.me();
    const membership = me.memberships.find(
        (candidate) => candidate.organisation.slug === slug && candidate.status === 'active',
    );
    if (membership === undefined) throw new Error(`No active membership in "${slug}".`);
    await repositories.context.setContext({ organisationId: membership.organisation.id });

    options.prepare?.(repositories);

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {node}
        </AppProviders>,
    );

    return { repositories };
}

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

const scratch = createMockRepositories({ scenario: 'multi-org-dietitian', latencyMs: 0 });

/** A seeded plan whose three configurations sit in three different cells — the common shape. */
let spreadPlan: PlanAdmin;
/** A seeded plan whose configurations share one cell — the household-size shape an import brings. */
let stackedPlan: PlanAdmin;

beforeAll(async () => {
    const page = await scratch.kitchenAdmin.listPlans({ limit: 100 });

    const spread = page.items.find(
        (row) =>
            new Set(row.variants.map((variant) => energyBandKey(variant.energyBand))).size ===
            row.variants.length,
    );
    if (spread === undefined) throw new Error('The seed carries no plan with distinct bands.');
    spreadPlan = spread;

    const stacked = page.items.find(
        (row) =>
            row.variants.length > 1 &&
            new Set(row.variants.map((variant) => energyBandKey(variant.energyBand))).size === 1 &&
            new Set(row.variants.map((variant) => combinationKey(variant))).size === 1,
    );
    if (stacked === undefined) {
        throw new Error('The seed carries no plan whose configurations share a cell.');
    }
    stackedPlan = stacked;
});

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

    it('summarises the two seeded shapes the way the list column reads them', () => {
        const spread = summarisePlanMatrix(spreadPlan);
        expect(spread.variants).toBe(spreadPlan.variants.length);
        // Three bands across two combinations is six cells, of which three are sold.
        expect(spread.cells).toBeGreaterThan(spread.filled);
        expect(spread.filled).toBe(spreadPlan.variants.length);

        const stackedSummary = summarisePlanMatrix(stackedPlan);
        expect(stackedSummary.variants).toBe(stackedPlan.variants.length);
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
    it('counts a plan’s priceable references and how many of them are decided', async () => {
        const lists = await scratch.kitchenAdmin.listPriceLists({ limit: 100 });
        const coverage = summarisePlanPrices(spreadPlan, lists.items);

        // The plan itself plus one reference per configuration.
        expect(coverage.references).toBe(spreadPlan.variants.length + 1);
        expect(
            coverage.confirmed + coverage.placeholder + coverage.marketPriced + coverage.unpriced,
        ).toBe(coverage.references);
        // The seed prices every configuration and never the plan row itself.
        expect(coverage.confirmed).toBe(spreadPlan.variants.length);
        expect(coverage.unpriced).toBe(1);
    });

    it('ignores a confirmed entry with no amount, exactly as the publish gate does', () => {
        const coverage = summarisePlanPrices({ id: String(spreadPlan.id), variants: [] }, [
            {
                entries: [
                    {
                        item: { kind: 'plan', planId: spreadPlan.id, variantId: null },
                        priceStatus: 'confirmed',
                        amountMinor: null,
                        effectiveFrom: '2026-07-27',
                        effectiveUntil: null,
                        note: null,
                    },
                ],
            },
        ]);
        expect(coverage.confirmed).toBe(0);
        expect(coverage.unpriced).toBe(1);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

describe('the plan list', () => {
    it('renders skeletons, then the seeded rows with their matrix, durations and prices', async () => {
        await renderKitchen(<PlansScreen />, { latencyMs: 40 });

        await untilVisible('kitchen-plans-loading');
        await untilVisible('kitchen-plans-table');

        const base = `kitchen-plan-${String(spreadPlan.id)}`;
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
            new RegExp(String(spreadPlan.variants.length)),
        );
    });

    it('states the coverage of the grid rather than only the number of configurations', async () => {
        await renderKitchen(<PlansScreen />);
        await untilVisible('kitchen-plans-table');

        const summary = summarisePlanMatrix(spreadPlan);
        expect(
            screen.getByTestId(`kitchen-plan-${String(spreadPlan.id)}-variants-coverage`),
        ).toHaveTextContent(new RegExp(String(summary.cells)));
    });

    it('marks a name that is standing in from the other language', async () => {
        await renderKitchen(<PlansScreen />, {
            prepare: (repositories) => {
                const held = repositories.prototypeStore.kitchenCatalogue.getPlan(spreadPlan.id);
                repositories.prototypeStore.kitchenCatalogue.updatePlan(spreadPlan.id, {
                    lockVersion: held.meta.lockVersion,
                    name: { en: '', ar: held.name.ar },
                });
            },
        });
        await untilVisible('kitchen-plans-table');

        // The reader's own language is empty, so the other one is standing in — and the row says
        // so rather than substituting silently, because the readiness evaluator will refuse to
        // publish the record for exactly this reason.
        expect(
            screen.getByTestId(`kitchen-plan-${String(spreadPlan.id)}-missing-arabic`),
        ).toBeTruthy();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderKitchen(<PlansScreen />);
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
        await renderKitchen(<PlansScreen />, {
            prepare: (repositories) => {
                const failing = repositories.kitchenAdmin as unknown as {
                    listPlans: () => Promise<never>;
                };
                failing.listPlans = () =>
                    Promise.reject(throwFailure(apiFailure('server', { message: 'Boom.' })));
            },
        });

        await untilVisible('kitchen-plans-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        await renderKitchen(<PlansScreen />, {
            email: CLINIC_OWNER,
            organisationSlug: 'cedar-clinic',
        });

        await untilVisible('kitchen-plans-forbidden');
    });

    it('renders through the lazy route boundary', async () => {
        await renderKitchen(<KitchenPlansRoute />);
        await untilVisible('kitchen-plans-table');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The matrix, through the controls
 * ---------------------------------------------------------------------------------------------- */

describe('editing the matrix', () => {
    it('shows a not-found state for an identifier that is not one', async () => {
        await renderKitchen(<PlanEditScreen plan="not-a-uuid" />);
        await untilVisible('kitchen-plan-not-found');
    });

    it('draws a cell for every combination and band, and marks the ones that are sold', async () => {
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />);
        await untilVisible('kitchen-plan-matrix-grid');

        const first = spreadPlan.variants[0]!;
        const sold = `kitchen-plan-matrix-grid-cell-${combinationKey(first)}-${energyBandKey(
            first.energyBand,
        )}`;
        expect(screen.getByTestId(sold)).toBeTruthy();
        expect(screen.getByTestId(`${sold}-control`).props.accessibilityState?.checked).toBe(true);

        // A cell the plan does not sell exists too — that is what makes the matrix a matrix.
        const other = spreadPlan.variants[1]!;
        const empty = `kitchen-plan-matrix-grid-cell-${combinationKey(first)}-${energyBandKey(
            other.energyBand,
        )}`;
        if (combinationKey(first) !== combinationKey(other)) {
            expect(screen.getByTestId(empty)).toBeTruthy();
        }
    });

    it('says how many configurations share a cell, for the shape an import brings', async () => {
        await renderKitchen(<PlanEditScreen plan={String(stackedPlan.id)} />);
        await untilVisible('kitchen-plan-matrix-grid');

        const first = stackedPlan.variants[0]!;
        const cell = `kitchen-plan-matrix-grid-cell-${combinationKey(first)}-${energyBandKey(
            first.energyBand,
        )}`;
        expect(screen.getByTestId(`${cell}-count`)).toHaveTextContent(
            new RegExp(String(stackedPlan.variants.length)),
        );
    });

    it('switches an empty cell on, saves it, and the repository holds the new configuration', async () => {
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
        );
        await untilVisible('kitchen-plan-matrix-grid');

        const rows = matrixRows(
            spreadPlan.combinations.map((entry, index) => ({
                key: `c${String(index)}`,
                code: entry.code,
                label: entry.label,
                mealsPerDay: entry.mealsPerDay,
                snacksPerDay: entry.snacksPerDay,
                isAvailable: entry.isAvailable,
            })),
            spreadPlan.variants.map((entry, index) => ({
                key: `v${String(index)}`,
                id: entry.id,
                name: entry.name,
                mealsPerDay: entry.mealsPerDay,
                snacksPerDay: entry.snacksPerDay,
                energyMin: entry.energyBand.min,
                energyMax: entry.energyBand.max,
                isActive: entry.isActive,
            })),
        );
        const bands = matrixBands(
            spreadPlan.variants.map((entry, index) => ({
                key: `v${String(index)}`,
                id: entry.id,
                name: entry.name,
                mealsPerDay: entry.mealsPerDay,
                snacksPerDay: entry.snacksPerDay,
                energyMin: entry.energyBand.min,
                energyMax: entry.energyBand.max,
                isActive: entry.isActive,
            })),
            [],
        );

        // The first cell in the grid that nothing occupies.
        let target: string | null = null;
        for (const row of rows) {
            for (const band of bands) {
                const occupied = spreadPlan.variants.some(
                    (entry) =>
                        combinationKey(entry) === row.key &&
                        energyBandKey(entry.energyBand) === band.key,
                );
                if (!occupied && target === null) target = `${row.key}-${band.key}`;
            }
        }
        if (target === null) throw new Error('The seeded plan fills every cell of its grid.');

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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(after.variants).toHaveLength(spreadPlan.variants.length + 1);
        });

        // The server minted an identifier for the configuration the cell created.
        const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
        const added = after.variants[after.variants.length - 1]!;
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
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
        );
        await untilVisible('kitchen-plan-matrix-grid');

        const empty = screen
            .getAllByTestId(/^kitchen-plan-matrix-grid-cell-.*-control$/, { exact: false })
            .find((node) => node.props.accessibilityState?.checked === false);
        if (empty === undefined) throw new Error('The seeded plan fills every cell of its grid.');

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
        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(after.variants).toHaveLength(spreadPlan.variants.length + 1);
        });
        const once = await repositories.kitchenAdmin.getPlan(spreadPlan.id);

        // The second save is awaited by its *lock version*, not by its toast: the first toast is
        // still on screen, and waiting for one would assert nothing about the write.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });
        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(after.meta.lockVersion).toBeGreaterThan(once.meta.lockVersion);
        });

        const twice = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
        expect(twice.variants).toHaveLength(spreadPlan.variants.length + 1);
        // The identifiers are the ones the first save minted, not a fresh set.
        expect(twice.variants.map((row) => String(row.id))).toEqual(
            once.variants.map((row) => String(row.id)),
        );
    });

    it('switches a sold cell off, saves it, and the configuration is gone', async () => {
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
        );
        await untilVisible('kitchen-plan-matrix-grid');

        const first = spreadPlan.variants[0]!;
        const cell = `kitchen-plan-matrix-grid-cell-${combinationKey(first)}-${energyBandKey(
            first.energyBand,
        )}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${cell}-control`));
        });
        // A cell can hold several configurations, so the removal is undoable rather than final.
        await untilVisible('kitchen-plan-matrix-undo');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(after.variants.some((row) => row.id === first.id)).toBe(false);
        });
    });

    it('puts an undone cell back rather than losing the configurations that were in it', async () => {
        await renderKitchen(<PlanEditScreen plan={String(stackedPlan.id)} />);
        await untilVisible('kitchen-plan-matrix-grid');

        const first = stackedPlan.variants[0]!;
        const cell = `kitchen-plan-matrix-grid-cell-${combinationKey(first)}-${energyBandKey(
            first.energyBand,
        )}`;

        await act(async () => {
            fireEvent.press(screen.getByTestId(`${cell}-control`));
        });
        expect(screen.getByTestId('kitchen-plan-matrix-removed')).toHaveTextContent(
            new RegExp(String(stackedPlan.variants.length)),
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
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />);
        await untilVisible('kitchen-plan-variants');

        const firstRow = `kitchen-plan-variants-row-seed-variant-0-${String(
            spreadPlan.variants[0]!.id,
        )}`;
        const secondRow = `kitchen-plan-variants-row-seed-variant-1-${String(
            spreadPlan.variants[1]!.id,
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
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />);
        await untilVisible('kitchen-plan-variants');

        const row = `kitchen-plan-variants-row-seed-variant-0-${String(
            spreadPlan.variants[0]!.id,
        )}`;
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
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
        );
        await untilVisible('kitchen-plan-matrix-grid');

        const held = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
        repositories.prototypeStore.kitchenCatalogue.setPlanVariants(spreadPlan.id, {
            lockVersion: held.meta.lockVersion,
            variants: held.variants.slice(0, 1).map((row) => ({
                id: row.id,
                name: row.name,
                energyBand: row.energyBand,
                mealsPerDay: row.mealsPerDay,
                snacksPerDay: row.snacksPerDay,
                isActive: row.isActive,
            })),
        });

        const first = spreadPlan.variants[0]!;
        const cell = `kitchen-plan-matrix-grid-cell-${combinationKey(first)}-${energyBandKey(
            first.energyBand,
        )}`;
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${cell}-control`));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-variants-save'));
        });

        await untilVisible('kitchen-plan-editor-screen-conflict-dialog');

        // The other writer's version stands: nothing was overwritten behind its back.
        const untouched = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
        expect(untouched.variants).toHaveLength(1);
    });

    it('asks before throwing away an unsaved change', async () => {
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />);
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
    /** The test id prefix of the plan's first seeded duration row. */
    function firstDurationRow(plan: PlanAdmin): string {
        const first = plan.durations[0]!;
        return `kitchen-plan-duration-rows-row-seed-duration-0-${first.kind}-${String(
            first.days ?? 'x',
        )}`;
    }

    it('takes the day field away when a duration becomes a one-off, and blocks the save when it returns empty', async () => {
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />);
        await untilVisible('kitchen-plan-duration-rows');

        const row = firstDurationRow(spreadPlan);
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
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
        );
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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(
                after.durations.some((row) => row.kind === 'fixed_days' && row.days === 20),
            ).toBe(true);
        });

        // …and it arrived with an undecided discount rather than a fabricated zero.
        const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
        const twenty = after.durations.find((row) => row.days === 20)!;
        expect(twenty.discountPercent).toBeNull();
    });

    it('keeps “not set” and “no discount” apart, in the row and on the wire', async () => {
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
        );
        await untilVisible('kitchen-plan-duration-rows');

        const row = firstDurationRow(spreadPlan);
        const seeded = spreadPlan.durations[0]!;
        // The seed's shortest commitment earns nothing, which is a decision rather than a blank.
        expect(seeded.discountPercent).toBe(0);
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

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(after.durations[0]?.discountPercent).toBeNull();
        });
        const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
        expect(after.durations[0]?.discountPercent).not.toBe(0);
        // The rows that carried a real percentage are untouched.
        expect(after.durations[1]?.discountPercent).toBe(spreadPlan.durations[1]?.discountPercent);
    });

    it('refuses a duplicate duration rather than offering one option twice', async () => {
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />);
        await untilVisible('kitchen-plan-durations-add');

        const existing = spreadPlan.durations[0]!.days!;

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
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />);
        await untilVisible('kitchen-plan-duration-rows');

        const first = firstDurationRow(spreadPlan);
        const second = spreadPlan.durations[1]!;
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
        const { repositories } = await renderKitchen(<PlanEditScreen plan="new" />);
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

        const page = await repositories.kitchenAdmin.listPlans({ limit: 100 });
        const created = page.items.find((row) => row.name.en === 'Autumn reset');
        expect(created?.meta.status).toBe('draft');
        expect(created?.variants).toEqual([]);
        expect(created?.durations).toEqual([]);
        // The create landed on the record's own address.
        expect(routerMock.__replace).toHaveBeenCalledWith(
            `/kitchen/plans/${String(created?.id ?? '')}`,
        );
    });

    it('lists every reason a half-built plan cannot be published', async () => {
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />, {
            prepare: (repos) => {
                // Withdrawn, emptied of configurations and emptied of durations: the state an
                // import leaves a plan in before anybody has finished it.
                const catalogue = repos.prototypeStore.kitchenCatalogue;
                catalogue.retirePlan(spreadPlan.id, {
                    lockVersion: catalogue.getPlan(spreadPlan.id).meta.lockVersion,
                });
                catalogue.setPlanVariants(spreadPlan.id, {
                    lockVersion: catalogue.getPlan(spreadPlan.id).meta.lockVersion,
                    variants: [],
                });
                catalogue.setPlanDurations(spreadPlan.id, {
                    lockVersion: catalogue.getPlan(spreadPlan.id).meta.lockVersion,
                    durations: [],
                });
            },
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
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
            {
                prepare: (repos) => {
                    // The seeded plans are published, so this one is withdrawn first — the state a
                    // person publishing from this screen is actually in.
                    const held = repos.prototypeStore.kitchenCatalogue.getPlan(spreadPlan.id);
                    repos.prototypeStore.kitchenCatalogue.retirePlan(spreadPlan.id, {
                        lockVersion: held.meta.lockVersion,
                    });
                },
            },
        );
        await untilVisible('kitchen-plan-publish');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish'));
        });
        await untilVisible('kitchen-plan-publish-dialog');

        expect(screen.getByTestId('kitchen-plan-publish-consequence')).toHaveTextContent(
            new RegExp(String(spreadPlan.variants.length)),
        );
        await waitFor(() => {
            expect(screen.queryByTestId('kitchen-plan-publish-blocked')).toBeNull();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-publish-confirm'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(after.meta.status).toBe('published');
        });
        await untilVisible('kitchen-plan-published');
        // A published plan offers withdrawal instead of a second publish.
        expect(screen.queryByTestId('kitchen-plan-publish')).toBeNull();
        expect(screen.getByTestId('kitchen-plan-retire')).toBeTruthy();
    });

    it('renders the server’s refusal when no confirmed price exists', async () => {
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />, {
            prepare: (repositories) => {
                const held = repositories.prototypeStore.kitchenCatalogue.getPlan(spreadPlan.id);
                repositories.prototypeStore.kitchenCatalogue.retirePlan(spreadPlan.id, {
                    lockVersion: held.meta.lockVersion,
                });
                const failing = repositories.kitchenAdmin as unknown as {
                    publishPlan: () => Promise<never>;
                };
                failing.publishPlan = () =>
                    Promise.reject(
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
                    );
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
        await renderKitchen(<PlanEditScreen plan={String(spreadPlan.id)} />, {
            prepare: (repositories) => {
                const held = repositories.prototypeStore.kitchenCatalogue.getPlan(spreadPlan.id);
                repositories.prototypeStore.kitchenCatalogue.retirePlan(spreadPlan.id, {
                    lockVersion: held.meta.lockVersion,
                });
                const failing = repositories.kitchenAdmin as unknown as {
                    publishPlan: () => Promise<never>;
                };
                failing.publishPlan = () =>
                    Promise.reject(
                        throwFailure(
                            validationFailure(
                                { status: ['This plan is quarantined for review.'] },
                                { message: 'Refused.' },
                            ),
                        ),
                    );
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
        const { repositories } = await renderKitchen(
            <PlanEditScreen plan={String(spreadPlan.id)} />,
        );
        await untilVisible('kitchen-plan-retire');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-retire'));
        });
        await untilVisible('kitchen-plan-retire-dialog');
        expect(screen.getByTestId('kitchen-plan-retire-consequence')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-plan-retire-confirm'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getPlan(spreadPlan.id);
            expect(after.meta.status).toBe('retired');
        });
        await untilVisible('kitchen-plan-retired');
    });
});
