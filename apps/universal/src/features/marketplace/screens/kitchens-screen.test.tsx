import type {
    Kitchen,
    KitchenFilter,
    KitchenSalesChannels,
    MarketplaceMeal,
    MealFilter,
    OpeningHours,
} from '@healthy360/api-client/contracts';
import type {
    DeliveryZoneId,
    DietClassification,
    KitchenBranchId,
    KitchenId,
    MealId,
    SalesChannel,
} from '@healthy360/domain-types';
import type { NutritionFacts } from '@healthy360/nutrition';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import type { CustomerAddress, DietaryProfile } from '@healthy360/api-client/contracts';

import { testMeResponse } from '../../../testing/session-fixtures.ts';
import { page } from '../../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../../testing/stub-screen.tsx';
import {
    deliversFast,
    narrowByDiets,
    parseKitchenSort,
    profileDietsOf,
    sortKitchens,
    toRows,
} from '../kitchen-finder.ts';
import { KitchensScreen } from './kitchens-screen.tsx';

/**
 * `/kitchens` — the finder. The router is mocked so a test can put a filter in the URL the way a
 * shared link would, and read back what the screen pushed or wrote.
 */
const routerState: { params: Record<string, string> } = { params: {} };

jest.mock('expo-router', () => {
    const push = jest.fn();
    const setParams = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace: jest.fn(), setParams, back: jest.fn() }),
        usePathname: () => '/kitchens',
        useLocalSearchParams: () => routerState.params,
        Redirect: () => null,
        Link: ({ children }: { children: React.ReactNode }) => children,
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
});

/* ── the world these tests author ────────────────────────────────────────────────────────────── */

function uuid(family: number, ordinal: number): string {
    return `01935f6d-${family.toString(16).padStart(4, '0')}-7000-8000-${ordinal
        .toString(16)
        .padStart(12, '0')}`;
}

const CHANNEL_NAMES: readonly SalesChannel[] = [
    'b2c',
    'b2b',
    'marketplace',
    'pos',
    'subscription',
    'delivery',
    'pickup',
    'corporate',
];

function channels(...enabled: readonly SalesChannel[]): KitchenSalesChannels {
    return Object.fromEntries(
        CHANNEL_NAMES.map((name) => [name, enabled.includes(name)]),
    ) as KitchenSalesChannels;
}

/** Every weekday the same, so "today" is the same whichever day the suite runs on. */
function everyDay(opensAt: string | null, closesAt: string | null): OpeningHours[] {
    return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        opensAt,
        closesAt,
        orderCutOffAt: null,
    }));
}

interface Seed {
    readonly ordinal: number;
    readonly name: string;
    readonly slug: string;
    readonly rating: number | null;
    readonly diets: readonly DietClassification[];
    readonly feeMinor: number;
    readonly minutes: number | null;
    readonly hours: readonly OpeningHours[];
    readonly channels: KitchenSalesChannels;
}

function kitchen(seed: Seed): Kitchen {
    const id = uuid(1, seed.ordinal) as KitchenId;
    return {
        id,
        name: seed.name,
        slug: seed.slug,
        tagline: '',
        description: `${seed.name} is authored by this test file.`,
        countryCode: 'AE',
        cuisines: [],
        dietClassifications: seed.diets,
        channels: seed.channels,
        branches: [
            {
                id: uuid(2, seed.ordinal) as KitchenBranchId,
                kitchenId: id,
                name: 'Main',
                area: 'Jumeirah 1',
                countryCode: 'AE',
                timeZone: 'Asia/Dubai',
                deliveryZones: [
                    {
                        id: uuid(3, seed.ordinal) as DeliveryZoneId,
                        name: 'Jumeirah',
                        area: 'Jumeirah 1',
                        countryCode: 'AE',
                        deliveryFee: { amount: seed.feeMinor, currency: 'AED' },
                        minimumOrder: { amount: 5000, currency: 'AED' },
                        estimatedMinutes: seed.minutes,
                        windowCodes: [],
                    },
                ],
                openingHours: [...seed.hours],
                supportsPickup: false,
                isActive: true,
            },
        ],
        deliveryWindows: [],
        rating: seed.rating,
        ratingCount: seed.rating === null ? 0 : 12,
        imagePlaceholderId: `kitchen-${seed.slug}`,
        isVerified: seed.ordinal === 2,
    };
}

