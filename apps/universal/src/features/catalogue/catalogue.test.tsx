import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { NutritionFacts } from '@healthy360/nutrition';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient, renderScreen } from '../../testing/render-screen.tsx';
import {
    centimetresFromFeetInches,
    feetInchesFromCentimetres,
    kilogramsFromPounds,
    macroBreakdown,
    per100gFacts,
    poundsFromKilograms,
} from './format.ts';
import { MACRO_DISTRIBUTION_RANGES, macroDistributionLevel } from './macro-rings.tsx';
import { toTargetRequest, DEFAULT_CALCULATOR_INPUTS } from './calculator-fields.tsx';
import { toMealFilter } from './meal-filters.tsx';
import { NutritionFactsPanel } from './nutrition-facts-panel.tsx';
import {
    cheapestVariant,
    distinctKitchenIds,
    isPlanSort,
    sortPlans,
    toPlanFilter,
} from './plan-catalogue.ts';
import { CalorieCalculatorScreen } from './screens/calorie-calculator-screen.tsx';
import { DietCategoryScreen } from './screens/diet-category-screen.tsx';
import { MacroCalculatorScreen } from './screens/macro-calculator-screen.tsx';
import { MealDetailScreen } from './screens/meal-detail-screen.tsx';
import { MealsScreen } from './screens/meals-screen.tsx';
import { PlanComparisonScreen } from './screens/plan-comparison-screen.tsx';
import { PlanDetailScreen } from './screens/plan-detail-screen.tsx';
import { PlansScreen } from './screens/plans-screen.tsx';

const CONSUMER = MOCK_SCENARIOS['consumer-prototype'].primaryEmail;

/**
 * Route parameters are the one thing these screens cannot reach through a repository, so the router
 * is mocked rather than rendered — the same seam `../marketplace/marketplace.test.tsx` uses, for
 * the same reason. `params` is mutable so a test can put a filter or an identifier in front of a
 * screen exactly the way a shared link would.
 */
const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    const setParams = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams, back: jest.fn() }),
        usePathname: () => '/meals',
        useLocalSearchParams: () => routerState.params,
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __setParams: setParams,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __setParams: jest.Mock };

beforeEach(() => {
    routerState.params = {};
    routerMock.__push.mockClear();
    routerMock.__setParams.mockClear();
    // `catalogue` is on the persistence allow-list (`data/query-keys.ts`), and `AppProviders`
    // restores that snapshot on mount. In a browser that is the feature; inside one Jest file it
    // would hand each test the previous test's results, so every test starts from a cold cache.
    globalThis.localStorage?.clear();
});

/**
 * A render with a *slow* repository bundle.
 *
 * The shared harness runs at zero latency, and the mock's `sleep(0)` resolves on a microtask — so a
 * screen is already showing its data by the time an awaited `render` returns, and the loading frame
 * cannot be observed at all. A few milliseconds of latency makes the pending state real, which is
 * the only way to assert that a screen actually has one.
 */
async function renderPending(node: ReactNode) {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'consumer-prototype',
        latencyMs: 40,
        tokenStore,
    });

    return render(
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
}

/**
 * Identifiers come from a throwaway repository bundle rather than by rendering a listing and
 * scraping it: rendering a second tree inside a test leaves `screen` pointing at a tree the test
 * then unmounts, which quietly breaks every render after it in the file.
 */
const scratch = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });

async function firstMealId(): Promise<string> {
    const page = await scratch.marketplace.listMeals({ limit: 1 });
    const meal = page.items[0];
    if (meal === undefined) throw new Error('The prototype world has no marketplace meals.');
    return String(meal.id);
}

async function firstPlanIds(count: number): Promise<readonly string[]> {
    const page = await scratch.marketplace.listPlans({ limit: count });
    if (page.items.length < count) throw new Error('The prototype world has too few plans.');
    return page.items.map((plan) => String(plan.id));
}

/* ── pure helpers ────────────────────────────────────────────────────────────────────────────── */

