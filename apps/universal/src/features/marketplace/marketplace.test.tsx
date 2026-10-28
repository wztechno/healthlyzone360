import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    Cart,
    DeliveryZone,
    Dietitian,
    DietitianFilter,
    Kitchen,
    KitchenBranch,
    KitchenFilter,
    KitchenSalesChannels,
    MarketplaceMeal,
    MealFilter,
    PlacedOrder,
    PlanFilter,
    Subscription,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import type {
    AllergenCode,
    CartId,
    DeliveryZoneId,
    DietClassification,
    DietitianId,
    KitchenBranchId,
    KitchenId,
    MealId,
    MealType,
    PlanVariantId,
    SalesChannel,
    SubscriptionId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { NutritionFacts } from '@healthy360/nutrition';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Dimensions, Pressable, ScrollView } from 'react-native';

import { useLogoutMutation } from '../../data/hooks.ts';
import { queryKeys } from '../../data/query-keys.ts';
import { takeMenuSearchFocus } from '../catalogue/menu-search-focus.ts';
import { consumerNavigation, marketplaceNavigation } from '../../navigation/consumer-items.ts';
import { forgetQueries, lastQuery, rememberQuery } from '../../navigation/last-query.ts';
import { withReturnTo } from '../../navigation/return-to.ts';
import { ConsumerShell } from '../../shell/consumer-shell.tsx';
import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import {
    kitchenManagerSession,
    testMembership,
    testMeResponse,
    testOrganisation,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import CustomerLayout from '../../../app/customer/_layout.tsx';
import { clearPendingAdd, readPendingAdd, writePendingAdd } from '../commerce/pending-add.ts';
import { useBasketAdd } from '../commerce/use-basket-add.tsx';
import {
    RESUME_INTENT_MAX_AGE_MS,
    clearResumeIntent,
    getResumeIntent,
    recordResumeIntent,
} from './resume-intent.ts';
import { DietitianProfileScreen } from './screens/dietitian-profile-screen.tsx';
import { DietitiansScreen } from './screens/dietitians-screen.tsx';
import { DiscoverScreen } from './screens/discover-screen.tsx';
import { ForBusinessScreen } from './screens/for-business-screen.tsx';
import { HowItWorksScreen } from './screens/how-it-works-screen.tsx';
import { KitchenMenuScreen } from './screens/kitchen-menu-screen.tsx';
import { KitchenProfileScreen } from './screens/kitchen-profile-screen.tsx';
import { KitchensScreen } from './screens/kitchens-screen.tsx';
import { MealCard } from './meal-card.tsx';
import { ShopViewOnlyProvider } from './shop-view-only.tsx';
import type * as ShownShelves from '../catalogue/shown-shelves.ts';

/**
 * Route parameters are the one thing these screens cannot reach through a repository, so the router
 * is mocked rather than rendered. `params` is mutable so a test can put a kitchen identifier in
 * front of a screen the way a deep link would.
 */
jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({ pathname: '/customer' }),
);

/**
 * The menu un-narrowed. Discover and `/meals` show only the shown shelves
 * (`catalogue/shown-shelves.ts`, tested there); these tests describe the whole menu, which is what
 * comes back when that narrowing is lifted.
 */