const CONSUMER = channels('b2c', 'marketplace', 'delivery', 'subscription');

const ALPHA = kitchen({
    ordinal: 1,
    name: 'Alpha Kitchen',
    slug: 'alpha',
    rating: 4.2,
    diets: ['high_protein', 'halal_friendly'],
    feeMinor: 1500,
    minutes: 40,
    hours: everyDay('09:00', '22:00'),
    channels: CONSUMER,
});
const BRAVO = kitchen({
    ordinal: 2,
    name: 'Bravo Greens',
    slug: 'bravo',
    rating: 4.8,
    diets: ['vegan', 'high_protein'],
    feeMinor: 500,
    minutes: 25,
    hours: everyDay(null, null),
    channels: CONSUMER,
});
/** Unrated, free delivery with no estimate, no hours published, no subscriptions. */
const CHARLIE = kitchen({
    ordinal: 3,
    name: 'Charlie Grill',
    slug: 'charlie',
    rating: null,
    diets: ['high_protein'],
    feeMinor: 0,
    minutes: null,
    hours: [],
    channels: channels('b2c', 'marketplace', 'delivery'),
});
/** Wholesale only — never listed to a household. */
const WHOLESALE = kitchen({
    ordinal: 4,
    name: 'Wholesale Works',
    slug: 'wholesale',
    rating: 5,
    diets: ['vegan'],
    feeMinor: 0,
    minutes: 10,
    hours: everyDay('09:00', '17:00'),
    channels: channels('b2b'),
});

const KITCHENS = [ALPHA, BRAVO, CHARLIE, WHOLESALE];

async function listKitchens(filter?: KitchenFilter) {
    const term = filter?.query?.toLowerCase() ?? '';
    return page(
        KITCHENS.filter(
            (each) =>
                each.name.toLowerCase().includes(term) &&
                (filter?.channels ?? []).every((channel) => each.channels[channel]),
        ),
    );
}

function facts(): NutritionFacts {
    return {
        basis: 'per_serving',
        kind: 'planned',
        serving: null,
        totalGrams: 380,
        amounts: [
            { nutrientId: 'energy', unit: 'kcal', value: 520, kind: 'planned', tolerance: null },
            { nutrientId: 'protein', unit: 'g', value: 32, kind: 'planned', tolerance: null },
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
            notes: [],
        },
    };
}

function meal(ordinal: number, name: string, slug: string, owner: Kitchen): MarketplaceMeal {
    return {
        id: uuid(4, ordinal) as MealId,
        kitchenId: owner.id,
        kitchenName: owner.name,
        itemType: 'meal',
        publishedCategory: null,
        name,
        slug,
        description: '',
        mealTypes: ['lunch'],
        dietClassifications: [],
        cuisines: [],
        allergens: [],
        serving: {
            label: '1 bowl',
            quantity: 1,
            unit: 'portion',
            grams: 380,
            millilitres: null,
            householdMeasure: null,
        },
        nutrition: facts(),
        price: { amount: 4500, currency: 'AED' },
        pack: null,
        preparationMinutes: 20,
        imagePlaceholderId: `meal-${slug}`,
        availability: [],
        channels: owner.channels,
        rating: 4.5,
        ratingCount: 3,
    };
}

const GREEN_BOWL = meal(1, 'Green bowl', 'green-bowl', BRAVO);
// Published nothing: the API sends `nutrition: null`, which maps to an empty set of amounts.
const LENTIL_STEW: MarketplaceMeal = {
    ...meal(2, 'Lentil stew', 'lentil-stew', BRAVO),
    nutrition: { ...facts(), amounts: [] },
};
const MEALS = [GREEN_BOWL, LENTIL_STEW];

async function listMeals(filter?: MealFilter) {
    return page(MEALS.filter((each) => filter?.kitchenIds?.includes(each.kitchenId) ?? true));
}

const REPOSITORIES = { marketplace: { listKitchens, listMeals } };

const CARD = /^kitchen-card-(alpha|bravo|charlie|wholesale)$/;

function cardOrder(): string[] {
    return screen
        .getAllByTestId(CARD)
        .map((node) => String(node.props.testID).replace('kitchen-card-', ''));
}

/* ── the screen ──────────────────────────────────────────────────────────────────────────────── */