describe('catalogue formatting', () => {
    it('splits energy across the three macronutrients at the Atwater factors', async () => {
        const meal = await scratch.marketplace.getMeal(
            (await scratch.marketplace.listMeals({ limit: 1 })).items[0]!.id,
        );
        const shares = macroBreakdown(meal.nutrition);

        expect(shares.map((share) => share.nutrientId)).toEqual(['protein', 'carbohydrate', 'fat']);
        for (const share of shares) {
            expect(share.kilocalories).toBeGreaterThan(0);
            expect(share.percentageOfEnergy).toBeGreaterThan(0);
            expect(share.percentageOfEnergy).toBeLessThan(100);
        }
    });

    it('re-bases a serving to 100 g only when the mass is known', async () => {
        const meal = (await scratch.marketplace.listMeals({ limit: 1 })).items[0]!;
        const per100g = per100gFacts(meal.nutrition);

        expect(per100g).not.toBeNull();
        expect(per100g?.basis).toBe('per_100g');
        expect(per100g?.totalGrams).toBeCloseTo(100, 6);

        expect(per100gFacts({ ...meal.nutrition, totalGrams: null })).toBeNull();
        expect(per100gFacts({ ...meal.nutrition, totalGrams: 0 })).toBeNull();
    });

    it('round-trips imperial height and weight without drifting', () => {
        expect(centimetresFromFeetInches(5, 9)).toBeCloseTo(175.26, 2);
        expect(feetInchesFromCentimetres(175.26)).toEqual({ feet: 5, inches: 9 });
        // 11.6 inches rounds to twelve, which is one more foot and no inches — never "5 ft 12 in".
        expect(feetInchesFromCentimetres(182.5)).toEqual({ feet: 6, inches: 0 });
        expect(poundsFromKilograms(kilogramsFromPounds(154))).toBeCloseTo(154, 6);
    });

    it('maps a macro share against the published distribution range, and only two ways', () => {
        expect(macroDistributionLevel('protein', MACRO_DISTRIBUTION_RANGES.protein.min)).toBe(
            'optimal',
        );
        expect(macroDistributionLevel('protein', MACRO_DISTRIBUTION_RANGES.protein.max)).toBe(
            'optimal',
        );
        expect(macroDistributionLevel('protein', 5)).toBe('moderate');
        expect(macroDistributionLevel('fat', 60)).toBe('moderate');
    });
});

describe('meal filter construction', () => {
    const base = {
        query: '',
        kitchenIds: [],
        mealTypes: [],
        dietClassifications: [],
        excludeAllergens: [],
        ranges: {
            energy: { min: null, max: null },
            protein: { min: null, max: null },
            carbohydrate: { min: null, max: null },
            fat: { min: null, max: null },
            price: { min: null, max: null },
            preparationMinutes: { min: null, max: null },
        },
        sort: undefined,
        currency: 'USD',
        limit: 20,
    } as const;

    it('omits every range that says nothing, so the query key stays stable', () => {
        expect(toMealFilter(base)).toEqual({ limit: 20 });
    });

    it('scales the price range into minor units of the declared currency', () => {
        const filter = toMealFilter({
            ...base,
            ranges: { ...base.ranges, price: { min: 20, max: 60 } },
        });
        // AED has two minor units: twenty dirhams is two thousand fils.
        expect(filter.price).toEqual({ min: 2000, max: 6000 });
    });

    it('keeps an open-ended range open rather than inventing a bound', () => {
        const filter = toMealFilter({
            ...base,
            ranges: { ...base.ranges, energy: { min: 400, max: null } },
        });
        expect(filter.energy).toEqual({ min: 400 });
    });
});

describe('plan filter construction', () => {
    const base = { query: '', category: 'all', kitchenIds: [], calorie: undefined } as const;

    it('omits every axis that says nothing, so the query key stays stable', () => {
        expect(toPlanFilter(base)).toEqual({});
    });

    it('maps each axis to its real PlanFilter field, and trims the query', () => {
        expect(toPlanFilter({ ...base, query: '  strength  ' })).toEqual({ query: 'strength' });
        expect(toPlanFilter({ ...base, category: 'high-protein' })).toEqual({
            categorySlug: 'high-protein',
        });
        expect(toPlanFilter({ ...base, kitchenIds: ['k1', 'k2'] })).toEqual({
            kitchenIds: ['k1', 'k2'],
        });
        expect(toPlanFilter({ ...base, calorie: 'lighter' })).toEqual({ energy: { max: 1600 } });
        expect(toPlanFilter({ ...base, calorie: 'higher' })).toEqual({ energy: { min: 2200 } });
    });

    it('ignores an unknown calorie preset rather than inventing a range', () => {
        expect(toPlanFilter({ ...base, calorie: 'nonsense' })).toEqual({});
    });
});