jest.mock('../catalogue/shown-shelves.ts', () => {
    const actual = jest.requireActual<typeof ShownShelves>('../catalogue/shown-shelves.ts');
    return { ...actual, ...actual.shelfNarrowing([]) };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

/** `routerState.params = …` puts a query in front of the screen, as a deep link would. */
const routerState = {
    set params(params: Record<string, string>) {
        routerMock.__set({ params });
    },
};

beforeEach(() => {
    routerMock.__reset();
    clearResumeIntent();
    clearPendingAdd();
});

/* ── the world these tests author ────────────────────────────────────────────────────────────── */

/**
 * Every screen below parses its route parameter through a `UUIDv7` codec, so an identifier that is
 * not UUID-shaped leaves the query disabled and the screen in its not-found state. `family` keeps
 * the entity kinds apart so a kitchen identifier can never collide with a meal's.
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

/** The consumer listing pair the directory screens filter on, plus the two acts a person can take. */
const CONSUMER_CHANNELS = salesChannels('b2c', 'marketplace', 'delivery', 'subscription');

function testZone(ordinal: number): DeliveryZone {
    return {
        id: uuid(3, ordinal) as DeliveryZoneId,
        name: 'Jumeirah',
        area: 'Jumeirah 1',
        countryCode: 'AE',
        deliveryFee: { amount: 1200, currency: 'AED' },
        minimumOrder: { amount: 5000, currency: 'AED' },
        estimatedMinutes: 45,
        windowCodes: [],
    };
}

function testBranch(kitchenId: KitchenId, ordinal: number): KitchenBranch {
    return {
        id: uuid(2, ordinal) as KitchenBranchId,
        kitchenId,
        name: 'Main branch',
        area: 'Jumeirah 1',
        countryCode: 'AE',
        timeZone: 'Asia/Dubai',
        deliveryZones: [testZone(ordinal)],
        // One trading day and one closed day, so the profile renders both opening lines.
        openingHours: [
            { weekday: 1, opensAt: '09:00', closesAt: '22:00', orderCutOffAt: '20:00' },
            { weekday: 7, opensAt: null, closesAt: null, orderCutOffAt: null },
        ],
        supportsPickup: true,
        isActive: true,
    };
}

interface KitchenSeed {
    readonly ordinal: number;
    readonly name: string;
    readonly slug: string;
    readonly cuisines?: readonly string[] | undefined;
    /** What the kitchen's meals classify as. The directory's diet chips narrow on exactly this. */
    readonly diets?: readonly DietClassification[] | undefined;
    readonly channels?: KitchenSalesChannels | undefined;
}

function testKitchen(seed: KitchenSeed): Kitchen {
    const id = uuid(1, seed.ordinal) as KitchenId;
    return {
        id,
        name: seed.name,
        slug: seed.slug,
        tagline: `${seed.name}, cooked to order`,
        description: `${seed.name} is authored by this test file.`,
        countryCode: 'AE',
        cuisines: seed.cuisines ?? ['Levantine'],
        dietClassifications: seed.diets ?? ['omnivore'],
        channels: seed.channels ?? CONSUMER_CHANNELS,
        branches: [testBranch(id, seed.ordinal)],
        deliveryWindows: [
            { code: 'morning', label: 'Morning', startsAt: '09:00', endsAt: '12:00', weekdays: [] },
        ],
        rating: 4.6,
        ratingCount: 24,
        imagePlaceholderId: `kitchen-${seed.slug}`,
        isVerified: true,
    };
}

const VERDANT = testKitchen({ ordinal: 1, name: 'Verdant Kitchen', slug: 'verdant-kitchen' });
const SAFFRON = testKitchen({
    ordinal: 2,
    name: 'Saffron and Sea',
    slug: 'saffron-and-sea',
    cuisines: ['Coastal'],
    diets: ['pescatarian'],
});
/** Wholesale only: it sells to businesses and has no consumer listing at all. */
const NORTHWIND = testKitchen({
    ordinal: 3,
    name: 'Northwind Provisions',
    slug: 'northwind-provisions',
    channels: salesChannels('b2b', 'corporate'),
});
/** Counter only: you may collect from it, but it is not listed on the marketplace. */
const OLIVE_TERRACE = testKitchen({
    ordinal: 4,
    name: 'Olive Terrace Counter',
    slug: 'olive-terrace-counter',
    channels: salesChannels('pos', 'pickup'),
});

const KITCHENS: readonly Kitchen[] = [VERDANT, SAFFRON, NORTHWIND, OLIVE_TERRACE];

function matchesText(haystack: readonly string[], query: string | undefined): boolean {
    if (query === undefined || query.trim() === '') return true;
    const needle = query.trim().toLowerCase();
    return haystack.some((value) => value.toLowerCase().includes(needle));
}

function overlaps(list: readonly string[], wanted: readonly string[] | undefined): boolean {
    if (wanted === undefined || wanted.length === 0) return true;
    return wanted.some((value) => list.includes(value));
}

/**
 * The directory answer.
 *
 * `channels` is an **every**, not a some: `KitchenFilter.channels` names the configuration a kitchen
 * must have, so asking for `['b2c', 'marketplace']` excludes a wholesaler and a counter alike. That
 * is the rule the listing screens rely on, so the stub has to state it rather than assume it.
 */
async function listKitchens(filter?: KitchenFilter) {
    const matched = KITCHENS.filter((kitchen) => {
        if (
            !matchesText(
                [kitchen.name, kitchen.tagline, kitchen.description, ...kitchen.cuisines],
                filter?.query,
            )
        ) {
            return false;
        }
        if (!overlaps(kitchen.cuisines, filter?.cuisines)) return false;
        if (
            filter?.channels !== undefined &&
            !filter.channels.every((channel) => kitchen.channels[channel])
        ) {
            return false;
        }
        return true;
    });
    return page(filter?.limit === undefined ? matched : matched.slice(0, filter.limit));
}

async function getKitchen(kitchenId: KitchenId): Promise<Kitchen> {
    const kitchen = KITCHENS.find((candidate) => candidate.id === kitchenId);
    if (kitchen === undefined) throw new ApiError(apiFailure('resource.not_found'));
    return kitchen;
}

function testFacts(): NutritionFacts {
    return {
        basis: 'per_serving',
        kind: 'planned',
        serving: {
            label: '1 bowl',
            quantity: 1,
            unit: 'portion',
            grams: 380,
            millilitres: null,
            householdMeasure: null,
        },
        totalGrams: 380,
        amounts: [
            { nutrientId: 'energy', unit: 'kcal', value: 520, kind: 'planned', tolerance: null },
            { nutrientId: 'protein', unit: 'g', value: 32, kind: 'planned', tolerance: null },
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
            notes: ['Every figure on this card was authored by the test that renders it.'],
        },
    };
}

/** A sellable product carries no figures at all — the card has to survive that. */
function emptyFacts(): NutritionFacts {
    const facts = testFacts();
    return { ...facts, serving: null, totalGrams: null, amounts: [] };
}

interface MealSeed {
    readonly ordinal: number;
    readonly name: string;
    readonly slug: string;
    readonly kitchen: Kitchen;
    readonly itemType?: 'meal' | 'product' | undefined;
    readonly mealTypes?: readonly MealType[] | undefined;
    readonly allergens?: readonly AllergenCode[] | undefined;
    readonly pack?: MarketplaceMeal['pack'] | undefined;
}

function testMeal(seed: MealSeed): MarketplaceMeal {
    const itemType = seed.itemType ?? 'meal';
    const nutrition = itemType === 'meal' ? testFacts() : emptyFacts();
    return {
        id: uuid(4, seed.ordinal) as MealId,
        kitchenId: seed.kitchen.id,
        kitchenName: seed.kitchen.name,
        itemType,
        publishedCategory: null,
        name: seed.name,
        slug: seed.slug,
        description: itemType === 'meal' ? `${seed.name}, made to order.` : '',
        mealTypes: seed.mealTypes ?? (itemType === 'meal' ? ['lunch'] : []),
        dietClassifications: itemType === 'meal' ? ['omnivore'] : [],
        cuisines: seed.kitchen.cuisines,
        allergens: seed.allergens ?? [],
        serving: nutrition.serving ?? {
            label: '1 jar',
            quantity: 1,
            unit: 'piece',
            grams: null,
            millilitres: null,
            householdMeasure: null,
        },
        nutrition,
        price: { amount: 4500, currency: 'AED' },
        pack: seed.pack ?? null,
        preparationMinutes: itemType === 'meal' ? 25 : null,
        imagePlaceholderId: `meal-${seed.slug}`,
        availability: [{ date: '2026-08-20', available: true, remaining: 8, orderCutOffAt: null }],
        channels: seed.kitchen.channels,
        rating: 4.4,
        ratingCount: 11,
    };
}

const MEALS: readonly MarketplaceMeal[] = [
    testMeal({ ordinal: 1, name: 'Harvest bowl', slug: 'verdant-harvest-bowl', kitchen: VERDANT }),
    testMeal({
        ordinal: 2,
        name: 'Lentil soup',
        slug: 'verdant-lentil-soup',
        kitchen: VERDANT,
        mealTypes: ['dinner'],
    }),
    testMeal({
        ordinal: 3,
        name: 'Chilli sauce',
        slug: 'verdant-chilli-sauce',
        kitchen: VERDANT,
        itemType: 'product',
        pack: { quantity: 0.3, unit: 'kg' },
    }),
];

/** A meal is only *listed* where its kitchen is configured for the marketplace. */
async function listMeals(filter?: MealFilter) {
    const matched = MEALS.filter((meal) => {
        if (!meal.channels.marketplace) return false;
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
        if (!overlaps(meal.mealTypes, filter?.mealTypes)) return false;
        return true;
    });
    return page(matched);
}

/**
 * The shared listing with the two prepared meals on published shelves — the home's category tiles
 * are the menu's shelves, and the base fixture leaves every meal unshelved.
 */
const SHELVES: Readonly<Record<string, { readonly code: string; readonly name: string }>> = {
    'verdant-harvest-bowl': { code: 'bowls', name: 'Bowls' },
    'verdant-lentil-soup': { code: 'soups', name: 'Soups' },
};

async function listShelvedMeals(filter?: MealFilter) {
    const result = await listMeals(filter);
    return {
        ...result,
        items: result.items.map((meal) => ({
            ...meal,
            publishedCategory: SHELVES[meal.slug] ?? meal.publishedCategory,
        })),
    };
}

function testDietitian(
    ordinal: number,
    overrides: Partial<Dietitian> & { readonly displayName: string },
): Dietitian {
    return {
        id: uuid(5, ordinal) as DietitianId,
        headline: 'Registered dietitian',
        biography: 'Authored by this test file.',
        credentials: ['Invented Register of Dietitians, 000000'],
        specialisms: ['Weight management'],
        locales: ['en'],
        countryCode: 'AE',
        kitchenIds: [],
        acceptingClients: true,
        imagePlaceholderId: `dietitian-${String(ordinal)}`,
        rating: 4.8,
        ratingCount: 9,
        ...overrides,
    };
}

const DIETITIANS: readonly Dietitian[] = [
    testDietitian(1, { displayName: 'Amina Haddad' }),
    testDietitian(2, {
        displayName: 'Rowan Fielding',
        specialisms: ['Sports nutrition'],
        acceptingClients: false,
    }),
];

async function listDietitians(filter?: DietitianFilter) {
    const matched = DIETITIANS.filter((dietitian) => {
        if (
            !matchesText(
                [dietitian.displayName, dietitian.headline, dietitian.biography],
                filter?.query,
            )
        ) {
            return false;
        }
        if (
            filter?.specialism !== undefined &&
            !dietitian.specialisms.includes(filter.specialism)
        ) {
            return false;
        }
        if (filter?.acceptingClients === true && !dietitian.acceptingClients) return false;
        return true;
    });
    return page(matched);
}

const ACTIVE_SUBSCRIPTION: Subscription = {
    id: uuid(6, 1) as SubscriptionId,
    state: 'active',
    configuration: {
        planId: uuid(7, 1) as SubscriptionPlanId,
        variantId: uuid(8, 1) as PlanVariantId,
        duration: '28d',
        startDate: '2026-08-03',
        deliveryWeekdays: [1, 3, 5],
        slotCode: 'morning',
        address: {
            label: 'Home',
            line1: '12 Test Street',
            line2: null,
            area: 'Jumeirah 1',
            city: 'Dubai',
            countryCode: 'AE',
            instructions: null,
        },
        days: [],
    },
    planName: 'Balanced week',
    kitchenId: VERDANT.id,
    weeklyPrice: { amount: 24900, currency: 'AED' },
    days: { total: 20, consumed: 6, remaining: 14 },
    nextDeliveryDate: '2026-08-20',
    skippedDates: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
};

/** The session the two signed-in surfaces below see: a consumer, no memberships. */
const CONSUMER_SESSION = testMeResponse();

/** A member of a corporate customer, with no organisation chosen yet. */
const BUSINESS_BUYER_SESSION = testMeResponse({
    memberships: [
        testMembership({ organisation: testOrganisation({ type: 'corporate_customer' }) }),
    ],
});

/* ── kitchen directory ───────────────────────────────────────────────────────────────────────── */

describe('KitchensScreen', () => {
    it('lists only kitchens configured for the marketplace channel', async () => {
        const { repositories } = await renderStubScreen(<KitchensScreen />, {
            repositories: { marketplace: { listKitchens } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-grid')).toBeTruthy();
        });

        // The directory asks for the consumer listing pair, and nothing else reaches the grid.
        expect(repositories.marketplace.listKitchens).toHaveBeenCalledWith(
            expect.objectContaining({ channels: ['b2c', 'marketplace'] }),
        );
        expect(screen.getByTestId('kitchen-card-verdant-kitchen')).toBeTruthy();
        // Wholesale only, and counter only: neither sells to a household through the marketplace.
        expect(screen.queryByTestId('kitchen-card-northwind-provisions')).toBeNull();
        expect(screen.queryByTestId('kitchen-card-olive-terrace-counter')).toBeNull();
    });

    it('renders the empty state, with a way out, when a search matches nothing', async () => {
        routerState.params = { q: 'zzzz-nothing-matches' };
        await renderStubScreen(<KitchensScreen />, {
            repositories: { marketplace: { listKitchens } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchens-empty-clear')).toBeTruthy();
    });

    /**
     * Diet is the one directory filter that narrows on the client: the repository has no parameter
     * for it, and `MarketplaceKitchenPresenter` does publish `diet_classifications`. So the screen
     * itself is what has to do the work, and this is the test that says it does.
     */
    it('narrows the list from a URL filter parameter', async () => {
        routerState.params = { diet: 'pescatarian' };
        await renderStubScreen(<KitchensScreen />, {
            repositories: { marketplace: { listKitchens } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-card-saffron-and-sea')).toBeTruthy();
        });
        expect(screen.queryByTestId('kitchen-card-verdant-kitchen')).toBeNull();
    });

    it('shows the loading skeleton first', async () => {
        await renderStubScreen(<KitchensScreen />, {
            repositories: { marketplace: { listKitchens } },
        });
        expect(screen.getByTestId('kitchens-loading')).toBeTruthy();
        await waitFor(() => screen.getByTestId('kitchens-grid'));
    });
});

/* ── kitchen profile and menu ────────────────────────────────────────────────────────────────── */

describe('KitchenProfileScreen', () => {
    /** A weekly plan, authored here, for the storefront's Plans tab. */
    function testPlan(ordinal: number, kitchen: Kitchen, name: string): SubscriptionPlan {
        const id = uuid(7, ordinal) as SubscriptionPlanId;
        return {
            id,
            kitchenId: kitchen.id,
            name,
            slug: name.toLowerCase().replace(/\s+/g, '-'),
            summary: `${name}, authored by this test file.`,
            description: '',
            categorySlugs: [],
            dietClassifications: ['omnivore'],
            variants: [
                {
                    id: uuid(8, ordinal * 10 + 1) as PlanVariantId,
                    planId: id,
                    name: 'Large',
                    energyRange: { min: 2000, max: 2200 },
                    proteinRange: null,
                    carbohydrateRange: null,
                    fatRange: null,
                    mealsPerDay: 3,
                    snacksPerDay: 1,
                    sittings: [
                        { slot: 'breakfast', sequence: 1 },
                        { slot: 'lunch', sequence: 1 },
                        { slot: 'dinner', sequence: 1 },
                        { slot: 'snack', sequence: 1 },
                    ],
                    pricePerWeek: { amount: 39900, currency: 'AED' },
                },
                {
                    id: uuid(8, ordinal * 10 + 2) as PlanVariantId,
                    planId: id,
                    name: 'Small',
                    energyRange: { min: 1400, max: 1600 },
                    proteinRange: null,
                    carbohydrateRange: null,
                    fatRange: null,
                    mealsPerDay: 2,
                    snacksPerDay: 0,
                    sittings: [
                        { slot: 'lunch', sequence: 1 },
                        { slot: 'dinner', sequence: 1 },
                    ],
                    pricePerWeek: { amount: 24900, currency: 'AED' },
                },
            ],
            durations: [],
            imagePlaceholderId: `plan-${String(ordinal)}`,
            rating: null,
            ratingCount: 0,
        };
    }

    /** Verdant's three listings, with the shelves and allergens a test hands them. */
    function verdantMenu(
        overrides: readonly Partial<Pick<MarketplaceMeal, 'publishedCategory' | 'allergens'>>[],
    ): readonly MarketplaceMeal[] {
        return MEALS.filter((meal) => meal.kitchenId === VERDANT.id).map((meal, index) => ({
            ...meal,
            ...overrides[index],
        }));
    }

    it('opens on the canopy hero, the standing facts and the order panel', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-hero-title')).toHaveTextContent('Verdant Kitchen');
        });
        expect(screen.getByTestId('kitchen-hero-panel')).toBeTruthy();
        expect(screen.getByTestId('kitchen-hero-media')).toBeTruthy();
        expect(
            screen.getByTestId('kitchen-hero-monogram', { includeHiddenElements: true }),
        ).toHaveTextContent('VK');
        expect(screen.getByTestId('kitchen-order-panel')).toBeTruthy();
        expect(screen.getByTestId('kitchen-view-menu')).toBeTruthy();

        // The pills: today's published window (never "open now" — see `storefront-facts.ts`),
        // verified, and the ways to order.
        expect(screen.getByTestId('kitchen-hours-today')).toBeTruthy();
        expect(screen.getByTestId('kitchen-verified')).toHaveTextContent('Verified kitchen');
        expect(screen.getByTestId('kitchen-ways')).toHaveTextContent('Delivery · Pickup · Plans');

        // All four facts, each bound to the contract.
        expect(screen.getByTestId('kitchen-fact-rating')).toHaveTextContent(/4\.6 · 24 ratings$/);
        expect(screen.getByTestId('kitchen-fact-delivery')).toHaveTextContent(/45 min$/);
        expect(screen.getByTestId('kitchen-fact-cuisine')).toHaveTextContent(/Levantine$/);
        expect(screen.getByTestId('kitchen-fact-branches')).toHaveTextContent(/1 branch$/);
    });

    it('keeps the rating fact, reading "Not rated yet", for a kitchen with no rating', async () => {
        const unrated: Kitchen = { ...VERDANT, rating: null, ratingCount: 0 };
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(unrated.id)} />, {
            repositories: {
                marketplace: { getKitchen: async () => Promise.resolve(unrated), listMeals },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-fact-rating'));
        expect(screen.getByTestId('kitchen-fact-rating')).toHaveTextContent(/Not rated yet$/);
    });

    /**
     * The design's five tabs, in its order. Each is drawn from what the contract carries — see the
     * table in `kitchen-profile-screen.tsx` — never from the design's sample batches and reviews.
     */
    it("offers the design's five tabs, the menu open", async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-tabs'));
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((tab) => tab.props.testID as string)).toEqual([
            'kitchen-tab-menu',
            'kitchen-tab-today',
            'kitchen-tab-plans',
            'kitchen-tab-safety',
            'kitchen-tab-reviews',
        ]);
        expect(screen.getByTestId('kitchen-tab-menu')).toBeSelected();
    });

    it('keeps the Plans tab for a kitchen that sells no plans, and says it has none', async () => {
        const counter = testKitchen({
            ordinal: 1,
            name: 'Verdant Kitchen',
            slug: 'verdant-kitchen',
            channels: salesChannels('b2c', 'marketplace', 'delivery'),
        });
        const listPlans = jest.fn(async (_filter?: PlanFilter) => Promise.resolve(page([])));

        await renderStubScreen(<KitchenProfileScreen kitchenId={String(counter.id)} />, {
            repositories: {
                marketplace: {
                    getKitchen: async () => Promise.resolve(counter),
                    listMeals,
                    listPlans,
                },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-see-plans'));
        await fireEvent.press(screen.getByTestId('kitchen-see-plans'));

        await waitFor(() => screen.getByTestId('kitchen-plans-empty'));
        expect(screen.getByTestId('kitchen-tab-plans')).toBeSelected();
        // A kitchen not configured for plans is not asked for any.
        expect(listPlans).not.toHaveBeenCalled();

        await fireEvent.press(screen.getByTestId('kitchen-plans-how'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans/how-it-works');
    });

    it('lists the menu on the Menu tab, each dish linked by its title', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-tab'));

        const links = screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-open$/);
        expect(links).toHaveLength(3);

        await fireEvent.press(links[0]!);
        expect(routerMock.__push).toHaveBeenCalledWith(expect.stringMatching(/^\/meals\//));
    });

    /**
     * The shelf counts and the safety tally are claims about the whole kitchen, so the storefront
     * reads every page before it draws either — never a count off the first page of several.
     */
    it('reads every page of the menu before it draws it', async () => {
        const mine = MEALS.filter((meal) => meal.kitchenId === VERDANT.id);
        const paged = jest.fn(async (filter?: MealFilter) =>
            Promise.resolve(
                filter?.cursor === undefined
                    ? page(mine.slice(0, 1), { nextCursor: 'second' })
                    : page(mine.slice(1)),
            ),
        );

        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals: paged } },
        });

        await waitFor(() => {
            expect(screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-open$/)).toHaveLength(3);
        });
        expect(paged).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'second' }));
        // "3 dishes", then today's cut-off where the kitchen publishes one for the day.
        expect(screen.getByTestId('kitchen-menu-count')).toHaveTextContent(/^3 dishes/);
    });

    it('narrows the menu to one of the shelves the kitchen files dishes under', async () => {
        const bowls = { code: 'bowls', name: 'Bowls' };
        const menu = verdantMenu([
            { publishedCategory: bowls },
            { publishedCategory: bowls },
            { publishedCategory: null },
        ]);

        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: {
                marketplace: { getKitchen, listMeals: async () => Promise.resolve(page(menu)) },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-shelves'));
        expect(screen.getByTestId('kitchen-shelf-all')).toHaveTextContent(/All.*3/);
        expect(screen.getByTestId('kitchen-shelf-bowls')).toHaveTextContent(/Bowls.*2/);
        // An unfiled listing still has a shelf, so the chips add up to "All".
        expect(screen.getByTestId('kitchen-shelf-other')).toHaveTextContent(/Other.*1/);

        await fireEvent.press(screen.getByTestId('kitchen-shelf-bowls'));

        expect(screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-open$/)).toHaveLength(2);
        expect(screen.queryByTestId('storefront-menu-verdant-chilli-sauce')).toBeNull();
    });

    /*
     * The shelf was the tab panel's own state, so Back from a dish, a reload and a trip to another
     * tab all dropped the person on "All" again (browse-07). It is the address's now, like the tab.
     */
    describe('the shelf lives in the address', () => {
        const bowls = { code: 'bowls', name: 'Bowls' };
        const menu = () =>
            verdantMenu([
                { publishedCategory: bowls },
                { publishedCategory: bowls },
                { publishedCategory: null },
            ]);
        const render = async () =>
            renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
                repositories: {
                    marketplace: {
                        getKitchen,
                        listMeals: async () => Promise.resolve(page(menu())),
                    },
                },
            });

        it('opens on the shelf a link (or Back) asks for', async () => {
            routerState.params = { shelf: 'bowls' };
            await render();

            await waitFor(() => screen.getByTestId('kitchen-shelves'));
            expect(
                screen.getByTestId('kitchen-shelf-bowls').props.accessibilityState,
            ).toMatchObject({ selected: true });
            expect(screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-open$/)).toHaveLength(2);
        });

        it('writes a chosen shelf to the address in place, and "All" lifts it', async () => {
            await render();

            await waitFor(() => screen.getByTestId('kitchen-shelves'));
            await fireEvent.press(screen.getByTestId('kitchen-shelf-other'));
            expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ shelf: 'other' });
            await fireEvent.press(screen.getByTestId('kitchen-shelf-all'));
            expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ shelf: undefined });
            // A choice on the page, never a history entry.
            expect(routerMock.__push).not.toHaveBeenCalled();
        });

        it('follows the address when it changes underneath the page', async () => {
            await render();
            await waitFor(() => screen.getByTestId('kitchen-shelves'));
            expect(screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-open$/)).toHaveLength(3);

            await act(async () => {
                routerMock.__set({ params: { shelf: 'bowls' } });
            });
            expect(screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-open$/)).toHaveLength(2);
        });

        it('reads a shelf this menu does not stock as "All"', async () => {
            routerState.params = { shelf: 'desserts' };
            await render();

            await waitFor(() => screen.getByTestId('kitchen-shelves'));
            expect(screen.getByTestId('kitchen-shelf-all').props.accessibilityState).toMatchObject({
                selected: true,
            });
            expect(screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-open$/)).toHaveLength(3);
        });

        it('remembers the open tab and shelf for a dish’s way back up', async () => {
            forgetQueries();
            routerMock.__set({
                pathname: `/kitchens/${String(VERDANT.id)}`,
                params: { tab: 'menu', shelf: 'bowls' },
            });
            await render();

            await waitFor(() => screen.getByTestId('kitchen-shelves'));
            expect(lastQuery(`/kitchens/${String(VERDANT.id)}`)).toBe('tab=menu&shelf=bowls');
        });
    });

    /*
     * "Start an order" pushed `/kitchens/{id}/menu` — a second listing of the dishes the Menu tab
     * shows — whose kitchen crumb pushed the storefront again (browse-12).
     */
    it('starts an order on the Menu tab, without a second listing of the same dishes', async () => {
        routerState.params = { tab: 'reviews' };
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-view-menu'));
        await fireEvent.press(screen.getByTestId('kitchen-view-menu'));

        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ tab: 'menu' });
        expect(routerMock.__push).not.toHaveBeenCalled();
        await waitFor(() => screen.getByTestId('kitchen-menu-tab'));
        expect(screen.getByTestId('kitchen-tab-menu')).toBeSelected();
    });

    it('names the way into the searchable menu for what it is', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-search'));
        expect(screen.getByTestId('kitchen-menu-search')).toHaveTextContent(/Search this menu$/);
        await fireEvent.press(screen.getByTestId('kitchen-menu-search'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchens/${String(VERDANT.id)}/menu`);
    });

    /*
     * The crumb pushed a fresh `/kitchens`: the directory's search and chips gone, and a forward
     * entry where the person meant to go back (browse-05).
     */
    describe('the "Kitchens" crumb goes up to the directory as it was left', () => {
        it('is Back when the directory is the entry below', async () => {
            routerMock.__set({
                pathname: `/kitchens/${String(VERDANT.id)}`,
                navState: {
                    index: 1,
                    routes: [
                        { name: 'kitchens/index', params: { diet: 'vegan' } },
                        {
                            name: 'kitchens/[kitchen]/index',
                            params: { kitchen: String(VERDANT.id) },
                        },
                    ],
                },
            });
            await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
                repositories: { marketplace: { getKitchen, listMeals } },
            });

            await fireEvent.press(await screen.findByTestId('kitchen-crumb-kitchens'));
            expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
            expect(routerMock.__push).not.toHaveBeenCalled();
        });

        it('otherwise opens it with the query it was last shown with', async () => {
            forgetQueries();
            rememberQuery('/kitchens', 'diet=vegan&sort=rating');
            await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
                repositories: { marketplace: { getKitchen, listMeals } },
            });

            await fireEvent.press(await screen.findByTestId('kitchen-crumb-kitchens'));
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchens?diet=vegan&sort=rating');
            expect(routerMock.__router.back).not.toHaveBeenCalled();
        });
    });

    it('offers Add on every dish, and asks an anonymous visitor how to continue', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-tab'));
        expect(screen.getAllByTestId(/^storefront-menu-[a-z0-9-]+-add$/)).toHaveLength(3);

        await fireEvent.press(screen.getByTestId('storefront-menu-verdant-harvest-bowl-add'));
        await waitFor(() => screen.getByTestId('kitchen-guest-sign-in'));
        expect(screen.getByTestId('kitchen-guest-register')).toBeTruthy();
    });

    it('opens on the tab a link asks for', async () => {
        routerState.params = { tab: 'plans' };
        const plans = [
            testPlan(1, VERDANT, 'Balanced week'),
            // Another kitchen's plan never reaches this kitchen's page, whatever the answer holds.
            testPlan(2, SAFFRON, 'Coastal week'),
        ];

        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: {
                marketplace: {
                    getKitchen,
                    listMeals,
                    listPlans: async (_filter?: PlanFilter) => Promise.resolve(page(plans)),
                },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-plans-tab'));
        expect(screen.getByTestId('kitchen-plan-balanced-week')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-plan-coastal-week')).toBeNull();

        // Priced from the cheapest size, per week — the contract has no per-delivery figure.
        expect(screen.getByTestId('kitchen-plan-balanced-week-price')).toHaveTextContent(/249/);

        await fireEvent.press(screen.getByTestId('kitchen-plan-balanced-week-choose'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/plans/${String(plans[0]!.id)}`);
    });

    it('moves to the Plans tab from the order panel', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: {
                marketplace: {
                    getKitchen,
                    listMeals,
                    listPlans: async () => Promise.resolve(page([])),
                },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-see-plans'));
        await fireEvent.press(screen.getByTestId('kitchen-see-plans'));

        await waitFor(() => screen.getByTestId('kitchen-plans-empty'));
        expect(screen.getByTestId('kitchen-tab-plans')).toBeSelected();
    });

    it('tallies the allergens the whole menu declares on the safety tab', async () => {
        const menu = verdantMenu([
            { allergens: ['milk' as AllergenCode] },
            { allergens: ['milk' as AllergenCode, 'gluten' as AllergenCode] },
            { allergens: [] },
        ]);

        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: {
                marketplace: { getKitchen, listMeals: async () => Promise.resolve(page(menu)) },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-tab-safety'));
        await fireEvent.press(screen.getByTestId('kitchen-tab-safety'));

        await waitFor(() => screen.getByTestId('kitchen-safety-tab'));
        expect(screen.getByTestId('kitchen-safety-allergens')).toHaveTextContent(/^2/);
        // The card's body names each allergen with the number of dishes declaring it.
        const body = screen.getByTestId('kitchen-safety-allergens-body');
        expect(body).toHaveTextContent(/Milk \(2\)/);
        expect(body).toHaveTextContent(/gluten \(1\)/);
        expect(screen.getByTestId('kitchen-safety-verified')).toHaveTextContent(/^Verified/);
        expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
    });

    /**
     * Every diet, not the three the card had room for.
     *
     * The directory card shows three and collapses the rest into a `+8`. The card is a single
     * press target — a pill inside it cannot be its own control without becoming a
     * `nested-interactive` failure — so that press lands here, and the count is only honest if
     * this page resolves it. Uncapped on purpose: a second `+N` would be the same dead end one
     * page further on. The design keeps them on the safety tab.
     */
    it('lists every diet the kitchen cooks for, uncapped', async () => {
        const many = testKitchen({
            ordinal: 1,
            name: 'Verdant Kitchen',
            slug: 'verdant-kitchen',
            diets: [
                'omnivore',
                'vegetarian',
                'vegan',
                'pescatarian',
                'keto',
                'low_carb',
                'high_protein',
                'mediterranean',
            ],
        });
        routerState.params = { tab: 'safety' };

        await renderStubScreen(<KitchenProfileScreen kitchenId={String(many.id)} />, {
            repositories: {
                marketplace: { getKitchen: async () => Promise.resolve(many), listMeals },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-diets'));

        for (const diet of many.dietClassifications) {
            expect(screen.getByTestId(`kitchen-diets-tags-${diet}`)).toBeTruthy();
        }

        // No overflow pill: the whole point of the page is that there is nothing left over.
        expect(screen.queryByTestId('kitchen-diets-tags-more')).toBeNull();
    });

    it('states the published terms per mode, and "—" where the contract is silent', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-order-panel'));
        expect(screen.getByTestId('kitchen-order-eta')).toHaveTextContent(/45 min$/);
        expect(screen.getByTestId('kitchen-order-minimum')).toHaveTextContent(/50/);
        expect(screen.getByTestId('kitchen-order-fee')).toHaveTextContent(/12/);
        expect(screen.getByTestId('kitchen-order-cutoff')).toBeTruthy();

        // Pickup: where to collect from is published; a collection lead time and charge are not.
        await fireEvent.press(screen.getByTestId('kitchen-order-mode-pickup'));
        expect(screen.getByTestId('kitchen-order-collect')).toHaveTextContent(/Jumeirah 1$/);
        expect(screen.getByTestId('kitchen-order-ready')).toHaveTextContent(/—$/);
        expect(screen.getByTestId('kitchen-order-pickup-fee')).toHaveTextContent(/—$/);
    });

    /**
     * "Today in the kitchen" is the day the kitchen publishes — opening, cut-off, delivery windows
     * and closing — never the design's production steps. The line's batch progress is not public,
     * and its card says so.
     */
    it('lays out the published day on the Today tab, and says the line is not public', async () => {
        const everyDay = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
            weekday,
            opensAt: '07:00',
            closesAt: '21:30',
            orderCutOffAt: '11:30',
        }));
        const daily: Kitchen = {
            ...VERDANT,
            branches: VERDANT.branches.map((branch) => ({ ...branch, openingHours: everyDay })),
            deliveryWindows: [
                { code: 'lunch', label: 'Lunch', startsAt: '12:15', endsAt: '13:00', weekdays: [] },
                { code: 'late', label: 'Late', startsAt: '13:15', endsAt: '14:00', weekdays: [] },
            ],
        };
        routerState.params = { tab: 'today' };

        await renderStubScreen(<KitchenProfileScreen kitchenId={String(daily.id)} />, {
            repositories: {
                marketplace: { getKitchen: async () => Promise.resolve(daily), listMeals },
            },
        });

        await waitFor(() => screen.getByTestId('kitchen-today-tab'));
        for (const step of ['opens', 'cutoff', 'window-lunch', 'window-late', 'closes']) {
            expect(screen.getByTestId(`kitchen-today-step-${step}`)).toBeTruthy();
        }
        expect(screen.getByTestId('kitchen-today-window-lunch')).toHaveTextContent('12:15–13:00');
        expect(screen.getByTestId('kitchen-today-line')).toHaveTextContent(/not published/);

        await fireEvent.press(screen.getByTestId('kitchen-today-pick'));
        await waitFor(() => screen.getByTestId('kitchen-menu-tab'));
        expect(screen.getByTestId('kitchen-tab-menu')).toBeSelected();
    });

    /** No endpoint lists a written review or a star distribution, so neither is invented. */
    it("shows the kitchen's own rating on the Reviews tab, and no reviews", async () => {
        routerState.params = { tab: 'reviews' };
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-reviews-tab'));
        expect(screen.getByTestId('kitchen-reviews-average')).toHaveTextContent('4.6');
        expect(screen.getByTestId('kitchen-reviews-count')).toHaveTextContent('24 ratings');
        expect(screen.getByTestId('kitchen-reviews-empty')).toHaveTextContent(/^No reviews yet/);
    });

    it('reports a failure rather than an empty page when the kitchen is unknown', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={UNKNOWN_ID} />, {
            repositories: { marketplace: { getKitchen } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-error')).toBeTruthy();
        });
    });

    it('shows the loading state before anything has arrived', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={UNKNOWN_ID} />, {
            repositories: { marketplace: { getKitchen } },
        });
        expect(screen.getByTestId('kitchen-loading')).toBeTruthy();
        await waitFor(() => screen.getByTestId('kitchen-error'));
    });
});