describe('KitchensScreen — the finder', () => {
    it('opens on the title, the count and the consumer directory', async () => {
        const { repositories } = await renderStubScreen(<KitchensScreen />, {
            repositories: REPOSITORIES,
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-grid')).toBeTruthy();
        });

        expect(repositories.marketplace.listKitchens).toHaveBeenCalledWith(
            expect.objectContaining({ channels: ['b2c', 'marketplace'] }),
        );
        expect(screen.getByTestId('kitchens-header-title')).toHaveTextContent('Kitchens');
        expect(screen.getByTestId('kitchens-results-count')).toHaveTextContent('3 kitchens');
        // Top rated, the unrated last.
        expect(cardOrder()).toEqual(['bravo', 'alpha', 'charlie']);
        expect(screen.getByTestId('kitchens-sort')).toBeTruthy();

        // A visitor is offered an address rather than shown one.
        expect(screen.getByTestId('kitchens-address-value')).toHaveTextContent('Add address');
        await fireEvent.press(screen.getByTestId('kitchens-address'));
        expect(routerMock.__push).toHaveBeenCalledWith('/sign-in');

        // The whole card is the link to the storefront.
        await fireEvent.press(screen.getByTestId('kitchen-card-alpha'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchens/${String(ALPHA.id)}`);
    });

    it('sorts by the order the URL names, unrated and unpublished figures last', async () => {
        routerState.params = { sort: 'fee' };
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-grid')).toBeTruthy();
        });
        expect(cardOrder()).toEqual(['charlie', 'bravo', 'alpha']);
    });

    it('narrows to kitchens cooking for every selected diet, and says how many', async () => {
        routerState.params = { diet: 'high_protein,vegan' };
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-card-bravo')).toBeTruthy();
        });
        expect(cardOrder()).toEqual(['bravo']);
        expect(screen.getByText('Matching kitchens')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('kitchens-results-count')).toHaveTextContent(
                '1 of 3 kitchens',
            );
        });
    });

    it('narrows to kitchens trading today from ?open=today', async () => {
        routerState.params = { open: 'today' };
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-card-alpha')).toBeTruthy();
        });
        expect(cardOrder()).toEqual(['alpha']);
    });

    it('offers a way out of an empty result', async () => {
        routerState.params = { q: 'nothing-matches-this' };
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-empty')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('kitchens-empty-clear'));
        expect(routerMock.__setParams).toHaveBeenCalledWith(expect.objectContaining({ q: '' }));
    });

    it('states today’s published hours, and nothing for a kitchen that publishes none', async () => {
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-grid')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-card-alpha-today')).toHaveTextContent(/09:00–22:00/);
        expect(screen.getByTestId('kitchen-card-bravo-today')).toHaveTextContent('Closed today');
        expect(screen.queryByTestId('kitchen-card-charlie-today')).toBeNull();
    });

    it('states the delivery terms a kitchen publishes and none it does not', async () => {
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-grid')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-card-alpha-facts')).toHaveTextContent(
            /^40 min · .*15\.00 fee · Min .*50\.00$/,
        );
        // No estimate is published, so no time is drawn — not a dash, not a guess.
        expect(screen.getByTestId('kitchen-card-charlie-facts')).toHaveTextContent(
            /^Free delivery · Min .*50\.00$/,
        );
        expect(screen.getByTestId('kitchen-card-charlie-unrated')).toBeTruthy();
        expect(screen.getByTestId('kitchen-card-bravo-verified')).toBeTruthy();
    });

    it('writes the search term and the toggles to the URL', async () => {
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-grid')).toBeTruthy();
        });

        const input = screen.getByTestId('kitchens-search-input');
        await fireEvent.changeText(input, 'alp');
        await fireEvent(input, 'submitEditing');
        expect(routerMock.__setParams).toHaveBeenCalledWith({ q: 'alp' });

        await fireEvent.press(screen.getByTestId('kitchens-filter-open-today'));
        expect(routerMock.__setParams).toHaveBeenCalledWith({ open: 'today' });

        await fireEvent.press(screen.getByTestId('kitchens-filter-channel-subscription'));
        expect(routerMock.__setParams).toHaveBeenCalledWith({ channel: 'subscription' });

        await fireEvent.press(screen.getByTestId('kitchens-filter-fast'));
        expect(routerMock.__setParams).toHaveBeenCalledWith({ fast: '30' });

        await fireEvent.press(screen.getByTestId('kitchens-filter-channel-pickup'));
        expect(routerMock.__setParams).toHaveBeenCalledWith({ channel: 'pickup' });
    });

    it('narrows to kitchens delivering within half an hour from ?fast=30', async () => {
        routerState.params = { fast: '30' };
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-card-bravo')).toBeTruthy();
        });
        expect(cardOrder()).toEqual(['bravo']);
        expect(screen.getByTestId('kitchens-filter-fast')).toHaveProp('aria-pressed', true);
    });

    it('lands each goal tile on a filter the meals catalogue reads', async () => {
        await renderStubScreen(<KitchensScreen />, { repositories: REPOSITORIES });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-goals')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('kitchens-goal-high_protein'));
        expect(routerMock.__push).toHaveBeenCalledWith('/meals?diet=high_protein');
        await fireEvent.press(screen.getByTestId('kitchens-goal-under500'));
        expect(routerMock.__push).toHaveBeenCalledWith('/meals?energyMax=500');
        // The count is the catalogue's own total for the same filter.
        await waitFor(() => {
            expect(screen.getByTestId('kitchens-goal-high_protein-count')).toHaveTextContent(
                '2 meals →',
            );
        });
    });

    it('orders by a signed-in shopper’s declared diets and names their address', async () => {
        const profile: DietaryProfile = {
            dietCategoryCode: 'halal_friendly',
            allergens: [],
            excludedIngredientIds: [],
            updatedAt: '2026-09-01T09:00:00.000Z',
        };
        const home = {
            id: 'address-1',
            label: 'Home',
            areaId: 'area-1',
            areaName: 'Jumeirah 1',
            line1: '14 Al Wasl Road',
            line2: null,
            building: null,
            floor: null,
            notes: null,
            isDefault: true,
            isDeliverable: true,
        } as unknown as CustomerAddress;

        await renderStubScreen(<KitchensScreen />, {
            session: testMeResponse(),
            repositories: {
                ...REPOSITORIES,
                account: {
                    getDietaryProfile: async () => profile,
                    listAddresses: async () => [home],
                },
            },
        });

        // Best match is the landing order: the kitchen cooking the shopper's diet first.
        await waitFor(() => {
            expect(cardOrder()[0]).toBe('alpha');
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchens-address-value')).toHaveTextContent(
                '14 Al Wasl Road',
            );
        });
        await fireEvent.press(screen.getByTestId('kitchens-address'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/account/addresses');
    });
});

/* ── the readings behind it ──────────────────────────────────────────────────────────────────── */

describe('kitchen-finder', () => {
    it('sorts rating descending with the unrated last, and keeps ties in arrival order', () => {
        expect(sortKitchens([CHARLIE, ALPHA, BRAVO], 'rating').map((k) => k.slug)).toEqual([
            'bravo',
            'alpha',
            'charlie',
        ]);
        expect(sortKitchens([ALPHA, CHARLIE, BRAVO], 'fastest').map((k) => k.slug)).toEqual([
            'bravo',
            'alpha',
            'charlie',
        ]);
    });

    it('narrows with every selected diet, not any', () => {
        expect(narrowByDiets([ALPHA, BRAVO, CHARLIE], ['high_protein']).length).toBe(3);
        expect(narrowByDiets([ALPHA, BRAVO, CHARLIE], ['high_protein', 'vegan'])).toEqual([BRAVO]);
    });

    it('offers best match only to a profile, and reads only known diet codes from it', () => {
        expect(parseKitchenSort(undefined)).toBe('rating');
        expect(parseKitchenSort('match')).toBe('rating');
        expect(parseKitchenSort(undefined, ['vegan'])).toBe('match');
        expect(parseKitchenSort('fee', ['vegan'])).toBe('fee');
        expect(profileDietsOf('vegan')).toEqual(['vegan']);
        expect(profileDietsOf('not-a-diet')).toEqual([]);
        expect(profileDietsOf(null)).toEqual([]);
        expect(
            sortKitchens([ALPHA, CHARLIE, BRAVO], 'match', ['vegan']).map((k) => k.slug),
        ).toEqual(['bravo', 'alpha', 'charlie']);
    });

    it('reads "under 30 min" from the fastest published delivery', () => {
        expect(deliversFast([ALPHA, BRAVO, CHARLIE])).toEqual([BRAVO]);
    });

    it('splits a grid into rows of equal width', () => {
        expect(toRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(toRows([1], 0)).toEqual([[1]]);
    });
});