describe('plan sort and facets', () => {
    it('recognises only the three real sorts', () => {
        expect(isPlanSort('recommended')).toBe(true);
        expect(isPlanSort('priceLowHigh')).toBe(true);
        expect(isPlanSort('ratingHighLow')).toBe(true);
        expect(isPlanSort('nope')).toBe(false);
        expect(isPlanSort(undefined)).toBe(false);
    });

    it('leaves the repository order untouched for "recommended", and orders by the real fields', async () => {
        const plans = (await scratch.marketplace.listPlans({ limit: 20 })).items;

        // "Recommended" is the catalogue's own order — returned as-is, not a re-sorted copy.
        expect(sortPlans(plans, 'recommended')).toBe(plans);

        const prices = sortPlans(plans, 'priceLowHigh').map(
            (plan) => cheapestVariant(plan)!.pricePerWeek.amount,
        );
        expect([...prices]).toEqual([...prices].sort((left, right) => left - right));

        const ratings = sortPlans(plans, 'ratingHighLow').map((plan) => plan.rating ?? -1);
        expect([...ratings]).toEqual([...ratings].sort((left, right) => right - left));
    });

    it('lists only the kitchens that own a plan, without duplicates', async () => {
        const plans = (await scratch.marketplace.listPlans({ limit: 20 })).items;
        const ids = distinctKitchenIds(plans);

        expect(new Set(ids).size).toBe(ids.length);
        // Four kitchens publish plans, of the six on the marketplace — the facet must not offer
        // the two that would only ever return the empty state.
        expect(ids.length).toBe(4);
    });
});

describe('calculator request construction', () => {
    it('is null until every measurement has been answered', () => {
        expect(toTargetRequest(DEFAULT_CALCULATOR_INPUTS)).toBeNull();
        expect(
            toTargetRequest({ ...DEFAULT_CALCULATOR_INPUTS, ageYears: 34, heightCentimetres: 170 }),
        ).toBeNull();
    });

    it('omits an unanswered body-fat rather than sending a zero', () => {
        const request = toTargetRequest({
            ...DEFAULT_CALCULATOR_INPUTS,
            ageYears: 34,
            heightCentimetres: 170,
            weightKilograms: 68,
        });
        expect(request).not.toBeNull();
        expect(request && 'bodyFatPercentage' in request).toBe(false);
    });
});

/* ── /meals ──────────────────────────────────────────────────────────────────────────────────── */

/** Meal cards, counted by their price line so a card's four child test ids are not counted too. */
function mealCardCount(): number {
    return screen.queryAllByTestId(/^meal-card-.*-price$/).length;
}