describe('KitchenMenuScreen', () => {
    it('puts nutrition on the card and navigates to the meal record', async () => {
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-menu-grid')).toBeTruthy();
        });

        // Doc 17, IA-12 / MKT-05: the energy figure is on the card, not behind a tap. Two of the
        // three authored listings are meals with figures; the sauce carries none.
        const cards = screen.getAllByTestId(/^meal-card-.*-nutrition$/);
        expect(cards).toHaveLength(2);

        /*
         * The *title* is the link, not the card.
         *
         * Every meal card carries an Add button now, and a control inside a pressable is an axe
         * `nested-interactive` failure — so the card is a grouping element and its title is the
         * target (`meal-card.tsx`, `BrowseCard`'s `titleAction`). This used to press the card root
         * with a regex that also matched the card's own children, which passed by accident of DOM
         * order; `-open` names the link outright.
         */
        const link = screen.getAllByTestId(/^meal-card-[a-z0-9-]+-open$/)[0];
        expect(link).toBeTruthy();
        await fireEvent.press(link!);

        // The catalogue wave's `/meals/{meal}` replaced the in-place summary drawer.
        expect(routerMock.__push).toHaveBeenCalledWith(expect.stringMatching(/^\/meals\//));
    });

    /**
     * All four macros, each a figure over its name, and only the ones the kitchen published.
     *
     * The card carried energy and protein; carbohydrate and fat were on the meal's own page. The
     * rating left this row for the title's baseline to make the room.
     *
     * They were one string of joined text — `520 cal  32g P` — and are now four stacked tiles, so
     * this asserts the number and the name where each is drawn. The unit went with the
     * abbreviation: a tile headed `Protein` does not need its figure to repeat that protein is
     * weighed in grams, and the bare numeral is what compares across a row of cards.
     */
    it('puts all four macros on the card, each figure over its name', async () => {
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-grid'));

        /*
         * 520 kcal, 32 g protein, 54 g carbohydrate, 18 g fat — the fixture's own numbers.
         *
         * A tile's two lines aggregate to one string, so each expectation is `figure` then `name`
         * with nothing between them. The names are capitalised in CSS, not in the catalogue, which
         * is why they read lower case here.
         */
        const base = 'meal-card-verdant-harvest-bowl-macro';
        for (const [key, content] of [
            ['energy', '520kcal'],
            ['protein', '32protein'],
            ['carbohydrate', '54carbs'],
            ['fat', '18fat'],
        ] as const) {
            expect(screen.getByTestId(`${base}-${key}`)).toHaveTextContent(content);
        }
    });

    /**
     * Silence, when there is nothing to declare.
     *
     * The card used to state "the kitchen declares no allergens in this dish" on every meal that
     * had none, at a reserved height. A grid of cards announcing what they do *not* contain is
     * noise on the scan the grid exists for; the claim is still made in full on the meal's own
     * page, which is where somebody deciding what they can safely eat actually reads.
     */
    it('says nothing about allergens when the kitchen declared none', async () => {
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-grid'));
        expect(screen.queryByTestId('meal-card-verdant-harvest-bowl-allergens')).toBeNull();
    });

    /**
     * Add is on the card for everybody, and an anonymous press is a question rather than a wall.
     *
     * It used to be on no card here at all, and on the discover grid only for people who had
     * already signed in. `commerce/use-basket-add.tsx` is the one implementation now, so a guest
     * gets the same offer from a grid that the meal page has always made.
     */
    it('offers Add on every card, and asks an anonymous visitor how to continue', async () => {
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-grid'));
        await fireEvent.press(screen.getByTestId('meal-card-verdant-harvest-bowl-add'));

        await waitFor(() => screen.getByTestId('kitchen-menu-guest-sign-in'));
        expect(screen.getByTestId('kitchen-menu-guest-register')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-menu-guest-continue')).toBeNull();
    });

    it('carries the medical disclaimer, because the cards carry figures', async () => {
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-grid'));
        expect(screen.getAllByTestId('medical-disclaimer').length).toBeGreaterThan(0);
    });

    it('renders an empty state when the filter excludes everything', async () => {
        routerState.params = { q: 'zzzz-nothing-matches' };
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-menu-empty')).toBeTruthy();
        });
    });

    it('filters the mixed menu down to products only', async () => {
        routerState.params = { itemType: 'product' };
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-menu-grid')).toBeTruthy();
        });

        expect(screen.getByTestId('meal-card-verdant-chilli-sauce')).toBeTruthy();
        expect(screen.queryByTestId('meal-card-verdant-harvest-bowl')).toBeNull();
        expect(screen.queryAllByTestId(/^meal-card-.*-nutrition$/)).toHaveLength(0);
    });

    it('says what a packed price buys, in the unit on the label', async () => {
        await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen, listMeals } },
        });

        await waitFor(() => screen.getByTestId('kitchen-menu-grid'));

        // 0.3 kg reads as the 300 g on the bottle; a dish priced as itself states no size.
        expect(screen.getByTestId('meal-card-verdant-chilli-sauce-pack')).toHaveTextContent(
            '/ 300 g',
        );
        expect(screen.queryByTestId('meal-card-verdant-harvest-bowl-pack')).toBeNull();
    });

    /*
     * The kitchen crumb pushed the storefront, so storefront › menu › storefront stacked up and
     * Back from the kitchen bounced between the two pages (browse-05, browse-12).
     */
    describe('its trail goes up, never forward', () => {
        const MENU_PATH = `/kitchens/${String(VERDANT.id)}/menu`;
        const STOREFRONT = `/kitchens/${String(VERDANT.id)}`;

        it('returns to the storefront it was opened from — Back, not a second copy', async () => {
            routerMock.__set({
                pathname: MENU_PATH,
                navState: {
                    index: 1,
                    routes: [
                        {
                            name: 'kitchens/[kitchen]/index',
                            params: { kitchen: String(VERDANT.id), tab: 'menu' },
                        },
                        {
                            name: 'kitchens/[kitchen]/menu',
                            params: { kitchen: String(VERDANT.id) },
                        },
                    ],
                },
            });
            await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
                repositories: { marketplace: { getKitchen, listMeals } },
            });

            await fireEvent.press(await screen.findByTestId('kitchen-menu-crumb-kitchen'));
            expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
            expect(routerMock.__push).not.toHaveBeenCalled();
        });

        it('opens the storefront as it was last shown when it is not the entry below', async () => {
            forgetQueries();
            rememberQuery(STOREFRONT, 'tab=menu&shelf=bowls');
            routerMock.__set({ pathname: MENU_PATH });
            await renderStubScreen(<KitchenMenuScreen kitchenId={String(VERDANT.id)} />, {
                repositories: { marketplace: { getKitchen, listMeals } },
            });

            await fireEvent.press(await screen.findByTestId('kitchen-menu-crumb-kitchen'));
            expect(routerMock.__push).toHaveBeenCalledWith(`${STOREFRONT}?tab=menu&shelf=bowls`);
            await fireEvent.press(screen.getByTestId('kitchen-menu-crumb-kitchens'));
            expect(routerMock.__push).toHaveBeenLastCalledWith('/kitchens');
        });
    });
});

