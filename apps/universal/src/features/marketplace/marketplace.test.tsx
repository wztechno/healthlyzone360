import { ApiError, apiFailure } from '@healthy360/api-client';
import type {
    DeliveryZone,
    Dietitian,
    DietitianFilter,
    Kitchen,
    KitchenBranch,
    KitchenFilter,
    KitchenSalesChannels,
    MarketplaceMeal,
    MealFilter,
    Subscription,
} from '@healthy360/api-client/contracts';
import type {
    AllergenCode,
    DeliveryZoneId,
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
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { queryKeys } from '../../data/query-keys.ts';
import { consumerNavigation, marketplaceNavigation } from '../../navigation/consumer-items.ts';
import { ConsumerShell } from '../../shell/consumer-shell.tsx';
import { testMeResponse } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { clearResumeIntent, getResumeIntent, recordResumeIntent } from './resume-intent.ts';
import { ConsumerHomeScreen } from './screens/consumer-home-screen.tsx';
import { DietitianProfileScreen } from './screens/dietitian-profile-screen.tsx';
import { DietitiansScreen } from './screens/dietitians-screen.tsx';
import { DiscoverScreen } from './screens/discover-screen.tsx';
import { ForBusinessScreen } from './screens/for-business-screen.tsx';
import { HowItWorksScreen } from './screens/how-it-works-screen.tsx';
import { KitchenMenuScreen } from './screens/kitchen-menu-screen.tsx';
import { KitchenProfileScreen } from './screens/kitchen-profile-screen.tsx';
import { KitchensScreen } from './screens/kitchens-screen.tsx';
import { PublicLandingScreen } from './screens/public-landing-screen.tsx';

/**
 * Route parameters are the one thing these screens cannot reach through a repository, so the router
 * is mocked rather than rendered. `params` is mutable so a test can put a kitchen identifier in
 * front of a screen the way a deep link would.
 */
const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    const setParams = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams, back: jest.fn() }),
        usePathname: () => '/customer',
        useLocalSearchParams: () => routerState.params,
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerState.params = {};
    routerMock.__push.mockClear();
    clearResumeIntent();
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
        dietClassifications: ['omnivore'],
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
        duration: '4w',
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
        dietClassifications: ['omnivore'],
        excludeAllergens: [],
        selectedMealIds: [],
    },
    planName: 'Balanced week',
    kitchenId: VERDANT.id,
    weeklyPrice: { amount: 24900, currency: 'AED' },
    days: { total: 20, consumed: 6, remaining: 14 },
    nextDeliveryDate: '2026-08-20',
    skippedDates: [],
    pausedUntil: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-10T09:00:00.000Z',
};

/** The session the two signed-in surfaces below see: a consumer, no memberships. */
const CONSUMER_SESSION = testMeResponse();

/* ── public landing ──────────────────────────────────────────────────────────────────────────── */