describe('MealsScreen', () => {
    it('shows the loading skeleton, then the grid and the result count', async () => {
        await renderPending(<MealsScreen />);

        expect(screen.getByTestId('meals-loading')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('meals-grid')).toBeTruthy();
        });
        expect(screen.getByTestId('meals-count')).toBeTruthy();
        expect(mealCardCount()).toBeGreaterThan(0);
    });

    it('offers every range the specification asks for, behind the filter disclosure', async () => {
        await renderScreen(<MealsScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meals-grid'));
        // The filters are collapsed by default so the grid leads; open them to reach the ranges.
        await fireEvent.press(screen.getByTestId('meals-filter-toggle'));
        await waitFor(() => screen.getByTestId('meals-ranges-energy'));
        for (const key of [
            'energy',
            'protein',
            'carbohydrate',
            'fat',
            'price',
            'preparationMinutes',
        ]) {
            expect(screen.getByTestId(`meals-ranges-${key}`)).toBeTruthy();
        }
    });

    it('narrows the catalogue from a URL range parameter', async () => {
        routerState.params = { proteinMin: '45' };
        await renderScreen(<MealsScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meals-grid'));
        const filtered = mealCardCount();

        expect(filtered).toBeGreaterThan(0);
        expect(filtered).toBeLessThan(20);
    });

    it('excludes a declared allergen from the results', async () => {
        routerState.params = { exclude: 'milk' };
        await renderScreen(<MealsScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meals-grid'));
        // The halloumi plate declares milk, so it cannot survive the exclusion.
        expect(screen.queryByTestId('meal-card-daily-pot-halloumi-plate')).toBeNull();
        expect(mealCardCount()).toBeGreaterThan(0);
    });

    it('renders the empty state, with a way out, when nothing matches', async () => {
        routerState.params = { q: 'zzzz-nothing-matches' };
        await renderScreen(<MealsScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('meals-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('meals-empty-clear')).toBeTruthy();
    });

    it('offers another page while the cursor has one', async () => {
        await renderScreen(<MealsScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meals-grid'));
        const before = mealCardCount();
        expect(before).toBe(20);

        await fireEvent.press(screen.getByTestId('meals-load-more'));

        await waitFor(() => {
            expect(mealCardCount()).toBeGreaterThan(before);
        });
        expect(screen.getByTestId('meals-all-loaded')).toBeTruthy();
    });
});

/* ── /meals/{meal} ───────────────────────────────────────────────────────────────────────────── */

describe('NutritionFactsPanel', () => {
    it('renders API meals with no recorded nutrition without formatting an empty timestamp', async () => {
        // Mirrors `NO_NUTRITION_FACTS` from the API mapper: empty `calculatedAt` is the sentinel
        // for "the platform has no timestamp" and must never reach `formatDate`.
        const unrecorded: NutritionFacts = {
            basis: 'per_serving',
            kind: 'planned',
            serving: null,
            totalGrams: null,
            amounts: [],
            source: {
                kind: 'synthetic_prototype',
                label: 'No nutrition source is recorded for this meal.',
                version: '0',
                calculatedAt: '',
            },
            calculation: {
                method: 'none.no_recorded_source',
                basis: 'per_serving',
                calculatedAt: '',
                prototype: true,
                rounding: 'none',
                notes: ['The platform holds no nutrition figures for this meal.'],
            },
        };

        await renderScreen(
            <NutritionFactsPanel facts={unrecorded} testID="meal-detail-facts" />,
        );

        expect(screen.getByTestId('meal-detail-facts')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-facts-synthetic')).toBeTruthy();
        expect(screen.queryByTestId('meal-detail-facts-calculated-at')).toBeNull();
    });
});

describe('MealDetailScreen', () => {
    it('renders the record: facts, provenance, macros, allergens, availability and price', async () => {
        const id = await firstMealId();
        await renderScreen(<MealDetailScreen mealId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('meal-detail-name')).toBeTruthy();
        });

        expect(screen.getByTestId('meal-detail-facts')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-facts-version')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-facts-calculated-at')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-facts-synthetic')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-macro-rings-protein')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-allergen-list')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-availability')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-price')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-b2c')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-subscription')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('shows the per-100 g basis when the serving mass is known', async () => {
        const id = await firstMealId();
        await renderScreen(<MealDetailScreen mealId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meal-detail-facts'));

        const perServing = screen.getByTestId('meal-detail-facts-amount-energy').props
            .children as string;
        await fireEvent.press(screen.getByTestId('meal-detail-facts-basis-per-100g'));

        await waitFor(() => {
            expect(screen.getByTestId('meal-detail-facts-amount-energy').props.children).not.toBe(
                perServing,
            );
        });
    });

    it('never puts a business price on a consumer page', async () => {
        const id = await firstMealId();
        await renderScreen(<MealDetailScreen mealId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meal-detail-name'));

        if (screen.queryByTestId('meal-detail-b2b') !== null) {
            expect(screen.getByTestId('meal-detail-b2b-no-price')).toBeTruthy();
        }
    });

    // G1 changed this deliberately: an anonymous visitor at the moment of highest intent is offered
    // a guest checkout *and* sign-in, rather than being redirected to a wall. Signing in is still
    // one press away and still records the page, which the second assertion pins.
    it('offers an anonymous visitor a guest checkout, with sign-in still one press away', async () => {
        const id = await firstMealId();
        await renderScreen(<MealDetailScreen mealId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meal-detail-add-to-basket'));
        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));

        await waitFor(() => screen.getByTestId('meal-detail-guest-continue'));
        expect(routerMock.__push).not.toHaveBeenCalledWith('/sign-in');

        await fireEvent.press(screen.getByTestId('meal-detail-guest-sign-in'));
        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });

    it('adds to the basket for real when somebody is signed in', async () => {
        const id = await firstMealId();
        const { repositories } = await renderScreen(<MealDetailScreen mealId={id} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });

        const before = (await repositories.commerce.getCart()).itemCount;

        await waitFor(() => screen.getByTestId('meal-detail-add-to-basket'));
        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));

        await waitFor(async () => {
            expect((await repositories.commerce.getCart()).itemCount).toBe(before + 1);
        });
    });

    it('adds to a real meal plan when the person has one', async () => {
        const id = await firstMealId();
        const { repositories } = await renderScreen(<MealDetailScreen mealId={id} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });

        const plan = await repositories.planner.getCurrentPlan();
        expect(plan).not.toBeNull();
        const before = (await repositories.planner.getWeek(plan!.planId, plan!.weekStart)).days
            .flatMap((day) => day.entries)
            .filter((entry) => entry.date === plan!.weekStart).length;

        // The button stays disabled until the current-plan query settles (loading is not the
        // same answer as "no plan"), so wait for enablement before pressing.
        await waitFor(() => {
            const button = screen.getByTestId('meal-detail-add-to-plan');
            expect(button.props.accessibilityState?.disabled).not.toBe(true);
        });
        await fireEvent.press(screen.getByTestId('meal-detail-add-to-plan'));

        await waitFor(async () => {
            const after = (await repositories.planner.getWeek(plan!.planId, plan!.weekStart)).days
                .flatMap((day) => day.entries)
                .filter((entry) => entry.date === plan!.weekStart).length;
            expect(after).toBe(before + 1);
        });
    });

    it('explains replacement instead of pretending to do it, and offers real destinations', async () => {
        const id = await firstMealId();
        await renderScreen(<MealDetailScreen mealId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('meal-detail-replace'));
        await fireEvent.press(screen.getByTestId('meal-detail-replace'));

        await waitFor(() => {
            expect(screen.getByTestId('meal-detail-replace-dialog')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('meal-detail-replace-home'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer');
    });

    it('reports a failure rather than an empty page when the meal is unknown', async () => {
        await renderPending(<MealDetailScreen mealId="01935f6d-f000-7000-8000-0000000000ff" />);

        expect(screen.getByTestId('meal-detail-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('meal-detail-error')).toBeTruthy();
        });
    });

    it('answers a malformed identifier with the not-found state rather than a stuck skeleton', async () => {
        await renderScreen(<MealDetailScreen mealId="not-a-uuid" />, {
            scenario: 'consumer-prototype',
        });

        expect(screen.getByTestId('meal-detail-empty')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-browse')).toBeTruthy();
    });
});

/* ── /plans and /plans/compare ───────────────────────────────────────────────────────────────── */

describe('PlansScreen', () => {
    it('lists the plans with their bands, durations and a from-price', async () => {
        await renderPending(<PlansScreen />);

        expect(screen.getByTestId('plans-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('plans-grid')).toBeTruthy();
        });
        expect(screen.getAllByTestId(/^plan-card-.*-bands$/).length).toBeGreaterThan(0);
        expect(screen.getAllByTestId(/^plan-card-.*-price$/).length).toBeGreaterThan(0);
    });

    it('narrows to a category from the URL and back again', async () => {
        routerState.params = { category: 'high-protein' };
        await renderScreen(<PlansScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.getByTestId('plan-card-strength-build')).toBeTruthy();
        expect(screen.queryByTestId('plan-card-plant-forward')).toBeNull();
    });

    it('refuses to open a comparison of fewer than two plans', async () => {
        await renderScreen(<PlansScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.getByTestId('plans-compare-open').props.accessibilityState.disabled).toBe(
            true,
        );
    });

    it('caps the selection at three and says so', async () => {
        const ids = await firstPlanIds(3);
        routerState.params = { compare: ids.join(',') };
        await renderScreen(<PlansScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.getByTestId('plans-compare-full')).toBeTruthy();
        expect(screen.getByTestId('plans-compare-open').props.accessibilityState.disabled).toBe(
            false,
        );
    });
});

describe('PlanComparisonScreen', () => {
    it('renders one row per metric and a link back to each plan', async () => {
        const ids = await firstPlanIds(3);
        routerState.params = { plans: ids.join(',') };
        await renderScreen(<PlanComparisonScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('plan-comparison-table')).toBeTruthy();
        });
        expect(screen.getByTestId('plan-comparison-links')).toBeTruthy();
        expect(screen.getAllByTestId(/^plan-comparison-open-/).length).toBe(3);
    });

    it('shows the empty state when nothing was selected', async () => {
        await renderScreen(<PlanComparisonScreen />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('plan-comparison-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('plan-comparison-back')).toBeTruthy();
    });
});

describe('PlanDetailScreen', () => {
    it('renders variants, macro ranges, durations, delivery and the sample menu', async () => {
        const [id] = await firstPlanIds(1);
        await renderScreen(<PlanDetailScreen planId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-name')).toBeTruthy();
        });

        expect(screen.getByTestId('plan-detail-variant-picker')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-macro-protein')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-snacks')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-duration-12w')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-delivery')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-dietitian')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-price')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-sample-grid')).toBeTruthy();
        });
    });

    it('changes the band, and the macro ranges follow', async () => {
        const [id] = await firstPlanIds(1);
        await renderScreen(<PlanDetailScreen planId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('plan-detail-variant-band'));
        const before = screen.getByTestId('plan-detail-macro-protein-value').props
            .children as string;

        const options = screen.getAllByTestId(/^plan-detail-variant-[0-9a-f-]+$/);
        await fireEvent.press(options[0]!);

        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-macro-protein-value').props.children).not.toBe(
                before,
            );
        });
    });

    it('sends an anonymous visitor to sign in before configuring', async () => {
        const [id] = await firstPlanIds(1);
        await renderScreen(<PlanDetailScreen planId={id} />, { scenario: 'consumer-prototype' });

        await waitFor(() => screen.getByTestId('plan-detail-configure'));
        await fireEvent.press(screen.getByTestId('plan-detail-configure'));

        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });

    it('opens the configurator on the chosen variant for a signed-in visitor', async () => {
        const [id] = await firstPlanIds(1);
        await renderScreen(<PlanDetailScreen planId={id} />, {
            scenario: 'consumer-prototype',
            signInAs: CONSUMER,
        });

        await waitFor(() => screen.getByTestId('plan-detail-configure'));
        await fireEvent.press(screen.getByTestId('plan-detail-configure'));

        // Both parameters travel: the plan, and the calorie band the person was actually looking
        // at. Carrying only the plan would silently reset them to the advertised variant.
        const [href] = routerMock.__push.mock.calls.at(-1) ?? [];
        expect(String(href)).toContain(`/customer/subscriptions/new?plan=${id ?? ''}`);
        expect(String(href)).toContain('&variant=');
    });

    it('reports a failure rather than an empty page when the plan is unknown', async () => {
        await renderPending(<PlanDetailScreen planId="01935f6d-f000-7000-8000-0000000000ff" />);

        expect(screen.getByTestId('plan-detail-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-error')).toBeTruthy();
        });
    });

    it('answers a malformed identifier with the not-found state rather than a stuck skeleton', async () => {
        await renderScreen(<PlanDetailScreen planId="not-a-uuid" />, {
            scenario: 'consumer-prototype',
        });

        expect(screen.getByTestId('plan-detail-empty')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-browse')).toBeTruthy();
    });
});