/* ── dietitians ──────────────────────────────────────────────────────────────────────────────── */

describe('DietitiansScreen', () => {
    it('lists professionals with their synthetic-credential note', async () => {
        await renderStubScreen(<DietitiansScreen />, {
            repositories: { marketplace: { listDietitians } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('dietitians-grid')).toBeTruthy();
        });
        expect(screen.getAllByTestId(/-synthetic-credentials$/)).toHaveLength(DIETITIANS.length);
    });

    it('shows the empty state when a specialism matches nobody', async () => {
        routerState.params = { specialism: 'Underwater basket weaving' };
        await renderStubScreen(<DietitiansScreen />, {
            repositories: { marketplace: { listDietitians } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('dietitians-empty')).toBeTruthy();
        });
    });
});

describe('DietitianProfileScreen', () => {
    it('marks the invented registration and offers an honest consultation control', async () => {
        const [dietitian] = DIETITIANS;

        await renderStubScreen(<DietitianProfileScreen dietitianId={String(dietitian!.id)} />, {
            repositories: { marketplace: { getDietitian: async () => dietitian! } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('dietitian-name')).toBeTruthy();
        });
        expect(screen.getByTestId('dietitian-synthetic-note')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('prototype-action'));

        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
    });
});

/* ── explainer and business ──────────────────────────────────────────────────────────────────── */