describe('PublicLandingScreen', () => {
    it('shows a skeleton while the featured kitchens load, then the kitchens', async () => {
        await renderStubScreen(<PublicLandingScreen />, {
            repositories: { marketplace: { listKitchens } },
        });

        expect(screen.getByTestId('landing-hero')).toBeTruthy();
        expect(screen.getByTestId('landing-featured-loading')).toBeTruthy();

        await waitFor(() => {
            expect(screen.getByTestId('landing-featured-grid')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-card-verdant-kitchen')).toBeTruthy();
    });

    it('offers both authentication entry points', async () => {
        await renderStubScreen(<PublicLandingScreen />, {
            repositories: { marketplace: { listKitchens } },
        });

        await fireEvent.press(screen.getByTestId('landing-register'));
        expect(routerMock.__push).toHaveBeenCalledWith('/register');

        await fireEvent.press(screen.getByTestId('landing-sign-in'));
        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });
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

    it('narrows the list from a URL filter parameter', async () => {
        routerState.params = { cuisine: 'Coastal' };
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
    it('renders the profile, its channels and its branches', async () => {
        await renderStubScreen(<KitchenProfileScreen kitchenId={String(VERDANT.id)} />, {
            repositories: { marketplace: { getKitchen } },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-name')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-channels')).toBeTruthy();
        expect(screen.getByTestId('kitchen-branches')).toBeTruthy();
        expect(screen.getByTestId('kitchen-view-menu')).toBeTruthy();
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

        const pressable = screen.getAllByTestId(/^meal-card-[a-z0-9-]+$/)[0];
        expect(pressable).toBeTruthy();
        await fireEvent.press(pressable!);

        // The catalogue wave's `/meals/{meal}` replaced the in-place summary drawer.
        expect(routerMock.__push).toHaveBeenCalledWith(expect.stringMatching(/^\/meals\//));
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
        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');
    });
});

/* ── discover ────────────────────────────────────────────────────────────────────────────────── */

describe('DiscoverScreen', () => {
    it('hands a search over to the kitchen directory with the query in the URL', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listKitchens } },
        });

        await fireEvent.changeText(screen.getByTestId('discover-search-input'), 'coastal');
        await fireEvent.press(screen.getByTestId('discover-search-submit'));

        expect(routerMock.__push).toHaveBeenCalledWith('/kitchens?q=coastal');
    });

    it('links every catalogue family to its real route', async () => {
        await renderStubScreen(<DiscoverScreen />, {
            repositories: { marketplace: { listKitchens } },
        });

        await fireEvent.press(screen.getByTestId('discover-family-meals'));

        expect(routerMock.__push).toHaveBeenCalledWith('/meals');
    });
});

/* ── consumer home ───────────────────────────────────────────────────────────────────────────── */

describe('ConsumerHomeScreen', () => {
    it('shows the running subscription and opens the screen that manages it', async () => {
        await renderStubScreen(<ConsumerHomeScreen />, {
            session: CONSUMER_SESSION,
            repositories: {
                commerce: { listSubscriptions: async () => page([ACTIVE_SUBSCRIPTION]) },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscription-card-content')).toBeTruthy();
        });
        expect(screen.getByTestId('consumer-greeting')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();

        await fireEvent.press(screen.getByTestId('consumer-subscription-manage'));
        expect(routerMock.__push).toHaveBeenCalledWith(
            `/customer/subscriptions/${String(ACTIVE_SUBSCRIPTION.id)}`,
        );
    });

    it('offers to resume a marketplace page recorded before sign-in', async () => {
        recordResumeIntent({ href: '/kitchens', labelKey: 'marketplace:nav.kitchens' });

        await renderStubScreen(<ConsumerHomeScreen />, {
            session: CONSUMER_SESSION,
            repositories: { commerce: { listSubscriptions: async () => page([]) } },
        });

        expect(screen.getByTestId('consumer-resume')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('consumer-resume-continue'));
        expect(routerMock.__push).toHaveBeenCalledWith('/kitchens');
        expect(getResumeIntent()).toBeNull();
    });
});

/* ── navigation and shells ───────────────────────────────────────────────────────────────────── */

describe('navigation descriptors', () => {
    it('offers only the destinations whose feature has a backend today', () => {
        const offered = [...consumerNavigation(), ...marketplaceNavigation()]
            .map((item) => item.href)
            .sort();

        expect([...new Set(offered)]).toEqual([
            '/customer',
            '/customer/cart',
            '/customer/subscriptions',
            '/discover',
            '/for-business',
            '/how-it-works',
            '/kitchens',
            '/meals',
            '/plans',
            '/profile',
        ]);
    });
});

describe('ConsumerShell', () => {
    it('renders only reachable destinations and navigates them for real', async () => {
        await renderStubScreen(
            <ConsumerShell unguarded>
                <></>
            </ConsumerShell>,
            { session: CONSUMER_SESSION },
        );

        expect(screen.getByTestId('consumer-nav-home')).toBeTruthy();
        expect(screen.queryByTestId('consumer-nav-planner')).toBeNull();
        expect(screen.queryByTestId('consumer-nav-nutrition')).toBeNull();
        expect(screen.queryByTestId('consumer-nav-virtual-dietitian')).toBeNull();

        await fireEvent.press(screen.getByTestId('consumer-nav-subscriptions'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/subscriptions');
        expect(screen.queryByTestId('prototype-notice')).toBeNull();
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