/* ── /diets/{diet} ───────────────────────────────────────────────────────────────────────────── */

describe('DietCategoryScreen', () => {
    it('leads with the suitability note and the disclaimer, then the meals and plans', async () => {
        await renderScreen(<DietCategoryScreen slug="high-protein" />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('diet-category-name')).toBeTruthy();
        });

        expect(screen.getByTestId('diet-category-suitability')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('diet-category-meals-grid')).toBeTruthy();
        });
        await waitFor(() => {
            expect(screen.getByTestId('diet-category-plans-grid')).toBeTruthy();
        });
    });

    it('says a commercial grouping has no dish-level classification instead of showing nothing', async () => {
        await renderScreen(<DietCategoryScreen slug="office" />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => screen.getByTestId('diet-category-name'));
        await waitFor(() => {
            expect(screen.getByTestId('diet-category-meals-list-empty')).toBeTruthy();
        });
        await waitFor(() => {
            expect(screen.getByTestId('diet-category-plans-grid')).toBeTruthy();
        });
    });

    it('answers an unknown slug with the not-found state', async () => {
        await renderScreen(<DietCategoryScreen slug="not-a-real-diet" />, {
            scenario: 'consumer-prototype',
        });

        await waitFor(() => {
            expect(screen.getByTestId('diet-category-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('diet-category-browse')).toBeTruthy();
    });
});

/* ── the public calculators ──────────────────────────────────────────────────────────────────── */

describe('CalorieCalculatorScreen', () => {
    it('asks for the missing measurements before it shows any figure', async () => {
        await renderScreen(<CalorieCalculatorScreen />, { scenario: 'consumer-prototype' });

        expect(screen.getByTestId('calorie-calculator-incomplete')).toBeTruthy();
        expect(screen.queryByTestId('calorie-calculator-target')).toBeNull();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('separates maintenance from target, names the method and shows the band', async () => {
        await renderScreen(<CalorieCalculatorScreen />, { scenario: 'consumer-prototype' });

        await fireEvent.changeText(screen.getByTestId('calorie-calculator-age-input'), '34');
        await fireEvent.changeText(screen.getByTestId('calorie-calculator-height-input'), '170');
        await fireEvent.changeText(screen.getByTestId('calorie-calculator-weight-input'), '68');

        await waitFor(() => {
            expect(screen.getByTestId('calorie-calculator-target')).toBeTruthy();
        });

        expect(screen.getByTestId('calorie-calculator-target-maintenance-value')).toBeTruthy();
        expect(screen.getByTestId('calorie-calculator-target-target-value')).toBeTruthy();
        expect(screen.getByTestId('calorie-calculator-target-tolerance')).toBeTruthy();
        expect(screen.getByTestId('calorie-calculator-target-method')).toBeTruthy();
        expect(screen.getByTestId('calorie-calculator-target-prototype')).toBeTruthy();
        expect(screen.getByTestId('calorie-calculator-target-disclaimer')).toBeTruthy();
    });

    it('keeps the measurement when the unit system changes', async () => {
        await renderScreen(<CalorieCalculatorScreen />, { scenario: 'consumer-prototype' });

        await fireEvent.changeText(screen.getByTestId('calorie-calculator-height-input'), '175');
        await fireEvent.press(screen.getByTestId('calorie-calculator-units-imperial'));

        await waitFor(() => {
            expect(screen.getByTestId('calorie-calculator-height-feet-input').props.value).toBe(
                '5',
            );
        });
        expect(screen.getByTestId('calorie-calculator-height-inches-input').props.value).toBe('9');
    });

    it('attaches help to exactly the two fields that confuse people', async () => {
        await renderScreen(<CalorieCalculatorScreen />, { scenario: 'consumer-prototype' });

        expect(screen.getByTestId('calorie-calculator-sex-help')).toBeTruthy();
        expect(screen.getByTestId('calorie-calculator-body-fat-help')).toBeTruthy();
    });
});

describe('MacroCalculatorScreen', () => {
    it('renders grams, percentages and calories once the form is complete', async () => {
        await renderScreen(<MacroCalculatorScreen />, { scenario: 'consumer-prototype' });

        expect(screen.getByTestId('macro-calculator-incomplete')).toBeTruthy();

        await fireEvent.changeText(screen.getByTestId('macro-calculator-age-input'), '29');
        await fireEvent.changeText(screen.getByTestId('macro-calculator-height-input'), '182');
        await fireEvent.changeText(screen.getByTestId('macro-calculator-weight-input'), '80');

        await waitFor(() => {
            expect(screen.getByTestId('macro-calculator-macros')).toBeTruthy();
        });

        expect(screen.getByTestId('macro-calculator-macros-table')).toBeTruthy();
        expect(screen.getByTestId('macro-calculator-macros-ring-protein')).toBeTruthy();
        expect(screen.getByTestId('macro-calculator-macros-grams-protein')).toBeTruthy();
        expect(screen.getByTestId('macro-calculator-macros-nutrients')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('offers the diet-preference split selector the calorie calculator does not', async () => {
        await renderScreen(<MacroCalculatorScreen />, { scenario: 'consumer-prototype' });
        expect(screen.getByTestId('macro-calculator-diet')).toBeTruthy();
    });
});
