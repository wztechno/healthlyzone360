import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    AddCartItemRequest,
    Cart,
    Kitchen,
    KitchenSalesChannels,
    MarketplaceMeal,
    MealFilter,
    NumericRangeFilter,
    PlanDurationOption,
    PlanFilter,
    PlanVariant,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import type {
    AllergenCode,
    CartId,
    KitchenId,
    MealId,
    PlanVariantId,
    SalesChannel,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { NutritionFacts } from '@healthy360/nutrition';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { useCartQuery } from '../../data/marketplace-hooks.ts';
import { testMeResponse } from '../../testing/session-fixtures.ts';
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
import { refineMeals } from './meal-readings.ts';
import { NutritionFactsPanel } from './nutrition-facts-panel.tsx';
import {
    cheapestVariant,
    distinctKitchenIds,
    isPlanSort,
    sortPlans,
    toPlanFilter,
} from './plan-catalogue.ts';
import { shelvesFrom } from './use-meal-shelves.ts';
import { MealDetailScreen } from './screens/meal-detail-screen.tsx';
import { MealsScreen } from './screens/meals-screen.tsx';
import { PlanComparisonScreen } from './screens/plan-comparison-screen.tsx';
import { PlanDetailScreen } from './screens/plan-detail-screen.tsx';
import { PlansScreen } from './screens/plans-screen.tsx';
import type * as ShownShelves from './shown-shelves.ts';

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

/**
 * The menu un-narrowed. Discover and `/meals` show only the shown shelves
 * (`catalogue/shown-shelves.ts`, tested there); these tests describe the whole menu, which is what
 * comes back when that narrowing is lifted.
 */
jest.mock('./shown-shelves.ts', () => {
    const actual = jest.requireActual<typeof ShownShelves>('./shown-shelves.ts');
    return { ...actual, ...actual.shelfNarrowing([]) };
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

/* ── the world these tests author ────────────────────────────────────────────────────────────── */

/**
 * UUIDv7-shaped identifiers. Every detail screen parses its route parameter through an id codec, so
 * an identifier that is not UUID-shaped is what puts the screen in its not-found state — which two
 * of the tests below rely on deliberately.
 */
function uuid(family: number, ordinal: number): string {
    return `01935f6d-${family.toString(16).padStart(4, '0')}-7000-8000-${ordinal
        .toString(16)
        .padStart(12, '0')}`;
}

/** Well-formed, and deliberately absent from the authored world. */
const UNKNOWN_ID = uuid(15, 255);

const NO_CHANNELS: Readonly<Record<SalesChannel, boolean>> = {
    b2c: false,
    b2b: false,
    marketplace: false,
    pos: false,
    subscription: false,
    delivery: false,
    pickup: false,
    corporate: false,
};

function salesChannels(...enabled: readonly SalesChannel[]): KitchenSalesChannels {
    const result: Record<SalesChannel, boolean> = { ...NO_CHANNELS };
    for (const channel of enabled) result[channel] = true;
    return result;
}

const CONSUMER_CHANNELS = salesChannels('b2c', 'marketplace', 'delivery', 'subscription');

function testKitchen(ordinal: number, name: string, slug: string): Kitchen {
    const id = uuid(1, ordinal) as KitchenId;
    return {
        id,
        name,
        slug,
        tagline: `${name}, cooked to order`,
        description: `${name} is authored by this test file.`,
        countryCode: 'AE',
        cuisines: ['Levantine'],
        dietClassifications: ['omnivore'],
        channels: CONSUMER_CHANNELS,
        branches: [],
        deliveryWindows: [],
        rating: 4.6,
        ratingCount: 24,
        imagePlaceholderId: `kitchen-${slug}`,
        isVerified: true,
    };
}

const VERDANT = testKitchen(1, 'Verdant Kitchen', 'verdant-kitchen');
const SAFFRON = testKitchen(2, 'Saffron and Sea', 'saffron-and-sea');
const DAILY_POT = testKitchen(3, 'The Daily Pot', 'the-daily-pot');

const KITCHENS: readonly Kitchen[] = [VERDANT, SAFFRON, DAILY_POT];

async function listKitchens() {
    return page(KITCHENS);
}

async function getKitchen(kitchenId: KitchenId): Promise<Kitchen> {
    const kitchen = KITCHENS.find((candidate) => candidate.id === kitchenId);
    if (kitchen === undefined) throw new ApiError(apiFailure('resource.not_found'));
    return kitchen;
}

interface FactsSeed {
    readonly energy?: number | undefined;
    readonly protein?: number | undefined;
    readonly totalGrams?: number | null | undefined;
}

/**
 * One authored set of per-serving facts.
 *
 * The three macronutrients are chosen so every share of the declared energy lands strictly between
 * 0 and 100 %, which is the invariant `macroBreakdown` is asserted against below — a set where the
 * reconstructed macro energy exceeded the declared figure would make that test pass for the wrong
 * reason.
 */
function testFacts(seed: FactsSeed = {}): NutritionFacts {
    const energy = seed.energy ?? 520;
    const protein = seed.protein ?? 32;
    const totalGrams = seed.totalGrams === undefined ? 380 : seed.totalGrams;
    return {
        basis: 'per_serving',
        kind: 'planned',
        serving: {
            label: '1 bowl',
            quantity: 1,
            unit: 'portion',
            grams: totalGrams,
            millilitres: null,
            householdMeasure: null,
        },
        totalGrams,
        amounts: [
            { nutrientId: 'energy', unit: 'kcal', value: energy, kind: 'planned', tolerance: null },
            { nutrientId: 'protein', unit: 'g', value: protein, kind: 'planned', tolerance: null },
            {
                nutrientId: 'carbohydrate',
                unit: 'g',
                value: 54,
                kind: 'planned',
                tolerance: null,
            },
            { nutrientId: 'fat', unit: 'g', value: 18, kind: 'planned', tolerance: null },
        ],
        source: {
            kind: 'synthetic_prototype',
            label: 'Authored by this test',
            version: '1',
            calculatedAt: '2026-08-01T09:00:00.000Z',
        },
        calculation: {
            method: 'test.authored',
            basis: 'per_serving',
            calculatedAt: '2026-08-01T09:00:00.000Z',
            prototype: true,
            rounding: 'none',
            notes: ['Every figure here was authored by the test that renders it.'],
        },
    };
}

interface MealSeed {
    readonly ordinal: number;
    readonly name: string;
    readonly slug: string;
    readonly kitchen?: Kitchen | undefined;
    readonly protein?: number | undefined;
    readonly allergens?: readonly AllergenCode[] | undefined;
    readonly channels?: KitchenSalesChannels | undefined;
    /** The shelf the kitchen filed it under — the menu's CATEGORY rows. */
    readonly category?: { readonly code: string; readonly name: string } | undefined;
}

function testMeal(seed: MealSeed): MarketplaceMeal {
    const kitchen = seed.kitchen ?? VERDANT;
    return {
        id: uuid(4, seed.ordinal) as MealId,
        kitchenId: kitchen.id,
        kitchenName: kitchen.name,
        itemType: 'meal',
        publishedCategory: seed.category ?? null,
        name: seed.name,
        slug: seed.slug,
        description: `${seed.name}, made to order.`,
        mealTypes: ['lunch'],
        dietClassifications: ['omnivore'],
        cuisines: kitchen.cuisines,
        allergens: seed.allergens ?? [],
        serving: {
            label: '1 bowl',
            quantity: 1,
            unit: 'portion',
            grams: 380,
            millilitres: null,
            householdMeasure: null,
        },
        nutrition: testFacts(seed.protein === undefined ? {} : { protein: seed.protein }),
        price: { amount: 4500, currency: 'AED' },
        preparationMinutes: 25,
        imagePlaceholderId: `meal-${seed.slug}`,
        availability: [{ date: '2026-08-20', available: true, remaining: 8, orderCutOffAt: null }],
        channels: seed.channels ?? kitchen.channels,
        rating: 4.4,
        ratingCount: 11,
    };
}

/**
 * The catalogue: twenty-five meals, one page and a bit at the screen's page size of twenty.
 *
 * Two properties are authored deliberately, because three tests below are *about* them: exactly one
 * meal declares milk, and exactly five carry 50 g of protein.
 */
const CATALOGUE_SIZE = 25;
const HIGH_PROTEIN_FROM = 21;
/** Fifteen bowls and ten salads: two shelves, so the CATEGORY list has something to count. */
const BOWLS = { code: 'bowls', name: 'Bowls' } as const;
const SALADS = { code: 'salads', name: 'Salads' } as const;
const BOWL_COUNT = 15;
const HIGH_PROTEIN_GRAMS = 50;
const MILK_MEAL_SLUG = 'daily-pot-halloumi-plate';
const MILK: readonly AllergenCode[] = ['milk' as AllergenCode];
const SESAME: readonly AllergenCode[] = ['sesame' as AllergenCode];

const CATALOGUE_MEALS: readonly MarketplaceMeal[] = Array.from(
    { length: CATALOGUE_SIZE },
    (_, index) => {
        const ordinal = index + 1;
        return testMeal({
            ordinal,
            name: ordinal === 1 ? 'Halloumi plate' : `Catalogue meal ${String(ordinal)}`,
            slug: ordinal === 1 ? MILK_MEAL_SLUG : `catalogue-meal-${String(ordinal)}`,
            protein: ordinal >= HIGH_PROTEIN_FROM ? HIGH_PROTEIN_GRAMS : 30,
            allergens: ordinal === 1 ? MILK : [],
            category: ordinal <= BOWL_COUNT ? BOWLS : SALADS,
        });
    },
);

const HIGH_PROTEIN_COUNT = CATALOGUE_SIZE - HIGH_PROTEIN_FROM + 1;

function proteinOf(meal: MarketplaceMeal): number {
    return meal.nutrition.amounts.find((amount) => amount.nutrientId === 'protein')?.value ?? 0;
}

function matchesText(haystack: readonly string[], query: string | undefined): boolean {
    if (query === undefined || query.trim() === '') return true;
    const needle = query.trim().toLowerCase();
    return haystack.some((value) => value.toLowerCase().includes(needle));
}

function inRange(value: number, range: NumericRangeFilter | undefined): boolean {
    if (range === undefined) return true;
    if (range.min !== undefined && value < range.min) return false;
    if (range.max !== undefined && value > range.max) return false;
    return true;
}

/**
 * The catalogue answer, cursor and all.
 *
 * The cursor is the index of the next row, because that is the smallest thing that behaves like a
 * cursor: `useMealsQuery` puts `nextCursor` straight back on the wire as `cursor`, so a stub that
 * ignored it would report a second page identical to the first and the paging test would pass
 * against a screen that never paged.
 */
async function listMeals(filter?: MealFilter) {
    const excluded: readonly AllergenCode[] = filter?.excludeAllergens ?? [];
    const matched = CATALOGUE_MEALS.filter((meal) => {
        if (
            !matchesText(
                [meal.name, meal.description, meal.kitchenName, ...meal.cuisines],
                filter?.query,
            )
        ) {
            return false;
        }
        if (
            filter?.kitchenIds !== undefined &&
            filter.kitchenIds.length > 0 &&
            !filter.kitchenIds.includes(meal.kitchenId)
        ) {
            return false;
        }
        if (
            filter?.itemTypes !== undefined &&
            filter.itemTypes.length > 0 &&
            !filter.itemTypes.includes(meal.itemType)
        ) {
            return false;
        }
        if (
            filter?.mealTypes !== undefined &&
            filter.mealTypes.length > 0 &&
            !meal.mealTypes.some((mealType) => filter.mealTypes?.includes(mealType))
        ) {
            return false;
        }
        if (
            filter?.categorySlug !== undefined &&
            meal.publishedCategory?.code !== filter.categorySlug
        ) {
            return false;
        }
        if (meal.allergens.some((code) => excluded.includes(code))) return false;
        if (!inRange(proteinOf(meal), filter?.protein)) return false;
        return true;
    });

    const limit = filter?.limit ?? matched.length;
    const start = filter?.cursor === undefined ? 0 : Number(filter.cursor);
    const slice = matched.slice(start, start + limit);
    const nextCursor = start + limit < matched.length ? String(start + limit) : null;
    return page(slice, { nextCursor, totalCount: matched.length });
}

/**
 * The meal the record screen is about.
 *
 * Two things are authored rather than inherited: it is **b2b-enabled**, so the price-privacy branch
 * really runs rather than being skipped, and it **declares an allergen**, so the declaration block
 * renders its list rather than its "nothing declared" line.
 */
const DETAIL_MEAL = testMeal({
    ordinal: 100,
    name: 'Harvest bowl',
    slug: 'verdant-harvest-bowl',
    allergens: SESAME,
    channels: salesChannels('b2c', 'marketplace', 'delivery', 'subscription', 'b2b'),
    category: BOWLS,
});

/**
 * The same screen for a listing sold by weight.
 *
 * A bottled sauce's published recipe version states what the bottle holds and no piece count, so
 * the server derives per-100 g facts (`catalogue.nutrition.per_100g`) and sends `serving: null` —
 * which the API mapper turns into `UNSTATED_SERVING`, an empty label and an unknown mass. Both
 * halves are authored here exactly as they arrive, because it is the *pair* the screen has to read
 * correctly: a per-serving view over these amounts would be naming a portion nobody sells.
 */
const WEIGHED_MEAL: MarketplaceMeal = {
    ...testMeal({ ordinal: 101, name: 'Smoked chilli sauce', slug: 'verdant-smoked-chilli-sauce' }),
    // `UNSTATED_SERVING`, written out rather than imported: it is not on the package's public
    // surface, and a fixture that states the shape is the one a reader can check against the wire.
    serving: {
        label: '',
        quantity: 1,
        unit: 'portion',
        grams: null,
        millilitres: null,
        householdMeasure: null,
    },
    nutrition: {
        ...testFacts({ totalGrams: 100 }),
        basis: 'per_100g',
        serving: null,
        calculation: {
            ...testFacts().calculation,
            method: 'catalogue.nutrition.per_100g',
            basis: 'per_100g',
        },
    },
};

async function getMeal(mealId: MealId): Promise<MarketplaceMeal> {
    if (mealId === DETAIL_MEAL.id) return DETAIL_MEAL;
    if (mealId === WEIGHED_MEAL.id) return WEIGHED_MEAL;
    const meal = CATALOGUE_MEALS.find((candidate) => candidate.id === mealId);
    if (meal === undefined) throw new ApiError(apiFailure('resource.not_found'));
    return meal;
}

/* ── plans ───────────────────────────────────────────────────────────────────────────────────── */

function testVariant(planOrdinal: number, index: number, name: string): PlanVariant {
    const energyFloor = 1400 + index * 400;
    return {
        id: uuid(6, planOrdinal * 10 + index) as PlanVariantId,
        planId: uuid(5, planOrdinal) as SubscriptionPlanId,
        name,
        energyRange: { min: energyFloor, max: energyFloor + 300 },
        proteinRange: { min: 80 + index * 30, max: 110 + index * 30 },
        carbohydrateRange: { min: 120 + index * 40, max: 170 + index * 40 },
        fatRange: { min: 40 + index * 10, max: 60 + index * 10 },
        mealsPerDay: 3,
        snacksPerDay: index,
        pricePerWeek: { amount: 20000 + planOrdinal * 1000 + index * 3000, currency: 'AED' },
    };
}

const DURATIONS: readonly PlanDurationOption[] = [
    { duration: '1w', discountPercent: 0, totalPrice: { amount: 20000, currency: 'AED' } },
    { duration: '4w', discountPercent: 5, totalPrice: { amount: 76000, currency: 'AED' } },
    { duration: '12w', discountPercent: 12, totalPrice: { amount: 211200, currency: 'AED' } },
];

interface PlanSeed {
    readonly ordinal: number;
    readonly name: string;
    readonly slug: string;
    readonly kitchen: Kitchen;
    readonly categorySlugs: readonly string[];
    readonly rating: number;
    readonly sampleMealIds?: readonly MealId[] | undefined;
}

function testPlan(seed: PlanSeed): SubscriptionPlan {
    return {
        id: uuid(5, seed.ordinal) as SubscriptionPlanId,
        kitchenId: seed.kitchen.id,
        name: seed.name,
        slug: seed.slug,
        summary: `${seed.name}, in a sentence.`,
        description: `${seed.name} is authored by this test file.`,
        categorySlugs: seed.categorySlugs,
        dietClassifications: ['omnivore'],
        variants: [
            testVariant(seed.ordinal, 0, 'Lighter'),
            testVariant(seed.ordinal, 1, 'Balanced'),
            testVariant(seed.ordinal, 2, 'Higher'),
        ],
        durations: DURATIONS,
        sampleMealIds: seed.sampleMealIds ?? [],
        imagePlaceholderId: `plan-${seed.slug}`,
        rating: seed.rating,
        ratingCount: 18,
    };
}

/** Two of the catalogue's meals stand in as the plan's representative week. */
const SAMPLE_MEAL_IDS: readonly MealId[] = CATALOGUE_MEALS.slice(0, 2).map((meal) => meal.id);

const PLANS: readonly SubscriptionPlan[] = [
    testPlan({
        ordinal: 1,
        name: 'Strength build',
        slug: 'strength-build',
        kitchen: VERDANT,
        categorySlugs: ['high-protein'],
        rating: 4.9,
        sampleMealIds: SAMPLE_MEAL_IDS,
    }),
    testPlan({
        ordinal: 2,
        name: 'Plant forward',
        slug: 'plant-forward',
        kitchen: SAFFRON,
        categorySlugs: ['plant-based'],
        rating: 4.2,
    }),
    testPlan({
        ordinal: 3,
        name: 'Balanced week',
        slug: 'balanced-week',
        // Deliberately the same kitchen as the first plan: the facet must not offer it twice.
        kitchen: VERDANT,
        categorySlugs: ['balanced'],
        rating: 4.5,
    }),
    testPlan({
        ordinal: 4,
        name: 'Coastal reset',
        slug: 'coastal-reset',
        kitchen: DAILY_POT,
        categorySlugs: ['balanced'],
        rating: 4.7,
    }),
];

/** Three distinct kitchens own the four plans. */
const PLAN_KITCHEN_COUNT = 3;

async function listPlans(filter?: PlanFilter) {
    const matched = PLANS.filter((plan) => {
        if (!matchesText([plan.name, plan.summary, plan.description], filter?.query)) return false;
        if (
            filter?.categorySlug !== undefined &&
            !plan.categorySlugs.includes(filter.categorySlug)
        ) {
            return false;
        }
        if (
            filter?.kitchenIds !== undefined &&
            filter.kitchenIds.length > 0 &&
            !filter.kitchenIds.includes(plan.kitchenId)
        ) {
            return false;
        }
        return true;
    });
    return page(matched);
}

async function getPlan(planId: SubscriptionPlanId): Promise<SubscriptionPlan> {
    const plan = PLANS.find((candidate) => candidate.id === planId);
    if (plan === undefined) throw new ApiError(apiFailure('resource.not_found'));
    return plan;
}

const PLAN_IDS: readonly string[] = PLANS.map((plan) => String(plan.id));

/** The catalogue repository answers every screen below needs, in one place. */
const CATALOGUE_REPOSITORIES = {
    marketplace: { listKitchens, getKitchen, listMeals, getMeal, listPlans, getPlan },
};

/** A signed-in consumer: no memberships, global permissions only. */
const CONSUMER_SESSION = testMeResponse();

/* ── pure helpers ────────────────────────────────────────────────────────────────────────────── */

describe('catalogue formatting', () => {
    it('splits energy across the three macronutrients at the Atwater factors', () => {
        const shares = macroBreakdown(testFacts());

        expect(shares.map((share) => share.nutrientId)).toEqual(['protein', 'carbohydrate', 'fat']);
        for (const share of shares) {
            expect(share.kilocalories).toBeGreaterThan(0);
            expect(share.percentageOfEnergy).toBeGreaterThan(0);
            expect(share.percentageOfEnergy).toBeLessThan(100);
        }
    });

    it('re-bases a serving to 100 g only when the mass is known', () => {
        const facts = testFacts();
        const per100g = per100gFacts(facts);

        expect(per100g).not.toBeNull();
        expect(per100g?.basis).toBe('per_100g');
        expect(per100g?.totalGrams).toBeCloseTo(100, 6);

        expect(per100gFacts({ ...facts, totalGrams: null })).toBeNull();
        expect(per100gFacts({ ...facts, totalGrams: 0 })).toBeNull();
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

    it('leaves the repository order untouched for "recommended", and orders by the real fields', () => {
        // "Recommended" is the catalogue's own order — returned as-is, not a re-sorted copy.
        expect(sortPlans(PLANS, 'recommended')).toBe(PLANS);

        const prices = sortPlans(PLANS, 'priceLowHigh').map(
            (plan) => cheapestVariant(plan)!.pricePerWeek.amount,
        );
        expect([...prices]).toEqual([...prices].sort((left, right) => left - right));

        const ratings = sortPlans(PLANS, 'ratingHighLow').map((plan) => plan.rating ?? -1);
        expect([...ratings]).toEqual([...ratings].sort((left, right) => right - left));
    });

    it('lists only the kitchens that own a plan, without duplicates', () => {
        const ids = distinctKitchenIds(PLANS);

        expect(new Set(ids).size).toBe(ids.length);
        // Four authored plans, three kitchens: the facet must not offer the fourth entry twice,
        // and it must not offer a kitchen that publishes no plan at all.
        expect(ids).toHaveLength(PLAN_KITCHEN_COUNT);
        expect(ids.length).toBeLessThan(KITCHENS.length + 1);
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

/** Meal cards, counted by their price line so a card's other child test ids are not counted too. */
function mealCardCount(): number {
    return screen.queryAllByTestId(/^meal-card-.*-price$/).length;
}

/** The screen's own page size, which is what the first page of an unfiltered catalogue holds. */
const PAGE_SIZE = 20;

const NO_RANGES = {
    energy: { min: null, max: null },
    protein: { min: null, max: null },
    carbohydrate: { min: null, max: null },
    fat: { min: null, max: null },
    price: { min: null, max: null },
    preparationMinutes: { min: null, max: null },
} as const;

describe('menu readings', () => {
    it('applies the ranges the server cannot, and leaves out a meal that never published the figure', () => {
        expect(refineMeals(CATALOGUE_MEALS, NO_RANGES, 'relevance')).toHaveLength(CATALOGUE_SIZE);
        // Every authored meal is 520 kcal, so "under 500" keeps none and "under 600" keeps all.
        expect(
            refineMeals(
                CATALOGUE_MEALS,
                { ...NO_RANGES, energy: { min: null, max: 500 } },
                'relevance',
            ),
        ).toHaveLength(0);
        expect(
            refineMeals(
                CATALOGUE_MEALS,
                { ...NO_RANGES, energy: { min: null, max: 600 } },
                'relevance',
            ),
        ).toHaveLength(CATALOGUE_SIZE);
        expect(
            refineMeals(
                CATALOGUE_MEALS,
                { ...NO_RANGES, protein: { min: 45, max: null } },
                'relevance',
            ),
        ).toHaveLength(HIGH_PROTEIN_COUNT);

        const unpublished: MarketplaceMeal = {
            ...CATALOGUE_MEALS[0]!,
            nutrition: { ...CATALOGUE_MEALS[0]!.nutrition, amounts: [] },
        };
        expect(
            refineMeals(
                [unpublished],
                { ...NO_RANGES, energy: { min: null, max: 900 } },
                'relevance',
            ),
        ).toHaveLength(0);
    });

    it('orders by the real fields, highest protein first', () => {
        const ordered = refineMeals(CATALOGUE_MEALS, NO_RANGES, 'protein');
        expect(proteinOf(ordered[0]!)).toBe(HIGH_PROTEIN_GRAMS);
        // Stable: the relevance order survives inside a tie.
        expect(ordered[HIGH_PROTEIN_COUNT]?.slug).toBe(MILK_MEAL_SLUG);
    });

    it('counts the shelves only when the whole menu was read', () => {
        expect(shelvesFrom({ meals: CATALOGUE_MEALS, complete: true })).toEqual({
            shelves: [
                { code: 'bowls', name: 'Bowls', count: BOWL_COUNT },
                { code: 'salads', name: 'Salads', count: CATALOGUE_SIZE - BOWL_COUNT },
            ],
            total: CATALOGUE_SIZE,
        });
        const partial = shelvesFrom({ meals: CATALOGUE_MEALS, complete: false });
        expect(partial.total).toBeNull();
        expect(partial.shelves.every((shelf) => shelf.count === null)).toBe(true);
    });
});

describe('MealsScreen', () => {
    it('shows the loading skeleton, then the grid and the result count', async () => {
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        expect(screen.getByTestId('meals-loading')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('meals-grid')).toBeTruthy();
        });
        expect(mealCardCount()).toBe(PAGE_SIZE);
        // More pages to come, so the count is the whole menu the shelf walk read.
        await waitFor(() => {
            expect(screen.getByTestId('meals-count')).toHaveTextContent(
                new RegExp(`${String(CATALOGUE_SIZE)} meals available`),
            );
        });
    });

    it("draws the design's card: tag, name, figures, price and Add", async () => {
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('meals-grid'));
        const card = screen.getByTestId(`meal-card-${MILK_MEAL_SLUG}`);
        // An omnivore dish wears its shelf, not "Omnivore".
        expect(within(card).getByTestId(`meal-card-${MILK_MEAL_SLUG}-tag`)).toHaveTextContent(
            'Bowls',
        );
        expect(within(card).getByTestId(`meal-card-${MILK_MEAL_SLUG}-figures`)).toHaveTextContent(
            /520 cal.*30g P.*★ 4\.4/,
        );
        expect(within(card).getByTestId(`meal-card-${MILK_MEAL_SLUG}-open`)).toBeTruthy();
        expect(within(card).getByTestId(`meal-card-${MILK_MEAL_SLUG}-add`)).toBeTruthy();
    });

    it('offers every range the specification asks for: calories on the panel, five more in the drawer', async () => {
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('meals-grid'));
        // The narrow-viewport panel is shut on a clean visit by design: the grid leads.
        expect(screen.queryByTestId('meals-ranges-energy')).toBeNull();
        await fireEvent.press(screen.getByTestId('meals-filter-toggle'));
        await waitFor(() => screen.getByTestId('meals-ranges-energy'));
        // The rail is the design's four groups and nothing else.
        expect(screen.queryByTestId('meals-ranges-protein')).toBeNull();
        expect(screen.queryByTestId('meals-filter-group-kitchen')).toBeNull();

        await fireEvent.press(screen.getByTestId('meals-more-filters'));
        await waitFor(() => screen.getByTestId('meals-ranges-protein'));
        for (const key of ['protein', 'carbohydrate', 'fat', 'price', 'preparationMinutes']) {
            expect(screen.getByTestId(`meals-ranges-${key}`)).toBeTruthy();
        }
        expect(screen.getByTestId('meals-filter-group-kitchen')).toBeTruthy();
        expect(screen.getByTestId('meals-filter-exclude-sesame')).toBeTruthy();
    });

    it('writes an allergen exclusion from the drawer, and counts it on the control that opens it', async () => {
        routerState.params = { exclude: 'milk' };
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('meals-grid'));
        // A filter the rail does not draw is never silently in force.
        expect(screen.getByTestId('meals-more-filters')).toHaveTextContent('More filters (1)');

        await fireEvent.press(screen.getByTestId('meals-more-filters'));
        await waitFor(() => screen.getByTestId('meals-filter-exclude-sesame'));
        expect(
            screen.getByTestId('meals-filter-exclude-milk').props.accessibilityState,
        ).toMatchObject({ selected: true });
        await fireEvent.press(screen.getByTestId('meals-filter-exclude-sesame'));
        expect(routerMock.__setParams).toHaveBeenLastCalledWith({ exclude: 'milk,sesame' });
    });

    it("draws the design's rail groups: counted shelves, diet pills and the calorie slider", async () => {
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('meals-grid'));
        await fireEvent.press(screen.getByTestId('meals-filter-toggle'));

        // The shelves are the kitchen's own, counted over the whole menu.
        await waitFor(() => {
            expect(
                screen.getByTestId('meals-filter-category-all-count', {
                    includeHiddenElements: true,
                }),
            ).toHaveTextContent(String(CATALOGUE_SIZE));
        });
        expect(
            screen.getByTestId('meals-filter-category-bowls-count', {
                includeHiddenElements: true,
            }),
        ).toHaveTextContent(String(BOWL_COUNT));
        expect(
            screen.getByTestId('meals-filter-category-salads-count', {
                includeHiddenElements: true,
            }),
        ).toHaveTextContent(String(CATALOGUE_SIZE - BOWL_COUNT));
        // The figure is part of the row's name, not a stray number read out on its own.
        expect(
            screen.getByTestId('meals-filter-category-bowls').props.accessibilityLabel,
        ).toContain(String(BOWL_COUNT));
        // "All" is lit while no shelf is chosen.
        expect(
            screen.getByTestId('meals-filter-category-all').props.accessibilityState,
        ).toMatchObject({ selected: true });

        // The design's four dietary pills, and only those on the rail.
        for (const diet of ['high_protein', 'vegetarian', 'vegan', 'gluten_free']) {
            expect(screen.getByTestId(`meals-filter-diet-${diet}`)).toBeTruthy();
        }
        expect(screen.queryByTestId('meals-filter-diet-low_carb')).toBeNull();
        expect(screen.getByTestId('meals-ranges-energy')).toBeTruthy();
        expect(screen.getByTestId('meals-filter-clear-all')).toBeTruthy();
    });

    it('picks one shelf at a time, filters on it server-side, and "All" lifts it', async () => {
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('meals-grid'));
        await fireEvent.press(screen.getByTestId('meals-filter-toggle'));
        await waitFor(() => screen.getByTestId('meals-filter-category-bowls'));

        await fireEvent.press(screen.getByTestId('meals-filter-category-bowls'));
        expect(routerMock.__setParams).toHaveBeenLastCalledWith({ category: 'bowls' });

        await fireEvent.press(screen.getByTestId('meals-filter-category-all'));
        expect(routerMock.__setParams).toHaveBeenLastCalledWith({ category: '' });
    });

    it('opens a filtered arrival with the controls showing, and lights what is applied', async () => {
        routerState.params = { category: 'salads', diet: 'vegan' };
        const { repositories } = await renderStubScreen(<MealsScreen />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        // The disclosure opened itself, because the controls are what a filtered link came for.
        await waitFor(() => screen.getByTestId('meals-filter-category-salads'));
        expect(
            screen.getByTestId('meals-filter-category-salads').props.accessibilityState,
        ).toMatchObject({ selected: true });
        expect(
            screen.getByTestId('meals-filter-category-all').props.accessibilityState,
        ).toMatchObject({ selected: false });
        expect(
            screen.getByTestId('meals-filter-diet-vegan').props.accessibilityState,
        ).toMatchObject({ selected: true });
        expect(repositories.marketplace.listMeals).toHaveBeenCalledWith(
            expect.objectContaining({ categorySlug: 'salads', limit: PAGE_SIZE }),
        );

        await fireEvent.press(screen.getByTestId('meals-filter-clear-all'));
        expect(routerMock.__setParams).toHaveBeenCalledWith(
            expect.objectContaining({ category: '', diet: '' }),
        );
    });

    describe('above lg', () => {
        const narrowWindow = Dimensions.get('window');
        const narrowScreen = Dimensions.get('screen');
        beforeAll(() => {
            Dimensions.set({
                window: { ...narrowWindow, width: 1440, height: 900 },
                screen: { ...narrowScreen, width: 1440, height: 900 },
            });
        });
        afterAll(() => {
            Dimensions.set({ window: narrowWindow, screen: narrowScreen });
        });

        it('is a rail beside the grid, with nothing to disclose', async () => {
            await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

            await waitFor(() => screen.getByTestId('meals-grid'));
            const rail = screen.getByTestId('meals-filter-rail');
            // The controls are drawn outright, once, and there is no toggle to open them with.
            expect(within(rail).getByTestId('meals-filter-category')).toBeTruthy();
            expect(within(rail).getByTestId('meals-filter-dietary')).toBeTruthy();
            expect(within(rail).getByTestId('meals-ranges-energy')).toBeTruthy();
            expect(within(rail).getByTestId('meals-filter-clear-all')).toBeTruthy();
            expect(within(rail).queryByTestId('meals-filter-group-kitchen')).toBeNull();
            expect(screen.queryByTestId('meals-filter-toggle')).toBeNull();
            expect(screen.getAllByTestId('meals-filter-diet-vegan')).toHaveLength(1);
        });
    });

    it('narrows the catalogue from a URL range parameter', async () => {
        routerState.params = { proteinMin: '45' };
        const { repositories } = await renderStubScreen(<MealsScreen />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('meals-grid'));

        expect(repositories.marketplace.listMeals).toHaveBeenCalledWith(
            expect.objectContaining({ protein: { min: 45 } }),
        );
        // Five of the twenty-five authored meals carry 50 g of protein, and only those survive.
        expect(mealCardCount()).toBe(HIGH_PROTEIN_COUNT);
        expect(mealCardCount()).toBeLessThan(PAGE_SIZE);
    });

    it('excludes a declared allergen from the results', async () => {
        routerState.params = { exclude: 'milk' };
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('meals-grid'));
        // The halloumi plate is the one authored meal that declares milk, so it cannot survive
        // the exclusion — and the other twenty-four still fill a page.
        expect(screen.queryByTestId(`meal-card-${MILK_MEAL_SLUG}`)).toBeNull();
        expect(mealCardCount()).toBe(PAGE_SIZE);
    });

    it('renders the empty state, with a way out, when nothing matches', async () => {
        routerState.params = { q: 'zzzz-nothing-matches' };
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('meals-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('meals-empty-clear')).toBeTruthy();
    });

    it('offers another page while the cursor has one, then simply ends', async () => {
        await renderStubScreen(<MealsScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('meals-grid'));
        const firstPage = mealCardCount();
        expect(firstPage).toBe(PAGE_SIZE);

        // Page to the end rather than assuming how many pages there are: what is worth asserting
        // is that every press adds meals and that the cursor eventually runs out.
        let loaded = firstPage;
        while (screen.queryByTestId('meals-load-more') !== null) {
            const previous = loaded;
            await fireEvent.press(screen.getByTestId('meals-load-more'));
            await waitFor(() => {
                expect(mealCardCount()).toBeGreaterThan(previous);
            });
            loaded = mealCardCount();
        }

        expect(loaded).toBe(CATALOGUE_SIZE);
        // Every page in, so the count line is the number on screen.
        expect(screen.getByTestId('meals-count')).toHaveTextContent(
            new RegExp(`${String(CATALOGUE_SIZE)} meals available`),
        );
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

        await renderStubScreen(
            <NutritionFactsPanel facts={unrecorded} testID="meal-detail-facts" />,
        );

        expect(screen.getByTestId('meal-detail-facts')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-facts-synthetic')).toBeTruthy();
        expect(screen.queryByTestId('meal-detail-facts-calculated-at')).toBeNull();
    });
});

/**
 * The cart observer every real screen has above it.
 *
 * `marketplace-shell.tsx` renders `useCartQuery(signedIn)` for the basket pill, so on a live screen
 * the current basket is always in the query cache. A stub screen has no shell, so a test that cares
 * about that cache has to supply the observer itself — otherwise `gcTime: 0` collects the cart the
 * moment a mutation writes it and the next add has nothing to read.
 */
function CartProbe() {
    useCartQuery(true);
    return null;
}

describe('MealDetailScreen', () => {
    it('keeps the obligations below the design: the full facts, their provenance and the disclaimer', async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(DETAIL_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => {
            expect(screen.getByTestId('meal-detail-name')).toBeTruthy();
        });

        const record = screen.getByTestId('meal-detail-record');
        expect(within(record).getByTestId('meal-detail-facts')).toBeTruthy();
        expect(within(record).getByTestId('meal-detail-facts-version')).toBeTruthy();
        expect(within(record).getByTestId('meal-detail-facts-calculated-at')).toBeTruthy();
        expect(within(record).getByTestId('meal-detail-facts-synthetic')).toBeTruthy();
        // The per-serving half of the contrast the weighed listing below draws: this meal states a
        // portion, so it gets a serving line and a basis control with both views on it.
        expect(within(record).getByTestId('meal-detail-serving')).toBeTruthy();
        expect(within(record).getByTestId('meal-detail-facts-basis-per-serving')).toBeTruthy();
        expect(within(record).getByTestId('medical-disclaimer')).toBeTruthy();

        // What the design does not draw and no obligation keeps is gone.
        expect(screen.queryByTestId('meal-detail-macro-rings-protein')).toBeNull();
        expect(screen.queryByTestId('meal-detail-availability')).toBeNull();
        expect(screen.queryByTestId('meal-detail-b2c')).toBeNull();
    });

    it("draws the design's information column: tag, rating, name, strip, ingredients, allergens and options", async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(DETAIL_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('meal-detail-name'));

        // An omnivore dish wears its shelf, and the rating carries its review count.
        expect(screen.getByTestId('meal-detail-lead-diet')).toHaveTextContent('Bowls');
        expect(screen.getByTestId('meal-detail-rating')).toHaveTextContent('★ 4.4 (11 reviews)');
        // All four cells, figure over name.
        for (const nutrient of ['energy', 'protein', 'carbohydrate', 'fat']) {
            expect(screen.getByTestId(`meal-detail-strip-${nutrient}`)).toBeTruthy();
        }
        expect(screen.getByTestId('meal-detail-strip-energy')).toHaveTextContent(/520/);
        expect(screen.getByTestId('meal-detail-strip-protein')).toHaveTextContent(/32g/);
        expect(screen.getByTestId('meal-detail-ingredients')).toBeTruthy();
        // The declared allergen is in the warning bar beside the photograph, not below the fold.
        expect(screen.getByTestId('meal-detail-allergen-list')).toHaveTextContent('Sesame.');
        // No modifiers exist in the API: the design's row states that rather than inventing four.
        expect(screen.getByTestId('meal-detail-options-none')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-instructions-input')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-quantity')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-add-to-basket')).toHaveTextContent(/Add to cart/);
    });

    it('fills the three frames with real images only, the third opening the kitchen', async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(DETAIL_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('meal-detail-name'));

        // One main photograph, and three frames under it.
        expect(screen.getAllByTestId('meal-detail-image')).toHaveLength(1);
        expect(screen.getByTestId('meal-detail-thumb-meal')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-thumb-empty')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('meal-detail-thumb-kitchen'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchens/${String(VERDANT.id)}`);
    });

    it("lists the kitchen's other meals under the column, never this one", async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(DETAIL_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('meal-detail-related-grid'));
        expect(screen.queryByTestId(`meal-card-${DETAIL_MEAL.slug}`)).toBeNull();
        expect(screen.getAllByTestId(/^meal-card-.*-price$/)).toHaveLength(4);

        await fireEvent.press(screen.getByTestId(`meal-card-${MILK_MEAL_SLUG}`));
        expect(routerMock.__push).toHaveBeenCalledWith(`/meals/${String(CATALOGUE_MEALS[0]!.id)}`);
    });

    it('shows the per-100 g basis when the serving mass is known', async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(DETAIL_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

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

    it('shows a listing sold by weight per 100 g, with no serving and no per-serving view', async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(WEIGHED_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('meal-detail-facts'));

        // Nothing where "One serving is …" would be: the label is empty and the mass unknown, and
        // printing a sentence around that is how a phrase the kitchen never wrote reaches a page.
        expect(screen.queryByTestId('meal-detail-serving')).toBeNull();
        // The strip says which hundred grams its four figures describe.
        expect(screen.getByTestId('meal-detail-strip-basis')).toHaveTextContent(/Per 100 g/);

        // No basis control at all, so there is no "Per serving" tab to press — the facts are
        // already on the comparison basis and there is no second view to offer.
        expect(screen.queryByTestId('meal-detail-facts-basis')).toBeNull();
        expect(screen.queryByTestId('meal-detail-facts-basis-per-serving')).toBeNull();
        expect(screen.getByTestId('meal-detail-facts-sold-by-weight')).toBeTruthy();

        expect(screen.getByTestId('meal-detail-facts-table-caption')).toHaveTextContent(
            /Per 100 g/,
        );
    });

    it('never puts a business price on a consumer page', async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(DETAIL_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('meal-detail-name'));

        // The authored meal *is* b2b-enabled, so the branch would run if there were one: the one
        // figure on the page is the consumer price, on the button that commits it.
        expect(screen.getByTestId('meal-detail-price')).toHaveTextContent(/45/);
        expect(screen.queryByText(/business/i)).toBeNull();
    });

    // G1 changed this deliberately: an anonymous visitor at the moment of highest intent is offered
    // a guest checkout *and* sign-in, rather than being redirected to a wall. Signing in is still
    // one press away and still records the page, which the second assertion pins.
    it('offers an anonymous visitor a guest checkout, with sign-in still one press away', async () => {
        await renderStubScreen(<MealDetailScreen mealId={String(DETAIL_MEAL.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('meal-detail-add-to-basket'));
        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));

        await waitFor(() => screen.getByTestId('meal-detail-guest-continue'));
        expect(routerMock.__push).not.toHaveBeenCalledWith('/sign-in');

        await fireEvent.press(screen.getByTestId('meal-detail-guest-sign-in'));
        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });

    it('adds to the basket for real when somebody is signed in', async () => {
        // The basket is a closure the overrides share, so "the cart really holds one more" is a
        // fact about the world the test authored rather than about a mock's private store.
        let itemCount = 0;
        const cartId = uuid(9, 1) as CartId;
        const cart = (): Cart => ({
            id: cartId,
            items: [],
            subtotal: { amount: itemCount * DETAIL_MEAL.price.amount, currency: 'AED' },
            itemCount,
            updatedAt: '2026-08-11T09:00:00.000Z',
        });

        const { repositories } = await renderStubScreen(
            <MealDetailScreen mealId={String(DETAIL_MEAL.id)} />,
            {
                session: CONSUMER_SESSION,
                repositories: {
                    ...CATALOGUE_REPOSITORIES,
                    commerce: {
                        getCart: async () => cart(),
                        addCartItem: async (_id: CartId, request: AddCartItemRequest) => {
                            itemCount += request.quantity;
                            return cart();
                        },
                    },
                },
            },
        );

        expect(itemCount).toBe(0);

        await waitFor(() => screen.getByTestId('meal-detail-add-to-basket'));
        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));

        await waitFor(() => {
            expect(repositories.commerce.addCartItem).toHaveBeenCalledWith(cartId, {
                mealId: DETAIL_MEAL.id,
                quantity: 1,
            });
        });
        // The call being recorded is not the same as the basket having changed — the stub answers
        // after a round trip, so the world is asserted once it has actually settled.
        await waitFor(() => {
            expect(itemCount).toBe(1);
        });
        // No note was typed, so nothing claims one was dropped.
        expect(screen.queryByTestId('prototype-notice')).toBeNull();
    });

    it('adds the meal and says plainly that a typed note cannot reach the kitchen yet', async () => {
        const cartId = uuid(9, 5) as CartId;
        const cart = (): Cart => ({
            id: cartId,
            items: [],
            subtotal: { amount: 0, currency: 'AED' },
            itemCount: 1,
            updatedAt: '2026-08-11T09:00:00.000Z',
        });

        const { repositories } = await renderStubScreen(
            <MealDetailScreen mealId={String(DETAIL_MEAL.id)} />,
            {
                session: CONSUMER_SESSION,
                repositories: {
                    ...CATALOGUE_REPOSITORIES,
                    commerce: {
                        getCart: async () => cart(),
                        addCartItem: async () => cart(),
                    },
                },
            },
        );

        await waitFor(() => screen.getByTestId('meal-detail-instructions-input'));
        await fireEvent.changeText(
            screen.getByTestId('meal-detail-instructions-input'),
            'No coriander, please',
        );
        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));

        // The meal still goes in — the request simply has no field for the note.
        await waitFor(() => {
            expect(repositories.commerce.addCartItem).toHaveBeenCalledWith(cartId, {
                mealId: DETAIL_MEAL.id,
                quantity: 1,
            });
        });
        await waitFor(() => screen.getByTestId('prototype-notice'));
    });

    /**
     * Two adds, one `getCart`.
     *
     * `useAddCartItemMutation` used to open the basket before every add — `POST /carts` plus a
     * lookup for every line already in it — to learn an identifier the cache already held. It now
     * reads the cart the shell is already holding and only opens one when there is genuinely
     * nothing to read.
     */
    it('adds the chosen quantity in one request, and the button states the total', async () => {
        let itemCount = 0;
        const cartId = uuid(9, 3) as CartId;
        const cart = (): Cart => ({
            id: cartId,
            items: [],
            subtotal: { amount: 0, currency: 'AED' },
            itemCount,
            updatedAt: '2026-08-11T09:00:00.000Z',
        });

        const { repositories } = await renderStubScreen(
            <MealDetailScreen mealId={String(DETAIL_MEAL.id)} />,
            {
                session: CONSUMER_SESSION,
                repositories: {
                    ...CATALOGUE_REPOSITORIES,
                    commerce: {
                        getCart: async () => cart(),
                        addCartItem: async (_id: CartId, request: AddCartItemRequest) => {
                            itemCount += request.quantity;
                            return cart();
                        },
                    },
                },
            },
        );

        await waitFor(() => screen.getByTestId('meal-detail-add-to-basket'));
        // One is the floor: there is no "add nothing".
        expect(screen.getByTestId('meal-detail-quantity-decrement')).toBeDisabled();

        await fireEvent.press(screen.getByTestId('meal-detail-quantity-increment'));
        await fireEvent.press(screen.getByTestId('meal-detail-quantity-increment'));
        expect(screen.getByTestId('meal-detail-quantity-value')).toHaveTextContent('3');
        // 3 × AED 45.00, stated on the button that commits it.
        expect(screen.getByTestId('meal-detail-add-to-basket')).toHaveTextContent(/135/);

        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));
        await waitFor(() => {
            expect(repositories.commerce.addCartItem).toHaveBeenCalledWith(cartId, {
                mealId: DETAIL_MEAL.id,
                quantity: 3,
            });
        });
        await waitFor(() => {
            expect(itemCount).toBe(3);
        });
    });

    it('carries the chosen quantity into a guest checkout', async () => {
        const cartId = uuid(9, 4) as CartId;
        const cart = (): Cart => ({
            id: cartId,
            items: [],
            subtotal: { amount: 0, currency: 'AED' },
            itemCount: 0,
            updatedAt: '2026-08-11T09:00:00.000Z',
        });

        const { repositories } = await renderStubScreen(
            <MealDetailScreen mealId={String(DETAIL_MEAL.id)} />,
            {
                repositories: {
                    ...CATALOGUE_REPOSITORIES,
                    commerce: {
                        getCart: async () => cart(),
                        addCartItem: async () => cart(),
                    },
                },
            },
        );

        await waitFor(() => screen.getByTestId('meal-detail-quantity-increment'));
        await fireEvent.press(screen.getByTestId('meal-detail-quantity-increment'));
        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));
        await waitFor(() => screen.getByTestId('meal-detail-guest-continue'));
        await fireEvent.press(screen.getByTestId('meal-detail-guest-continue'));

        await waitFor(() => {
            expect(repositories.commerce.addCartItem).toHaveBeenCalledWith(cartId, {
                mealId: DETAIL_MEAL.id,
                quantity: 2,
            });
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/guest-checkout');
        });
    });

    it('opens the basket once and then reuses the identifier it was given', async () => {
        let itemCount = 0;
        const cartId = uuid(9, 2) as CartId;
        const cart = (): Cart => ({
            id: cartId,
            items: [],
            subtotal: { amount: 0, currency: 'AED' },
            itemCount,
            updatedAt: '2026-08-11T09:00:00.000Z',
        });

        const { repositories } = await renderStubScreen(
            <>
                <MealDetailScreen mealId={String(DETAIL_MEAL.id)} />
                <CartProbe />
            </>,
            {
                session: CONSUMER_SESSION,
                repositories: {
                    ...CATALOGUE_REPOSITORIES,
                    commerce: {
                        getCart: async () => cart(),
                        addCartItem: async (_id: CartId, request: AddCartItemRequest) => {
                            itemCount += request.quantity;
                            return cart();
                        },
                    },
                },
            },
        );

        await waitFor(() => screen.getByTestId('meal-detail-add-to-basket'));
        await waitFor(() => {
            expect(repositories.commerce.getCart).toHaveBeenCalledTimes(1);
        });

        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));
        await waitFor(() => {
            expect(itemCount).toBe(1);
        });

        await fireEvent.press(screen.getByTestId('meal-detail-add-to-basket'));
        await waitFor(() => {
            expect(itemCount).toBe(2);
        });

        // Two meals in the basket, and the basket was opened exactly once — by the probe.
        expect(repositories.commerce.getCart).toHaveBeenCalledTimes(1);
        expect(repositories.commerce.addCartItem).toHaveBeenCalledTimes(2);
        expect(repositories.commerce.addCartItem).toHaveBeenLastCalledWith(cartId, {
            mealId: DETAIL_MEAL.id,
            quantity: 1,
        });
    });

    it('reports a failure rather than an empty page when the meal is unknown', async () => {
        await renderStubScreen(<MealDetailScreen mealId={UNKNOWN_ID} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        expect(screen.getByTestId('meal-detail-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('meal-detail-error')).toBeTruthy();
        });
    });

    it('answers a malformed identifier with the not-found state rather than a stuck skeleton', async () => {
        await renderStubScreen(<MealDetailScreen mealId="not-a-uuid" />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        expect(screen.getByTestId('meal-detail-empty')).toBeTruthy();
        expect(screen.getByTestId('meal-detail-browse')).toBeTruthy();
    });
});