describe('HowItWorksScreen', () => {
    it('renders four steps and the standing disclaimer', async () => {
        await renderStubScreen(<HowItWorksScreen />);

        for (const step of ['tell', 'target', 'plan', 'eat']) {
            expect(screen.getByTestId(`how-it-works-step-${step}`)).toBeTruthy();
        }
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });
});

describe('ForBusinessScreen', () => {
    it('presents the programmes without a single price', async () => {
        await renderStubScreen(<ForBusinessScreen />);

        for (const programme of ['corporate', 'clinic', 'gym', 'wholesale']) {
            expect(screen.getByTestId(`for-business-programme-${programme}`)).toBeTruthy();
        }
        // Business-price privacy: no currency marker may appear anywhere on this screen.
        const rendered = JSON.stringify(screen.toJSON());
        expect(rendered).not.toMatch(/AED|SAR|\bfrom \d/i);
        expect(screen.getByTestId('for-business-pricing')).toBeTruthy();
    });

    it('answers the quotation request with a real route rather than a dead control', async () => {
        await renderStubScreen(<ForBusinessScreen />);

        await fireEvent.press(screen.getByTestId('for-business-request-quotation'));

        await waitFor(() => {
            expect(screen.getByTestId('for-business-enquiry')).toBeTruthy();
        });

        await fireEvent.press(screen.getByTestId('for-business-enquiry-sign-in'));
        // On to the business application afterwards — the step the dialog promises (gap-01).
        expect(routerMock.__push).toHaveBeenCalledWith(withReturnTo('/sign-in', '/apply'));
    });

    it('registers with the business application as the return, too', async () => {
        await renderStubScreen(<ForBusinessScreen />);

        await fireEvent.press(screen.getByTestId('for-business-request-quotation'));
        await fireEvent.press(await screen.findByTestId('for-business-enquiry-register'));
        expect(routerMock.__push).toHaveBeenCalledWith(withReturnTo('/register', '/apply'));
    });

    it('opens the business application straight away for somebody already signed in', async () => {
        const { queryClient } = await renderStubScreen(<ForBusinessScreen />, {
            session: testMeResponse(),
        });

        // The session restores asynchronously; until then the press would still ask.
        await waitFor(() => {
            expect(queryClient.getQueryData(queryKeys.me())).toBeDefined();
        });
        await fireEvent.press(screen.getByTestId('for-business-request-quotation'));
        expect(routerMock.__push).toHaveBeenCalledWith('/apply');
        expect(screen.queryByTestId('for-business-enquiry-sign-in')).toBeNull();
    });
});

describe('HowItWorksScreen — the next step', () => {
    it('offers a visitor an account, returning to this page', async () => {
        routerMock.__set({ pathname: '/how-it-works' });
        await renderStubScreen(<HowItWorksScreen />);

        await fireEvent.press(screen.getByTestId('how-it-works-register'));
        expect(routerMock.__push).toHaveBeenCalledWith(withReturnTo('/register', '/how-it-works'));
    });

    it('offers somebody signed in their plans instead of an account they already have', async () => {
        await renderStubScreen(<HowItWorksScreen />, { session: testMeResponse() });

        await fireEvent.press(await screen.findByTestId('how-it-works-plans'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans');
        expect(screen.queryByTestId('how-it-works-register')).toBeNull();
    });
});

/* ── discover ────────────────────────────────────────────────────────────────────────────────── */

describe('DiscoverScreen', () => {
    /*
     * The search hand-off this suite used to assert here now lives in the chrome
     * (`shell/marketplace-shell.tsx`), so that it is reachable from every marketplace screen rather
     * than only from this one. It writes the same `?q=` the catalogue's own filters read.
     */
    it('sends the hero call to action into the catalogue', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listKitchens, listMeals } },
        });

        await fireEvent.press(screen.getByTestId('discover-hero-meals'));

        expect(routerMock.__push).toHaveBeenCalledWith('/meals');
    });

    /*
     * The tile carries the filter, not just the destination. A category that landed on the bare
     * catalogue would look like it worked while quietly ignoring the thing the person picked.
     */
    it('opens the menu filtered to a shelf from a category tile', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listKitchens, listMeals: listShelvedMeals } },
        });

        await waitFor(() => screen.getByTestId('discover-category-bowls'));
        await fireEvent.press(screen.getByTestId('discover-category-bowls'));

        // The same `category` the menu's CATEGORY rail writes — a filter the server applies.
        expect(routerMock.__push).toHaveBeenCalledWith('/meals?category=bowls');
    });

    /*
     * Six tiles: the shelves that hold a meal, then the narrower diets with the most. `omnivore`
     * is never a tile — it is "everything" under another name — and a diet tile filters by diet.
     */
    it('fills the category row with the diets that have the most meals', async () => {
        const diets: readonly DietClassification[] = [
            'vegan',
            'vegan',
            'keto',
            'high_protein',
            'high_protein',
            'high_protein',
        ];
        const meals = diets.map((diet, index): MarketplaceMeal => ({
            ...testMeal({
                ordinal: 40 + index,
                name: `Diet meal ${String(index + 1)}`,
                slug: `diet-meal-${String(index + 1)}`,
                kitchen: VERDANT,
            }),
            dietClassifications: ['omnivore', diet],
        }));

        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals: async () => page(meals) } },
        });

        await waitFor(() => screen.getByTestId('discover-category-high_protein'));
        expect(screen.getByTestId('discover-category-high_protein')).toHaveTextContent(/3 meals$/);
        expect(screen.getByTestId('discover-category-vegan')).toHaveTextContent(/2 meals$/);
        expect(screen.getByTestId('discover-category-keto')).toHaveTextContent(/1 meal$/);
        expect(screen.queryByTestId('discover-category-omnivore')).toBeNull();

        await fireEvent.press(screen.getByTestId('discover-category-vegan'));
        expect(routerMock.__push).toHaveBeenCalledWith('/meals?diet=vegan');
    });

    /* Every count is over the whole catalogue, so the home reads every page before it counts. */
    it('reads every page of the catalogue before it counts it', async () => {
        const first = testMeal({
            ordinal: 60,
            name: 'Page one',
            slug: 'page-one',
            kitchen: VERDANT,
        });
        const second: MarketplaceMeal = {
            ...testMeal({ ordinal: 61, name: 'Page two', slug: 'page-two', kitchen: SAFFRON }),
            publishedCategory: { code: 'soups', name: 'Soups' },
        };
        const listPaged = jest.fn(async (filter?: MealFilter) =>
            filter?.cursor === 'next' ? page([second]) : page([first], { nextCursor: 'next' }),
        );

        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals: listPaged } },
        });

        // The shelf only the second page holds has its tile, so the walk read both pages.
        await waitFor(() => screen.getByTestId('discover-category-soups'));
        expect(listPaged).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('discover-hero-eyebrow')).toHaveTextContent(
            'From 2 kitchens · 2 meals on the menu',
        );
    });

    /*
     * One ranking read from the top: the grid takes the first four, the rail continues with the
     * next three rather than repeating any of them, and the panel beside it goes to the plans.
     */
    it('continues the ranking in the rail beside the plans panel', async () => {
        const ranked = rankedMeals();

        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals: async () => page(ranked) } },
        });

        await waitFor(() => screen.getByTestId('discover-rail'));
        expect(screen.getByTestId('meal-card-ranked-meal-4')).toBeTruthy();
        expect(screen.queryByTestId('meal-card-ranked-meal-5')).toBeNull();
        expect(screen.getByTestId('discover-rail-title')).toHaveTextContent('Also rated highly');
        expect(screen.getByTestId('discover-rail-ranked-meal-5')).toBeTruthy();
        expect(screen.getByTestId('discover-rail-ranked-meal-7')).toBeTruthy();
        expect(screen.queryByTestId('discover-rail-ranked-meal-8')).toBeNull();

        await fireEvent.press(screen.getByTestId('discover-rail-ranked-meal-5'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/meals/${String(ranked[4]?.id)}`);

        await fireEvent.press(screen.getByTestId('discover-offer-action'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans');
    });

    it('draws no rail when the ranking ends inside the grid', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals } },
        });

        await waitFor(() => screen.getByTestId('meal-card-verdant-harvest-bowl'));
        expect(screen.getByTestId('discover-offer')).toBeTruthy();
        expect(screen.queryByTestId('discover-rail')).toBeNull();
    });

    /*
     * The card's figure line states only what was published, and a dish nobody has rated says so
     * in the rating's slot rather than showing a star with nothing after it.
     */
    it('prints the published figures and an honest rating slot on each card', async () => {
        const harvest = MEALS[0];
        if (harvest === undefined) throw new Error('The fixture lost its first meal.');
        const unrated: MarketplaceMeal = { ...harvest, rating: null, ratingCount: 0 };

        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals: async () => page([unrated]) } },
        });

        await waitFor(() => screen.getByTestId('meal-card-verdant-harvest-bowl-figures'));
        expect(screen.getByTestId('meal-card-verdant-harvest-bowl-figure-energy')).toBeTruthy();
        expect(screen.getByTestId('meal-card-verdant-harvest-bowl-figure-protein')).toBeTruthy();
        expect(
            screen.getByTestId('meal-card-verdant-harvest-bowl-figure-rating'),
        ).toHaveTextContent('Not rated yet');
    });

    /*
     * The design's offer band, bound to the one discount the product publishes: the best run
     * discount across the plans, and the shortest run that earns it.
     */
    it('names the best plan run discount in the offer band', async () => {
        const plan: SubscriptionPlan = {
            id: uuid(7, 90) as SubscriptionPlanId,
            kitchenId: VERDANT.id,
            name: 'Offer week',
            slug: 'offer-week',
            summary: '',
            description: '',
            categorySlugs: [],
            dietClassifications: ['omnivore'],
            variants: [],
            durations: [
                { duration: '7d', days: 7, discountPercent: 0, totalPrice: null },
                // The same discount on the shorter and the longer run: the band names the
                // shortest, and a run is named by its length rather than counted in weeks.
                { duration: '20d', days: 20, discountPercent: 10, totalPrice: null },
                { duration: '84d', days: 84, discountPercent: 10, totalPrice: null },
            ],
            imagePlaceholderId: 'plan-90',
            rating: null,
            ratingCount: 0,
        };

        await renderStubScreen(<DiscoverScreen />, {
            repositories: {
                marketplace: { listMeals, listPlans: async () => page([plan]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('discover-offer-title')).toHaveTextContent(
                'Meal plans: up to 10% off when you choose 20 days or more',
            );
        });
        await fireEvent.press(screen.getByTestId('discover-offer-action'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans');
    });

    /*
     * Signed in, with an order: the hero's second button is the design's "Track order", opening
     * that order, and the card beside the band is "because you ordered" it — the meals most like
     * the ordered one that the grid is not already showing.
     */
    it('tracks the latest order from the hero and recommends from it', async () => {
        const order = testOrder('Ranked meal 6');

        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                marketplace: { listMeals: async () => page(rankedMeals()) },
                commerce: { listMyOrders: async () => page([order]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('discover-rail-title')).toHaveTextContent(
                'Because you ordered Ranked meal 6',
            );
        });
        expect(screen.getByTestId('discover-rail-ranked-meal-5')).toBeTruthy();
        expect(screen.getByTestId('discover-rail-ranked-meal-7')).toBeTruthy();
        expect(screen.queryByTestId('discover-rail-ranked-meal-6')).toBeNull();

        expect(screen.getByTestId('discover-hero-track')).toHaveTextContent(
            'Track order H360-1042',
        );
        await fireEvent.press(screen.getByTestId('discover-hero-track'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/customer/orders/${String(order.id)}`);
    });

    /*
     * A delivered order has nothing left to track: the hero tracks the newest one still on its way
     * (a plan's next day), and with none the button is the screen's own alternative again.
     */
    it('does not track a delivered order from the hero', async () => {
        const delivered: PlacedOrder = {
            ...testOrder('Ranked meal 6'),
            id: uuid(9, 2) as PlacedOrder['id'],
            reference: 'H360-1043',
            state: 'delivered',
        };
        const next: PlacedOrder = { ...testOrder('Ranked meal 6'), state: 'placed' };

        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                marketplace: { listMeals: async () => page(rankedMeals()) },
                commerce: { listMyOrders: async () => page([delivered, next]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('discover-hero-track')).toHaveTextContent(
                'Track order H360-1042',
            );
        });
    });

    it('drops the hero track button once every order is delivered', async () => {
        const delivered: PlacedOrder = { ...testOrder('Ranked meal 6'), state: 'delivered' };

        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                marketplace: { listMeals: async () => page(rankedMeals()) },
                commerce: { listMyOrders: async () => page([delivered]) },
            },
        });

        // The rail still reads the delivered order: it is what they last ate.
        await waitFor(() => {
            expect(screen.getByTestId('discover-rail-title')).toHaveTextContent(
                'Because you ordered Ranked meal 6',
            );
        });
        expect(screen.queryByTestId('discover-hero-track')).toBeNull();
    });
});

/** Eight lunches from one kitchen, in the order the rating sort hands them back. */
function rankedMeals(): readonly MarketplaceMeal[] {
    return Array.from({ length: 8 }, (_, index) =>
        testMeal({
            ordinal: 20 + index,
            name: `Ranked meal ${String(index + 1)}`,
            slug: `ranked-meal-${String(index + 1)}`,
            kitchen: VERDANT,
        }),
    );
}

/** A placed order whose one line names `mealName`, for the home's "Track order" and its rail. */
function testOrder(mealName: string): PlacedOrder {
    return {
        id: uuid(9, 1) as PlacedOrder['id'],
        reference: 'H360-1042',
        state: 'confirmed',
        lines: [
            {
                id: 'line-1',
                name: mealName,
                quantity: 1,
                unitPrice: { amount: 4500, currency: 'AED' },
                lineTotal: { amount: 4500, currency: 'AED' },
            },
        ],
        priceLines: [],
        total: { amount: 4500, currency: 'AED' },
        address: {
            label: 'Home',
            line1: '12 Test Street',
            line2: null,
            area: 'Jumeirah 1',
            city: 'Dubai',
            countryCode: 'AE',
            instructions: null,
        },
        slotCode: 'morning',
        deliveryDate: '2026-08-20',
        placedAt: '2026-08-18T09:00:00.000Z',
    };
}

/* ── discover as the only home ───────────────────────────────────────────────────────────────── */

/*
 * `/` and `/customer` both forward to Discover now. These are the cases the two screens they used
 * to render covered, asserted on the one page that is left.
 */
describe('DiscoverScreen as the only home', () => {
    /*
     * The design's delivery-slot eyebrow and "All 48 meals", made true: both count the whole
     * prepared-meal listing — the sauce is a product and is not counted.
     */
    it('counts the catalogue into the hero eyebrow, the header link and every tile', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals: listShelvedMeals } },
        });

        expect(screen.getByTestId('discover-category-skeleton-1')).toBeTruthy();

        await waitFor(() => screen.getByTestId('discover-category-bowls'));
        expect(screen.queryByTestId('discover-category-skeleton-1')).toBeNull();
        expect(screen.getByTestId('discover-hero-eyebrow')).toHaveTextContent(
            'From 1 kitchen · 2 meals on the menu',
        );
        expect(screen.getByTestId('discover-categories-header-action')).toHaveTextContent(
            'All 2 meals →',
        );
        expect(screen.getByTestId('discover-category-bowls')).toHaveTextContent(/1 meal$/);
        expect(screen.getByTestId('discover-category-soups')).toHaveTextContent(/1 meal$/);
        // Only shelves that hold a prepared meal get a tile; meal type is never one.
        expect(screen.queryByTestId('discover-category-lunch')).toBeNull();
    });

    it('offers Add to a visitor with no account, and asks how to continue', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals } },
        });

        await waitFor(() => screen.getByTestId('meal-card-verdant-harvest-bowl-add'));
        await fireEvent.press(screen.getByTestId('meal-card-verdant-harvest-bowl-add'));

        await waitFor(() => screen.getByTestId('discover-guest-sign-in'));
        expect(screen.getByTestId('discover-guest-register')).toBeTruthy();
    });

    /* A visitor's page is the storefront and nothing else: none of an account's extras. */
    it('shows a visitor none of the signed-in extras', async () => {
        recordResumeIntent({ href: '/kitchens', labelKey: 'marketplace:nav.kitchens' });

        const { repositories } = await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listMeals } },
        });

        await waitFor(() => screen.getByTestId('meal-card-verdant-harvest-bowl'));
        expect(screen.queryByTestId('discover-resume')).toBeNull();
        expect(screen.queryByTestId('discover-links')).toBeNull();
        expect(screen.queryByTestId('medical-disclaimer')).toBeNull();
        expect(repositories.commerce.listSubscriptions).not.toHaveBeenCalled();
    });

    /*
     * The running subscription takes the offer band — the design's brand-subtle panel — and the
     * band's button manages it. Its next delivery is the hero's eyebrow.
     */
    it('puts the running subscription in the offer band, managed from its button', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                commerce: { listSubscriptions: async () => page([ACTIVE_SUBSCRIPTION]) },
                marketplace: { listMeals },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('discover-offer-title')).toHaveTextContent('Balanced week');
        });
        expect(screen.getByTestId('discover-offer-eyebrow')).toHaveTextContent(
            'Your subscription · Active',
        );
        expect(screen.getByTestId('discover-offer-body')).toHaveTextContent(/August/);
        expect(screen.getByTestId('discover-hero-eyebrow')).toHaveTextContent(/August/);
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('discover-subscription-manage'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            `/customer/subscriptions/${String(ACTIVE_SUBSCRIPTION.id)}`,
        );
    });

    /*
     * "Live", not merely "not cancelled": a subscription that ran its full length is expired, and
     * it used to take the band as though it were still delivering.
     */
    it('does not put a subscription that has run its course in the band', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                commerce: {
                    listSubscriptions: async () =>
                        page([{ ...ACTIVE_SUBSCRIPTION, state: 'expired' as const }]),
                },
                marketplace: { listMeals },
            },
        });

        await waitFor(() => screen.getByTestId('meal-card-verdant-harvest-bowl'));
        expect(screen.queryByTestId('discover-subscription-manage')).toBeNull();
        // The band is the plans offer again, and the hero's eyebrow names no next delivery.
        await fireEvent.press(screen.getByTestId('discover-offer-action'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans');
        expect(screen.queryByTestId('discover-hero-eyebrow')).not.toHaveTextContent(/August/);
    });

    it('keeps the plans offer in the band for somebody with no subscription', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                commerce: { listSubscriptions: async () => page([]) },
                marketplace: { listMeals },
            },
        });

        await waitFor(() => screen.getByTestId('meal-card-verdant-harvest-bowl'));
        expect(screen.queryByTestId('discover-subscription-manage')).toBeNull();
        await fireEvent.press(screen.getByTestId('discover-offer-action'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans');
    });

    // The account's tiles are gone: the header's account icon opens the account page, which holds
    // subscriptions, and staff reach their profile from their own header icon.
    it('closes on no account tiles once signed in', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                commerce: { listSubscriptions: async () => page([]) },
                marketplace: { listMeals },
            },
        });

        await waitFor(() => screen.getByTestId('discover-hero'));
        expect(screen.queryByTestId('discover-links')).toBeNull();
    });

    it('offers to resume a marketplace page recorded before sign-in', async () => {
        recordResumeIntent({ href: '/kitchens', labelKey: 'marketplace:nav.kitchens' });

        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                commerce: { listSubscriptions: async () => page([]) },
                marketplace: { listMeals },
            },
        });

        // Shown once the session has restored: the notice is a signed-in person's.
        expect(await screen.findByTestId('discover-resume')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('discover-resume-continue'));
        expect(routerMock.__push).toHaveBeenCalledWith('/kitchens');
        expect(getResumeIntent()).toBeNull();
    });

    it('never offers to resume the page the person is already on', async () => {
        routerMock.__set({ pathname: '/discover' });
        recordResumeIntent({ href: '/discover', labelKey: 'marketplace:nav.discover' });

        await renderStubScreen(<DiscoverScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                commerce: { listSubscriptions: async () => page([]) },
                marketplace: { listMeals },
            },
        });

        // The disclaimer is a signed-in extra, so by then the notice would have shown.
        await waitFor(() => screen.getByTestId('medical-disclaimer'));
        expect(screen.queryByTestId('discover-resume')).toBeNull();
    });
});