/* ── /plans and /plans/compare ───────────────────────────────────────────────────────────────── */

describe('PlansScreen', () => {
    it('lists the plans with their bands, durations and a from-price', async () => {
        await renderStubScreen(<PlansScreen />, { repositories: CATALOGUE_REPOSITORIES });

        expect(screen.getByTestId('plans-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('plans-grid')).toBeTruthy();
        });
        expect(screen.getAllByTestId(/^plan-card-.*-bands$/)).toHaveLength(PLANS.length);
        expect(screen.getAllByTestId(/^plan-card-.*-price$/)).toHaveLength(PLANS.length);
    });

    it('narrows to a kitchen from the URL, the way the kitchen finder links in', async () => {
        routerState.params = { kitchen: String(SAFFRON.id) };
        await renderStubScreen(<PlansScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.getByTestId('plan-card-plant-forward')).toBeTruthy();
        expect(screen.queryByTestId('plan-card-strength-build')).toBeNull();
        // One chip per kitchen that publishes a plan, never one twice, plus "All kitchens".
        await waitFor(() => {
            expect(screen.getByTestId('plans-kitchens')).toBeTruthy();
        });
        expect(screen.getAllByTestId(/^plans-kitchen-/)).toHaveLength(PLAN_KITCHEN_COUNT + 1);
        expect(
            screen.getByTestId(`plans-kitchen-${String(SAFFRON.id)}`).props.accessibilityState
                .selected,
        ).toBe(true);
        expect(screen.getByTestId('plans-kitchen-all').props.accessibilityState.selected).toBe(
            false,
        );
    });

    it('keeps the comparison out of the way until a plan is chosen for it', async () => {
        await renderStubScreen(<PlansScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.queryByTestId('plans-compare-tray')).toBeNull();
        expect(screen.getByTestId('plan-card-strength-build-compare')).toBeTruthy();
    });

    it('refuses to open a comparison of fewer than two plans', async () => {
        routerState.params = { compare: PLAN_IDS[0]! };
        await renderStubScreen(<PlansScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.getByTestId('plans-compare-open').props.accessibilityState.disabled).toBe(
            true,
        );
    });

    it('caps the selection at three and says so', async () => {
        routerState.params = { compare: PLAN_IDS.slice(0, 3).join(',') };
        await renderStubScreen(<PlansScreen />, { repositories: CATALOGUE_REPOSITORIES });

        await waitFor(() => screen.getByTestId('plans-grid'));
        expect(screen.getByTestId('plans-compare-full')).toBeTruthy();
        expect(screen.getByTestId('plans-compare-open').props.accessibilityState.disabled).toBe(
            false,
        );
    });
});