/* ── navigation and shells ───────────────────────────────────────────────────────────────────── */

describe('navigation descriptors', () => {
    it('offers only the destinations whose feature has a backend today', () => {
        const offered = [...consumerNavigation(), ...marketplaceNavigation()]
            .map((item) => item.href)
            .sort();

        expect([...new Set(offered)]).toEqual([
            '/customer/cart',
            '/customer/subscriptions',
            '/discover',
            '/for-business',
            '/how-it-works',
            '/kitchens',
            '/meals',
            '/plans',
        ]);
    });
});

describe('ConsumerShell', () => {
    it('wears the customer header rather than a sidebar, and its basket goes to the cart', async () => {
        await renderStubScreen(
            <ConsumerShell unguarded>
                <></>
            </ConsumerShell>,
            { session: CONSUMER_SESSION },
        );

        // The destinations themselves are a menu at Jest's phone width; the bar is what moved.
        expect(screen.getByTestId('marketplace-shell')).toBeTruthy();
        expect(screen.queryByTestId('consumer-shell')).toBeNull();
        expect(screen.queryByTestId('consumer-nav-home')).toBeNull();

        // The session restores asynchronously; the basket is offered once it has. Destinations
        // are navigated to, not pushed: an entry for the same route is reused (CHROME-11).
        await fireEvent.press(await screen.findByTestId('marketplace-basket'));
        expect(routerMock.__router.navigate).toHaveBeenCalledWith('/customer/cart');

        // The account is one icon straight to the account page — no menu in between.
        expect(screen.queryByTestId('marketplace-account-menu')).toBeNull();
        await fireEvent.press(screen.getByTestId('marketplace-account'));
        expect(routerMock.__router.navigate).toHaveBeenCalledWith('/customer/account');
        expect(routerMock.__push).not.toHaveBeenCalled();
        expect(screen.getByTestId('locale-toggle')).toBeTruthy();
        expect(screen.getByTestId('theme-toggle')).toBeTruthy();
        // A plain customer has no staff workspace, so no staff profile icon.
        expect(screen.queryByTestId('marketplace-staff-profile')).toBeNull();
        expect(screen.queryByTestId('marketplace-workspaces')).toBeNull();
    });

    it('gives a business buyer the view-only shop, before any organisation is chosen', async () => {
        await renderStubScreen(
            <ConsumerShell unguarded>
                <></>
            </ConsumerShell>,
            { session: BUSINESS_BUYER_SESSION },
        );

        // They order wholesale from `/corporate`, which the Workspaces button leads to.
        await fireEvent.press(await screen.findByTestId('marketplace-workspaces-button'));
        expect(routerMock.__push).toHaveBeenCalledWith('/workspace');
        expect(screen.getByTestId('marketplace-sign-out')).toBeTruthy();
        expect(screen.queryByTestId('marketplace-basket')).toBeNull();
        expect(screen.queryByTestId('marketplace-account')).toBeNull();
    });

    it('gives staff a view-only shop: Workspaces and Sign out, no basket or account', async () => {
        await renderStubScreen(
            <ConsumerShell unguarded>
                <></>
            </ConsumerShell>,
            { session: kitchenManagerSession() },
        );

        await fireEvent.press(await screen.findByTestId('marketplace-workspaces-button'));
        expect(routerMock.__push).toHaveBeenCalledWith('/workspace');
        expect(screen.getByTestId('marketplace-sign-out')).toBeTruthy();
        expect(screen.getByTestId('locale-toggle')).toBeTruthy();
        expect(screen.getByTestId('theme-toggle')).toBeTruthy();
        // Everything a customer does is gone.
        expect(screen.queryByTestId('marketplace-basket')).toBeNull();
        expect(screen.queryByTestId('marketplace-account')).toBeNull();
        expect(screen.queryByTestId('marketplace-staff-profile')).toBeNull();
        // The bar's button is the way back, so the menu carries no second one.
        await fireEvent.press(screen.getByTestId('marketplace-shell-menu'));
        expect(screen.queryByTestId('marketplace-workspaces')).toBeNull();
        expect(screen.queryByTestId('prototype-notice')).toBeNull();
    });
});

describe('the shop’s staff view', () => {
    const meal = MEALS[0]!;
    const card = (viewOnly: boolean) => (
        <ShopViewOnlyProvider value={viewOnly}>
            <MealCard meal={meal} onPress={jest.fn()} onAdd={jest.fn()} />
        </ShopViewOnlyProvider>
    );

    it('keeps Add on a meal card for a customer', async () => {
        await renderStubScreen(card(false));
        expect(screen.getByTestId(`meal-card-${meal.slug}-add`)).toBeTruthy();
    });

    it('drops Add from a meal card for staff, leaving the card to show', async () => {
        await renderStubScreen(card(true));
        expect(screen.queryByTestId(`meal-card-${meal.slug}-add`)).toBeNull();
        expect(screen.getByText(meal.name)).toBeTruthy();
    });

    it('adds nothing while the shop is view-only, whatever presses Add', async () => {
        function AddButton() {
            const basket = useBasketAdd({ labelKey: 'catalogue:nav.meals', testID: 'probe' });
            return (
                <Pressable
                    testID="probe-add"
                    onPress={() => {
                        basket.add({ id: meal.id, kitchenId: meal.kitchenId });
                    }}
                />
            );
        }
        const { repositories } = await renderStubScreen(
            <ShopViewOnlyProvider value>
                <AddButton />
            </ShopViewOnlyProvider>,
            { session: kitchenManagerSession() },
        );
        const getCart = jest.spyOn(repositories.commerce, 'getCart');
        const addCartItem = jest.spyOn(repositories.commerce, 'addCartItem');

        await fireEvent.press(screen.getByTestId('probe-add'));

        expect(getCart).not.toHaveBeenCalled();
        expect(addCartItem).not.toHaveBeenCalled();
        expect(readPendingAdd()).toBeNull();
    });
});

describe('the customer area for a view-only shopper', () => {
    it('sends a business buyer from the basket back to the shop', async () => {
        routerMock.__set({ pathname: '/customer/cart' });
        await renderStubScreen(<CustomerLayout />, { session: BUSINESS_BUYER_SESSION });

        await waitFor(() => {
            expect(routerMock.__redirect).toHaveBeenCalledWith('/discover');
        });
    });

    it('lets a business buyer through to the wholesale checkout `/corporate` sends them to', async () => {
        routerMock.__set({ pathname: '/customer/checkout', params: { channel: 'wholesale' } });
        await renderStubScreen(<CustomerLayout />, { session: BUSINESS_BUYER_SESSION });

        // The session has restored once the shop's chrome is the view-only one.
        await screen.findByTestId('marketplace-workspaces-button');
        expect(routerMock.__redirect).not.toHaveBeenCalledWith('/discover');
    });

    it('keeps staff off the wholesale checkout — it is a business buyer’s', async () => {
        routerMock.__set({ pathname: '/customer/checkout', params: { channel: 'wholesale' } });
        await renderStubScreen(<CustomerLayout />, { session: kitchenManagerSession() });

        await waitFor(() => {
            expect(routerMock.__redirect).toHaveBeenCalledWith('/discover');
        });
    });
});