describe('PlanComparisonScreen', () => {
    it('renders one row per metric and a link back to each plan', async () => {
        routerState.params = { plans: PLAN_IDS.slice(0, 3).join(',') };
        await renderStubScreen(<PlanComparisonScreen />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => {
            expect(screen.getByTestId('plan-comparison-table')).toBeTruthy();
        });
        expect(screen.getByTestId('plan-comparison-links')).toBeTruthy();
        expect(screen.getAllByTestId(/^plan-comparison-open-/)).toHaveLength(3);
    });

    it('shows the empty state when nothing was selected', async () => {
        await renderStubScreen(<PlanComparisonScreen />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => {
            expect(screen.getByTestId('plan-comparison-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('plan-comparison-back')).toBeTruthy();
    });
});

describe('PlanDetailScreen', () => {
    const [STRENGTH_BUILD] = PLANS;

    it('renders variants, macro ranges, durations, delivery and the sample menu', async () => {
        await renderStubScreen(<PlanDetailScreen planId={String(STRENGTH_BUILD!.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-name')).toBeTruthy();
        });

        expect(screen.getByTestId('plan-detail-variant-picker')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-macro-protein')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-snacks')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-duration-12w')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-delivery')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-price')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-sample-grid')).toBeTruthy();
        });
    });

    /**
     * A multi-configuration plan arrives with `totalPrice: null` on every duration — the server
     * will not quote one figure across differently-priced variants. The screen must derive the
     * selected variant's total (weekly × weeks × discount) rather than dropping the duration,
     * which is exactly the regression that made subscriptions unreachable when the seeded
     * per-week plans first hit the real API.
     */
    it('derives duration totals from the selected variant when the server states none', async () => {
        const plan = STRENGTH_BUILD!;
        const unpriced = {
            ...plan,
            durations: plan.durations.map((option) => ({ ...option, totalPrice: null })),
        };

        await renderStubScreen(<PlanDetailScreen planId={String(plan.id)} />, {
            repositories: {
                ...CATALOGUE_REPOSITORIES,
                marketplace: {
                    ...CATALOGUE_REPOSITORIES.marketplace,
                    getPlan: async () => unpriced,
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-duration-12w')).toBeTruthy();
        });

        // The advertised (middle) variant is what an unopened page shows, so the derived figure
        // is its weekly price over twelve weeks, less the option's stated discount.
        const middle = plan.variants[Math.floor(plan.variants.length / 2)]!;
        const option = unpriced.durations.find((entry) => entry.duration === '12w')!;
        const expectedMinor = Math.round(
            (middle.pricePerWeek.amount * 12 * (100 - option.discountPercent)) / 100,
        );
        // Digit-by-digit with any grouping/decimal codepoint between them: the formatter's
        // separators vary by ICU build, and this assertion is about the arithmetic, not the glyphs.
        const digits = String(expectedMinor).split('');
        const cents = digits.splice(-2).join('');
        expect(screen.getByTestId('plan-detail-duration-12w')).toHaveTextContent(
            new RegExp(`${digits.join('.?')}.?${cents}`),
        );
    });

    it('changes the band, and the macro ranges follow', async () => {
        await renderStubScreen(<PlanDetailScreen planId={String(STRENGTH_BUILD!.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

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
        await renderStubScreen(<PlanDetailScreen planId={String(STRENGTH_BUILD!.id)} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('plan-detail-configure'));
        await fireEvent.press(screen.getByTestId('plan-detail-configure'));

        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });

    it('opens the configurator on the chosen variant for a signed-in visitor', async () => {
        await renderStubScreen(<PlanDetailScreen planId={String(STRENGTH_BUILD!.id)} />, {
            session: CONSUMER_SESSION,
            repositories: CATALOGUE_REPOSITORIES,
        });

        await waitFor(() => screen.getByTestId('plan-detail-configure'));
        await fireEvent.press(screen.getByTestId('plan-detail-configure'));

        // Both parameters travel: the plan, and the calorie band the person was actually looking
        // at. Carrying only the plan would silently reset them to the advertised variant.
        const [href] = routerMock.__push.mock.calls.at(-1) ?? [];
        expect(String(href)).toContain(
            `/customer/subscriptions/new?plan=${String(STRENGTH_BUILD!.id)}`,
        );
        expect(String(href)).toContain('&variant=');
    });

    it('reports a failure rather than an empty page when the plan is unknown', async () => {
        await renderStubScreen(<PlanDetailScreen planId={UNKNOWN_ID} />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        expect(screen.getByTestId('plan-detail-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('plan-detail-error')).toBeTruthy();
        });
    });

    it('answers a malformed identifier with the not-found state rather than a stuck skeleton', async () => {
        await renderStubScreen(<PlanDetailScreen planId="not-a-uuid" />, {
            repositories: CATALOGUE_REPOSITORIES,
        });

        expect(screen.getByTestId('plan-detail-empty')).toBeTruthy();
        expect(screen.getByTestId('plan-detail-browse')).toBeTruthy();
    });
});