describe('MarketplaceShell — header destinations', () => {
    const shell = (
        <ConsumerShell unguarded>
            <></>
        </ConsumerShell>
    );

    it('takes the brand to the marketplace home, not to the launch resolver', async () => {
        await renderStubScreen(shell, { session: CONSUMER_SESSION });

        await fireEvent.press(screen.getByTestId('brand-mark'));
        expect(routerMock.__router.navigate).toHaveBeenCalledWith('/discover');
        expect(routerMock.__push).not.toHaveBeenCalledWith('/');
    });

    it('does nothing for the destination the person is already on, and says it is current', async () => {
        routerMock.__set({ pathname: '/customer/account' });
        await renderStubScreen(shell, { session: CONSUMER_SESSION });

        const account = await screen.findByTestId('marketplace-account');
        expect(account.props['aria-current']).toBe('page');
        await fireEvent.press(account);
        expect(routerMock.__router.navigate).not.toHaveBeenCalled();
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('signs in from the header with the page, query and all, as the return', async () => {
        routerMock.__set({ pathname: '/meals', params: { diet: 'vegan' } });
        await renderStubScreen(shell);

        await fireEvent.press(await screen.findByTestId('marketplace-sign-in'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            withReturnTo('/sign-in', '/meals?diet=vegan'),
        );
        expect(getResumeIntent()?.href).toBe('/meals?diet=vegan');
    });

    it('signs in from the footer with the same return', async () => {
        routerMock.__set({ pathname: '/kitchens' });
        await renderStubScreen(shell);

        await fireEvent.press(await screen.findByTestId('footer-sign-in'));
        expect(routerMock.__push).toHaveBeenCalledWith(withReturnTo('/sign-in', '/kitchens'));
    });
});

/* ── where a page opens, and the menu drawer (browse-04, CHROME-15) ──────────────────────────── */

describe('MarketplaceShell — the page’s place', () => {
    const shell = (
        <ConsumerShell unguarded>
            <></>
        </ConsumerShell>
    );
    // The jest-preset's scroll view mock shares one `scrollTo` spy across every instance.
    const scrollTo = ScrollView.prototype.scrollTo as unknown as jest.Mock;

    /** The root stack holding the marketplace group, its pages `keys` deep, the last on screen. */
    function stack(...keys: readonly string[]) {
        return {
            index: 0,
            routes: [
                {
                    name: '(marketplace)',
                    key: 'marketplace-group',
                    state: {
                        index: keys.length - 1,
                        routes: keys.map((key) => ({ name: 'page', key })),
                    },
                },
            ],
        };
    }

    async function scrollPortTo(y: number) {
        await fireEvent.scroll(screen.getByTestId('marketplace-shell-content'), {
            nativeEvent: { contentOffset: { x: 0, y } },
        });
    }

    beforeEach(() => {
        scrollTo.mockClear();
    });

    it('opens a page reached by going forward at its top, and a page returned to where it was left', async () => {
        routerMock.__set({ pathname: '/meals', navState: stack('place-menu') });
        await renderStubScreen(shell);
        await scrollPortTo(1600);

        // A meal opened from far down the menu: the meal page starts at its top.
        scrollTo.mockClear();
        await act(async () => {
            routerMock.__set({
                pathname: '/meals/7',
                navState: stack('place-menu', 'place-meal'),
            });
        });
        expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
        await scrollPortTo(400);

        // Back: the menu's own entry, at the place the reader left it.
        scrollTo.mockClear();
        await act(async () => {
            routerMock.__set({ pathname: '/meals', navState: stack('place-menu') });
        });
        expect(scrollTo).toHaveBeenCalledWith({ y: 1600, animated: false });
    });

    it('leaves the reader where they are when only the page’s query changes', async () => {
        routerMock.__set({ pathname: '/meals', navState: stack('place-filters') });
        await renderStubScreen(shell);
        await scrollPortTo(900);

        scrollTo.mockClear();
        // `setParams` keeps the entry, and so its key.
        await act(async () => {
            routerMock.__set({ params: { diet: 'vegan' } });
        });
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('closes the menu drawer when the page changes underneath it', async () => {
        routerMock.__set({ pathname: '/meals' });
        await renderStubScreen(shell);

        // Jest's window is a phone's, so the destinations are behind the menu button.
        await fireEvent.press(screen.getByTestId('marketplace-shell-menu'));
        expect(screen.getByTestId('marketplace-nav-meals')).toBeTruthy();

        // Browser Back, say: nothing inside the shell was pressed.
        await act(async () => {
            routerMock.__set({ pathname: '/kitchens' });
        });
        expect(screen.queryByTestId('marketplace-nav-meals')).toBeNull();
    });
});

/* ── the header search and the menu's own (browse-06) ────────────────────────────────────────── */

describe('MarketplaceShell — search', () => {
    const shell = (
        <ConsumerShell unguarded>
            <></>
        </ConsumerShell>
    );
    const narrow = Dimensions.get('window');
    const narrowScreen = Dimensions.get('screen');
    const atWidth = (width: number) => {
        Dimensions.set({
            window: { ...narrow, width, height: 900 },
            screen: { ...narrowScreen, width, height: 900 },
        });
    };
    afterEach(async () => {
        // Still mounted here — the suite's cleanup runs after this — so the resize is an update.
        await act(async () => {
            Dimensions.set({ window: narrow, screen: narrowScreen });
        });
        takeMenuSearchFocus();
    });

    it('shows the menu’s term in the header field, and searches there in place', async () => {
        atWidth(1440);
        routerMock.__set({ pathname: '/meals', params: { q: 'salad', diet: 'vegan' } });
        await renderStubScreen(shell);

        const field = await screen.findByTestId('marketplace-search');
        expect(field.props.value).toBe('salad');

        await fireEvent.changeText(field, 'grain bowl');
        await fireEvent(field, 'submitEditing');
        // The diet stays: a search on the menu narrows what is already applied.
        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ q: 'grain bowl' });
        expect(routerMock.__push).not.toHaveBeenCalled();

        // Lifted elsewhere — a chip removed, "Clear all" — the header follows.
        await act(async () => {
            routerMock.__set({ params: { diet: 'vegan' } });
        });
        expect(screen.getByTestId('marketplace-search').props.value).toBe('');
    });

    it('opens the menu on the term from any other page', async () => {
        atWidth(1440);
        routerMock.__set({ pathname: '/kitchens', params: { q: 'thai' } });
        await renderStubScreen(shell);

        // Another page's `?q=` is its own search, not the menu's.
        const field = await screen.findByTestId('marketplace-search');
        expect(field.props.value).toBe('');
        await fireEvent.changeText(field, 'soup & bread');
        await fireEvent(field, 'submitEditing');
        expect(routerMock.__push).toHaveBeenCalledWith('/meals?q=soup+%26+bread');
        expect(routerMock.__router.setParams).not.toHaveBeenCalled();
    });

    it('opens the menu from the tablet’s search button with the cursor waiting in its field', async () => {
        atWidth(1024);
        routerMock.__set({ pathname: '/kitchens' });
        await renderStubScreen(shell);

        await fireEvent.press(await screen.findByTestId('marketplace-search-button'));
        expect(routerMock.__router.navigate).toHaveBeenCalledWith('/meals');
        expect(routerMock.__push).not.toHaveBeenCalled();
        // Taken by the menu's field when it mounts (`menu-search-focus.ts`).
        expect(takeMenuSearchFocus()).toBe(true);
    });
});

/* ── the add a sign-in was started for (AUTH-01) ─────────────────────────────────────────────── */

describe('MarketplaceShell — a kept add', () => {
    const cartId = uuid(9, 1) as CartId;
    const MEAL_ID = uuid(5, 1) as MealId;
    const shell = (
        <ConsumerShell unguarded>
            <></>
        </ConsumerShell>
    );

    function commerce() {
        let itemCount = 0;
        const cart = (): Cart => ({
            id: cartId,
            items: [],
            subtotal: { amount: 0, currency: 'AED' },
            itemCount,
            updatedAt: '2026-08-11T09:00:00.000Z',
        });
        return {
            getCart: async () => cart(),
            addCartItem: jest.fn(async (_id: CartId, request: { quantity: number }) => {
                itemCount += request.quantity;
                return cart();
            }),
        };
    }

    it('adds it once the session can hold a basket, with the usual confirmation', async () => {
        writePendingAdd({ mealId: MEAL_ID, quantity: 2, kitchenId: VERDANT.id });
        const repositories = commerce();

        await renderStubScreen(shell, {
            session: CONSUMER_SESSION,
            repositories: { commerce: repositories },
        });

        expect(await screen.findByTestId('basket-added')).toBeTruthy();
        expect(repositories.addCartItem).toHaveBeenCalledTimes(1);
        expect(repositories.addCartItem).toHaveBeenCalledWith(cartId, {
            mealId: MEAL_ID,
            quantity: 2,
        });
        // Spent: a refresh, or the next page, does not add it again.
        expect(readPendingAdd()).toBeNull();
    });

    it('keeps waiting while the address is unconfirmed', async () => {
        writePendingAdd({ mealId: MEAL_ID, quantity: 1, kitchenId: VERDANT.id });
        const repositories = commerce();

        await renderStubScreen(shell, {
            session: testMeResponse({ user: { emailVerifiedAt: null } }),
            repositories: { commerce: repositories },
        });

        await waitFor(() => screen.getByTestId('marketplace-shell'));
        expect(repositories.addCartItem).not.toHaveBeenCalled();
        expect(readPendingAdd()).not.toBeNull();
    });

    /*
     * Every way of signing out runs the one mutation, so that is where the tab's drafts and the
     * resume intent are dropped: they belonged to the person who just left (AUTH-13, AUTH-15).
     */
    it('is forgotten, with the page to come back to, when the person signs out', async () => {
        function SignOut() {
            const logout = useLogoutMutation();
            return (
                <Pressable
                    testID="probe-sign-out"
                    onPress={() => {
                        logout.mutate();
                    }}
                />
            );
        }
        writePendingAdd({ mealId: MEAL_ID, quantity: 1 });
        recordResumeIntent({ href: '/kitchens', labelKey: 'marketplace:nav.kitchens' });

        await renderStubScreen(<SignOut />, {
            session: CONSUMER_SESSION,
            repositories: { auth: { logout: async () => undefined } },
        });
        await fireEvent.press(screen.getByTestId('probe-sign-out'));

        await waitFor(() => {
            expect(readPendingAdd()).toBeNull();
        });
        expect(getResumeIntent()).toBeNull();
    });
});

/* ── the resume-intent store ─────────────────────────────────────────────────────────────────── */

describe('resume intent', () => {
    it('records, reads and clears one destination', () => {
        expect(getResumeIntent()).toBeNull();

        recordResumeIntent({ href: '/kitchens/abc', labelKey: 'marketplace:nav.kitchens' });
        expect(getResumeIntent()?.href).toBe('/kitchens/abc');

        clearResumeIntent();
        expect(getResumeIntent()).toBeNull();
    });

    it('expires: a page recorded an afternoon ago is not offered', () => {
        recordResumeIntent({
            href: '/kitchens/abc',
            labelKey: 'marketplace:nav.kitchens',
            recordedAt: new Date(Date.now() - RESUME_INTENT_MAX_AGE_MS - 1000).toISOString(),
        });
        expect(getResumeIntent()).toBeNull();
    });
});

/* ── query keys ──────────────────────────────────────────────────────────────────────────────── */

describe('query keys', () => {
    it('nests every family under a prefix its own root can invalidate', () => {
        expect(queryKeys.marketplace.kitchens({ query: 'a' })[0]).toBe('marketplace');
        expect(queryKeys.catalogue.meals()[0]).toBe('catalogue');
        expect(queryKeys.planner.week('plan-1' as never, '2026-07-27')[0]).toBe('planner');
        expect(queryKeys.commerce.cart()[0]).toBe('commerce');
        expect(queryKeys.vd.sessions()[0]).toBe('vd');
        expect(queryKeys.business.quotations()[0]).toBe('business');
        expect(queryKeys.professional.reviewQueue()[0]).toBe('professional');
        expect(queryKeys.nutrition.currentTargets()[0]).toBe('nutrition');
    });

    it('uses null rather than undefined for an absent filter', () => {
        expect(queryKeys.marketplace.kitchens()).toEqual(['marketplace', 'kitchens', null]);
    });

    it('sorts a comparison key so the order plans were picked in is not part of it', () => {
        const a = queryKeys.catalogue.planComparison(['b', 'a'] as never);
        const b = queryKeys.catalogue.planComparison(['a', 'b'] as never);
        expect(a).toEqual(b);
    });
});
