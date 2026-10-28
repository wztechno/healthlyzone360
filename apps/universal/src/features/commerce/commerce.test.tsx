import {
    ApiError,
    apiFailure,
    orderPlacementRefusedFailure,
    validationFailure,
} from '@healthy360/api-client/contracts';
import type {
    AccountSetupChecklist,
    AddCartItemRequest,
    Cart,
    CartItem,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CommerceRepository,
    CustomerAddress,
    DeliveryAddress,
    DietaryProfile,
    Kitchen,
    KitchenBranch,
    KitchenSalesChannels,
    MarketplaceMeal,
    MarketplaceRepository,
    PlaceOrderRequest,
    PlacedOrder,
    PlanDurationOption,
    PlanSitting,
    PlanVariant,
    PreviewCheckoutRequest,
    SetSubscriptionMealChoicesRequest,
    SkipDayRequest,
    Subscription,
    SubscriptionBalance,
    SubscriptionConfiguration,
    SubscriptionDelivery,
    SubscriptionFilter,
    SubscriptionMealChoice,
    SubscriptionPlan,
    SubscriptionPlanDay,
    SubscriptionPlanDays,
    SubscriptionPreview,
    SubscriptionQuote,
    SubscriptionQuoteRequest,
} from '@healthy360/api-client/contracts';
import { SUBSCRIPTION_STATES } from '@healthy360/domain-types';
import type {
    AllergenCode,
    CartId,
    KitchenId,
    MealId,
    Money,
    OrderId,
    PlanDuration,
    PlanVariantId,
    SalesChannel,
    ServiceAreaId,
    SubscriptionId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { pathnameOf, queryOf, withReturnTo } from '../../navigation/return-to.ts';
import { clearAllSessionDrafts } from '../../navigation/session-draft.ts';
import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { testMeResponse } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    EMPTY_ADDRESS,
    formatAddress,
    fromDeliveryAddress,
    isAddressComplete,
    toDeliveryAddress,
    validateAddress,
} from './address.ts';
import { LATEST_PLACED, placedOrders } from './checkout-draft.ts';
import {
    CONFIGURATOR_PATH,
    configuratorDraftKey,
    configuratorDrafts,
    configuratorHref,
    parseConfiguratorEdits,
} from './configurator-draft.ts';
import type { ConfiguratorEdits } from './configurator-draft.ts';
import {
    CONFIGURATOR_STEPS,
    chosenDays,
    combinationKey,
    configuredDeliveryDates,
    estimatedTotal,
    firstIncompleteStep,
    initialConfiguratorState,
    isStepReachable,
    mealCombinations,
    missingPicks,
    nextConfiguratorStep,
    perDeliveryPrice,
    pickKey,
    pickedMealIds,
    previousConfiguratorStep,
    repeatFirstWeek,
    stepPosition,
    toConfiguration,
    validateConfiguratorStep,
    variantForCombination,
} from './configurator.ts';
import type { ConfiguratorState, MealPicks, StepContext } from './configurator.ts';
import { buildPriceRows } from './configurator-steps.tsx';
import {
    addDays,
    daysBetween,
    deliveryDatesFor,
    earliestStartDate,
    isIsoDate,
    isoWeekday,
    nextAllowedDate,
    todayIso,
    upcomingDeliveryDates,
} from './dates.ts';
import {
    DEFAULT_SLOT_CODE,
    DELIVERY_SLOTS,
    deliveryAreaStatus,
    deliverySlotByCode,
    isDeliverySlotCode,
    servedAreas,
    toContractSlot,
} from './delivery.ts';
import { ALLERGY_LIST_HREF } from './my-allergens.tsx';
import { CartScreen } from './screens/cart-screen.tsx';
import { CheckoutScreen } from './screens/checkout-screen.tsx';
import { SubscriptionConfiguratorScreen } from './screens/subscription-configurator-screen.tsx';
import { SubscriptionDetailScreen } from './screens/subscription-detail-screen.tsx';
import { SubscriptionsScreen } from './screens/subscriptions-screen.tsx';
import {
    canChangeDelivery,
    canPauseOrSkip,
    canResume,
    isTerminalSubscriptionState,
} from './state-badge.tsx';
import {
    ALLERGEN_CONFLICT_WARNING,
    CHECKOUT_ADDRESS_MISSING,
    CHECKOUT_WINDOW_NOT_OFFERED,
    CHECKOUT_EMPTY_CART,
    SUBSCRIPTION_DAY_UNAVAILABLE,
    displayableWarnings,
    isCriticalWarning,
    isKnownWarning,
    warningMessageKey,
} from './warnings.ts';

/**
 * Commerce: the calendar, the configurator, the basket, the checkout and the subscription screens.
 *
 * Everything these screens read is **authored here**. There is no fixture world behind them any
 * more: a repository method this file does not declare rejects with `StubNotConfiguredError` naming
 * the surface, so a hole in the setup fails loudly instead of rendering an empty state over it.
 *
 * Two consequences worth stating, because they changed what some of these cases can honestly claim:
 *
 * * **A basket is a closure variable.** `getCart` reads it, `addCartItem`/`removeCartItem`/
 *   `placeOrder` rewrite it, and the screen's own invalidation is what makes the redraw the
 *   assertion. That is the replacement for the deleted mock store's reach-ins.
 * * **Guards that lived in the mock repository are now the server's.** What survives on this side of
 *   the wire is what the *client* does — which controls it offers for a given state, which requests
 *   it refuses to send, and how it renders a refusal that arrives anyway. Those are the cases below;
 *   the repository-internal half is recorded in the migration report rather than faked here.
 */

/**
 * Route parameters are the one thing these screens cannot reach through a repository, so the router
 * is mocked rather than rendered — the shared mock every customer suite uses
 * (`testing/expo-router-mock.ts`). What the router really does with a call is pinned once, against
 * the real thing, in `navigation/use-return-to.test.tsx`.
 */
jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/customer/cart',
    }),
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

beforeEach(() => {
    routerMock.__reset();
    globalThis.localStorage?.clear();
    // Session drafts (plan setup, placed order) live in module memory for the whole file; a draft
    // one test leaves behind is a different starting point for the next.
    clearAllSessionDrafts();
});

/* ══ the world these tests author ══════════════════════════════════════════════════════════════ */

/**
 * UUIDv7-shaped identifiers. Every detail screen parses its route parameter through an id codec, so
 * an identifier that is not UUID-shaped is what puts a screen into its not-found state — which two
 * of the cases below rely on deliberately.
 */
function uuid(family: number, ordinal: number): string {
    return `01935f6d-${family.toString(16).padStart(4, '0')}-7000-8000-${ordinal
        .toString(16)
        .padStart(12, '0')}`;
}

const KITCHEN_ID = uuid(1, 1) as KitchenId;
const PLAN_ID = uuid(2, 1) as SubscriptionPlanId;
const CART_ID = uuid(7, 1) as CartId;
const SUBSCRIPTION_ID = uuid(8, 1) as SubscriptionId;
const ORDER_ID = uuid(9, 1) as OrderId;

/** Well formed, and deliberately absent from the authored world. */
const UNKNOWN_PLAN_ID = uuid(15, 255);
const UNKNOWN_SUBSCRIPTION_ID = uuid(15, 254);

const AED = 'AED';

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

/* ── the kitchen, and the areas it publishes a delivery zone for ─────────────────────────────── */

/** Sorted, because `servedAreas` sorts — the first of these is the one the area check is asked. */
const SERVED_AREAS: readonly string[] = ['Business Bay', 'Dubai Marina', 'Jumeirah 1'];

const KITCHEN_BRANCH: KitchenBranch = {
    id: uuid(3, 1) as KitchenBranch['id'],
    kitchenId: KITCHEN_ID,
    name: 'Business Bay kitchen',
    area: 'Business Bay',
    countryCode: 'AE',
    timeZone: 'Asia/Dubai',
    deliveryZones: SERVED_AREAS.map((area, index) => ({
        id: uuid(4, index + 1) as KitchenBranch['deliveryZones'][number]['id'],
        name: `${area} zone`,
        area,
        countryCode: 'AE',
        deliveryFee: { amount: 1500, currency: AED },
        minimumOrder: null,
        estimatedMinutes: 45,
        windowCodes: [],
    })),
    openingHours: [],
    supportsPickup: false,
    isActive: true,
};

/**
 * The kitchen publishes no delivery windows of its own, so the checkout and the configurator both
 * fall back to `DELIVERY_SLOTS` — which is what makes `midday` the default the tests below expect.
 */
const KITCHEN: Kitchen = {
    id: KITCHEN_ID,
    name: 'Verdant Kitchen',
    slug: 'verdant-kitchen',
    tagline: 'Cooked to order, delivered daily',
    description: 'Authored by this test file.',
    countryCode: 'AE',
    cuisines: ['Levantine'],
    dietClassifications: ['omnivore', 'mediterranean'],
    channels: salesChannels('b2c', 'marketplace', 'delivery', 'subscription'),
    branches: [KITCHEN_BRANCH],
    deliveryWindows: [],
    rating: 4.6,
    ratingCount: 24,
    imagePlaceholderId: 'kitchen-verdant',
    isVerified: true,
};

/* ── the menu ────────────────────────────────────────────────────────────────────────────────── */

interface MealSeed {
    readonly ordinal: number;
    readonly name: string;
    readonly priceMinorUnits: number;
    readonly allergens?: readonly AllergenCode[] | undefined;
}

function testMeal(seed: MealSeed): MarketplaceMeal {
    return {
        id: uuid(5, seed.ordinal) as MealId,
        kitchenId: KITCHEN_ID,
        kitchenName: KITCHEN.name,
        itemType: 'meal',
        publishedCategory: null,
        name: seed.name,
        slug: `meal-${String(seed.ordinal)}`,
        description: `${seed.name}, made to order.`,
        mealTypes: ['lunch'],
        dietClassifications: ['omnivore'],
        cuisines: KITCHEN.cuisines,
        allergens: seed.allergens ?? [],
        serving: {
            label: '1 bowl',
            quantity: 1,
            unit: 'portion',
            grams: 380,
            millilitres: null,
            householdMeasure: null,
        },
        nutrition: {
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
                {
                    nutrientId: 'energy',
                    unit: 'kcal',
                    value: 520,
                    kind: 'planned',
                    tolerance: null,
                },
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
                notes: ['Every figure here was authored by the test that renders it.'],
            },
        },
        price: { amount: seed.priceMinorUnits, currency: AED },
        pack: null,
        preparationMinutes: 25,
        imagePlaceholderId: `meal-${String(seed.ordinal)}`,
        availability: [{ date: '2026-08-20', available: true, remaining: 8, orderCutOffAt: null }],
        channels: KITCHEN.channels,
        rating: 4.4,
        ratingCount: 11,
    };
}

/**
 * Three meals. Two declare an allergen, which is what puts real codes in front of the configurator's
 * allergen picker rather than only the one the profile already carries.
 */
const MENU_MEALS: readonly MarketplaceMeal[] = [
    testMeal({ ordinal: 1, name: 'Harvest bowl', priceMinorUnits: 4500 }),
    testMeal({
        ordinal: 2,
        name: 'Sesame greens',
        priceMinorUnits: 3800,
        allergens: ['sesame' as AllergenCode],
    }),
    testMeal({
        ordinal: 3,
        name: 'Halloumi plate',
        priceMinorUnits: 5200,
        allergens: ['milk' as AllergenCode],
    }),
];

const BASKET_MEAL = MENU_MEALS[0]!;

/** The one basket line these tests press: `cart-line-<item id>-…` is how the screen names it. */
const BASKET_LINE_ID = `line-${BASKET_MEAL.slug}`;

function mealById(mealId: MealId): MarketplaceMeal {
    const meal = MENU_MEALS.find((candidate) => candidate.id === mealId);
    if (meal === undefined) throw new ApiError(apiFailure('resource.not_found'));
    return meal;
}

/* ── the plan ────────────────────────────────────────────────────────────────────────────────── */

interface VariantSeed {
    readonly ordinal: number;
    readonly name: string;
    readonly energyFloor: number;
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    readonly weeklyMinorUnits: number;
}

/**
 * The sittings a band fills each day, the way the server derives them: one meal is lunch, two are
 * lunch and dinner, three add breakfast, a fourth and later meal is another lunch, and every snack
 * is a snack sitting of its own. Authored here rather than read off the client, which never
 * derives them — it is served them.
 */
function sittingsFor(mealsPerDay: number, snacksPerDay: number): readonly PlanSitting[] {
    const meals: PlanSitting[] =
        mealsPerDay <= 0
            ? []
            : mealsPerDay === 1
              ? [{ slot: 'lunch', sequence: 1 }]
              : mealsPerDay === 2
                ? [
                      { slot: 'lunch', sequence: 1 },
                      { slot: 'dinner', sequence: 1 },
                  ]
                : [
                      { slot: 'breakfast', sequence: 1 },
                      { slot: 'lunch', sequence: 1 },
                      { slot: 'dinner', sequence: 1 },
                      ...Array.from({ length: mealsPerDay - 3 }, (_, extra) => ({
                          slot: 'lunch' as const,
                          sequence: extra + 2,
                      })),
                  ];
    const snacks = Array.from({ length: snacksPerDay }, (_, index) => ({
        slot: 'snack' as const,
        sequence: index + 1,
    }));
    return [...meals, ...snacks];
}

function testVariant(seed: VariantSeed): PlanVariant {
    return {
        id: uuid(6, seed.ordinal) as PlanVariantId,
        planId: PLAN_ID,
        name: seed.name,
        energyRange: { min: seed.energyFloor, max: seed.energyFloor + 200 },
        proteinRange: { min: 90, max: 130 },
        carbohydrateRange: { min: 140, max: 200 },
        fatRange: { min: 45, max: 70 },
        mealsPerDay: seed.mealsPerDay,
        snacksPerDay: seed.snacksPerDay,
        sittings: sittingsFor(seed.mealsPerDay, seed.snacksPerDay),
        pricePerWeek: { amount: seed.weeklyMinorUnits, currency: AED },
    };
}

/**
 * Six bands over three genuine meal-and-snack combinations.
 *
 * Authored that way on purpose: `mealCombinations` is supposed to collapse the six into three, and a
 * plan whose bands mapped one-to-one onto combinations would make that test pass without the
 * collapsing ever happening.
 */
const PLAN_VARIANTS: readonly PlanVariant[] = [
    testVariant({
        ordinal: 1,
        name: 'Light',
        energyFloor: 1400,
        mealsPerDay: 3,
        snacksPerDay: 1,
        weeklyMinorUnits: 42_500,
    }),
    testVariant({
        ordinal: 2,
        name: 'Balanced',
        energyFloor: 1800,
        mealsPerDay: 3,
        snacksPerDay: 1,
        weeklyMinorUnits: 47_500,
    }),
    testVariant({
        ordinal: 3,
        name: 'Hearty',
        energyFloor: 2200,
        mealsPerDay: 3,
        snacksPerDay: 1,
        weeklyMinorUnits: 52_500,
    }),
    testVariant({
        ordinal: 4,
        name: 'Light, two snacks',
        energyFloor: 1500,
        mealsPerDay: 3,
        snacksPerDay: 2,
        weeklyMinorUnits: 46_500,
    }),
    testVariant({
        ordinal: 5,
        name: 'Balanced, two snacks',
        energyFloor: 1900,
        mealsPerDay: 3,
        snacksPerDay: 2,
        weeklyMinorUnits: 51_500,
    }),
    testVariant({
        ordinal: 6,
        name: 'Two meals',
        energyFloor: 1200,
        mealsPerDay: 2,
        snacksPerDay: 0,
        weeklyMinorUnits: 33_500,
    }),
];

/** The band the catalogue advertises its duration totals against. */
const ADVERTISED_VARIANT = PLAN_VARIANTS[1]!;

/** The band a set-up opened without one starts on: the plan's middle one — five sittings a day. */
const OPENING_VARIANT = PLAN_VARIANTS[Math.floor(PLAN_VARIANTS.length / 2)]!;

/** Lunch and dinner only: the smallest day to fill, for the cases that pick through the screen. */
const TWO_MEALS_VARIANT = PLAN_VARIANTS[5]!;

/**
 * The published totals, computed by hand from the advertised band's 475.00 a week.
 *
 * Deliberately *not* produced by `estimatedTotal` or `balanceTotal`: these are what the catalogue
 * says a run costs, and the whole point of the duration-pricing case below is that the client's own
 * arithmetic reproduces them. Deriving them from the function under test would make that vacuous.
 *
 * A run is a balance of delivery days priced per day, the way the server prices it: the per-day
 * list price is 47 500 ÷ 7 = 6 785.71 → 6 786; the discount is taken off *that* and rounded
 * before multiplying, never off a total.
 *
 * 7d  — 6 786 × 7, no discount                     → 47 502.
 * 14d — 6 786 less 5 %  = 6 446.70 → 6 447, × 14   → 90 258.
 * 28d — 6 786 less 10 % = 6 107.40 → 6 107, × 28   → 170 996.
 * 84d — 6 786 less 20 % = 5 428.80 → 5 429, × 84   → 456 036.
 */
/** The authored options always carry a total; the contract allows `null` for multi-config plans. */
type AuthoredDurationOption = PlanDurationOption & { readonly totalPrice: Money };

const PLAN_DURATION_OPTIONS: readonly AuthoredDurationOption[] = [
    { duration: '7d', days: 7, discountPercent: 0, totalPrice: { amount: 47_502, currency: AED } },
    {
        duration: '14d',
        days: 14,
        discountPercent: 5,
        totalPrice: { amount: 90_258, currency: AED },
    },
    {
        duration: '28d',
        days: 28,
        discountPercent: 10,
        totalPrice: { amount: 170_996, currency: AED },
    },
    {
        duration: '84d',
        days: 84,
        discountPercent: 20,
        totalPrice: { amount: 456_036, currency: AED },
    },
];

/** The per-day list price of the advertised band: 47 500 a week ÷ 7, rounded. */
const ADVERTISED_DAY_PRICE: Money = { amount: 6786, currency: AED };

const PLAN: SubscriptionPlan = {
    id: PLAN_ID,
    kitchenId: KITCHEN_ID,
    name: 'Balanced week',
    slug: 'balanced-week',
    summary: 'A week of balanced meals, cooked daily.',
    description: 'Authored by this test file.',
    categorySlugs: ['balanced'],
    dietClassifications: ['omnivore', 'mediterranean'],
    variants: PLAN_VARIANTS,
    durations: PLAN_DURATION_OPTIONS,
    imagePlaceholderId: 'plan-balanced-week',
    rating: 4.7,
    ratingCount: 42,
};

/** The first duration is the one a freshly opened configurator starts on. */
const DEFAULT_DURATION: PlanDuration = PLAN_DURATION_OPTIONS[0]!.duration;

function durationOption(duration: PlanDuration): AuthoredDurationOption {
    const option = PLAN_DURATION_OPTIONS.find((entry) => entry.duration === duration);
    if (option === undefined) throw new Error(`No ${duration} option on the authored plan.`);
    return option;
}

function variantById(variantId: PlanVariantId): PlanVariant {
    return PLAN_VARIANTS.find((variant) => variant.id === variantId) ?? ADVERTISED_VARIANT;
}

/* ── the person's dietary profile ────────────────────────────────────────────────────────────── */

/**
 * The one list the kitchen reads at generation. The set-up and the subscription show it against
 * the plan's dishes rather than collecting a second list (plans-16); a declared milk allergy is
 * what makes one of the plan's sample dishes a clash.
 */
function dietaryProfile(allergenCodes: readonly AllergenCode[] = []): DietaryProfile {
    return {
        dietCategoryCode: null,
        allergens: allergenCodes.map((allergenCode) => ({
            allergenCode,
            severity: 'allergy' as const,
            note: null,
        })),
        excludedIngredientIds: [],
        updatedAt: null,
    };
}

const MILK = 'milk' as AllergenCode;

/* ── the address book ────────────────────────────────────────────────────────────────────────── */

function testAddress(overrides: Partial<CustomerAddress> = {}): CustomerAddress {
    return {
        id: 'address-home',
        label: 'Home',
        areaId: uuid(11, 1) as ServiceAreaId,
        areaName: 'Business Bay',
        isDeliverable: true,
        line1: '12 Sunset Street',
        line2: null,
        building: null,
        floor: null,
        notes: null,
        isDefault: true,
        ...overrides,
    };
}

const HOME_ADDRESS = testAddress();

/* ── the basket ──────────────────────────────────────────────────────────────────────────────── */

function cartLine(meal: MarketplaceMeal, quantity: number): CartItem {
    return {
        id: `line-${meal.slug}`,
        mealId: meal.id,
        kitchenId: meal.kitchenId,
        name: meal.name,
        quantity,
        unitPrice: meal.price,
        lineTotal: { amount: meal.price.amount * quantity, currency: meal.price.currency },
        allergens: meal.allergens,
        deliveryDate: null,
    };
}

function cartOf(items: readonly CartItem[]): Cart {
    return {
        id: CART_ID,
        items,
        subtotal: {
            amount: items.reduce((sum, item) => sum + item.lineTotal.amount, 0),
            currency: AED,
        },
        itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
        updatedAt: '2026-08-10T09:00:00.000Z',
    };
}

/**
 * The basket, held in one mutable object.
 *
 * The overrides read and rewrite it *at call time*, so a mutation a screen causes is what the
 * subsequent refetch sees. That is the replacement for the deleted mock store: press the stepper,
 * the world changes, the screen invalidates, and the redraw is the assertion.
 */
interface Basket {
    cart: Cart;
}

function basketOf(quantity: number): Basket {
    return { cart: quantity === 0 ? cartOf([]) : cartOf([cartLine(BASKET_MEAL, quantity)]) };
}

const DELIVERY_FEE: Money = { amount: 1500, currency: AED };

function checkoutPreview(cart: Cart, request: PreviewCheckoutRequest): CheckoutPreview {
    // No address, no zone, no fee — the same shape the server answers a basket-only preview with.
    const deliveryFee = request.addressId === undefined ? null : DELIVERY_FEE;
    return {
        cartId: cart.id,
        lines: [{ code: 'subtotal', label: 'Subtotal', amount: cart.subtotal }],
        subtotal: cart.subtotal,
        deliveryFee,
        discount: null,
        total: { amount: cart.subtotal.amount + (deliveryFee?.amount ?? 0), currency: AED },
        earliestDeliveryDate: '2026-08-12',
        warnings: [],
        offeredWindowCodes: null,
        paymentDeferred: true,
    };
}

function placedOrderFrom(cart: Cart, request: PlaceOrderRequest): PlacedOrder {
    const subtotal = cart.subtotal;
    return {
        id: ORDER_ID,
        reference: 'H360-4821',
        state: 'placed',
        lines: cart.items.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
        })),
        priceLines: [
            { code: 'subtotal', label: 'Subtotal', amount: subtotal },
            { code: 'delivery', label: 'Delivery', amount: DELIVERY_FEE },
        ],
        total: { amount: subtotal.amount + DELIVERY_FEE.amount, currency: AED },
        address: {
            label: HOME_ADDRESS.label,
            line1: HOME_ADDRESS.line1,
            line2: null,
            area: HOME_ADDRESS.areaName,
            city: 'Dubai',
            countryCode: 'AE',
            instructions: null,
        },
        slotCode: request.slotCode ?? DEFAULT_SLOT_CODE,
        deliveryDate: request.deliveryDate ?? '2026-08-12',
        placedAt: '2026-08-11T09:00:00.000Z',
    };
}

function basketRepository(basket: Basket): Partial<CommerceRepository> {
    return {
        getCart: async (): Promise<Cart> => basket.cart,
        addCartItem: async (_cartId: CartId, request: AddCartItemRequest): Promise<Cart> => {
            const meal = mealById(request.mealId);
            const existing = basket.cart.items.find((item) => item.mealId === request.mealId);
            basket.cart = cartOf([
                ...basket.cart.items.filter((item) => item.mealId !== request.mealId),
                cartLine(meal, (existing?.quantity ?? 0) + request.quantity),
            ]);
            return basket.cart;
        },
        removeCartItem: async (_cartId: CartId, itemId: string): Promise<Cart> => {
            basket.cart = cartOf(basket.cart.items.filter((item) => item.id !== itemId));
            return basket.cart;
        },
        previewCheckout: async (request: PreviewCheckoutRequest): Promise<CheckoutPreview> =>
            checkoutPreview(basket.cart, request),
    };
}

/* ── subscriptions ───────────────────────────────────────────────────────────────────────────── */

const SUBSCRIPTION_ADDRESS: DeliveryAddress = {
    label: 'Home',
    line1: 'Apartment 3, Palm Court',
    line2: null,
    area: 'Business Bay',
    city: 'Dubai',
    countryCode: 'AE',
    instructions: null,
};

/** A Monday, so the skip sheet's first option is the subscription's own next delivery. */
const NEXT_DELIVERY = '2026-09-07';

function testConfiguration(
    overrides: Partial<SubscriptionConfiguration> = {},
): SubscriptionConfiguration {
    return {
        planId: PLAN_ID,
        variantId: ADVERTISED_VARIANT.id,
        duration: '28d',
        startDate: '2026-08-03',
        deliveryWeekdays: [1, 3, 5],
        slotCode: 'midday',
        address: SUBSCRIPTION_ADDRESS,
        days: [],
        ...overrides,
    };
}

function testSubscription(overrides: Partial<Subscription> = {}): Subscription {
    return {
        id: SUBSCRIPTION_ID,
        state: 'active',
        configuration: testConfiguration(),
        planName: PLAN.name,
        kitchenId: KITCHEN_ID,
        weeklyPrice: ADVERTISED_VARIANT.pricePerWeek,
        days: { total: 28, consumed: 3, remaining: 25 },
        nextDeliveryDate: NEXT_DELIVERY,
        skippedDates: [],
        createdAt: '2026-08-01T09:00:00.000Z',
        updatedAt: '2026-08-10T09:00:00.000Z',
        ...overrides,
    };
}

function testBalance(subscription: Subscription): SubscriptionBalance {
    return {
        subscriptionId: subscription.id,
        state: subscription.state,
        days: subscription.days,
        perDayPrice: { amount: 3250, currency: AED },
        skippedDays: subscription.skippedDates.length,
        nextDeliveryDate: subscription.nextDeliveryDate,
        deliveryWeekdays: subscription.configuration.deliveryWeekdays,
        changeCutoffHours: 24,
    };
}

function testDelivery(date: string): SubscriptionDelivery {
    return {
        id: `delivery-${date}`,
        date,
        status: 'scheduled',
        consumed: false,
        skipReason: null,
        slotCode: 'midday',
    };
}

/**
 * The plan delivers every day. `allowsFreeSelection` is still on the quote's wire shape but no
 * longer gates anything: every subscriber chooses every meal.
 */
function testQuote(overrides: Partial<SubscriptionQuote> = {}): SubscriptionQuote {
    return {
        planId: PLAN_ID,
        variantId: ADVERTISED_VARIANT.id,
        duration: DEFAULT_DURATION,
        available: true,
        availableWeekdays: [1, 2, 3, 4, 5, 6, 7],
        days: durationOption(DEFAULT_DURATION).days,
        listPrice: ADVERTISED_DAY_PRICE,
        discountPercent: 0,
        perDayPrice: ADVERTISED_DAY_PRICE,
        total: durationOption(DEFAULT_DURATION).totalPrice,
        allowsFreeSelection: false,
        changeCutoffHours: 24,
        // The server has not named a floor: the screen works the same rule out for itself.
        earliestStartDate: null,
        refusals: [],
        ...overrides,
    };
}

/** `YYYY-MM-DD` plus whole days, computed here so the fixtures owe nothing to `./dates.ts`. */
function plusDays(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
}

interface PreviewOverrides {
    readonly firstDeliveryDate?: string | undefined;
    readonly lastDeliveryDate?: string | undefined;
}

/**
 * What a priced proposal comes back as.
 *
 * The delivery count is the run's own day count — a balance of deliveries, not a calendar range —
 * and the per-day figures are worked by hand here rather than read off `plan-balance.ts`, so a case
 * that compares the client's derived dates and rows against this is comparing two independent
 * calculations rather than one function with itself.
 */
function subscriptionPreview(
    configuration: SubscriptionConfiguration,
    overrides: PreviewOverrides = {},
): SubscriptionPreview {
    const option = durationOption(configuration.duration);
    const variant = variantById(configuration.variantId);
    const currency = variant.pricePerWeek.currency;
    const perDayList = Math.round(variant.pricePerWeek.amount / 7);
    const perDay = Math.round((perDayList * (100 - option.discountPercent)) / 100);
    const gross = perDayList * option.days;

    return {
        configuration,
        lines: [
            {
                code: 'gross',
                label: `${String(option.days)} delivery days`,
                amount: { amount: gross, currency },
            },
            ...(option.discountPercent > 0
                ? [
                      {
                          code: 'discount',
                          label: `Duration discount (${String(option.discountPercent)} %)`,
                          amount: { amount: -(gross - option.totalPrice.amount), currency },
                      },
                  ]
                : []),
        ],
        perDayListPrice: { amount: perDayList, currency },
        perDayPrice: { amount: perDay, currency },
        weeklyPrice: { amount: perDay * configuration.deliveryWeekdays.length, currency },
        discountPercent: option.discountPercent,
        total: option.totalPrice,
        firstDeliveryDate: overrides.firstDeliveryDate ?? configuration.startDate,
        // Loosely a calendar horizon; the cases that care about the last day state it themselves.
        lastDeliveryDate:
            overrides.lastDeliveryDate ??
            plusDays(
                configuration.startDate,
                Math.ceil(option.days / configuration.deliveryWeekdays.length) * 7 - 1,
            ),
        deliveryCount: option.days,
        warnings: [],
        paymentDeferred: true,
    };
}

/* ══ pure: calendar arithmetic ═════════════════════════════════════════════════════════════════ */

describe('delivery calendar arithmetic', () => {
    it('adds days across a month and a year boundary without drifting', () => {
        expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
        expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    });

    it('numbers weekdays from Monday, with Sunday as seven', () => {
        expect(isoWeekday('2026-07-27')).toBe(1);
        expect(isoWeekday('2026-08-02')).toBe(7);
    });

    it('answers null rather than throwing on something that is not a date', () => {
        expect(isIsoDate('not-a-date')).toBe(false);
        expect(isIsoDate('2026-02-30')).toBe(false);
        expect(addDays('nonsense', 1)).toBeNull();
        expect(isoWeekday('nonsense')).toBeNull();
        expect(daysBetween('nonsense', '2026-01-01')).toBeNull();
    });

    it('reads today from the local clock, so a person east of Greenwich is not a day behind', () => {
        const midnightLocal = new Date(2026, 6, 30, 0, 30);
        expect(todayIso(midnightLocal)).toBe('2026-07-30');
        expect(earliestStartDate(midnightLocal)).toBe('2026-07-31');
    });

    it('never offers today as a start date', () => {
        expect(daysBetween(todayIso(), earliestStartDate())).toBe(1);
        expect(daysBetween(todayIso(), earliestStartDate(new Date(), 0))).toBe(1);
    });

    /**
     * The plan's change cut-off reaches past tomorrow: a kitchen that locks each delivery 48 hours
     * ahead cannot start a subscription tomorrow, and offering the date anyway promised a start the
     * server then moved forward on its own (plans-17).
     */
    it('starts no sooner than the plan’s change cut-off allows', () => {
        // Thursday 30 July, late morning. 48 hours on lands inside Saturday, so Saturday's
        // delivery is already locked and the first open day is Sunday; tomorrow is Friday.
        const thursday = new Date(2026, 6, 30, 11, 0);
        expect(earliestStartDate(thursday, 48)).toBe('2026-08-02');
        // A cut-off that ends later the same day still leaves tomorrow as the floor...
        expect(earliestStartDate(thursday, 12)).toBe('2026-07-31');
        // ...and one that ends just after midnight locks tomorrow too.
        expect(earliestStartDate(thursday, 14)).toBe('2026-08-01');
        expect(earliestStartDate(thursday, 0)).toBe('2026-07-31');
    });

    it('produces the delivery dates a balance of days lands on', () => {
        // Monday, Wednesday, Friday from a Monday start: six deliveries reach into the second week.
        const dates = deliveryDatesFor('2026-07-27', [1, 3, 5], 6);
        expect(dates).toEqual([
            '2026-07-27',
            '2026-07-29',
            '2026-07-31',
            '2026-08-03',
            '2026-08-05',
            '2026-08-07',
        ]);
    });

    it('counts deliveries, not calendar days, so a short balance stops where it is spent', () => {
        // Four deliveries on three weekdays: the fourth is the following Monday, and nothing after.
        const dates = deliveryDatesFor('2026-07-27', [1, 3, 5], 4);
        expect(dates).toHaveLength(4);
        expect(dates.at(-1)).toBe('2026-08-03');
    });

    it('produces nothing at all when no weekday was chosen', () => {
        expect(deliveryDatesFor('2026-07-27', [], 4)).toEqual([]);
        expect(deliveryDatesFor('2026-07-27', [1], 0)).toEqual([]);
    });

    it('includes the day it starts from when listing upcoming deliveries', () => {
        const dates = upcomingDeliveryDates('2026-07-27', [1, 3, 5], 3);
        expect(dates).toEqual(['2026-07-27', '2026-07-29', '2026-07-31']);
    });

    it('does not offer a day that has already been skipped', () => {
        const dates = upcomingDeliveryDates('2026-07-27', [1, 3, 5], 3, {
            skipped: ['2026-07-29'],
        });
        expect(dates).toEqual(['2026-07-27', '2026-07-31', '2026-08-03']);
    });

    it('repairs a start date onto the next day the plan actually delivers', () => {
        // Saturday, on a plan that delivers Monday to Friday.
        expect(nextAllowedDate('2026-08-01', [1, 2, 3, 4, 5])).toBe('2026-08-03');
        expect(nextAllowedDate('2026-08-03', [1, 2, 3, 4, 5])).toBe('2026-08-03');
    });
});

/* ══ pure: delivery slots and the area check ═══════════════════════════════════════════════════ */

describe('delivery slots', () => {
    /**
     * The repository half of this case — every published code accepted by a real `changeSlot` — went
     * with the fixture world; a stub that echoed whatever it was handed would assert nothing. What
     * is still load-bearing is that the published list and the rules built on it agree: a code on
     * the list that the configurator's own slot rule rejected would block a subscription on a
     * window the product advertises.
     */
    it('publishes only codes its own vocabulary recognises', () => {
        expect(DELIVERY_SLOTS.length).toBeGreaterThan(0);
        for (const slot of DELIVERY_SLOTS) {
            expect(isDeliverySlotCode(slot.code)).toBe(true);
            expect(deliverySlotByCode(slot.code)).toEqual(slot);
        }
        // The default a configurator starts on has to be one of them, or every fresh configuration
        // would open with a slot issue nobody chose.
        expect(isDeliverySlotCode(DEFAULT_SLOT_CODE)).toBe(true);
    });

    it('rejects a code that is not on the list', () => {
        expect(isDeliverySlotCode('midday')).toBe(true);
        expect(isDeliverySlotCode('midnight')).toBe(false);
        expect(deliverySlotByCode('midnight')).toBeNull();
        expect(deliverySlotByCode('morning')?.startsAt).toBe('07:00');
    });

    it('takes its label from the caller so no English is frozen into the slot', () => {
        const slot = DELIVERY_SLOTS[0];
        expect(slot).toBeDefined();
        expect(toContractSlot(slot!, 'صباحًا')).toEqual({
            code: 'morning',
            label: 'صباحًا',
            startsAt: '07:00',
            endsAt: '10:00',
        });
    });
});

describe('the delivery-area check (doc 17, SUB-02)', () => {
    it('answers from the kitchen’s own published zones', () => {
        const areas = servedAreas(KITCHEN);

        expect(areas).toEqual(SERVED_AREAS);
        expect(deliveryAreaStatus(KITCHEN, areas[0] ?? '')).toBe('served');
    });

    it('ignores case and stray whitespace, because people type their own address', () => {
        const area = servedAreas(KITCHEN)[0] ?? '';

        expect(deliveryAreaStatus(KITCHEN, `  ${area.toLocaleUpperCase()} `)).toBe('served');
    });

    it('says unserved for somewhere the kitchen does not publish', () => {
        expect(deliveryAreaStatus(KITCHEN, 'Somewhere Else Entirely')).toBe('unserved');
    });

    it('treats silence as unknown rather than as coverage', () => {
        expect(deliveryAreaStatus(undefined, 'Business Bay')).toBe('unknown');
    });
});

/* ══ pure: the address form ════════════════════════════════════════════════════════════════════ */

const translate = (key: string): string => key;

const COMPLETE_ADDRESS = {
    label: 'Home',
    line1: 'Apartment 3, Palm Court',
    line2: '',
    area: 'Business Bay',
    city: 'Dubai',
    countryCode: 'ae',
    instructions: '',
};

describe('the delivery address', () => {
    it('names every field a delivery genuinely needs', () => {
        const errors = validateAddress(EMPTY_ADDRESS, translate);
        expect(Object.keys(errors).sort()).toEqual([
            'area',
            'city',
            'countryCode',
            'label',
            'line1',
        ]);
    });

    it('accepts a complete address and treats the optional lines as optional', () => {
        expect(validateAddress(COMPLETE_ADDRESS, translate)).toEqual({});
        expect(isAddressComplete(COMPLETE_ADDRESS, translate)).toBe(true);
    });

    it('normalises the country code rather than rejecting a lowercase one', () => {
        expect(toDeliveryAddress(COMPLETE_ADDRESS).countryCode).toBe('AE');
        expect(
            validateAddress({ ...COMPLETE_ADDRESS, countryCode: 'UAE' }, translate).countryCode,
        ).toBe('commerce:validation.countryCode');
    });

    it('sends absence as null rather than as an empty string', () => {
        const address = toDeliveryAddress(COMPLETE_ADDRESS);
        expect(address.line2).toBeNull();
        expect(address.instructions).toBeNull();
    });

    it('round-trips a stored address back into the form', () => {
        const address = toDeliveryAddress({ ...COMPLETE_ADDRESS, line2: 'Floor 4' });
        expect(fromDeliveryAddress(address).line2).toBe('Floor 4');
        expect(fromDeliveryAddress(address).instructions).toBe('');
    });

    it('drops the empty parts when writing one line', () => {
        const line = formatAddress(toDeliveryAddress(COMPLETE_ADDRESS));
        expect(line).toBe('Apartment 3, Palm Court, Business Bay, Dubai, AE');
    });

    it('refuses a value longer than the field allows', () => {
        const long = 'x'.repeat(200);
        expect(validateAddress({ ...COMPLETE_ADDRESS, line1: long }, translate).line1).toBe(
            'commerce:validation.tooLong',
        );
    });
});

/* ══ pure: the configurator ════════════════════════════════════════════════════════════════════ */

describe('configurator steps', () => {
    it('is four steps, and settles delivery and the meals before the review', () => {
        expect([...CONFIGURATOR_STEPS]).toEqual(['plan', 'delivery', 'meals', 'review']);
        // Doc 17, SUB-02: the area and the allergies are both answered before anything is created.
        expect(stepPosition('delivery')).toBeLessThan(stepPosition('review'));
        // The meals come after the delivery days, because they are chosen for those very days.
        expect(stepPosition('delivery')).toBeLessThan(stepPosition('meals'));
        expect(stepPosition('meals')).toBeLessThan(stepPosition('review'));
    });

    it('walks forwards and backwards and stops at both ends', () => {
        expect(previousConfiguratorStep('plan')).toBeNull();
        expect(nextConfiguratorStep('review')).toBeNull();
        expect(nextConfiguratorStep('plan')).toBe('delivery');
        expect(nextConfiguratorStep('delivery')).toBe('meals');
        expect(nextConfiguratorStep('meals')).toBe('review');
        expect(previousConfiguratorStep('review')).toBe('meals');
        expect(previousConfiguratorStep('meals')).toBe('delivery');
    });
});

describe('meal combinations (doc 17, SUB-08)', () => {
    it('lists each meal-and-snack combination once, however many bands offer it', () => {
        const combinations = mealCombinations(PLAN);

        expect(combinations.length).toBeLessThan(PLAN.variants.length);
        expect(new Set(combinations.map((entry) => combinationKey(entry))).size).toBe(
            combinations.length,
        );
        const totalVariants = combinations.reduce((sum, entry) => sum + entry.variantIds.length, 0);
        expect(totalVariants).toBe(PLAN.variants.length);
    });

    it('moves to the band closest to the one the person was already on', () => {
        const combinations = mealCombinations(PLAN);
        const twoSnacks = combinations.find((entry) => entry.snacksPerDay === 2);
        const light = PLAN.variants[0];

        expect(twoSnacks).toBeDefined();
        expect(light).toBeDefined();
        const moved = variantForCombination(PLAN, twoSnacks!, light ?? null);
        expect(moved).not.toBeNull();
        expect(twoSnacks?.variantIds).toContain(moved?.id);
        // "Closest", and not merely "the first one offering that combination": the 1 500 kcal band
        // is nearer the 1 400 one this person was on than the 1 900 band that follows it.
        expect(moved?.name).toBe('Light, two snacks');
    });
});

describe('duration pricing', () => {
    it.each(PLAN_DURATION_OPTIONS.map((option) => option.duration))(
        'derives the same %s total the catalogue publishes for the advertised band',
        (duration: PlanDuration) => {
            const option = durationOption(duration);

            // With the server's figure withheld, the client's own per-day arithmetic lands on
            // the figure the catalogue publishes — rounding the day, never the total.
            expect(estimatedTotal(ADVERTISED_VARIANT, { ...option, totalPrice: null })).toEqual(
                option.totalPrice,
            );
        },
    );

    it('prefers the figure the server states over its own estimate', () => {
        const quoted: PlanDurationOption = {
            ...durationOption('28d'),
            totalPrice: { amount: 123_456, currency: AED },
        };
        expect(estimatedTotal(ADVERTISED_VARIANT, quoted)).toEqual(quoted.totalPrice);
    });

    it('has no estimate without a band or without a length', () => {
        const unpriced = { ...durationOption('28d'), totalPrice: null };
        expect(estimatedTotal(null, unpriced)).toBeNull();
        expect(estimatedTotal(ADVERTISED_VARIANT, undefined)).toBeNull();
    });

    it('divides a total across its deliveries, and refuses to divide by none', () => {
        expect(perDeliveryPrice({ amount: 171_000, currency: 'USD' }, 12)).toEqual({
            amount: 14_250,
            currency: 'USD',
        });
        expect(perDeliveryPrice({ amount: 171_000, currency: 'USD' }, 0)).toBeNull();
    });

    it('keeps the currency it was given rather than assuming the default', () => {
        expect(perDeliveryPrice({ amount: 3000, currency: 'SAR' }, 3)?.currency).toBe('SAR');
    });
});

/**
 * The review's price card, as one arithmetic read top to bottom (plans-19): a delivery day lists
 * at X, the run buys N of them, the discount is the gap to the server's total, and a day after the
 * discount is what a refund is computed from. The old card showed a weekly price and a "before
 * discount" of four calendar weeks beside a total of twenty-eight delivery days.
 */
describe('the review’s price rows', () => {
    const labels = {
        perDayList: 'Per delivery day',
        balance: '28 delivery days',
        gross: 'Before discount',
        discount: 'Duration discount, 10 %',
        total: 'Total',
        perDelivery: 'Per delivery day, after the discount',
    };

    it('reads per-day list, gross over the balance, the discount, the total and the day after it', () => {
        const preview = subscriptionPreview(testConfiguration({ duration: '28d' }));
        const rows = buildPriceRows(preview, labels);

        expect(rows.map((row) => row.key)).toEqual([
            'per-day-list',
            'gross',
            'discount',
            'total',
            'per-delivery',
        ]);
        expect(rows[0]?.amount).toEqual(ADVERTISED_DAY_PRICE);
        // 6 786 × 28, and the row says what it multiplies.
        expect(rows[1]?.amount).toEqual({ amount: 6786 * 28, currency: AED });
        expect(rows[1]?.note).toBe('28 delivery days');
        // The gap between that and the server's total, shown as a credit.
        expect(rows[2]?.amount).toEqual({ amount: 170_996 - 6786 * 28, currency: AED });
        expect(rows[3]?.amount).toEqual({ amount: 170_996, currency: AED });
        expect(rows[3]?.emphasis).toBe(true);
        // 170 996 ÷ 28 = 6 107, the discounted per-day price the server quoted.
        expect(rows[4]?.amount).toEqual({ amount: 6107, currency: AED });
    });

    it('leaves the discount row out of a run that earns none', () => {
        const preview = subscriptionPreview(testConfiguration({ duration: '7d' }));
        const rows = buildPriceRows(preview, { ...labels, balance: '7 delivery days' });

        expect(rows.map((row) => row.key)).toEqual([
            'per-day-list',
            'gross',
            'total',
            'per-delivery',
        ]);
        // No discount, so "before" and the total are the same figure.
        expect(rows[1]?.amount).toEqual(rows[2]?.amount);
    });
});

/**
 * A dish in every sitting of every day a state delivers on — a meals step that is done. Keyed with
 * the screen's own `pickKey`; the request cases below author their keys by hand instead.
 */
function pickEverything(
    state: ConfiguratorState,
    plan: SubscriptionPlan = PLAN,
    mealId: MealId = MENU_MEALS[0]!.id,
): MealPicks {
    const sittings = plan.variants.find((variant) => variant.id === state.variantId)?.sittings;
    return Object.fromEntries(
        configuredDeliveryDates(state, plan).flatMap((date) =>
            (sittings ?? []).map((sitting) => [pickKey(date, sitting), mealId] as const),
        ),
    );
}

describe('step validation', () => {
    function fixture(): {
        readonly state: ConfiguratorState;
        readonly context: StepContext;
    } {
        const opened: ConfiguratorState = {
            ...initialConfiguratorState({
                plan: PLAN,
                startDate: '2026-08-03',
                allowedWeekdays: [1, 2, 3, 4, 5, 7],
            }),
            address: COMPLETE_ADDRESS,
            termsAcknowledged: true,
        };
        const state: ConfiguratorState = { ...opened, mealPicks: pickEverything(opened) };
        const context: StepContext = {
            plan: PLAN,
            allowedWeekdays: [1, 2, 3, 4, 5, 7],
            areaStatus: 'served',
            // A saved address is the only way the address requirement is met (plans-02).
            hasSavedAddress: true,
            earliestStartDate: '2026-07-31',
            translate,
        };
        return { state, context };
    }

    it('lets a complete configuration through every step', () => {
        const { state, context } = fixture();
        for (const step of CONFIGURATOR_STEPS) {
            expect(validateConfiguratorStep(step, state, context)).toEqual([]);
        }
        expect(firstIncompleteStep(state, context)).toBeNull();
    });

    it('refuses a delivery day the plan does not deliver on', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, deliveryWeekdays: [6] },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.deliveryDayUnavailable');
    });

    it('refuses a start date on a weekday the plan does not deliver on', () => {
        const { state, context } = fixture();
        // 2026-08-01 is a Saturday; this plan delivers on every day except Saturday.
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, startDate: '2026-08-01' },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.startWeekday');
    });

    it('refuses a start date earlier than tomorrow', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, startDate: '2026-07-27' },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.startTooSoon');
    });

    it('refuses a configuration with no delivery days at all', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, deliveryWeekdays: [] },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.noDeliveryDays');
    });

    it('enforces no weekday rule while the allowed set is still unknown', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, deliveryWeekdays: [6] },
            { ...context, allowedWeekdays: null },
        );
        expect(issues).not.toContain('commerce:configurator.issues.deliveryDayUnavailable');
    });

    it('stops an unserved area outright rather than offering to acknowledge it away', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep('delivery', state, {
            ...context,
            areaStatus: 'unserved',
        });
        expect(issues).toContain('commerce:configurator.issues.areaUnserved');
    });

    it('lets an unknown area through, because silence is not a refusal', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep('delivery', state, {
            ...context,
            areaStatus: 'unknown',
        });
        expect(issues).toEqual([]);
    });

    /**
     * The start is the first delivery, so it is judged against the days actually chosen — the
     * purchase refuses a start it would otherwise have to move. With none chosen yet, the plan's
     * own delivery days are the rule.
     */
    it('judges the start date against the chosen delivery days, else the plan’s', () => {
        const { state, context } = fixture();
        // Tuesday 4 August: a day the plan delivers on, but not one of Mon/Wed/Fri.
        const tuesday = { ...state, startDate: '2026-08-04', deliveryWeekdays: [1, 3, 5] };
        expect(validateConfiguratorStep('delivery', tuesday, context)).toContain(
            'commerce:configurator.issues.startWeekday',
        );
        expect(
            validateConfiguratorStep('delivery', { ...tuesday, startDate: '2026-08-05' }, context),
        ).toEqual([]);
        // Nothing chosen: Tuesday is fine by the plan; Saturday is not.
        const unchosen = { ...tuesday, deliveryWeekdays: [] };
        expect(validateConfiguratorStep('delivery', unchosen, context)).not.toContain(
            'commerce:configurator.issues.startWeekday',
        );
        expect(
            validateConfiguratorStep('delivery', { ...unchosen, startDate: '2026-08-01' }, context),
        ).toContain('commerce:configurator.issues.startWeekday');
    });

    it('refuses a start date inside the plan’s change cut-off, not merely before tomorrow', () => {
        const { state, context } = fixture();
        // The kitchen locks deliveries far enough ahead that Monday 3 August is the floor.
        const locked = { ...context, earliestStartDate: '2026-08-03' };
        expect(validateConfiguratorStep('delivery', state, locked)).toEqual([]);
        expect(
            validateConfiguratorStep('delivery', { ...state, startDate: '2026-07-31' }, locked),
        ).toContain('commerce:configurator.issues.startTooSoon');
    });

    /**
     * A plan with no length on sale opens with no length chosen, and the plan step says so rather
     * than letting a configuration with nothing to buy through to a priced preview.
     */
    it('holds the plan step while the plan offers no length, or one it no longer sells', () => {
        const { context } = fixture();
        const unsellable = { ...PLAN, durations: [] };
        const state = initialConfiguratorState({ plan: unsellable, startDate: '2026-08-03' });

        expect(state.duration).toBeNull();
        expect(validateConfiguratorStep('plan', state, { ...context, plan: unsellable })).toEqual([
            'commerce:configurator.issues.duration',
        ]);
        expect(firstIncompleteStep(state, { ...context, plan: unsellable })).toBe('plan');

        // A draft can name a length the kitchen has since withdrawn; the step refuses it too.
        const withdrawn = { ...PLAN, durations: PLAN.durations.slice(1) };
        expect(
            validateConfiguratorStep(
                'plan',
                { ...state, duration: '7d' },
                { ...context, plan: withdrawn },
            ),
        ).toEqual(['commerce:configurator.issues.duration']);
    });

    /**
     * A typed address used to satisfy this step on its own. Placement takes only a saved address's
     * identifier, so that path passed all three steps and was refused at Subscribe every time.
     */
    it('will not leave the delivery step without a saved address, however complete the fields', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, address: COMPLETE_ADDRESS },
            { ...context, hasSavedAddress: false },
        );
        expect(issues).toContain('commerce:configurator.issues.address');
        expect(
            validateConfiguratorStep('delivery', { ...state, address: EMPTY_ADDRESS }, context),
        ).toEqual([]);
    });

    it('will not confirm without the terms acknowledgement the repository requires', () => {
        const { state, context } = fixture();
        expect(
            validateConfiguratorStep('review', { ...state, termsAcknowledged: false }, context),
        ).toEqual(['commerce:configurator.issues.terms']);
    });

    it('makes a later step unreachable while an earlier one is unanswered', () => {
        const { state, context } = fixture();
        const broken = { ...state, deliveryWeekdays: [] };
        expect(isStepReachable('review', broken, context)).toBe(false);
        expect(isStepReachable('delivery', broken, context)).toBe(true);
        expect(firstIncompleteStep(broken, context)).toBe('delivery');
    });

    /**
     * The customer chooses what they eat: every sitting of every delivery day is filled before the
     * review, and one empty sitting anywhere in the run is enough to hold the step.
     */
    it('holds the meals step until every sitting of every day has a dish', () => {
        const { state, context } = fixture();
        const missing = ['commerce:configurator.issues.mealsMissing'];

        expect(validateConfiguratorStep('meals', { ...state, mealPicks: {} }, context)).toEqual(
            missing,
        );

        // One sitting short, on the last day of the run.
        const lastDay = configuredDeliveryDates(state, PLAN).at(-1)!;
        const allButOne = Object.fromEntries(
            Object.entries(state.mealPicks).filter(([key]) => key !== `${lastDay}|snack:2`),
        );
        expect(Object.keys(allButOne)).toHaveLength(Object.keys(state.mealPicks).length - 1);
        const short = { ...state, mealPicks: allButOne };
        expect(validateConfiguratorStep('meals', short, context)).toEqual(missing);
        expect(isStepReachable('review', short, context)).toBe(false);
        expect(isStepReachable('meals', short, context)).toBe(true);
        expect(firstIncompleteStep(short, context)).toBe('meals');

        expect(validateConfiguratorStep('meals', state, context)).toEqual([]);
    });
});

describe('turning the configurator state into a request', () => {
    it('sorts the delivery weekdays so the same choice always sends the same request', () => {
        const state: ConfiguratorState = {
            ...initialConfiguratorState({ plan: PLAN, startDate: '2026-08-03' }),
            deliveryWeekdays: [5, 1, 3],
            address: COMPLETE_ADDRESS,
        };
        const configuration = toConfiguration(state, PLAN, toDeliveryAddress);
        expect(configuration?.deliveryWeekdays).toEqual([1, 3, 5]);
    });

    it('answers null rather than sending an incomplete proposal', () => {
        const base = initialConfiguratorState({ plan: PLAN, startDate: '2026-08-03' });

        expect(toConfiguration({ ...base, variantId: null }, PLAN, toDeliveryAddress)).toBeNull();
        expect(toConfiguration({ ...base, duration: null }, PLAN, toDeliveryAddress)).toBeNull();
        expect(toConfiguration({ ...base, startDate: null }, PLAN, toDeliveryAddress)).toBeNull();
        expect(
            toConfiguration({ ...base, deliveryWeekdays: [] }, PLAN, toDeliveryAddress),
        ).toBeNull();
    });

    it('derives the same delivery dates the repository will bill for', () => {
        const state: ConfiguratorState = {
            ...initialConfiguratorState({ plan: PLAN, startDate: '2026-08-03' }),
            duration: '7d',
            deliveryWeekdays: [1, 3, 5],
            address: COMPLETE_ADDRESS,
        };
        const configuration = toConfiguration(state, PLAN, toDeliveryAddress);
        expect(configuration).not.toBeNull();

        // Seven deliveries on three weekdays from a Monday start: the first is the start date
        // itself and the seventh is the Monday a fortnight on — a balance, not a calendar week.
        // Authored here rather than read back from `configuredDeliveryDates`, so the two really are
        // two answers to the same question.
        const preview = subscriptionPreview(configuration!, {
            firstDeliveryDate: '2026-08-03',
            lastDeliveryDate: '2026-08-17',
        });

        const dates = configuredDeliveryDates(state, PLAN);
        expect(dates.length).toBe(preview.deliveryCount);
        expect(dates[0]).toBe(preview.firstDeliveryDate);
        expect(dates.at(-1)).toBe(preview.lastDeliveryDate);
    });

    it('derives no dates for a length the plan does not offer', () => {
        const state: ConfiguratorState = {
            ...initialConfiguratorState({ plan: PLAN, startDate: '2026-08-03' }),
            duration: '40d',
            deliveryWeekdays: [1, 3, 5],
        };
        expect(configuredDeliveryDates(state, PLAN)).toEqual([]);
        expect(configuredDeliveryDates({ ...state, duration: null }, PLAN)).toEqual([]);
    });
});

/**
 * The meals a configuration carries: a dish for each sitting of each delivery day, keyed
 * `date|slot:sequence`. The cases run on the two-meal band (lunch and dinner) over seven
 * deliveries on Monday, Wednesday and Friday from Monday 3 August — the dates are authored here,
 * not read back from `configuredDeliveryDates`.
 */
describe('the meals a configuration carries', () => {
    const [HARVEST, SESAME, HALLOUMI] = MENU_MEALS.map((meal) => meal.id) as [
        MealId,
        MealId,
        MealId,
    ];
    /** Seven deliveries on Mon/Wed/Fri from 3 August: week 1 is the first three. */
    const RUN = [
        '2026-08-03',
        '2026-08-05',
        '2026-08-07',
        '2026-08-10',
        '2026-08-12',
        '2026-08-14',
        '2026-08-17',
    ] as const;

    function twoMealRun(mealPicks: MealPicks = {}): ConfiguratorState {
        return {
            ...initialConfiguratorState({
                plan: PLAN,
                variantId: TWO_MEALS_VARIANT.id,
                startDate: '2026-08-03',
            }),
            duration: '7d',
            deliveryWeekdays: [1, 3, 5],
            address: COMPLETE_ADDRESS,
            mealPicks,
        };
    }

    /** Lunch and dinner for each of `dates`, both the same dish. */
    function sameDish(dates: readonly string[], mealId: MealId): Record<string, MealId> {
        return Object.fromEntries(
            dates.flatMap((date) => [
                [`${date}|lunch:1`, mealId],
                [`${date}|dinner:1`, mealId],
            ]),
        );
    }

    it('keys a pick by its day and its sitting, so a second lunch is a sitting of its own', () => {
        expect(pickKey('2026-08-03', { slot: 'lunch', sequence: 1 })).toBe('2026-08-03|lunch:1');
        expect(pickKey('2026-08-03', { slot: 'lunch', sequence: 2 })).toBe('2026-08-03|lunch:2');
    });

    it('sends every delivery day with a dish for each sitting, in the order of the day', () => {
        const state = twoMealRun({
            ...sameDish(RUN, HARVEST),
            '2026-08-05|lunch:1': HALLOUMI,
            '2026-08-05|dinner:1': SESAME,
            // A day the run does not deliver on, and a sitting this band does not have — both
            // left from an earlier choice of days or band. Neither is sent.
            '2026-08-04|lunch:1': SESAME,
            '2026-08-03|breakfast:1': SESAME,
        });

        const configuration = toConfiguration(state, PLAN, toDeliveryAddress);

        expect(configuration?.days).toEqual(
            RUN.map((date) => ({
                date,
                meals:
                    date === '2026-08-05'
                        ? [
                              { slot: 'lunch', sequence: 1, mealId: HALLOUMI },
                              { slot: 'dinner', sequence: 1, mealId: SESAME },
                          ]
                        : [
                              { slot: 'lunch', sequence: 1, mealId: HARVEST },
                              { slot: 'dinner', sequence: 1, mealId: HARVEST },
                          ],
            })),
        );
        expect(chosenDays(state, PLAN)).toEqual(configuration?.days);
        // The allergy notice reads each dish once, however many days carry it.
        expect([...pickedMealIds(state, PLAN)].sort()).toEqual([HARVEST, HALLOUMI, SESAME].sort());
    });

    it('sends a day only as far as it was filled, and counts what is missing', () => {
        const full = sameDish(RUN, HARVEST);
        const state = twoMealRun(
            Object.fromEntries(
                Object.entries(full).filter(([key]) => key !== '2026-08-10|dinner:1'),
            ),
        );

        // The server refuses an incomplete day by name; the meals step never lets one reach it.
        expect(chosenDays(state, PLAN).find((day) => day.date === '2026-08-10')).toEqual({
            date: '2026-08-10',
            meals: [{ slot: 'lunch', sequence: 1, mealId: HARVEST }],
        });
        expect(missingPicks(state, PLAN)).toBe(1);
        expect(missingPicks(twoMealRun(), PLAN)).toBe(RUN.length * 2);
        expect(missingPicks(twoMealRun(full), PLAN)).toBe(0);
    });

    it('owes no meals for a run with no days, but never reads a band-less run as complete', () => {
        // A length the plan does not sell has no delivery days, so nothing is missing.
        expect(missingPicks({ ...twoMealRun(), duration: '40d' }, PLAN)).toBe(0);
        expect(chosenDays({ ...twoMealRun(), duration: '40d' }, PLAN)).toEqual([]);
        // Days but no band: there are no sittings to fill, which is not the same as all filled.
        expect(missingPicks({ ...twoMealRun(), variantId: null }, PLAN)).toBeGreaterThan(0);
    });

    it('repeats week 1 onto every later day of the same weekday', () => {
        const state = twoMealRun({
            '2026-08-03|lunch:1': HARVEST,
            '2026-08-03|dinner:1': SESAME,
            '2026-08-05|lunch:1': HALLOUMI,
            '2026-08-05|dinner:1': HARVEST,
            '2026-08-07|lunch:1': SESAME,
            '2026-08-07|dinner:1': HALLOUMI,
        });

        const repeated = repeatFirstWeek(state, PLAN);

        expect(repeated).toEqual({
            ...state.mealPicks,
            // Mondays from Monday 3, Wednesdays from Wednesday 5, Fridays from Friday 7.
            '2026-08-10|lunch:1': HARVEST,
            '2026-08-10|dinner:1': SESAME,
            '2026-08-12|lunch:1': HALLOUMI,
            '2026-08-12|dinner:1': HARVEST,
            '2026-08-14|lunch:1': SESAME,
            '2026-08-14|dinner:1': HALLOUMI,
            '2026-08-17|lunch:1': HARVEST,
            '2026-08-17|dinner:1': SESAME,
        });
        expect(missingPicks({ ...state, mealPicks: repeated }, PLAN)).toBe(0);
    });

    it('never overwrites a later day the person already chose, and fills only what is empty', () => {
        const state = twoMealRun({
            ...sameDish(['2026-08-03', '2026-08-05', '2026-08-07'], HARVEST),
            // Chosen on purpose for a later Wednesday: Repeat must leave it alone.
            '2026-08-12|lunch:1': SESAME,
        });

        const repeated = repeatFirstWeek(state, PLAN);

        expect(repeated['2026-08-12|lunch:1']).toBe(SESAME);
        expect(repeated['2026-08-12|dinner:1']).toBe(HARVEST);
        expect(repeated['2026-08-10|lunch:1']).toBe(HARVEST);
        // The input is a value, not a store: nothing was changed in place.
        expect(state.mealPicks['2026-08-10|lunch:1']).toBeUndefined();
    });

    it('leaves a later sitting empty where week 1 left it empty', () => {
        const state = twoMealRun({
            ...sameDish(['2026-08-05', '2026-08-07'], HARVEST),
            // Monday 3 has a lunch and no dinner.
            '2026-08-03|lunch:1': HALLOUMI,
        });

        const repeated = repeatFirstWeek(state, PLAN);

        expect(repeated['2026-08-10|lunch:1']).toBe(HALLOUMI);
        expect(repeated['2026-08-10|dinner:1']).toBeUndefined();
        expect(repeated['2026-08-17|dinner:1']).toBeUndefined();
        // Week 1's own gap and the two Mondays after it.
        expect(missingPicks({ ...state, mealPicks: repeated }, PLAN)).toBe(3);
    });

    it('has nothing to repeat in a run with no days', () => {
        const state = { ...twoMealRun({ '2026-08-03|lunch:1': HARVEST }), duration: null };
        expect(repeatFirstWeek(state, PLAN)).toBe(state.mealPicks);
    });
});

/* ══ pure: warnings and states ═════════════════════════════════════════════════════════════════ */

describe('preview warnings', () => {
    it('has written copy for every code the repository can emit', () => {
        expect(isKnownWarning(CHECKOUT_EMPTY_CART)).toBe(true);
        expect(isKnownWarning(SUBSCRIPTION_DAY_UNAVAILABLE)).toBe(true);
        // A basket priced before an address is chosen is the ordinary first render of the
        // checkout, and the generic "a note we do not recognise" sentence is not what to say
        // about it.
        expect(isKnownWarning(CHECKOUT_ADDRESS_MISSING)).toBe(true);
        expect(warningMessageKey(CHECKOUT_ADDRESS_MISSING)).toBe(
            'commerce:warnings.checkout_address_missing',
        );
        expect(warningMessageKey(SUBSCRIPTION_DAY_UNAVAILABLE)).toBe(
            'commerce:warnings.subscription_delivery_day_unavailable',
        );
    });

    it('falls back to one generic sentence for a code it has never seen', () => {
        expect(isKnownWarning('subscription.invented_later')).toBe(false);
        expect(warningMessageKey('subscription.invented_later')).toBe('commerce:warnings.unknown');
    });

    it('treats an allergen conflict as critical and a scheduling note as not', () => {
        expect(isCriticalWarning(ALLERGEN_CONFLICT_WARNING)).toBe(true);
        expect(isCriticalWarning(SUBSCRIPTION_DAY_UNAVAILABLE)).toBe(false);
    });

    it('drops the empty-basket warning, which the empty state already says', () => {
        expect(displayableWarnings([CHECKOUT_EMPTY_CART, ALLERGEN_CONFLICT_WARNING])).toEqual([
            ALLERGEN_CONFLICT_WARNING,
        ]);
    });
});

describe('what each subscription state permits', () => {
    it('covers every state in the domain vocabulary', () => {
        for (const state of SUBSCRIPTION_STATES) {
            expect(typeof canPauseOrSkip(state)).toBe('boolean');
            expect(typeof isTerminalSubscriptionState(state)).toBe('boolean');
        }
    });

    it('permits pause and skip only from the two live states', () => {
        expect(SUBSCRIPTION_STATES.filter(canPauseOrSkip)).toEqual(['active', 'skipped_today']);
    });

    it('permits resume only from paused', () => {
        expect(SUBSCRIPTION_STATES.filter(canResume)).toEqual(['paused']);
    });

    it('permits address and slot changes from every live or paused state', () => {
        expect(SUBSCRIPTION_STATES.filter(canChangeDelivery)).toEqual([
            'active',
            'paused',
            'skipped_today',
        ]);
    });

    it('treats cancelled and expired as read-only', () => {
        expect(SUBSCRIPTION_STATES.filter(isTerminalSubscriptionState)).toEqual([
            'cancelled',
            'expired',
        ]);
    });
});

/* ══ screens: the basket ═══════════════════════════════════════════════════════════════════════ */

function renderCart(
    basket: Basket,
    options: {
        readonly latencyMs?: number;
        readonly addresses?: readonly CustomerAddress[];
    } = {},
) {
    return renderStubScreen(<CartScreen />, {
        session: testMeResponse(),
        ...(options.latencyMs === undefined ? {} : { latencyMs: options.latencyMs }),
        repositories: {
            commerce: basketRepository(basket),
            // A line's photograph is the meal's own, read by id — `CartItem` carries none.
            marketplace: { getMeal: async (mealId: MealId) => mealById(mealId) },
            // The line under the title, and the delivery figure, come from the default address.
            account: { listAddresses: async () => options.addresses ?? [] },
        },
    });
}

describe('CartScreen', () => {
    it('shows skeletons before the basket arrives', async () => {
        await renderCart(basketOf(0), { latencyMs: 60 });
        expect(screen.getByTestId('cart-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('cart-empty')).toBeTruthy();
        });
    });

    it('offers a way to the marketplace when the basket is empty', async () => {
        await renderCart(basketOf(0));
        await waitFor(() => {
            expect(screen.getByTestId('cart-empty')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('cart-browse'));
        expect(routerMock.__push).toHaveBeenCalledWith('/meals');
    });

    it('renders every line with its own price, and a priced total from the preview', async () => {
        await renderCart(basketOf(2));

        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });
        // One noun for the one place (browse-14): the toast and the header say basket too.
        expect(screen.getByTestId('cart-title')).toHaveTextContent('Your basket');
        // Two of a 45.00 meal: the line total is the repository's, and so is the priced total.
        expect(screen.getByTestId(`cart-line-${BASKET_LINE_ID}-total`)).toHaveTextContent(
            'AED 90.00',
        );
        // A line has no modifiers in the contract, which is the design's own "No changes" case.
        expect(screen.getByTestId(`cart-line-${BASKET_LINE_ID}-mods`)).toHaveTextContent(
            'No changes',
        );
        await waitFor(() => {
            expect(screen.getByTestId('cart-price-total-amount')).toHaveTextContent('AED 90.00');
        });
        expect(screen.getByTestId('cart-price-subtotal-amount')).toHaveTextContent('AED 90.00');
        // No saved address, so nothing to price delivery from yet — said, not shown as zero.
        expect(screen.getByTestId('cart-price-delivery-amount')).toHaveTextContent('At checkout');
        // No tax figure exists, and no discount was quoted: neither row is drawn.
        expect(screen.queryByTestId('cart-price-discount')).toBeNull();
        expect(screen.getByTestId('cart-fine-print')).toHaveTextContent(/cash/);
    });

    it('names the default saved address and prices delivery to it', async () => {
        const harness = await renderCart(basketOf(2), {
            addresses: [testAddress({ id: 'address-office', isDefault: false }), HOME_ADDRESS],
        });

        await waitFor(() => {
            expect(screen.getByTestId('cart-subtitle')).toHaveTextContent(/12 Sunset Street/);
        });
        await waitFor(() => {
            expect(screen.getByTestId('cart-price-delivery-amount')).toHaveTextContent('AED 15.00');
        });
        expect(screen.getByTestId('cart-price-total-amount')).toHaveTextContent('AED 105.00');
        // The preview was asked about the default address, not the first one in the list.
        expect(harness.repositories.commerce.previewCheckout).toHaveBeenCalledWith(
            expect.objectContaining({ addressId: HOME_ADDRESS.id }),
        );
    });

    /**
     * There is no promotion operation, so the design's promo field and "Apply" are the prototype
     * notice: drawn, and honest about doing nothing.
     */
    it('answers "Apply" on a promo code with the prototype notice and changes nothing', async () => {
        const basket = basketOf(1);
        await renderCart(basket);
        await waitFor(() => {
            expect(screen.getByTestId('cart-promo-apply')).toBeTruthy();
        });

        await fireEvent.changeText(screen.getByTestId('cart-promo-input'), 'SUMMER');
        await fireEvent.press(screen.getByTestId('cart-promo-apply'));

        expect(await screen.findByTestId('prototype-notice')).toHaveTextContent(/Not built yet/);
        expect(screen.getByTestId('cart-price-total-amount')).toHaveTextContent('AED 45.00');
    });

    it('raises a quantity for real, and the total moves with it', async () => {
        const basket = basketOf(1);
        const harness = await renderCart(basket);
        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });
        expect(basket.cart.itemCount).toBe(1);

        await act(async () => {
            fireEvent.press(screen.getByTestId(`cart-line-${BASKET_LINE_ID}-quantity-increment`));
        });

        // One request carrying the *difference*, and a basket that really holds two afterwards.
        await waitFor(() => {
            expect(basket.cart.itemCount).toBe(2);
        });
        expect(harness.repositories.commerce.addCartItem).toHaveBeenCalledWith(CART_ID, {
            mealId: BASKET_MEAL.id,
            quantity: 1,
        });
        await waitFor(() => {
            expect(screen.getByTestId('cart-price-total-amount')).toHaveTextContent('AED 90.00');
        });
    });

    it('lowers a quantity by rebuilding the line, since the contract cannot set one', async () => {
        const basket = basketOf(3);
        const harness = await renderCart(basket);
        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(`cart-line-${BASKET_LINE_ID}-quantity-decrement`));
        });

        await waitFor(() => {
            expect(basket.cart.itemCount).toBe(2);
        });
        expect(basket.cart.items).toHaveLength(1);
        // `addCartItem` can only raise a quantity, so lowering is a remove followed by an add at
        // the target — two round trips, and the hook says so rather than pretending otherwise.
        expect(harness.repositories.commerce.removeCartItem).toHaveBeenCalledWith(
            CART_ID,
            BASKET_LINE_ID,
        );
        expect(harness.repositories.commerce.addCartItem).toHaveBeenCalledWith(CART_ID, {
            mealId: BASKET_MEAL.id,
            quantity: 2,
        });
    });

    it('removes a line for real and falls back to the empty state', async () => {
        const basket = basketOf(1);
        await renderCart(basket);
        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId(`cart-line-${BASKET_LINE_ID}-remove`));
        });

        await waitFor(() => {
            expect(screen.getByTestId('cart-empty')).toBeTruthy();
        });
        expect(basket.cart.items).toHaveLength(0);
    });

    it('sends a full basket onward to checkout', async () => {
        await renderCart(basketOf(1));
        // Waiting on its price: there until the preview answers, but not yet pressable.
        await waitFor(() => {
            expect(screen.getByTestId('cart-checkout')).not.toBeDisabled();
        });
        await fireEvent.press(screen.getByTestId('cart-checkout'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/checkout');
    });

    /*
     * Checkout sat inside the price's `QueryStates`, so a failed or refused preview left only the
     * error and Retry: no way onward, and no sign the basket could still be ordered (browse-13).
     */
    it('keeps Checkout on the page when the price cannot be worked out, waiting on it', async () => {
        const basket = basketOf(1);
        const previewCheckout = jest
            .fn<Promise<CheckoutPreview>, [PreviewCheckoutRequest]>()
            .mockRejectedValueOnce(new ApiError(apiFailure('network')))
            .mockImplementation(async (request) => checkoutPreview(basket.cart, request));
        await renderStubScreen(<CartScreen />, {
            session: testMeResponse(),
            repositories: {
                commerce: { ...basketRepository(basket), previewCheckout },
                marketplace: { getMeal: async (mealId: MealId) => mealById(mealId) },
                account: { listAddresses: async () => [] },
            },
        });

        await waitFor(() => screen.getByTestId('cart-preview-error'));
        expect(screen.getByTestId('cart-checkout')).toBeDisabled();
        expect(screen.getByTestId('cart-fine-print')).toBeTruthy();
        await fireEvent.press(screen.getByTestId('cart-checkout'));
        expect(routerMock.__push).not.toHaveBeenCalled();

        // Retry prices it, and the same button goes on to checkout.
        await fireEvent.press(screen.getByTestId('cart-preview-error-retry'));
        await waitFor(() => {
            expect(screen.getByTestId('cart-checkout')).not.toBeDisabled();
        });
        await fireEvent.press(screen.getByTestId('cart-checkout'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/checkout');
    });

    /**
     * The design's compact stepper replaced a labelled number field, so what the field's label used
     * to say now has to be said by the controls: each button names the meal it changes, and the
     * floor is a disabled minus rather than a line that silently refuses to drop below one.
     */
    it('names the meal on each quantity control and will not step below one portion', async () => {
        await renderCart(basketOf(1));
        await waitFor(() => {
            expect(screen.getByTestId('cart-lines')).toBeTruthy();
        });

        const decrement = screen.getByTestId(`cart-line-${BASKET_LINE_ID}-quantity-decrement`);
        const increment = screen.getByTestId(`cart-line-${BASKET_LINE_ID}-quantity-increment`);
        expect(decrement.props.accessibilityLabel).toContain(BASKET_MEAL.name);
        expect(increment.props.accessibilityLabel).toContain(BASKET_MEAL.name);
        expect(decrement.props.accessibilityState).toMatchObject({ disabled: true });
        expect(screen.getByTestId(`cart-line-${BASKET_LINE_ID}-quantity-value`)).toHaveTextContent(
            '1',
        );
        // The photograph slot is there — decorative, since the name beside it is what is announced.
        expect(
            screen.getByTestId(`cart-line-${BASKET_LINE_ID}-image`, {
                includeHiddenElements: true,
            }),
        ).toBeTruthy();
    });

    it('offers the menu again from under the lines, as a way to add rather than to leave', async () => {
        await renderCart(basketOf(1));
        await waitFor(() => {
            expect(screen.getByTestId('cart-add-more')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('cart-add-more'));
        // To the basket's own kitchen: a basket holds one kitchen's meals (browse-03).
        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchens/${String(KITCHEN_ID)}`);
        // The summary rail is a sibling of the lines, not nested inside them, so it can sit beside
        // them on a desk and after them on a phone.
        expect(screen.getByTestId('cart-layout-main')).toContainElement(
            screen.getByTestId('cart-lines'),
        );
        expect(screen.getByTestId('cart-layout-main')).not.toContainElement(
            screen.getByTestId('cart-summary'),
        );
        expect(screen.getByTestId('cart-layout-aside')).toContainElement(
            screen.getByTestId('cart-summary'),
        );
    });
});

/* ══ screens: checkout ═════════════════════════════════════════════════════════════════════════ */

interface CheckoutOptions {
    readonly addresses?: readonly CustomerAddress[] | undefined;
    readonly commerce?: Partial<CommerceRepository> | undefined;
    /** The account's setup checklist. Defaults to one with nothing left to do. */
    readonly checklist?: AccountSetupChecklist | undefined;
    /** The checkout's URL query — its address, date, window and step live there. */
    readonly params?: Readonly<Record<string, string>> | undefined;
}

const READY_CHECKLIST: AccountSetupChecklist = {
    lifecycle: 'active',
    items: [],
    canActivate: true,
};

/**
 * Settles once the checkout's kitchen query has been answered. Review records the kitchen's name
 * as it reads at that moment, so committing before the answer lands leaves the confirmation saying
 * "The kitchen" — a race a slow CI runner loses.
 */
let kitchenServed: Promise<void> = Promise.resolve();

/**
 * The checkout keeps every choice in its URL, so its cases run with the router mock *following*
 * navigation: choosing a window is a `setParams` the screen then reads back, "Continue to payment"
 * a push of `?step=payment`, and placing the order a replace onto `?placed=`. The spies still record
 * each call, which is what most cases assert.
 */
function renderCheckout(basket: Basket, options: CheckoutOptions = {}) {
    let served = () => {};
    kitchenServed = new Promise((resolve) => {
        served = resolve;
    });
    routerMock.__set({
        pathname: '/customer/checkout',
        params: options.params ?? {},
        follow: true,
    });
    // The confirmation reads the placed order back by its identifier: the one this case placed,
    // or — for a confirmation opened straight from its URL — one the server already holds.
    let placed: PlacedOrder | null = null;
    const placeOrder = options.commerce?.placeOrder;
    return renderStubScreen(<CheckoutScreen />, {
        session: testMeResponse(),
        repositories: {
            commerce: {
                ...basketRepository(basket),
                getMyOrder: async (orderId: OrderId): Promise<PlacedOrder> => {
                    if (placed?.id === orderId) return placed;
                    if (orderId !== ORDER_ID) throw new ApiError(apiFailure('resource.not_found'));
                    return placedOrderFrom(cartOf([cartLine(BASKET_MEAL, 1)]), {
                        cartId: CART_ID,
                        addressId: HOME_ADDRESS.id,
                    });
                },
                ...options.commerce,
                ...(placeOrder === undefined
                    ? {}
                    : {
                          placeOrder: async (request: PlaceOrderRequest) => {
                              placed = await placeOrder(request);
                              return placed;
                          },
                      }),
            },
            account: {
                listAddresses: async () => options.addresses ?? [],
                getChecklist: async () => options.checklist ?? READY_CHECKLIST,
            },
            marketplace: {
                getKitchen: async () => {
                    served();
                    return KITCHEN;
                },
            },
        },
    });
}

/** The checkout's href for these choices, as the screen writes it. */
function checkoutAt(query: Readonly<Record<string, string>>): string {
    return `/customer/checkout?${new URLSearchParams(query).toString()}`;
}

/** The payment step `reviewCheckout` lands on: the home address, the earliest day, midday. */
function paymentStepHref(): string {
    return checkoutAt({
        address: HOME_ADDRESS.id,
        date: earliestStartDate(),
        slot: DEFAULT_SLOT_CODE,
        step: 'payment',
    });
}

/** Choose the one saved address and commit the delivery details, which reveals "place order". */
async function reviewCheckout(addressId: string): Promise<void> {
    await act(async () => {
        await kitchenServed;
    });
    await fireEvent.press(await screen.findByTestId('checkout-address-picker-trigger'));
    await fireEvent.press(await screen.findByTestId(`checkout-address-picker-option-${addressId}`));
    await waitFor(() => {
        expect(screen.getByTestId('checkout-review')).toBeTruthy();
    });
    await act(async () => {
        fireEvent.press(screen.getByTestId('checkout-review'));
    });
    // Choosing an address re-prices, and "place order" waits for that price: no confirmed total,
    // no placement.
    await waitFor(() => {
        expect(screen.getByTestId('checkout-place-order').props.accessibilityState).toMatchObject({
            disabled: false,
        });
    });
}

describe('CheckoutScreen', () => {
    // The confirmation's kitchen name is a note the placement leaves in the tab; no case may
    // inherit one from the case before it.
    beforeEach(() => {
        clearAllSessionDrafts();
    });

    it('says there is nothing to check out when the basket is empty', async () => {
        await renderCheckout(basketOf(0));
        await waitFor(() => {
            expect(screen.getByTestId('checkout-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-browse')).toBeTruthy();
        // No order was placed in this tab, so there is nothing to track from here.
        expect(screen.queryByTestId('checkout-track-latest')).toBeNull();
    });

    /**
     * The placement takes an address *identifier*, so a person with nothing saved cannot be given a
     * form to type into — they are sent to the address form, which is the only place that produces
     * one, carrying the checkout as it stands so saving comes straight back.
     */
    it('sends somebody with no saved address to the address form, and back', async () => {
        await renderCheckout(basketOf(1), { addresses: [] });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-addresses-empty')).toBeTruthy();
        });
        // Nothing to continue with: Continue is off, and says why to a screen reader.
        expect(screen.getByTestId('checkout-review').props.accessibilityState).toMatchObject({
            disabled: true,
        });
        expect(screen.getByTestId('checkout-review').props.accessibilityHint).toBe(
            'Add a delivery address first',
        );

        await act(async () => {
            await kitchenServed;
        });
        await fireEvent.press(screen.getByTestId('checkout-add-address'));

        const opened = routerMock.__push.mock.calls.at(-1)?.[0] as string;
        expect(pathnameOf(opened)).toBe('/customer/account/addresses/new');
        // The return is this checkout with the choices it derived written out.
        expect(opened).toBe(
            withReturnTo(
                '/customer/account/addresses/new',
                checkoutAt({ date: earliestStartDate(), slot: DEFAULT_SLOT_CODE }),
            ),
        );
    });

    it('picks a saved address and a kitchen window, and never a payment instrument', async () => {
        await renderCheckout(basketOf(1), { addresses: [HOME_ADDRESS] });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-picker')).toBeTruthy();
        });

        expect(screen.getByTestId('checkout-slot-picker')).toBeTruthy();
        expect(screen.getByTestId('checkout-date-field')).toBeTruthy();
        // Delivery is the real fulfilment and is chosen; this kitchen publishes no pickup, so the
        // design's Pickup card is drawn and refuses rather than pretending.
        expect(screen.getByTestId('checkout-mode-delivery').props.accessibilityState).toMatchObject(
            { checked: true },
        );
        expect(screen.getByTestId('checkout-mode-pickup').props.accessibilityState).toMatchObject({
            checked: false,
            disabled: true,
        });

        // The property that matters most on this screen is an absence: nothing on the delivery
        // step takes payment, and nowhere on the screen takes a card.
        expect(screen.queryByTestId('checkout-payment-methods')).toBeNull();
        expect(screen.queryByTestId('checkout-card-number')).toBeNull();
    });

    it('shows the chosen saved address in the delivery grid, read from the address book', async () => {
        const address = testAddress({ line2: 'Flat 4', notes: 'Ring twice' });
        await renderCheckout(basketOf(1), { addresses: [address] });

        await fireEvent.press(await screen.findByTestId('checkout-address-picker-trigger'));
        await fireEvent.press(
            await screen.findByTestId(`checkout-address-picker-option-${address.id}`),
        );

        await waitFor(() => {
            expect(screen.getByTestId('checkout-street-input').props.value).toBe(
                '12 Sunset Street, Flat 4',
            );
        });
        expect(screen.getByTestId('checkout-area-input').props.value).toBe('Business Bay');
        expect(screen.getByTestId('checkout-note-input').props.value).toBe('Ring twice');
        // Edited in the address book, not here.
        expect(screen.getByTestId('checkout-street-input').props.editable).toBe(false);
    });

    it('chooses the default address by itself and prices delivery straight away (HA-22)', async () => {
        await renderCheckout(basketOf(1), { addresses: [HOME_ADDRESS] });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-street-input').props.value).not.toBe('');
        });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-price-delivery')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-price-subtotal')).toBeTruthy();
    });

    it('refuses to review until an address has been chosen', async () => {
        // Two addresses and neither is the default: there is nothing to choose for them.
        await renderCheckout(basketOf(1), {
            addresses: [
                testAddress({ id: 'address-office', isDefault: false }),
                { ...HOME_ADDRESS, isDefault: false },
            ],
        });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-review')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-picker-error')).toBeTruthy();
        });
        // Still collecting: no place-order control has appeared.
        expect(screen.queryByTestId('checkout-place-order')).toBeNull();
    });

    it('answers "place order" with a confirmation, and the basket is the order now', async () => {
        const basket = basketOf(1);
        const harness = await renderCheckout(basket, {
            addresses: [HOME_ADDRESS],
            commerce: {
                placeOrder: async (request: PlaceOrderRequest): Promise<PlacedOrder> => {
                    const placed = placedOrderFrom(basket.cart, request);
                    // The server turns the basket into the order; nothing is left behind.
                    basket.cart = cartOf([]);
                    return placed;
                },
            },
        });

        await reviewCheckout(HOME_ADDRESS.id);

        expect(screen.getByTestId('checkout-committed-address')).toHaveTextContent(
            /12 Sunset Street/,
        );
        expect(screen.getByTestId('checkout-committed-slot')).toBeTruthy();
        // The payment step is the design's radio list with the one method there is, chosen.
        expect(screen.getByTestId('checkout-payment-methods').props.accessibilityRole).toBe(
            'radiogroup',
        );
        expect(screen.getByTestId('checkout-payment-cod').props.accessibilityState).toMatchObject({
            checked: true,
        });
        expect(screen.queryByTestId('checkout-card-number')).toBeNull();
        // The receipt printer waits beside Place order.
        expect(screen.getByTestId('checkout-printer-status')).toHaveTextContent('Ready to print');

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });

        // The confirmation is a URL of its own, put in place of the payment step: a refresh shows
        // it again, and Back from it is not a second chance to place the same order.
        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalledWith(
                `/customer/checkout?placed=${String(ORDER_ID)}`,
            );
        });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-success-screen')).toBeTruthy();
        });
        expect(await screen.findByTestId('checkout-success-title')).toHaveTextContent(
            'Order H360-4821 confirmed',
        );
        // Cash on delivery, said out loud rather than implied by the absence of a receipt.
        expect(screen.getByTestId('checkout-success-body')).toHaveTextContent(/in cash/);
        expect(screen.getByTestId('checkout-success-body')).toHaveTextContent(/Verdant Kitchen/);

        // The confirmation prices itself from the placed order — the preview query dies with the
        // emptied basket, and a price block fed from there rendered nothing.
        // It is printed as the receipt, by the printer that stood beside Place order.
        expect(screen.getByTestId('checkout-printer-status')).toHaveTextContent(
            'Printing your receipt',
        );
        expect(
            screen.getByTestId('checkout-receipt-total-amount', { includeHiddenElements: true }),
        ).toHaveTextContent('AED 60.00');
        expect(
            screen.getByTestId('checkout-receipt-items', { includeHiddenElements: true }),
        ).toHaveTextContent(new RegExp(BASKET_MEAL.name));

        // The placement carried the saved address identifier and no instrument of any kind.
        expect(harness.repositories.commerce.placeOrder).toHaveBeenCalledWith({
            cartId: CART_ID,
            addressId: HOME_ADDRESS.id,
            slotCode: DEFAULT_SLOT_CODE,
            deliveryDate: earliestStartDate(),
        });

        // The basket became the order. Leaving the lines behind would let one screen place the
        // same basket twice.
        expect(basket.cart.items).toHaveLength(0);

        // Tracking opens the signed-in order page by the order's identifier, never its reference.
        // (Last: the mock follows the push, and this screen is not the order page.)
        await fireEvent.press(screen.getByTestId('checkout-success-track'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/customer/orders/${String(ORDER_ID)}`);
    });

    /**
     * The window is one choice among the kitchen's own, so it is a radio group — the chosen chip is
     * *checked*, not merely pressed — and the choice is what the review repeats and what is sent.
     */
    it('takes one delivery window from the chips, reviews it, and sends exactly that', async () => {
        const basket = basketOf(1);
        const harness = await renderCheckout(basket, {
            addresses: [HOME_ADDRESS],
            commerce: {
                placeOrder: async (request: PlaceOrderRequest): Promise<PlacedOrder> => {
                    const placed = placedOrderFrom(basket.cart, request);
                    basket.cart = cartOf([]);
                    return placed;
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-slot-picker')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-slot-picker').props.accessibilityRole).toBe(
            'radiogroup',
        );
        expect(
            screen.getByTestId(`checkout-slot-${DEFAULT_SLOT_CODE}`).props.accessibilityState,
        ).toMatchObject({ checked: true });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-slot-evening'));
        });
        expect(screen.getByTestId('checkout-slot-evening').props.accessibilityState).toMatchObject({
            checked: true,
        });
        expect(
            screen.getByTestId(`checkout-slot-${DEFAULT_SLOT_CODE}`).props.accessibilityState,
        ).toMatchObject({ checked: false });

        // The first segment of the bar is the current one until the details are committed.
        expect(screen.getByTestId('checkout-stepper-delivery').props['aria-current']).toBe('step');

        await reviewCheckout(HOME_ADDRESS.id);

        expect(screen.getByTestId('checkout-stepper-payment').props['aria-current']).toBe('step');
        expect(screen.getByTestId('checkout-committed-slot')).toHaveTextContent(/Evening/);
        // The button states what it commits to: the priced total, not a bare "Place order".
        await waitFor(() => {
            expect(screen.getByTestId('checkout-place-order')).toHaveTextContent(/AED/);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-success-screen')).toBeTruthy();
        });
        expect(harness.repositories.commerce.placeOrder).toHaveBeenCalledWith(
            expect.objectContaining({ slotCode: 'evening' }),
        );
    });

    /**
     * A refusal names every reason, and the checkout lists them. Asserted because the alternative —
     * one sentence saying the order could not be placed — sends somebody back to a basket with
     * nothing to change.
     */
    it('lists every reason a placement was refused', async () => {
        const basket = basketOf(1);
        await renderCheckout(basket, {
            addresses: [HOME_ADDRESS],
            commerce: {
                placeOrder: () =>
                    Promise.reject(
                        new ApiError(
                            orderPlacementRefusedFailure([
                                { reason: 'zone_suspended', context: {} },
                                { reason: 'cut_off_passed', context: {} },
                            ]),
                        ),
                    ),
            },
        });

        await reviewCheckout(HOME_ADDRESS.id);
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-place-error')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-place-error-reason-zone_suspended')).toBeTruthy();
        expect(screen.getByTestId('checkout-place-error-reason-cut_off_passed')).toBeTruthy();
        // Refused means refused: no confirmation was drawn, and the basket is still somebody's.
        expect(screen.queryByTestId('checkout-success-screen')).toBeNull();
        expect(basket.cart.items).toHaveLength(1);
    });

    /**
     * A refusal about the *account* is not fixable from the checkout, so it carries the way out.
     * Without it the sentence "complete the outstanding steps" names a screen nobody is standing
     * on and does not say where it is.
     */
    it('points an account-shaped refusal at the account checklist', async () => {
        await renderCheckout(basketOf(1), {
            addresses: [HOME_ADDRESS],
            commerce: {
                placeOrder: () =>
                    Promise.reject(
                        new ApiError(
                            orderPlacementRefusedFailure([
                                { reason: 'account_not_ready', context: {} },
                            ]),
                        ),
                    ),
            },
        });

        await reviewCheckout(HOME_ADDRESS.id);
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('checkout-place-error-reason-account_not_ready'),
            ).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-finish-setup'));
        });
        // The account page, carrying this payment step to come back to.
        expect(routerMock.__push).toHaveBeenCalledWith(
            withReturnTo('/customer/account', paymentStepHref()),
        );
    });

    /**
     * The server names every requirement the account is missing. Each becomes a row saying what it
     * needs and opening the screen that does it — not one link to the top of the account page.
     */
    it('lists each missing setup step with a way straight to it', async () => {
        await renderCheckout(basketOf(1), {
            addresses: [HOME_ADDRESS],
            commerce: {
                placeOrder: () =>
                    Promise.reject(
                        new ApiError(
                            orderPlacementRefusedFailure([
                                {
                                    reason: 'account_not_ready',
                                    context: {
                                        outstanding: 'account.no_served_address',
                                        has_address: true,
                                    },
                                },
                                {
                                    reason: 'account_not_ready',
                                    context: { outstanding: 'account.dietary_declaration_missing' },
                                },
                            ]),
                        ),
                    ),
            },
        });

        await reviewCheckout(HOME_ADDRESS.id);
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-setup-required')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-setup-required')).toHaveTextContent(/2 steps are left/);
        // An address exists but is out of area, so the row says that, not "add an address".
        expect(screen.getByTestId('checkout-setup-step-add_address-body')).toHaveTextContent(
            /outside the areas we deliver to/,
        );
        expect(screen.getByTestId('checkout-setup-step-dietary_profile')).toBeTruthy();
        // Nothing about the order itself was refused, so there is no second, generic error.
        expect(screen.queryByTestId('checkout-place-error')).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-setup-step-dietary_profile-open'));
        });
        // Straight to the step's own screen, carrying the payment step it came from.
        expect(routerMock.__push).toHaveBeenCalledWith(
            withReturnTo('/customer/account/allergies', paymentStepHref()),
        );
        expect(routerMock.__push).not.toHaveBeenCalledWith('/customer/account/allergies');
    });
});

/*
 * The checkout's choices live in its URL (`checkout-draft.ts`): a detour to add an address unmounts
 * the screen — every customer page is a sibling in one `<Slot/>` — and a refresh starts it from
 * nothing, so whatever was not in the query was lost. These cases hold the screen to that: it opens
 * from a URL, writes each choice back into it, walks Delivery → Payment as two entries, and sends
 * every detour off carrying the page as it stands.
 */
describe('CheckoutScreen — its choices live in the URL', () => {
    beforeEach(() => {
        clearAllSessionDrafts();
    });

    const OFFICE = testAddress({
        id: 'address-office',
        label: 'Office',
        line1: '1 Tower Road',
        isDefault: false,
    });
    const LATER = (): string => addDays(earliestStartDate(), 3) ?? earliestStartDate();

    it('opens on the payment step a URL names, and places exactly those choices', async () => {
        const basket = basketOf(1);
        const harness = await renderCheckout(basket, {
            addresses: [HOME_ADDRESS, OFFICE],
            params: { address: OFFICE.id, date: LATER(), slot: 'evening', step: 'payment' },
            commerce: {
                placeOrder: async (request: PlaceOrderRequest): Promise<PlacedOrder> =>
                    placedOrderFrom(basket.cart, request),
            },
        });

        expect(await screen.findByTestId('checkout-payment-step')).toBeTruthy();
        expect(screen.getByTestId('checkout-committed-address')).toHaveTextContent(/1 Tower Road/);
        expect(screen.getByTestId('checkout-committed-slot')).toHaveTextContent(/Evening/);
        expect(screen.getByTestId('checkout-stepper-payment').props['aria-current']).toBe('step');

        await waitFor(() => {
            expect(
                screen.getByTestId('checkout-place-order').props.accessibilityState,
            ).toMatchObject({ disabled: false });
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });
        // Not the default address, not the earliest day, not the house window: the URL's.
        await waitFor(() => {
            expect(harness.repositories.commerce.placeOrder).toHaveBeenCalledWith({
                cartId: CART_ID,
                addressId: OFFICE.id,
                slotCode: 'evening',
                deliveryDate: LATER(),
            });
        });
        // Nothing the URL said was thrown away on the way.
        expect(routerMock.__router.setParams).not.toHaveBeenCalled();
    });

    it.each([
        ['an address no longer in the book', { address: 'address-gone' }],
        ['a window the kitchen does not offer', { slot: 'late_night' }],
        ['a day that has already gone', { date: '2020-01-01' }],
    ] as const)(
        'puts a payment step back on delivery rather than paying for %s',
        async (_label, broken) => {
            await renderCheckout(basketOf(1), {
                addresses: [HOME_ADDRESS],
                params: {
                    address: HOME_ADDRESS.id,
                    date: LATER(),
                    slot: DEFAULT_SLOT_CODE,
                    step: 'payment',
                    ...broken,
                },
            });

            // Once the data has settled, the step is taken off this entry — and the screen never
            // offered to place an order with a substitute it had quietly picked.
            await waitFor(() => {
                expect(routerMock.__router.setParams).toHaveBeenCalledWith({ step: undefined });
            });
            expect(await screen.findByTestId('checkout-delivery-step')).toBeTruthy();
            expect(screen.queryByTestId('checkout-place-order')).toBeNull();
        },
    );

    it('fills the delivery step with its own choices where the URL’s are unusable', async () => {
        await renderCheckout(basketOf(1), {
            addresses: [HOME_ADDRESS],
            params: { address: 'address-gone', date: 'next tuesday', slot: 'late_night' },
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-street-input').props.value).toBe(
                '12 Sunset Street',
            );
        });
        expect(
            screen.getByTestId(`checkout-slot-${DEFAULT_SLOT_CODE}`).props.accessibilityState,
        ).toMatchObject({ checked: true });
        // On the delivery step there is nothing to take back, so the URL is left alone until the
        // person chooses something.
        expect(routerMock.__router.setParams).not.toHaveBeenCalled();
    });

    it('writes each choice into its URL, and makes the payment step an entry of its own', async () => {
        await renderCheckout(basketOf(1), {
            // Neither is the default, so nothing is chosen until the person chooses.
            addresses: [{ ...HOME_ADDRESS, isDefault: false }, OFFICE],
        });
        await act(async () => {
            await kitchenServed;
        });

        await fireEvent.press(await screen.findByTestId('checkout-address-picker-trigger'));
        await fireEvent.press(
            await screen.findByTestId(`checkout-address-picker-option-${OFFICE.id}`),
        );
        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ address: OFFICE.id });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-street-input').props.value).toBe('1 Tower Road');
        });

        await fireEvent.press(await screen.findByTestId('checkout-slot-evening'));
        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ slot: 'evening' });

        // The date: the same day next year, by its year select.
        const earliest = earliestStartDate();
        const nextYear = String(Number(earliest.slice(0, 4)) + 1);
        await fireEvent.press(screen.getByTestId('checkout-date-field-year-trigger'));
        await fireEvent.press(
            await screen.findByTestId(`checkout-date-field-year-option-${nextYear}`),
        );
        const chosenDate = earliest.endsWith('-02-29')
            ? undefined
            : `${nextYear}${earliest.slice(4)}`;
        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ date: chosenDate });

        // A choice is a replace of this entry, never a push: Back does not walk through windows.
        expect(routerMock.__push).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });
        expect(routerMock.__push).toHaveBeenCalledWith(
            checkoutAt({
                address: OFFICE.id,
                date: chosenDate ?? earliest,
                slot: 'evening',
                step: 'payment',
            }),
        );
        expect(await screen.findByTestId('checkout-payment-step')).toBeTruthy();
        expect(screen.getByTestId('checkout-committed-slot')).toHaveTextContent(/Evening/);
    });

    it('goes Back to the delivery entry when it is the one underneath', async () => {
        const delivery = { address: HOME_ADDRESS.id, date: LATER(), slot: DEFAULT_SLOT_CODE };
        routerMock.__set({
            navState: {
                index: 2,
                routes: [
                    { name: 'cart' },
                    { name: 'checkout', params: delivery },
                    { name: 'checkout', params: { ...delivery, step: 'payment' } },
                ],
            },
        });
        await renderCheckout(basketOf(1), {
            addresses: [HOME_ADDRESS],
            params: { ...delivery, step: 'payment' },
        });

        await fireEvent.press(await screen.findByTestId('checkout-edit'));

        expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
        expect(routerMock.__router.setParams).not.toHaveBeenCalled();
    });

    it.each([
        ['after a refresh', undefined],
        [
            'when the page underneath is the basket',
            { index: 1, routes: [{ name: 'cart' }, { name: 'checkout' }] },
        ],
    ] as const)(
        'takes the step off this entry %s, never leaving the checkout',
        async (_label, navState) => {
            routerMock.__set({ navState });
            await renderCheckout(basketOf(1), {
                addresses: [HOME_ADDRESS],
                params: {
                    address: HOME_ADDRESS.id,
                    date: LATER(),
                    slot: DEFAULT_SLOT_CODE,
                    step: 'payment',
                },
            });

            await fireEvent.press(await screen.findByTestId('checkout-edit'));

            expect(routerMock.__router.setParams).toHaveBeenCalledWith({ step: undefined });
            expect(routerMock.__router.back).not.toHaveBeenCalled();
            expect(await screen.findByTestId('checkout-delivery-step')).toBeTruthy();
        },
    );

    it('lists the setup steps up front, sends each off with a way back, and holds Place order', async () => {
        await renderCheckout(basketOf(1), {
            addresses: [HOME_ADDRESS],
            checklist: {
                lifecycle: 'provisional',
                canActivate: false,
                items: [
                    { step: 'verify_email', complete: true, required: true, blockedReason: null },
                    // Optional here: not something to stop an order for.
                    { step: 'verify_phone', complete: false, required: false, blockedReason: null },
                    {
                        step: 'dietary_profile',
                        complete: false,
                        required: true,
                        blockedReason: null,
                    },
                    { step: 'consents', complete: false, required: true, blockedReason: null },
                ],
            },
        });

        // On the delivery step, before anything is committed — not after a refused order.
        const panel = await screen.findByTestId('checkout-setup-required');
        expect(screen.getByTestId('checkout-delivery-step')).toBeTruthy();
        expect(panel.props.role).toBe('status');
        expect(panel).toHaveTextContent(/2 steps are left before you can order/);
        expect(screen.getByTestId('checkout-setup-step-dietary_profile')).toBeTruthy();
        expect(screen.getByTestId('checkout-setup-step-consents')).toBeTruthy();
        expect(screen.queryByTestId('checkout-setup-step-verify_phone')).toBeNull();
        expect(screen.queryByTestId('checkout-setup-step-verify_email')).toBeNull();

        // Each step carries the checkout as it stands, so finishing it comes straight back here.
        await act(async () => {
            await kitchenServed;
        });
        await fireEvent.press(screen.getByTestId('checkout-setup-step-dietary_profile-open'));
        const here = checkoutAt({
            address: HOME_ADDRESS.id,
            date: earliestStartDate(),
            slot: DEFAULT_SLOT_CODE,
        });
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo('/customer/account/allergies', here),
        );

        // The delivery details can still be committed; the order cannot be placed.
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });
        expect(await screen.findByTestId('checkout-payment-step')).toBeTruthy();
        expect(screen.getByTestId('checkout-setup-required')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('checkout-place-order')).toHaveTextContent(/AED/);
        });
        const place = screen.getByTestId('checkout-place-order');
        expect(place.props.accessibilityState).toMatchObject({ disabled: true });
        expect(place.props.accessibilityHint).toBe('Finish the steps above to place your order.');
    });

    it('opens the address form for another address, or for the one chosen, with a way back', async () => {
        await renderCheckout(basketOf(1), { addresses: [HOME_ADDRESS] });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-street-input').props.value).not.toBe('');
        });
        await act(async () => {
            await kitchenServed;
        });
        const here = checkoutAt({
            address: HOME_ADDRESS.id,
            date: earliestStartDate(),
            slot: DEFAULT_SLOT_CODE,
        });

        await fireEvent.press(screen.getByTestId('checkout-edit-address'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo(`/customer/account/addresses/${HOME_ADDRESS.id}`, here),
        );

        await fireEvent.press(screen.getByTestId('checkout-manage-addresses'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo('/customer/account/addresses/new', here),
        );
        // The return the form receives is this checkout, exactly, once its query is read back.
        const opened = routerMock.__push.mock.calls.at(-1)?.[0] as string;
        expect(decodeURIComponent(queryOf(opened)['returnTo'] ?? '')).toBe(here);
    });

    it('shows the confirmation from its URL alone, as after a refresh', async () => {
        await renderCheckout(basketOf(0), { params: { placed: String(ORDER_ID) } });

        expect(await screen.findByTestId('checkout-success-title')).toHaveTextContent(
            'Order H360-4821 confirmed',
        );
        // The kitchen's name was a note in the tab that placed it; without it, the words still read.
        expect(screen.getByTestId('checkout-success-body')).toHaveTextContent(/The kitchen/);
        expect(screen.getByTestId('checkout-stepper-placed').props['aria-current']).toBe('step');
        // Not the empty basket the placement left behind.
        expect(screen.queryByTestId('checkout-empty')).toBeNull();
    });

    it('says so when the confirmation’s order cannot be found', async () => {
        await renderCheckout(basketOf(0), { params: { placed: uuid(9, 99) } });
        expect(await screen.findByText('We could not find that order')).toBeTruthy();
    });

    it('offers the order just placed when Back lands on the emptied checkout', async () => {
        placedOrders.write(LATEST_PLACED, {
            orderId: String(ORDER_ID),
            kitchenName: KITCHEN.name,
            slotLabel: 'Midday',
        });
        await renderCheckout(basketOf(0));

        await fireEvent.press(await screen.findByTestId('checkout-track-latest'));
        expect(routerMock.__push).toHaveBeenCalledWith(`/customer/orders/${String(ORDER_ID)}`);
    });
});

describe('CheckoutScreen — the slots the address zone offers', () => {
    /** A preview whose zone offers `codes` once an address is chosen, and nothing filtered before. */
    function zonePreview(basket: Basket, codes: readonly string[]) {
        return {
            previewCheckout: async (request: PreviewCheckoutRequest): Promise<CheckoutPreview> => ({
                ...checkoutPreview(basket.cart, request),
                offeredWindowCodes: request.addressId === undefined ? null : codes,
            }),
        };
    }

    async function chooseAddress(addressId: string): Promise<void> {
        await act(async () => {
            await kitchenServed;
        });
        await fireEvent.press(await screen.findByTestId('checkout-address-picker-trigger'));
        await fireEvent.press(
            await screen.findByTestId(`checkout-address-picker-option-${addressId}`),
        );
    }

    it('offers only the zone’s slots, moves off one it does not offer, and sends that', async () => {
        const basket = basketOf(1);
        const harness = await renderCheckout(basket, {
            addresses: [HOME_ADDRESS],
            commerce: {
                ...zonePreview(basket, ['evening']),
                placeOrder: async (request: PlaceOrderRequest): Promise<PlacedOrder> =>
                    placedOrderFrom(basket.cart, request),
            },
        });

        // No address yet: nothing to filter by, so the default is offered.
        await waitFor(() => {
            expect(screen.getByTestId(`checkout-slot-${DEFAULT_SLOT_CODE}`)).toBeTruthy();
        });

        await chooseAddress(HOME_ADDRESS.id);
        await waitFor(() => {
            expect(screen.queryByTestId(`checkout-slot-${DEFAULT_SLOT_CODE}`)).toBeNull();
        });
        expect(screen.getByTestId('checkout-slot-evening').props.accessibilityState).toMatchObject({
            checked: true,
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });
        await waitFor(() => {
            expect(
                screen.getByTestId('checkout-place-order').props.accessibilityState,
            ).toMatchObject({ disabled: false });
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });
        await waitFor(() => {
            expect(harness.repositories.commerce.placeOrder).toHaveBeenCalledWith(
                expect.objectContaining({ slotCode: 'evening' }),
            );
        });
    });

    it('says so, and will not review, when the zone offers no slot', async () => {
        const basket = basketOf(1);
        await renderCheckout(basket, {
            addresses: [HOME_ADDRESS],
            commerce: zonePreview(basket, []),
        });

        await chooseAddress(HOME_ADDRESS.id);
        await waitFor(() => {
            expect(screen.getByTestId('checkout-slot-none')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-slot-none')).toHaveTextContent(
            /offers no delivery slot/,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });
        expect(screen.queryByTestId('checkout-place-order')).toBeNull();
    });

    it('names a window_not_offered refusal in words', async () => {
        await renderCheckout(basketOf(1), {
            addresses: [HOME_ADDRESS],
            commerce: {
                placeOrder: () =>
                    Promise.reject(
                        new ApiError(
                            orderPlacementRefusedFailure([
                                {
                                    reason: 'window_not_offered',
                                    context: { delivery_window_code: 'evening' },
                                },
                            ]),
                        ),
                    ),
            },
        });

        await reviewCheckout(HOME_ADDRESS.id);
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('checkout-place-error-reason-window_not_offered'),
            ).toHaveTextContent(/does not offer that delivery slot/);
        });
    });

    it('has written copy for the window_not_offered preview warning', () => {
        expect(isKnownWarning(CHECKOUT_WINDOW_NOT_OFFERED)).toBe(true);
        expect(warningMessageKey(CHECKOUT_WINDOW_NOT_OFFERED)).toBe(
            'commerce:warnings.checkout_window_not_offered',
        );
    });
});

describe('CheckoutScreen — a basket that crosses the person’s allergies', () => {
    it('warns, asks once more at Place order, and then places it — it is never blocked', async () => {
        const basket = basketOf(1);
        const clashing = basket.cart.items[0];
        if (clashing === undefined) throw new Error('The basket needs a line.');

        const harness = await renderCheckout(basket, {
            addresses: [HOME_ADDRESS],
            commerce: {
                previewCheckout: async (
                    request: PreviewCheckoutRequest,
                ): Promise<CheckoutPreview> => ({
                    ...checkoutPreview(basket.cart, request),
                    warnings: ['checkout.allergen_conflict'],
                    allergenConflicts: [
                        { mealId: clashing.mealId, reason: 'unassessed', allergenCodes: [] },
                    ],
                }),
                placeOrder: async (request: PlaceOrderRequest): Promise<PlacedOrder> =>
                    placedOrderFrom(basket.cart, request),
            },
        });

        await act(async () => {
            await kitchenServed;
        });
        await fireEvent.press(await screen.findByTestId('checkout-address-picker-trigger'));
        await fireEvent.press(
            await screen.findByTestId(`checkout-address-picker-option-${HOME_ADDRESS.id}`),
        );
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });

        expect(await screen.findByTestId('checkout-allergen-conflict')).toBeTruthy();
        await waitFor(() => {
            expect(
                screen.getByTestId('checkout-place-order').props.accessibilityState,
            ).toMatchObject({ disabled: false });
        });

        // The first press asks rather than places.
        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });
        expect(await screen.findByText('Order meals with your allergens?')).toBeTruthy();
        expect(harness.repositories.commerce.placeOrder).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-allergen-confirm-place'));
        });
        await waitFor(() => {
            expect(harness.repositories.commerce.placeOrder).toHaveBeenCalledWith(
                expect.objectContaining({ acknowledgeAllergenConflicts: true }),
            );
        });
    });
});

/* ══ screens: the configurator ═════════════════════════════════════════════════════════════════ */

interface ConfiguratorOptions {
    readonly plan?: (() => Promise<SubscriptionPlan>) | undefined;
    /** The kitchen's menu. Defaults to the authored one; a case may hold it back. */
    readonly listMeals?: MarketplaceRepository['listMeals'] | undefined;
    readonly quote?: SubscriptionQuote | undefined;
    readonly addresses?: readonly CustomerAddress[] | undefined;
    /** The person's dietary profile — the one allergy list the kitchen reads. Empty by default. */
    readonly profile?: DietaryProfile | undefined;
    readonly commerce?: Partial<CommerceRepository> | undefined;
    readonly latencyMs?: number | undefined;
    /** The account's setup checklist. Defaults to one with nothing left to do. */
    readonly checklist?: AccountSetupChecklist | undefined;
    /** The set-up's URL query beyond `plan` and `variant` — its step and address live there. */
    readonly params?: Readonly<Record<string, string>> | undefined;
}

function configuratorRepositories(options: ConfiguratorOptions = {}): RepositoryOverrides {
    return {
        marketplace: {
            getPlan: options.plan ?? (async () => PLAN),
            getKitchen: async () => KITCHEN,
            listMeals: options.listMeals ?? (async () => page(MENU_MEALS)),
        },
        account: {
            listAddresses: async () => options.addresses ?? [],
            getChecklist: async () => options.checklist ?? READY_CHECKLIST,
            getDietaryProfile: async () => options.profile ?? dietaryProfile(),
        },
        commerce: {
            getSubscriptionQuote: async () => options.quote ?? testQuote(),
            previewSubscription: async (configuration: SubscriptionConfiguration) =>
                subscriptionPreview(configuration),
            ...options.commerce,
        },
    };
}

/**
 * The set-up keeps its step, band and address in its URL, so — like the checkout's — its cases run
 * with the router mock *following* navigation: Continue is a push of `?step=`, choosing an address
 * a `setParams`, and the screen reads each back. The spies still record every call.
 */
function renderConfigurator(
    props: { readonly planId: string | undefined; readonly variantId?: string | undefined },
    options: ConfiguratorOptions = {},
) {
    routerMock.__set({
        pathname: CONFIGURATOR_PATH,
        params: {
            ...(props.planId === undefined ? {} : { plan: props.planId }),
            ...(props.variantId === undefined ? {} : { variant: props.variantId }),
            ...options.params,
        },
        follow: true,
    });
    return renderStubScreen(
        <SubscriptionConfiguratorScreen
            planId={props.planId}
            {...(props.variantId === undefined ? {} : { variantId: props.variantId })}
        />,
        {
            session: testMeResponse(),
            ...(options.latencyMs === undefined ? {} : { latencyMs: options.latencyMs }),
            repositories: configuratorRepositories(options),
        },
    );
}

async function pressNext(times: number): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        // Next is busy until the step rules' data has arrived; a press before that is ignored.
        await waitFor(
            () => {
                expect(screen.getByTestId('configurator-next')).not.toBeDisabled();
            },
            { timeout: 15_000 },
        );
        // Awaited: `fireEvent` is asynchronous in RNTL 14, and a press left floating inside an
        // `act` was sometimes dropped once Continue became a navigation the screen re-renders on.
        await fireEvent.press(screen.getByTestId('configurator-next'));
    }
}

/** Every sitting any of the plan's bands fills, once each. */
const ALL_SITTINGS: readonly PlanSitting[] = PLAN_VARIANTS.flatMap(
    (variant) => variant.sittings,
).filter(
    (sitting, index, all) =>
        all.findIndex(
            (other) => other.slot === sitting.slot && other.sequence === sitting.sequence,
        ) === index,
);

/** How far ahead {@link pickMealsAhead} chooses: past any start the set-up can open on. */
const PICKED_AHEAD_DAYS = 42;

/**
 * A dish already chosen for every sitting of every band on every day of the next six weeks — the
 * session draft a person leaves behind once they have been through the meals step. Written before
 * the screen mounts, which is when it reads its draft. Picks for days the run does not deliver on
 * are carried and never sent, so whatever start the set-up opens on, its whole run is filled.
 */
function pickMealsAhead(
    meal: MarketplaceMeal = MENU_MEALS[0]!,
    edits: ConfiguratorEdits = {},
): void {
    const today = todayIso();
    const mealPicks: Record<string, MealId> = {};
    for (let offset = 0; offset < PICKED_AHEAD_DAYS; offset += 1) {
        const date = addDays(today, offset)!;
        for (const sitting of ALL_SITTINGS) mealPicks[pickKey(date, sitting)] = meal.id;
    }
    configuratorDrafts.write(configuratorDraftKey(String(PLAN.id)), { ...edits, mealPicks });
}

/** The request `createSubscription` was called with, the first time. */
function createRequest(harness: {
    readonly repositories: { readonly commerce: CommerceRepository };
}): {
    readonly configuration: SubscriptionConfiguration;
    readonly acknowledgedTerms: boolean;
    readonly addressId?: string;
} {
    return (harness.repositories.commerce.createSubscription as unknown as jest.Mock).mock
        .calls[0]?.[0] as {
        configuration: SubscriptionConfiguration;
        acknowledgedTerms: boolean;
        addressId?: string;
    };
}

/** Opens one sitting's select and chooses `meal` from it. */
async function pickMeal(selectTestID: string, meal: MarketplaceMeal): Promise<void> {
    await fireEvent.press(screen.getByTestId(`${selectTestID}-trigger`));
    await fireEvent.press(await screen.findByTestId(`${selectTestID}-option-${String(meal.id)}`));
    await waitFor(() => {
        expect(screen.getByTestId(`${selectTestID}-value`)).toHaveTextContent(meal.name);
    });
}

/** The delivery dates the meals step draws a row for, in order. */
function mealRowDates(): string[] {
    return screen
        .getAllByTestId(/^configurator-meal-\d{4}-\d{2}-\d{2}$/)
        .map((row) => (row.props.testID as string).slice('configurator-meal-'.length));
}

/**
 * Plan → delivery → meals → review, for a person with one saved address in a served area — which
 * the delivery step chooses on its own, as the checkout does (HA-22). The meals step is passed on
 * the strength of picks already in the draft ({@link pickMealsAhead}), so the case must write them
 * before it renders.
 */
async function walkToReviewStep(): Promise<void> {
    await waitFor(() => {
        expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
    });

    await pressNext(1);
    await waitFor(() => {
        expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
    });

    await waitFor(() => {
        expect(screen.getByTestId('configurator-area-served')).toBeTruthy();
    });
    await pressNext(1);

    await waitFor(() => {
        expect(screen.getByTestId('configurator-step-meals')).toBeTruthy();
    });
    await pressNext(1);

    // The server's price, on the review step. A generous wait: the priced preview is three hops
    // away (plan, weekday probe, preview), and under the full suite's load 5 s was not always enough.
    await waitFor(
        () => {
            expect(screen.getByTestId('configurator-price-total-amount')).toBeTruthy();
        },
        { timeout: 15_000 },
    );
    expect(screen.getByTestId('configurator-price-per-delivery-amount')).toBeTruthy();
    expect(screen.getByTestId('configurator-step-review')).toBeTruthy();
}

describe('SubscriptionConfiguratorScreen', () => {
    // The set-up's choices are a session draft; no case may inherit one from the case before it.
    beforeEach(() => {
        clearAllSessionDrafts();
        // Subscribe is answered by the receipt printer, which Jest has no frames to feed: under
        // reduced motion the receipt is out at once and "View plan" is offered straight away.
        jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * The receipt has printed and the subscription has not opened yet: it opens when the customer
     * presses "View plan", not mid-print.
     */
    async function viewPlan(): Promise<void> {
        const button = await screen.findByTestId('configurator-view-plan', {}, { timeout: 5000 });
        expect(routerMock.__replace).not.toHaveBeenCalledWith(expect.stringContaining('created=1'));
        await act(async () => {
            fireEvent.press(button);
        });
    }

    it('answers a malformed plan identifier with the not-found state', async () => {
        await renderConfigurator({ planId: 'not-a-uuid' });
        expect(screen.getByTestId('configurator-empty')).toBeTruthy();
    });

    it('reports a failure rather than an empty page for an unknown plan', async () => {
        await renderConfigurator(
            { planId: UNKNOWN_PLAN_ID },
            {
                latencyMs: 40,
                plan: () => Promise.reject(new ApiError(apiFailure('resource.not_found'))),
            },
        );
        expect(screen.getByTestId('configurator-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('configurator-error')).toBeTruthy();
        });
    });

    it('opens on the band, the meals and the length, with the progress beside them', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-variant')).toBeTruthy();
        expect(screen.getByTestId('configurator-combination')).toBeTruthy();
        expect(screen.getByTestId('configurator-duration')).toBeTruthy();
        expect(screen.getByTestId('configurator-stepper')).toBeTruthy();
    });

    it('prices the plan from the first step, without asking the server yet', async () => {
        const harness = await renderConfigurator({ planId: String(PLAN.id) });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-summary-total')).toBeTruthy();
        });
        // An estimate from the variant and the length; the server prices on the review step.
        expect(harness.repositories.commerce.previewSubscription).not.toHaveBeenCalled();
    });

    it('opens on the variant the plan page was showing when one is supplied', async () => {
        const light = PLAN.variants[0]!;

        await renderConfigurator({ planId: String(PLAN.id), variantId: String(light.id) });

        await waitFor(() => {
            expect(screen.getByTestId(`configurator-variant-${String(light.id)}`)).toBeTruthy();
        });
        const chosen = screen.getByTestId(`configurator-variant-${String(light.id)}`);
        // The chosen card is the supplied variant's, not the plan's own default one, and it
        // carries its own kcal range.
        expect(chosen.props.accessibilityState?.checked).toBe(true);
        expect(chosen).toHaveTextContent(/1,400 to 1,600/);
    });

    it('states a choice with one option as its answer, not as a lone chip', async () => {
        const single = { ...PLAN, durations: PLAN.durations.slice(0, 1) };
        await renderConfigurator({ planId: String(PLAN.id) }, { plan: async () => single });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-duration-only')).toBeTruthy();
        });
        expect(
            screen.queryByTestId(`configurator-duration-${single.durations[0]!.duration}`),
        ).toBeNull();
        // The plan's six bands are still a choice.
        expect(screen.queryByTestId('configurator-variant-only')).toBeNull();
    });

    it('attaches the discount to the length option itself (doc 17, SUB-05)', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-duration-28d')).toBeTruthy();
        });
        const fourWeeks = screen.getByTestId('configurator-duration-28d');
        // Named by what it buys — four weeks, twenty-eight deliveries — at the estimate for the
        // advertised band, with the discount it earns.
        expect(fourWeeks).toHaveTextContent(/4 weeks/);
        expect(fourWeeks).toHaveTextContent(/28 delivery days/);
        expect(fourWeeks).toHaveTextContent(/1,709\.96/);
        expect(fourWeeks).toHaveTextContent(/10% off/);
    });

    it('names a run that is not whole weeks in days, never rounded to a week', async () => {
        const fiveDays: PlanDurationOption = {
            duration: '5d',
            days: 5,
            discountPercent: 0,
            totalPrice: null,
        };
        await renderConfigurator(
            { planId: String(PLAN.id) },
            { plan: async () => ({ ...PLAN, durations: [fiveDays, ...PLAN.durations] }) },
        );

        const option = await screen.findByTestId('configurator-duration-5d');
        expect(option).toHaveTextContent(/5 days/);
        expect(option).not.toHaveTextContent(/week/);
    });

    it('says so when the plan has no length on sale, and holds the step', async () => {
        await renderConfigurator(
            { planId: String(PLAN.id) },
            { plan: async () => ({ ...PLAN, durations: [] }), addresses: [HOME_ADDRESS] },
        );

        expect(await screen.findByTestId('configurator-duration-none')).toHaveTextContent(
            'This plan has no length on sale yet.',
        );
        // Nothing to quote, so the screen does not wait on a quote: Continue answers at once, with
        // the reason, and the step holds rather than spinning on a request that is never made.
        const next = screen.getByTestId('configurator-next');
        expect(next).not.toBeDisabled();
        fireEvent.press(next);
        expect(
            await screen.findByText('Choose how long the subscription should run.'),
        ).toBeTruthy();
        expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        expect(screen.queryByTestId('configurator-step-delivery')).toBeNull();
    });

    /**
     * The allergy list is read, not collected (plans-16): the delivery step shows the profile's
     * own list, which of the dishes chosen so far cross it, and the way to the editor — which
     * comes back to this very step. Here the person has been through the meals step and chosen
     * the halloumi plate throughout.
     */
    it('shows the profile’s allergy list against the chosen dishes, with a way to change it', async () => {
        pickMealsAhead(MENU_MEALS[2]!);
        await renderConfigurator(
            { planId: String(PLAN.id) },
            { addresses: [HOME_ADDRESS], profile: dietaryProfile([MILK]) },
        );
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });
        // Nothing of the old "leave out" list survives on the plan step either.
        expect(screen.queryByTestId('configurator-diets')).toBeNull();

        await pressNext(1);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        });

        const notice = await screen.findByTestId('configurator-allergy-notice');
        await waitFor(() => {
            expect(
                within(notice).getByTestId('configurator-allergy-notice-list'),
            ).toHaveTextContent(/Your allergy list: Milk/);
        });
        // The run's one dish has milk in it; it is named, with what it carries.
        const clashes = await within(notice).findByTestId('configurator-allergy-notice-clashes');
        expect(clashes).toHaveTextContent(/1 dish in this plan contains something/);
        expect(clashes).toHaveTextContent(/Halloumi plate/);
        expect(clashes).toHaveTextContent(/Milk/);
        expect(screen.queryByTestId(`configurator-allergen-${MILK}`)).toBeNull();
        expect(screen.queryByTestId('configurator-checks-acknowledge')).toBeNull();

        // The editor is a detour that returns to the delivery step, address and all.
        await fireEvent.press(within(notice).getByTestId('configurator-allergy-notice-edit'));
        const middle = PLAN.variants[Math.floor(PLAN.variants.length / 2)]!;
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo(
                ALLERGY_LIST_HREF,
                configuratorHref({
                    plan: String(PLAN.id),
                    variant: String(middle.id),
                    step: 'delivery',
                    address: HOME_ADDRESS.id,
                }),
            ),
        );
    });

    it('does not read the list as safe before the plan’s dishes have arrived', async () => {
        await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                params: { step: 'delivery' },
                profile: dietaryProfile([MILK]),
                // The kitchen's menu never answers: nothing to check the list against yet.
                listMeals: () => new Promise(() => undefined),
            },
        );

        await screen.findByTestId('configurator-allergy-notice');
        // No dishes chosen yet is not "nothing crosses": the notice says there is nothing to check
        // yet, rather than giving a clean bill it cannot stand behind.
        await waitFor(() => {
            expect(screen.getByTestId('configurator-allergy-notice-unchecked')).toHaveTextContent(
                /No dishes to check yet/,
            );
        });
        expect(screen.queryByTestId('configurator-allergy-notice-none')).toBeNull();
        expect(screen.queryByTestId('configurator-allergy-notice-clashes')).toBeNull();
    });

    /**
     * The earliest start honours the plan's change cut-off (plans-17): a kitchen that locks each
     * delivery 48 hours ahead cannot start tomorrow, and the step says why.
     */
    it('starts no sooner than the plan’s cut-off, and says so beside the date', async () => {
        await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                params: { step: 'delivery' },
                quote: testQuote({ changeCutoffHours: 48 }),
            },
        );

        const note = await screen.findByTestId('configurator-start-date-cutoff');
        expect(note).toHaveTextContent(/locks each delivery 48 hours ahead/);
        // The floor the note names is the one the rules enforce: two days on, not tomorrow.
        const floor = earliestStartDate(new Date(), 48);
        expect(floor > earliestStartDate()).toBe(true);
    });

    /**
     * The server names the floor once it has the chosen days (plans-17): its date is the one the
     * purchase enforces, so it is the one offered — and asked for with those days.
     */
    it('takes the start-date floor from the server once it names one, asking with the chosen days', async () => {
        // Ten days out, so it is past any local rule and unmistakably the server's.
        const floor = addDays(todayIso(), 10)!;
        const harness = await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                params: { step: 'delivery' },
                commerce: {
                    getSubscriptionQuote: async (request: SubscriptionQuoteRequest) =>
                        testQuote({
                            changeCutoffHours: 48,
                            // Only the read made with the chosen days names the floor.
                            earliestStartDate:
                                request.deliveryWeekdays === undefined ? null : floor,
                        }),
                },
            },
        );

        await screen.findByTestId('configurator-start-date-cutoff');
        const [year, , day] = floor.split('-').map(Number);
        // The date field moves onto the server's floor once that read answers: its day and year
        // read back as chosen.
        await waitFor(() => {
            expect(screen.getByTestId('configurator-start-date-field-day-value')).toHaveTextContent(
                new RegExp(`^${String(day)}$`),
            );
        });
        expect(screen.getByTestId('configurator-start-date-field-year-value')).toHaveTextContent(
            new RegExp(`^${String(year)}$`),
        );
        // Asked with every delivery day the plan offers — the default choice — in order.
        expect(harness.repositories.commerce.getSubscriptionQuote).toHaveBeenCalledWith({
            planId: PLAN.id,
            variantId: PLAN.variants[Math.floor(PLAN.variants.length / 2)]!.id,
            duration: DEFAULT_DURATION,
            deliveryWeekdays: [1, 2, 3, 4, 5, 6, 7],
        });
    });

    it('moves an untouched start onto the chosen days, and repairs one the person chose', async () => {
        const tomorrow = earliestStartDate();
        const dayAfter = addDays(tomorrow, 1)!;
        const startWeekday = isoWeekday(tomorrow)!;
        await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                params: { step: 'delivery' },
                quote: testQuote({ changeCutoffHours: 0 }),
            },
        );
        await screen.findByTestId('configurator-start-date-field');
        expect(screen.queryByTestId('configurator-start-date-repair')).toBeNull();
        // Every delivery day is pre-selected once the plan's availability has arrived; pressing
        // before that would *select* the day into an empty set rather than drop it.
        await waitFor(() => {
            expect(
                screen.getByTestId(`configurator-weekday-${String(startWeekday)}`).props
                    .accessibilityState,
            ).toMatchObject({ selected: true });
        });

        // Drop the weekday the start falls on. The start was never chosen, so it follows the days
        // to the next one of them rather than asking to be repaired.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`configurator-weekday-${String(startWeekday)}`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-start-date-field-day-value')).toHaveTextContent(
                new RegExp(`^${String(Number(dayAfter.slice(8, 10)))}$`),
            );
        });
        expect(screen.queryByTestId('configurator-start-date-repair')).toBeNull();
    });

    it('repairs a chosen start that falls outside the chosen days onto the first that fits', async () => {
        const tomorrow = earliestStartDate();
        const dayAfter = addDays(tomorrow, 1)!;
        const startWeekday = isoWeekday(tomorrow)!;
        // A start the person chose — tomorrow — on days that no longer include it.
        configuratorDrafts.write(configuratorDraftKey(String(PLAN.id)), {
            startDate: tomorrow,
            deliveryWeekdays: [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== startWeekday),
        });
        await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                params: { step: 'delivery' },
                quote: testQuote({ changeCutoffHours: 0 }),
            },
        );

        // The repair names the first chosen day on or after the floor: the day after tomorrow.
        const repair = await screen.findByTestId('configurator-start-date-repair');
        expect(repair).toHaveTextContent(new RegExp(dayAfter.slice(0, 4)));
        await act(async () => {
            fireEvent.press(repair);
        });
        await waitFor(() => {
            expect(screen.queryByTestId('configurator-start-date-repair')).toBeNull();
        });
        expect(screen.getByTestId('configurator-start-date-field-day-value')).toHaveTextContent(
            new RegExp(`^${String(Number(dayAfter.slice(8, 10)))}$`),
        );
        expect(configuratorDrafts.read(configuratorDraftKey(String(PLAN.id)))?.startDate).toBe(
            dayAfter,
        );
    });

    it('draws no cut-off note for a plan that locks nothing ahead', async () => {
        await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                params: { step: 'delivery' },
                quote: testQuote({ changeCutoffHours: 0 }),
            },
        );

        await screen.findByTestId('configurator-start-date-field');
        expect(screen.queryByTestId('configurator-start-date-cutoff')).toBeNull();
    });

    it('will not leave the delivery step without an address', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(2);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-issue-address')).toBeTruthy();
        });
        // Beside the button that was pressed, not at the foot of a long step.
        expect(
            within(screen.getByTestId('configurator-summary')).getByTestId(
                'configurator-issue-address',
            ),
        ).toBeTruthy();
        expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        // Nothing saved, so no form to type into: the one way on is the address editor.
        expect(screen.queryByTestId('configurator-address-picker')).toBeNull();
        expect(screen.getByTestId('configurator-add-address')).toBeTruthy();
    });

    it('disables the weekdays the plan does not deliver on', async () => {
        // The sharpest case: a plan whose quote publishes no weekend deliveries at all.
        await renderConfigurator(
            { planId: String(PLAN.id) },
            { quote: { ...testQuote(), availableWeekdays: [1, 2, 3, 4, 5] } },
        );
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(1);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-weekdays-limited')).toBeTruthy();
        });
        const saturday = screen.getByTestId('configurator-weekday-6');
        expect(saturday.props.accessibilityState?.disabled ?? saturday.props['aria-disabled']).toBe(
            true,
        );
    });

    it.each([
        ['plan', 'configurator-review-plan-edit', undefined],
        ['meals', 'configurator-review-meals-edit', 'meals'],
    ] as const)(
        'goes back to the %s step from its Edit on the review',
        async (step, edit, query) => {
            pickMealsAhead();
            await renderConfigurator({ planId: String(PLAN.id) }, { addresses: [HOME_ADDRESS] });

            await walkToReviewStep();

            await act(async () => {
                fireEvent.press(screen.getByTestId(edit));
            });
            await waitFor(() => {
                expect(screen.getByTestId(`configurator-step-${step}`)).toBeTruthy();
            });
            // Edit is a step of its own in history, like Continue: Back returns to the review.
            const opened = routerMock.__push.mock.calls.at(-1)?.[0] as string;
            expect(pathnameOf(opened)).toBe(CONFIGURATOR_PATH);
            expect(queryOf(opened)['step']).toBe(query);
        },
        30_000,
    );

    it('walks the four steps and creates a real subscription at the end', async () => {
        const created = testSubscription({ state: 'active' });
        pickMealsAhead();
        const harness = await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                commerce: { createSubscription: async () => created },
            },
        );

        await walkToReviewStep();
        // The meals the run carries, as a card of their own with a way back to choose again.
        expect(screen.getByTestId('configurator-summary-meals')).toHaveTextContent(/7 days chosen/);
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
        expect(screen.getByTestId('configurator-summary-address')).toHaveTextContent(
            /12 Sunset Street/,
        );
        // The length reads as what it buys, and the price card as one arithmetic: a delivery day
        // of the band the set-up opened on (the plan's middle one, 465.00 a week → 66.43) lists
        // first, the run buys seven of them, and the total is the server's own figure, with
        // the day it works out to after the discount under it.
        expect(screen.getByTestId('configurator-summary-duration')).toHaveTextContent(
            /1 week · 7 delivery days/,
        );
        expect(screen.getByTestId('configurator-price-per-day-list-amount')).toHaveTextContent(
            /66\.43/,
        );
        expect(screen.getByTestId('configurator-price-gross-amount')).toHaveTextContent(/465\.01/);
        expect(screen.getByTestId('configurator-price-gross')).toHaveTextContent(/7 delivery days/);
        expect(screen.queryByTestId('configurator-price-discount')).toBeNull();
        expect(screen.getByTestId('configurator-price-total-amount')).toHaveTextContent(/475\.02/);
        expect(screen.getByTestId('configurator-price-per-delivery-amount')).toHaveTextContent(
            /67\.86/,
        );
        // The allergy list is on the review too, as a card of its own rather than a summary row.
        expect(screen.queryByTestId('configurator-summary-allergens')).toBeNull();
        expect(
            within(screen.getByTestId('configurator-review-allergens')).getByTestId(
                'configurator-review-allergy-notice-list',
            ),
        ).toHaveTextContent('Your allergy list is empty.');

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-confirm-acknowledge-control'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-create'));
        });
        // The receipt it printed is the priced preview, under the plan's name.
        await screen.findByTestId('configurator-view-plan', {}, { timeout: 5000 });
        expect(screen.getByTestId('configurator-printer-status')).toHaveTextContent(
            'Plan confirmed',
        );
        expect(screen.getByTestId('configurator-receipt-total-amount')).toHaveTextContent(
            /475\.02/,
        );
        await viewPlan();

        // The set-up is replaced by the subscription itself, flagged as just created: a refresh
        // shows the subscription, and Back is not a second chance to create it (plans-04).
        await waitFor(
            () => {
                expect(routerMock.__replace).toHaveBeenCalledWith(
                    `/customer/subscriptions/${String(created.id)}?created=1`,
                );
            },
            { timeout: 5000 },
        );
        expect(routerMock.__push).not.toHaveBeenCalledWith(
            expect.stringContaining(`/customer/subscriptions/${String(created.id)}`),
        );

        // What the four steps actually sent: the configuration the person assembled, the saved
        // address it is delivered to, the acknowledgement the contract requires, and nothing
        // resembling a payment.
        expect(harness.repositories.commerce.createSubscription).toHaveBeenCalledTimes(1);
        const request = createRequest(harness);
        expect(request.acknowledgedTerms).toBe(true);
        expect(request.addressId).toBe(HOME_ADDRESS.id);
        expect(request.configuration.planId).toBe(PLAN.id);
        expect(request.configuration.variantId).toBe(OPENING_VARIANT.id);
        expect(request.configuration.address.area).toBe(HOME_ADDRESS.areaName);
        expect(request.configuration.slotCode).toBe(DEFAULT_SLOT_CODE);
        // And the meals, in the same call: seven consecutive delivery days from the start, each
        // with a dish in every one of the band's five sittings, in the order of the day. Nothing
        // follows the creation — there is no second write to lose.
        const start = request.configuration.startDate;
        expect(request.configuration.days).toEqual(
            Array.from({ length: 7 }, (_, offset) => ({
                date: addDays(start, offset),
                meals: [
                    { slot: 'breakfast', sequence: 1, mealId: MENU_MEALS[0]!.id },
                    { slot: 'lunch', sequence: 1, mealId: MENU_MEALS[0]!.id },
                    { slot: 'dinner', sequence: 1, mealId: MENU_MEALS[0]!.id },
                    { slot: 'snack', sequence: 1, mealId: MENU_MEALS[0]!.id },
                    { slot: 'snack', sequence: 2, mealId: MENU_MEALS[0]!.id },
                ],
            })),
        );
        expect(harness.repositories.commerce.setSubscriptionMealChoices).not.toHaveBeenCalled();
        // The set-up is spent: its draft is gone.
        expect(configuratorDrafts.read(configuratorDraftKey(String(PLAN.id)))).toBeNull();
    }, 30_000);

    /**
     * The repository refuses a creation whose summary was never acknowledged. That guard now lives
     * on the server, so what this asserts is the client half: the request is never sent at all.
     */
    it('will not send a creation whose terms were never acknowledged', async () => {
        pickMealsAhead();
        const harness = await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                commerce: { createSubscription: async () => testSubscription() },
            },
        );

        await walkToReviewStep();

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-create'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-issue-terms')).toBeTruthy();
        });
        expect(harness.repositories.commerce.createSubscription).not.toHaveBeenCalled();
        expect(routerMock.__replace).not.toHaveBeenCalled();
    }, 30_000);

    /**
     * ③ Meals: a dish for every sitting of every delivery day, from any meal the kitchen publishes.
     * The run is the two-meal band over a week of every day, starting ten days out — fourteen
     * sittings — with every day but the first already chosen in the draft.
     */
    it('holds Next on the meals step until every sitting of every day has a dish', async () => {
        const [harvest, sesame, halloumi] = MENU_MEALS as readonly [
            MarketplaceMeal,
            MarketplaceMeal,
            MarketplaceMeal,
        ];
        const start = addDays(todayIso(), 10)!;
        const run = Array.from({ length: 7 }, (_, offset) => addDays(start, offset)!);
        const laterDays: Record<string, MealId> = {};
        for (const date of run.slice(1)) {
            laterDays[`${date}|lunch:1`] = sesame.id;
            laterDays[`${date}|dinner:1`] = sesame.id;
        }
        configuratorDrafts.write(configuratorDraftKey(String(PLAN.id)), {
            startDate: start,
            mealPicks: laterDays,
        });
        const created = testSubscription({ state: 'active' });
        const harness = await renderConfigurator(
            { planId: String(PLAN.id), variantId: String(TWO_MEALS_VARIANT.id) },
            {
                addresses: [HOME_ADDRESS],
                params: { step: 'meals' },
                commerce: { createSubscription: async () => created },
            },
        );

        expect(await screen.findByTestId('configurator-step-meals')).toBeTruthy();
        // The days arrive with the plan's delivery weekdays, which are every day by default.
        await waitFor(() => {
            expect(screen.getByTestId('configurator-meals-progress')).toHaveTextContent(
                '12 of 14 meals chosen',
            );
        });
        // One row per delivery day of the run, one select per sitting of the band.
        expect(mealRowDates()).toEqual(run);
        const firstDay = `configurator-meal-${start}`;
        expect(screen.getByTestId(`${firstDay}-lunch-1`)).toHaveTextContent(/Lunch/);
        expect(screen.getByTestId(`${firstDay}-dinner-1`)).toHaveTextContent(/Dinner/);
        expect(screen.queryByTestId(`${firstDay}-breakfast-1`)).toBeNull();
        expect(screen.getByTestId(`${firstDay}-lunch-1-value`)).toHaveTextContent('Choose a meal');
        expect(screen.getByTestId(`configurator-meal-${run[1]!}-lunch-1-value`)).toHaveTextContent(
            sesame.name,
        );
        // A single week: there is nothing to repeat it onto.
        expect(screen.queryByTestId('configurator-meals-repeat')).toBeNull();

        // Next is refused beside the button, and the sittings still empty say so where they are.
        await pressNext(1);
        await waitFor(() => {
            expect(
                within(screen.getByTestId('configurator-summary')).getByTestId(
                    'configurator-issue-mealsMissing',
                ),
            ).toHaveTextContent(/Choose a meal for every sitting of every day to continue\./);
        });
        expect(screen.getByTestId('configurator-step-meals')).toBeTruthy();
        expect(routerMock.__push).not.toHaveBeenCalled();
        expect(screen.getByTestId(`${firstDay}-lunch-1-error`)).toHaveTextContent('Choose a meal');
        expect(screen.getByTestId(`${firstDay}-dinner-1-error`)).toBeTruthy();
        expect(screen.queryByTestId(`configurator-meal-${run[1]!}-lunch-1-error`)).toBeNull();

        await pickMeal(`${firstDay}-lunch-1`, harvest);
        await pickMeal(`${firstDay}-dinner-1`, halloumi);
        expect(screen.getByTestId('configurator-meals-progress')).toHaveTextContent(
            '14 of 14 meals chosen',
        );
        expect(screen.queryByTestId(`${firstDay}-lunch-1-error`)).toBeNull();
        // Written to the draft as it is chosen, so a detour or a refresh keeps it.
        expect(
            configuratorDrafts.read(configuratorDraftKey(String(PLAN.id)))?.mealPicks?.[
                `${start}|dinner:1`
            ],
        ).toBe(halloumi.id);

        await pressNext(1);
        await waitFor(
            () => {
                expect(screen.getByTestId('configurator-price-total-amount')).toBeTruthy();
            },
            { timeout: 15_000 },
        );
        expect(queryOf(routerMock.__push.mock.calls.at(-1)?.[0] as string)['step']).toBe('review');
        expect(screen.getByTestId('configurator-summary-meals')).toHaveTextContent(/7 days chosen/);

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-confirm-acknowledge-control'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-create'));
        });
        await viewPlan();

        // The day chosen here and the six from the draft, every sitting, in one create call.
        const request = createRequest(harness);
        expect(request.configuration.variantId).toBe(TWO_MEALS_VARIANT.id);
        expect(request.configuration.days).toEqual(
            run.map((date, index) => ({
                date,
                meals:
                    index === 0
                        ? [
                              { slot: 'lunch', sequence: 1, mealId: harvest.id },
                              { slot: 'dinner', sequence: 1, mealId: halloumi.id },
                          ]
                        : [
                              { slot: 'lunch', sequence: 1, mealId: sesame.id },
                              { slot: 'dinner', sequence: 1, mealId: sesame.id },
                          ],
            })),
        );
    }, 30_000);

    /**
     * A long run is filled a week at a time: "Repeat week 1" copies the first week onto every later
     * day of the same weekday and leaves a day the person already chose alone. One delivery day a
     * week here, so the seven deliveries are seven weeks of one day each.
     */
    it('fills every later week from week 1, keeping a later day already chosen', async () => {
        const [harvest, sesame, halloumi] = MENU_MEALS as readonly [
            MarketplaceMeal,
            MarketplaceMeal,
            MarketplaceMeal,
        ];
        const start = addDays(todayIso(), 10)!;
        const run = Array.from({ length: 7 }, (_, week) => addDays(start, week * 7)!);
        const thirdWeek = run[2]!;
        configuratorDrafts.write(configuratorDraftKey(String(PLAN.id)), {
            startDate: start,
            deliveryWeekdays: [isoWeekday(start)!],
            // Chosen before for week 3's lunch: Repeat must leave it alone.
            mealPicks: { [`${thirdWeek}|lunch:1`]: sesame.id },
        });
        await renderConfigurator(
            { planId: String(PLAN.id), variantId: String(TWO_MEALS_VARIANT.id) },
            { addresses: [HOME_ADDRESS], params: { step: 'meals' } },
        );

        expect(await screen.findByTestId('configurator-step-meals')).toBeTruthy();
        expect(mealRowDates()).toEqual(run);
        for (const [index, date] of run.entries()) {
            const week = screen.getByTestId(`configurator-meals-week-${String(index + 1)}`);
            expect(week).toHaveTextContent(new RegExp(`^Week ${String(index + 1)}\\D`));
            expect(within(week).getByTestId(`configurator-meal-${date}`)).toBeTruthy();
        }
        expect(screen.getByTestId('configurator-meals-progress')).toHaveTextContent(
            '1 of 14 meals chosen',
        );
        // Nothing to copy until week 1 is whole.
        expect(screen.getByTestId('configurator-meals-repeat')).toBeDisabled();

        await pickMeal(`configurator-meal-${start}-lunch-1`, harvest);
        expect(screen.getByTestId('configurator-meals-repeat')).toBeDisabled();
        await pickMeal(`configurator-meal-${start}-dinner-1`, halloumi);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-meals-repeat')).not.toBeDisabled();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-meals-repeat'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-meals-progress')).toHaveTextContent(
                '14 of 14 meals chosen',
            );
        });
        for (const date of run.slice(1)) {
            expect(screen.getByTestId(`configurator-meal-${date}-lunch-1-value`)).toHaveTextContent(
                date === thirdWeek ? sesame.name : harvest.name,
            );
            expect(
                screen.getByTestId(`configurator-meal-${date}-dinner-1-value`),
            ).toHaveTextContent(halloumi.name);
        }
        const draft = configuratorDrafts.read(configuratorDraftKey(String(PLAN.id)));
        expect(draft?.mealPicks?.[`${run.at(-1)!}|dinner:1`]).toBe(halloumi.id);
        expect(draft?.mealPicks?.[`${thirdWeek}|lunch:1`]).toBe(sesame.id);

        // Every day is filled, so the step lets go.
        await pressNext(1);
        await waitFor(
            () => {
                expect(screen.getByTestId('configurator-step-review')).toBeTruthy();
            },
            { timeout: 15_000 },
        );
        expect(screen.queryByTestId('configurator-issue-mealsMissing')).toBeNull();
    }, 30_000);
});

/**
 * The set-up as a URL and a draft (plans-02, 03, 06): the step, band and address in the query, the
 * rest of the person's choices in a session draft keyed by plan — so Back walks the steps, a
 * refresh or a detour changes nothing, and adding an address comes back to the delivery step with
 * it chosen.
 */
describe('SubscriptionConfiguratorScreen — its place survives leaving it', () => {
    beforeEach(() => {
        clearAllSessionDrafts();
    });

    const PLAN_PARAM = String(PLAN.id);
    const OFFICE = testAddress({
        id: 'address-office',
        label: 'Office',
        line1: '1 Tower Road',
        isDefault: false,
    });
    /** The band a set-up opened without one starts on: the plan's middle one. */
    const MIDDLE_BAND = PLAN.variants[Math.floor(PLAN.variants.length / 2)]!;
    /** The set-up at a step, with the band and address a fresh one derives. */
    const at = (step: 'plan' | 'delivery' | 'meals' | 'review', address: string | undefined) =>
        configuratorHref({ plan: PLAN_PARAM, variant: String(MIDDLE_BAND.id), step, address });

    it('opens on the step its URL names', async () => {
        await renderConfigurator(
            { planId: PLAN_PARAM },
            { addresses: [HOME_ADDRESS], params: { step: 'delivery' } },
        );

        expect(await screen.findByTestId('configurator-step-delivery')).toBeTruthy();
        expect(screen.queryByTestId('configurator-step-plan')).toBeNull();
        expect(screen.getByTestId('configurator-progress-delivery')).toBeTruthy();
    });

    it('pushes each step, so Back walks them instead of leaving the set-up', async () => {
        await renderConfigurator({ planId: PLAN_PARAM }, { addresses: [HOME_ADDRESS] });
        await screen.findByTestId('configurator-step-plan');

        await pressNext(1);

        expect(routerMock.__push).toHaveBeenLastCalledWith(at('delivery', HOME_ADDRESS.id));
        expect(routerMock.__router.setParams).not.toHaveBeenCalledWith({ step: 'delivery' });
        expect(await screen.findByTestId('configurator-step-delivery')).toBeTruthy();
    });

    it('moves a step whose earlier answers are missing to the first one still unanswered', async () => {
        // Review, with no address to deliver to: the delivery step is unanswered.
        await renderConfigurator({ planId: PLAN_PARAM }, { params: { step: 'review' } });

        expect(await screen.findByTestId('configurator-step-delivery')).toBeTruthy();
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({ step: 'delivery' });
        expect(screen.queryByTestId('configurator-step-review')).toBeNull();
    });

    it('moves a review whose days have no meals yet back to the meals step', async () => {
        // An address and a delivery step that is answered — and not one meal chosen.
        await renderConfigurator(
            { planId: PLAN_PARAM },
            { addresses: [HOME_ADDRESS], params: { step: 'review' } },
        );

        expect(await screen.findByTestId('configurator-step-meals')).toBeTruthy();
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({ step: 'meals' });
        expect(screen.queryByTestId('configurator-step-review')).toBeNull();
        expect(
            screen.getByTestId('configurator-progress-review').props.accessibilityState,
        ).toMatchObject({ disabled: true });
    });

    it.each([
        ['when the step before is the entry underneath', true],
        ['after a refresh', false],
    ] as const)('goes back a step %s', async (_label, underneath) => {
        routerMock.__set({
            navState: underneath
                ? {
                      index: 1,
                      routes: [
                          { name: 'subscriptions/new', params: { plan: PLAN_PARAM } },
                          {
                              name: 'subscriptions/new',
                              params: { plan: PLAN_PARAM, step: 'delivery' },
                          },
                      ],
                  }
                : undefined,
        });
        await renderConfigurator(
            { planId: PLAN_PARAM },
            { addresses: [HOME_ADDRESS], params: { step: 'delivery' } },
        );

        await fireEvent.press(await screen.findByTestId('configurator-back'));

        if (underneath) {
            expect(routerMock.__router.back).toHaveBeenCalledTimes(1);
            expect(routerMock.__router.setParams).not.toHaveBeenCalledWith({ step: undefined });
        } else {
            expect(routerMock.__router.setParams).toHaveBeenCalledWith({ step: undefined });
            expect(routerMock.__router.back).not.toHaveBeenCalled();
            expect(await screen.findByTestId('configurator-step-plan')).toBeTruthy();
        }
    });

    it('keeps the choices through a remount, and forgets them on Start over', async () => {
        const first = await renderConfigurator(
            { planId: PLAN_PARAM },
            { addresses: [HOME_ADDRESS], params: { step: 'delivery' } },
        );
        await screen.findByTestId('configurator-step-delivery');
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-slot-evening'));
        });
        expect(
            screen.getByTestId('configurator-slot-evening').props.accessibilityState,
        ).toMatchObject({ checked: true });
        // Written as it is made, so leaving now loses nothing.
        expect(configuratorDrafts.read(configuratorDraftKey(PLAN_PARAM))?.slotCode).toBe('evening');

        // A detour, Back or a refresh unmounts the screen; the new one finds the window chosen.
        await first.view.unmount();
        await renderConfigurator(
            { planId: PLAN_PARAM },
            { addresses: [HOME_ADDRESS], params: { step: 'delivery' } },
        );
        await screen.findByTestId('configurator-step-delivery');
        expect(
            screen.getByTestId('configurator-slot-evening').props.accessibilityState,
        ).toMatchObject({ checked: true });

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-start-over'));
        });
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({
            step: undefined,
            address: undefined,
        });
        expect(configuratorDrafts.read(configuratorDraftKey(PLAN_PARAM))).toBeNull();
        expect(await screen.findByTestId('configurator-step-plan')).toBeTruthy();
        expect(screen.queryByTestId('configurator-start-over')).toBeNull();
    });

    it('sends somebody with no saved address to the address editor, and back to this step', async () => {
        await renderConfigurator(
            { planId: PLAN_PARAM },
            { addresses: [], params: { step: 'delivery' } },
        );

        await fireEvent.press(await screen.findByTestId('configurator-add-address'));

        const opened = routerMock.__push.mock.calls.at(-1)?.[0] as string;
        expect(opened).toBe(
            withReturnTo('/customer/account/addresses/new', at('delivery', undefined)),
        );
        // The return the editor receives is this set-up on its delivery step, exactly.
        expect(decodeURIComponent(queryOf(opened)['returnTo'] ?? '')).toBe(
            at('delivery', undefined),
        );
    });

    it('chooses the address the editor comes back with', async () => {
        await renderConfigurator(
            { planId: PLAN_PARAM },
            {
                addresses: [HOME_ADDRESS, OFFICE],
                params: { step: 'delivery', address: OFFICE.id },
            },
        );
        await screen.findByTestId('configurator-step-delivery');

        await waitFor(() => {
            expect(screen.getByTestId('configurator-address-picker-trigger')).toHaveTextContent(
                /1 Tower Road/,
            );
        });
        // And another choice is written back into the URL, not kept in the screen.
        await fireEvent.press(screen.getByTestId('configurator-address-picker-trigger'));
        await fireEvent.press(
            await screen.findByTestId(`configurator-address-picker-option-${HOME_ADDRESS.id}`),
        );
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({ address: HOME_ADDRESS.id });
    });

    it('lists the account steps up front, each coming back here, and holds Subscribe', async () => {
        pickMealsAhead();
        await renderConfigurator(
            { planId: PLAN_PARAM },
            {
                addresses: [HOME_ADDRESS],
                checklist: {
                    lifecycle: 'provisional',
                    canActivate: false,
                    items: [
                        {
                            step: 'verify_email',
                            complete: true,
                            required: true,
                            blockedReason: null,
                        },
                        {
                            step: 'dietary_profile',
                            complete: false,
                            required: true,
                            blockedReason: null,
                        },
                    ],
                },
            },
        );

        // Before step one, not after a refused Subscribe.
        const panel = await screen.findByTestId('configurator-setup-required');
        expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        expect(panel).toHaveTextContent(/1 step is left before you can subscribe/);

        await fireEvent.press(screen.getByTestId('configurator-setup-step-dietary_profile-open'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo('/customer/account/allergies', at('plan', HOME_ADDRESS.id)),
        );

        // Back from the detour; the set-up itself can still be walked, and only Subscribe waits.
        await act(async () => {
            routerMock.__set({ pathname: CONFIGURATOR_PATH, params: { plan: PLAN_PARAM } });
        });
        await walkToReviewStep();
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-confirm-acknowledge-control'));
        });
        const create = screen.getByTestId('configurator-create');
        expect(create.props.accessibilityState).toMatchObject({ disabled: true });
        expect(create.props.accessibilityHint).toBe('Finish the steps above to subscribe.');
    }, 30_000);

    it('reads back only what a draft may hold', () => {
        expect(
            parseConfiguratorEdits({
                duration: '28d',
                slotCode: 'evening',
                deliveryWeekdays: [1, 3, 9],
                mealPicks: { '2026-11-02|lunch:1': 'meal-1', '2026-11-02|dinner:1': 'meal-2' },
                // None is a field of the set-up any more; a draft from before carries them. The
                // flat first-week list was replaced by a pick per sitting of every day.
                selectedMealIds: ['meal-1'],
                excludeAllergens: ['tree_nut'],
                dietClassifications: ['omnivore'],
                termsAcknowledged: true,
                variantId: 'from-somewhere',
            }),
        ).toEqual({
            duration: '28d',
            slotCode: 'evening',
            mealPicks: { '2026-11-02|lunch:1': 'meal-1', '2026-11-02|dinner:1': 'meal-2' },
        });
        // A length from before runs were named by their days is dropped, not misread.
        expect(parseConfiguratorEdits({ duration: '4w', slotCode: 'evening' })).toEqual({
            slotCode: 'evening',
        });
        // Picks that are not a map of dish identifiers are dropped whole rather than half-read.
        expect(
            parseConfiguratorEdits({ slotCode: 'evening', mealPicks: { '2026-11-02|lunch:1': 7 } }),
        ).toEqual({ slotCode: 'evening' });
        expect(parseConfiguratorEdits({ slotCode: 'evening', mealPicks: ['meal-1'] })).toEqual({
            slotCode: 'evening',
        });
        expect(parseConfiguratorEdits('not a draft')).toBeNull();
    });
});

/* ══ screens: subscription list and detail ═════════════════════════════════════════════════════ */

function renderSubscriptions(
    subscriptions: readonly Subscription[],
    options: { readonly latencyMs?: number } = {},
) {
    return renderStubScreen(<SubscriptionsScreen />, {
        session: testMeResponse(),
        ...(options.latencyMs === undefined ? {} : { latencyMs: options.latencyMs }),
        repositories: {
            commerce: {
                listSubscriptions: async (filter?: SubscriptionFilter) => {
                    const states = filter?.states ?? [];
                    return page(
                        states.length === 0
                            ? subscriptions
                            : subscriptions.filter((entry) => states.includes(entry.state)),
                    );
                },
            },
        },
    });
}

describe('SubscriptionsScreen', () => {
    it('shows skeletons before the list arrives', async () => {
        await renderSubscriptions([testSubscription()], { latencyMs: 60 });
        expect(screen.getByTestId('subscriptions-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-list')).toBeTruthy();
        });
    });

    it('renders each subscription with its state and its next delivery', async () => {
        await renderSubscriptions([testSubscription()]);

        await waitFor(() => {
            expect(screen.getByTestId(`subscription-row-${String(SUBSCRIPTION_ID)}`)).toBeTruthy();
        });
        expect(
            screen.getByTestId(`subscription-row-${String(SUBSCRIPTION_ID)}-state`),
        ).toBeTruthy();
        expect(screen.getByTestId(`subscription-row-${String(SUBSCRIPTION_ID)}-next`)).toBeTruthy();
    });

    it('opens a row', async () => {
        await renderSubscriptions([testSubscription()]);
        await waitFor(() => {
            expect(
                screen.getByTestId(`subscription-row-${String(SUBSCRIPTION_ID)}-open`),
            ).toBeTruthy();
        });

        await fireEvent.press(
            screen.getByTestId(`subscription-row-${String(SUBSCRIPTION_ID)}-open`),
        );
        expect(routerMock.__push).toHaveBeenCalledWith(
            `/customer/subscriptions/${String(SUBSCRIPTION_ID)}`,
        );
    });

    it('has a real empty state for a filter nothing matches', async () => {
        // One live subscription and nothing that has ended — so "ended" really matches nothing.
        await renderSubscriptions([testSubscription()]);
        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-list')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscriptions-filter-ended'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('subscriptions-clear-filter')).toBeTruthy();
        // The group is written into the URL — as `status`, never the reserved `state`.
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({ status: 'ended' });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscriptions-clear-filter'));
        });
        expect(routerMock.__router.setParams).toHaveBeenLastCalledWith({ status: undefined });
    });

    it('opens on the group its URL names, so Back and a refresh keep it', async () => {
        routerMock.__set({ params: { status: 'paused' } });
        const harness = await renderSubscriptions([
            testSubscription(),
            testSubscription({ id: uuid(8, 2) as SubscriptionId, state: 'paused' }),
        ]);

        await waitFor(() => {
            expect(screen.getByTestId(`subscription-row-${String(uuid(8, 2))}`)).toBeTruthy();
        });
        expect(screen.queryByTestId(`subscription-row-${String(SUBSCRIPTION_ID)}`)).toBeNull();
        expect(harness.repositories.commerce.listSubscriptions).toHaveBeenCalledWith({
            states: ['paused'],
        });
    });

    it('ends the list in a way to another plan, not a sentence about one', async () => {
        await renderSubscriptions([testSubscription()]);
        await waitFor(() => {
            expect(screen.getByTestId('subscriptions-list')).toBeTruthy();
        });

        expect(screen.queryByTestId('subscriptions-new-hint')).toBeNull();
        await fireEvent.press(screen.getByTestId('subscriptions-browse'));
        expect(routerMock.__push).toHaveBeenCalledWith('/plans');
    });
});

/**
 * One subscription's world, held in a mutable object the overrides read at call time — so a
 * transition really changes it and the screen's own invalidation is what redraws.
 */
interface SubscriptionWorld {
    subscription: Subscription;
    /** The run's meals, day by day, as `GET …/days` serves them. */
    days: SubscriptionPlanDays;
}

/** The sittings the subscription's band fills: lunch and dinner. */
const SUBSCRIPTION_SITTINGS: readonly PlanSitting[] = [
    { slot: 'lunch', sequence: 1 },
    { slot: 'dinner', sequence: 1 },
];

/** The Wednesday after {@link NEXT_DELIVERY}, past its change cut-off once nothing can be changed. */
const LOCKED_DELIVERY = '2026-09-09';

function chosenMeal(
    date: string,
    sitting: PlanSitting,
    meal: MarketplaceMeal,
    source: SubscriptionMealChoice['source'] = 'customer',
): SubscriptionMealChoice {
    return {
        date,
        slot: sitting.slot,
        sequence: sitting.sequence,
        mealId: meal.id,
        mealName: meal.name,
        source,
    };
}

function planDay(
    date: string,
    meals: readonly [MarketplaceMeal, MarketplaceMeal],
    overrides: Partial<SubscriptionPlanDay> = {},
): SubscriptionPlanDay {
    return {
        date,
        basis: 'actual',
        status: 'scheduled',
        editable: true,
        changeDeadline: `${date}T00:00:00.000Z`,
        meals: SUBSCRIPTION_SITTINGS.map((sitting, index) =>
            chosenMeal(date, sitting, meals[index]!),
        ),
        ...overrides,
    };
}

/**
 * Two days to come: the next delivery, still open, with the harvest bowl and the halloumi plate —
 * the one dish with milk in it — and the one after, already locked.
 */
function testPlanDays(): SubscriptionPlanDays {
    const [harvest, sesame, halloumi] = MENU_MEALS as readonly [
        MarketplaceMeal,
        MarketplaceMeal,
        MarketplaceMeal,
    ];
    return {
        sittings: SUBSCRIPTION_SITTINGS,
        days: [
            planDay(NEXT_DELIVERY, [harvest, halloumi]),
            planDay(LOCKED_DELIVERY, [sesame, harvest], { editable: false }),
        ],
    };
}

function liveWorld(overrides: Partial<Subscription> = {}): SubscriptionWorld {
    return { subscription: testSubscription(overrides), days: testPlanDays() };
}

interface DetailOptions {
    readonly addresses?: readonly CustomerAddress[] | undefined;
    readonly profile?: DietaryProfile | undefined;
    readonly commerce?: Partial<CommerceRepository> | undefined;
    readonly latencyMs?: number | undefined;
    readonly subscriptionId?: string | undefined;
}

/**
 * The five transitions, as the server applies them — including the two guards it enforces.
 *
 * Pausing something already paused and resuming something that was never paused are refused here
 * exactly as the backend refuses them, so the screen's rejection path is exercised against a real
 * `ApiFailure` rather than a bare `Error`.
 */
function transitions(world: SubscriptionWorld): Partial<CommerceRepository> {
    return {
        pause: async (): Promise<Subscription> => {
            if (world.subscription.state === 'paused') {
                throw new ApiError(
                    validationFailure({}, { message: 'That subscription is already paused.' }),
                );
            }
            world.subscription = { ...world.subscription, state: 'paused' };
            return world.subscription;
        },
        resume: async (): Promise<Subscription> => {
            if (world.subscription.state !== 'paused') {
                throw new ApiError(
                    validationFailure({}, { message: 'That subscription is not paused.' }),
                );
            }
            world.subscription = { ...world.subscription, state: 'active' };
            return world.subscription;
        },
        skipDay: async (_id: SubscriptionId, request: SkipDayRequest): Promise<Subscription> => {
            world.subscription = {
                ...world.subscription,
                skippedDates: [...world.subscription.skippedDates, request.date],
            };
            return world.subscription;
        },
        changeSlot: async (_id: SubscriptionId, request: ChangeSlotRequest) => {
            world.subscription = {
                ...world.subscription,
                configuration: {
                    ...world.subscription.configuration,
                    slotCode: request.slotCode,
                    ...(request.deliveryWeekdays === undefined
                        ? {}
                        : { deliveryWeekdays: request.deliveryWeekdays }),
                },
            };
            return world.subscription;
        },
        changeAddress: async (_id: SubscriptionId, request: ChangeAddressRequest) => {
            world.subscription = {
                ...world.subscription,
                configuration: {
                    ...world.subscription.configuration,
                    address: request.address,
                },
            };
            return world.subscription;
        },
        listSubscriptionDays: async (): Promise<SubscriptionPlanDays> => world.days,
        // The whole day is replaced, as the server replaces it, and answered named.
        setSubscriptionMealChoices: async (
            _id: SubscriptionId,
            request: SetSubscriptionMealChoicesRequest,
        ): Promise<readonly SubscriptionMealChoice[]> => {
            const meals = request.choices.map((choice) =>
                chosenMeal(request.date, choice, mealById(choice.mealId)),
            );
            world.days = {
                ...world.days,
                days: world.days.days.map((day) =>
                    day.date === request.date ? { ...day, meals } : day,
                ),
            };
            return meals;
        },
    };
}

function renderDetail(world: SubscriptionWorld, options: DetailOptions = {}) {
    return renderStubScreen(
        <SubscriptionDetailScreen
            subscriptionId={options.subscriptionId ?? String(SUBSCRIPTION_ID)}
        />,
        {
            session: testMeResponse(),
            ...(options.latencyMs === undefined ? {} : { latencyMs: options.latencyMs }),
            repositories: {
                commerce: {
                    getSubscription: async () => world.subscription,
                    getSubscriptionBalance: async () => testBalance(world.subscription),
                    listSubscriptionDeliveries: async () => page([testDelivery(NEXT_DELIVERY)]),
                    getSubscriptionQuote: async () => testQuote(),
                    ...transitions(world),
                    ...options.commerce,
                },
                account: {
                    listAddresses: async () => options.addresses ?? [],
                    getDietaryProfile: async () => options.profile ?? dietaryProfile(),
                },
                // The kitchen's menu: what a day's meals may be changed to, and what the allergy
                // notice reads the chosen dishes' allergens from.
                marketplace: {
                    getPlan: async () => PLAN,
                    listMeals: async () => page(MENU_MEALS),
                },
            },
        },
    );
}

describe('SubscriptionDetailScreen', () => {
    it('answers a malformed identifier with the not-found state', async () => {
        await renderDetail(liveWorld(), { subscriptionId: 'not-a-uuid' });
        expect(screen.getByTestId('subscription-detail-empty')).toBeTruthy();
    });

    it('reports a failure for an identifier that is well formed but unknown', async () => {
        await renderDetail(liveWorld(), {
            subscriptionId: UNKNOWN_SUBSCRIPTION_ID,
            latencyMs: 40,
            commerce: {
                getSubscription: () =>
                    Promise.reject(new ApiError(apiFailure('resource.not_found'))),
            },
        });
        expect(screen.getByTestId('subscription-detail-loading')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-error')).toBeTruthy();
        });
    });

    it('renders the record, the plan card with its Change links, and the actions', async () => {
        await renderDetail(liveWorld());

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-name')).toHaveTextContent(PLAN.name);
        });
        expect(screen.getByTestId('subscription-detail-configuration')).toBeTruthy();
        expect(screen.getByTestId('subscription-detail-row-address')).toBeTruthy();
        expect(screen.getByTestId('subscription-detail-manage')).toBeTruthy();
        expect(screen.getByTestId('subscription-detail-next')).toBeTruthy();
        expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        expect(screen.getByTestId('subscription-skip')).toBeTruthy();
        expect(screen.getByTestId('subscription-change-address')).toBeTruthy();
        expect(screen.getByTestId('subscription-change-slot')).toBeTruthy();
        // Resume is not offered from an active subscription: the repository would refuse it.
        expect(screen.queryByTestId('subscription-resume')).toBeNull();

        // The length is what was bought, read as weeks and as the balance it created; the
        // start date is in the past, so it "Started".
        expect(screen.getByTestId('subscription-detail-row-duration')).toHaveTextContent(
            /4 weeks · 28 delivery days/,
        );
        expect(screen.getByTestId('subscription-detail-row-start')).toHaveTextContent(/Started/);
        expect(screen.getByTestId('subscription-detail-row-start')).toHaveTextContent(/Aug/);
        expect(screen.getByTestId('subscription-detail-row-start')).toHaveTextContent(/2026/);
        // No "Excluded" row reading a field nothing wrote: the allergy list is its own card.
        expect(screen.queryByTestId('subscription-detail-row-allergens')).toBeNull();
        expect(screen.queryByTestId('subscription-timeline-paused-until')).toBeNull();
    });

    it('says a subscription that has not begun "Starts", and one with no date "Not planned yet"', async () => {
        await renderDetail(
            liveWorld({ configuration: testConfiguration({ startDate: '2099-01-04' }) }),
        );
        const future = await screen.findByTestId('subscription-detail-row-start');
        expect(future).toHaveTextContent(/Starts/);
        expect(future).not.toHaveTextContent(/Started/);
        expect(future).toHaveTextContent(/Jan/);
        expect(future).toHaveTextContent(/2099/);

        await renderDetail(liveWorld({ configuration: testConfiguration({ startDate: '' }) }));
        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-row-start')).toHaveTextContent(
                /Not planned yet/,
            );
        });
    });

    it('shows the profile’s allergy list against the chosen dishes, with a way to change it', async () => {
        await renderDetail(liveWorld(), { profile: dietaryProfile([MILK]) });

        const card = await screen.findByTestId('subscription-detail-allergies');
        await waitFor(() => {
            expect(
                within(card).getByTestId('subscription-detail-allergy-notice-list'),
            ).toHaveTextContent(/Your allergy list: Milk/);
        });
        // Three dishes across the run's days; the halloumi plate is the one with milk in it.
        const clashes = await within(card).findByTestId(
            'subscription-detail-allergy-notice-clashes',
        );
        expect(clashes).toHaveTextContent(/1 dish in this plan contains something/);
        expect(clashes).toHaveTextContent(/Halloumi plate/);

        await fireEvent.press(within(card).getByTestId('subscription-detail-allergy-notice-edit'));
        expect(String(routerMock.__push.mock.calls.at(-1)?.[0])).toMatch(
            new RegExp(`^${ALLERGY_LIST_HREF}\\?returnTo=`),
        );
    });

    /**
     * The customer chose every meal when they subscribed; the page lists them day by day and
     * changes one open day at a time — the whole day, every sitting, in one write.
     */
    it('lists each day’s meals and saves a changed day with every sitting', async () => {
        const [harvest, sesame] = MENU_MEALS as readonly [MarketplaceMeal, MarketplaceMeal];
        const world = liveWorld();
        const harness = await renderDetail(world);

        const section = await screen.findByTestId('subscription-meals');
        const open = await within(section).findByTestId(`subscription-meals-day-${NEXT_DELIVERY}`);
        expect(
            within(open).getByTestId(`subscription-meals-day-${NEXT_DELIVERY}-lunch-1`),
        ).toHaveTextContent(/Lunch.*Harvest bowl/);
        expect(
            within(open).getByTestId(`subscription-meals-day-${NEXT_DELIVERY}-dinner-1`),
        ).toHaveTextContent(/Dinner.*Halloumi plate/);
        // A day past its cut-off is shown, never offered for change.
        const locked = within(section).getByTestId(`subscription-meals-day-${LOCKED_DELIVERY}`);
        expect(locked).toHaveTextContent(/Sesame greens/);
        expect(screen.queryByTestId(`subscription-meals-day-${LOCKED_DELIVERY}-change`)).toBeNull();

        await act(async () => {
            fireEvent.press(screen.getByTestId(`subscription-meals-day-${NEXT_DELIVERY}-change`));
        });
        const dialog = await screen.findByTestId('subscription-meals-dialog');
        // The day's own meals are where the editor starts.
        expect(
            within(dialog).getByTestId('subscription-meals-dialog-day-lunch-1-value'),
        ).toHaveTextContent(harvest.name);
        await fireEvent.press(
            within(dialog).getByTestId('subscription-meals-dialog-day-dinner-1-trigger'),
        );
        await fireEvent.press(
            await screen.findByTestId(
                `subscription-meals-dialog-day-dinner-1-option-${String(sesame.id)}`,
            ),
        );
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-meals-save'));
        });

        // Every sitting of the day goes, the untouched lunch with the changed dinner.
        await waitFor(() => {
            expect(harness.repositories.commerce.setSubscriptionMealChoices).toHaveBeenCalledWith(
                SUBSCRIPTION_ID,
                {
                    date: NEXT_DELIVERY,
                    choices: [
                        { slot: 'lunch', sequence: 1, mealId: harvest.id },
                        { slot: 'dinner', sequence: 1, mealId: sesame.id },
                    ],
                },
            );
        });
        await waitFor(() => {
            expect(screen.queryByTestId('subscription-meals-dialog')).toBeNull();
        });
        // Redrawn from the server's days, not from what was pressed.
        await waitFor(() => {
            expect(
                screen.getByTestId(`subscription-meals-day-${NEXT_DELIVERY}-dinner-1`),
            ).toHaveTextContent(/Sesame greens/);
        });
        expect(
            (harness.repositories.commerce.listSubscriptionDays as unknown as jest.Mock).mock.calls
                .length,
        ).toBeGreaterThan(1);
    });

    it('marks a day nobody chose for as repeated, and offers no change once it is over', async () => {
        const [harvest, sesame] = MENU_MEALS as readonly [MarketplaceMeal, MarketplaceMeal];
        const world = liveWorld({ state: 'expired', nextDeliveryDate: null });
        world.days = {
            sittings: SUBSCRIPTION_SITTINGS,
            days: [
                planDay(NEXT_DELIVERY, [harvest, sesame], {
                    meals: SUBSCRIPTION_SITTINGS.map((sitting, index) =>
                        chosenMeal(NEXT_DELIVERY, sitting, [harvest, sesame][index]!, 'repeated'),
                    ),
                }),
            ],
        };
        await renderDetail(world);

        expect(
            await screen.findByTestId(`subscription-meals-day-${NEXT_DELIVERY}-repeated`),
        ).toHaveTextContent(/Repeated/);
        // Shown, never changed: the subscription is over, however open the day itself is.
        expect(screen.queryByTestId(`subscription-meals-day-${NEXT_DELIVERY}-change`)).toBeNull();
    });

    /**
     * The repository's own guard — resuming something that was never paused — is the server's now.
     * What the client owes is that it never asks: the control is absent rather than present and
     * apologetic, so the refusal path is a safety net and not the normal route.
     */
    it('does not offer, or send, a transition the current state forbids', async () => {
        const harness = await renderDetail(liveWorld());

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-actions')).toBeTruthy();
        });
        expect(screen.queryByTestId('subscription-resume')).toBeNull();
        expect(harness.repositories.commerce.resume).not.toHaveBeenCalled();

        const paused = await renderDetail(liveWorld({ state: 'paused' }));
        await waitFor(() => {
            expect(screen.getByTestId('subscription-resume')).toBeTruthy();
        });
        expect(screen.queryByTestId('subscription-pause')).toBeNull();
        expect(screen.queryByTestId('subscription-skip')).toBeNull();
        expect(paused.repositories.commerce.pause).not.toHaveBeenCalled();
    });

    it('pauses for real, through a dialog that states the consequence', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world);
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause-consequence')).toBeTruthy();
        });
        // A pause lasts until Resume: there is no "resume on" date to collect, because nothing
        // ever acted on one.
        expect(screen.queryByTestId('subscription-pause-until')).toBeNull();
        expect(screen.getByTestId('subscription-pause-consequence')).toHaveTextContent(
            /until you press Resume/,
        );
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause-confirm'));
        });

        await waitFor(() => {
            expect(world.subscription.state).toBe('paused');
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-resume')).toBeTruthy();
        });
        expect(harness.repositories.commerce.pause).toHaveBeenCalledWith(SUBSCRIPTION_ID);
        expect(harness.repositories.commerce.pause).toHaveBeenCalledTimes(1);
    });

    it('resumes a paused subscription for real', async () => {
        const world = liveWorld({ state: 'paused' });
        const harness = await renderDetail(world);
        await waitFor(() => {
            expect(screen.getByTestId('subscription-resume')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-resume'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-resume-dialog')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-resume-confirm'));
        });

        await waitFor(() => {
            expect(world.subscription.state).toBe('active');
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        });
        expect(harness.repositories.commerce.resume).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    });

    it('skips a chosen delivery day for real', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world);
        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip-sheet')).toBeTruthy();
        });

        // The subscription's own next delivery is the first day the sheet offers, and the one a
        // person most often wants to skip.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`subscription-skip-option-${NEXT_DELIVERY}`));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-skip-consequence')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-skip-confirm'));
        });

        await waitFor(() => {
            expect(world.subscription.skippedDates).toContain(NEXT_DELIVERY);
        });
        expect(harness.repositories.commerce.skipDay).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
            date: NEXT_DELIVERY,
        });
    });

    it('changes the delivery window for real', async () => {
        const world = liveWorld();
        const harness = await renderDetail(world);
        await waitFor(() => {
            expect(screen.getByTestId('subscription-change-slot')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-change-slot'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-slot-picker')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-slot-evening'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-slot-confirm'));
        });

        await waitFor(() => {
            expect(world.subscription.configuration.slotCode).toBe('evening');
        });
        expect(harness.repositories.commerce.changeSlot).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
            slotCode: 'evening',
            deliveryWeekdays: [1, 3, 5],
        });
    });

    /**
     * The dialog does not offer a form. A delivery address is *chosen* from the account's address
     * book — the same rule checkout follows, and for the same reason: a subscription's address has
     * to be one the placement can resolve a zone and a window from, which only a saved entry is.
     * So the assertion stays where it was: the record, not the form, has to be holding it after.
     */
    it('changes the delivery address for real', async () => {
        const garden = testAddress({
            id: 'address-garden',
            label: 'Garden',
            line1: 'Villa 12, Garden Row',
            areaName: 'Dubai Marina',
            isDefault: false,
        });
        const world = liveWorld();
        const harness = await renderDetail(world, { addresses: [garden] });

        // Otherwise the closing assertion would pass on a subscription nobody touched.
        expect(world.subscription.configuration.address.line1).not.toBe(garden.line1);

        await waitFor(() => {
            expect(screen.getByTestId('subscription-change-address')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-change-address'));
        });
        await fireEvent.press(await screen.findByTestId('subscription-address-picker-trigger'));
        await fireEvent.press(
            await screen.findByTestId(`subscription-address-picker-option-${garden.id}`),
        );
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-address-confirm'));
        });

        await waitFor(() => {
            expect(world.subscription.configuration.address.line1).toBe(garden.line1);
        });
        // And the configuration table redraws from the answer rather than from what was pressed.
        await waitFor(() => {
            expect(screen.getByText('Villa 12, Garden Row, Dubai Marina')).toBeTruthy();
        });
        expect(harness.repositories.commerce.changeAddress).toHaveBeenCalledWith(SUBSCRIPTION_ID, {
            address: expect.objectContaining({ line1: garden.line1, area: garden.areaName }),
            addressId: garden.id,
        });
    });

    it('shows the repository’s own refusal when the screen has gone stale', async () => {
        const world = liveWorld();
        await renderDetail(world);
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('subscription-pause-confirm')).toBeTruthy();
        });

        // Somebody else — another tab, another device — pauses it while the dialog is open.
        world.subscription = { ...world.subscription, state: 'paused' };

        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause-confirm'));
        });

        // Inside the dialog that is still open, not on the page behind its backdrop (plans-09).
        await waitFor(() => {
            expect(
                within(screen.getByTestId('subscription-pause-dialog')).getByTestId(
                    'subscription-pause-failure',
                ),
            ).toHaveTextContent(/already paused/);
        });

        // Closed and opened again, the dialog starts clean rather than on the old refusal.
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause-cancel'));
        });
        world.subscription = { ...world.subscription, state: 'active' };
        await act(async () => {
            fireEvent.press(screen.getByTestId('subscription-pause'));
        });
        expect(await screen.findByTestId('subscription-pause-confirm')).toBeTruthy();
        expect(screen.queryByTestId('subscription-pause-failure')).toBeNull();
    });

    it('says the subscription was just created, once, from its URL', async () => {
        routerMock.__set({ params: { created: '1' } });
        await renderDetail(liveWorld());

        const created = await screen.findByTestId('subscription-created');
        expect(created).toHaveTextContent(/Your subscription is set up/);
        await fireEvent.press(screen.getByTestId('subscription-created-dismiss'));
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({ created: undefined });
    });

    it('adds a new address from the address dialog, and reopens it on that address', async () => {
        const garden = testAddress({
            id: 'address-garden',
            label: 'Garden',
            line1: 'Villa 12, Garden Row',
            areaName: 'Dubai Marina',
            isDefault: false,
        });
        const first = await renderDetail(liveWorld(), { addresses: [HOME_ADDRESS] });

        await fireEvent.press(await screen.findByTestId('subscription-change-address'));
        await fireEvent.press(await screen.findByTestId('subscription-address-add'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            withReturnTo(
                '/customer/account/addresses/new',
                `/customer/subscriptions/${String(SUBSCRIPTION_ID)}?dialog=address`,
            ),
        );

        // The detour unmounted the page; the editor finishes onto it with the new address patched in.
        await first.view.unmount();
        routerMock.__reset();
        routerMock.__set({ params: { dialog: 'address', address: garden.id } });
        await renderDetail(liveWorld(), { addresses: [HOME_ADDRESS, garden] });

        expect(await screen.findByTestId('subscription-address-dialog')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('subscription-address-picker-trigger')).toHaveTextContent(
                /Villa 12, Garden Row/,
            );
        });
        // Taken off the entry, so a refresh or a Back onto it does not open the dialog again.
        expect(routerMock.__router.setParams).toHaveBeenCalledWith({
            dialog: undefined,
            address: undefined,
        });
    });

    it('goes up to the account and the list by name, never stacking a copy', async () => {
        await renderDetail(liveWorld());
        await screen.findByTestId('subscription-detail-name');

        await fireEvent.press(screen.getByTestId('subscription-detail-crumb-subscriptions'));
        expect(routerMock.__router.dismissTo).toHaveBeenLastCalledWith(
            '/customer/account?section=subscriptions',
        );
        await fireEvent.press(screen.getByTestId('subscription-detail-crumb-account'));
        expect(routerMock.__router.dismissTo).toHaveBeenLastCalledWith('/customer/account');
        expect(routerMock.__push).not.toHaveBeenCalled();
    });

    it('offers the same plan again, or the list, once a subscription is over', async () => {
        await renderDetail(liveWorld({ state: 'expired', nextDeliveryDate: null }));

        const notice = await screen.findByTestId('subscription-detail-read-only');
        await fireEvent.press(within(notice).getByTestId('subscription-detail-plan-again'));
        expect(routerMock.__push).toHaveBeenLastCalledWith(
            `/plans/${String(PLAN_ID)}?variant=${String(testConfiguration().variantId)}`,
        );
        await fireEvent.press(within(notice).getByTestId('subscription-detail-list'));
        expect(routerMock.__router.dismissTo).toHaveBeenLastCalledWith(
            '/customer/account?section=subscriptions',
        );
    });

    /**
     * The read-only path cannot be reached by any control on this screen, and that is deliberate:
     * `cancelSubscription` is the one transition that produces a terminal state, and it has its own
     * suite. What is asserted here is the pair of facts the rule is built from — that a live
     * subscription shows its controls and not the closed notice, and that a terminal one shows the
     * notice and no controls at all.
     */
    it('shows the controls, and not the closed notice, while a subscription is live', async () => {
        await renderDetail(liveWorld());

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-actions')).toBeTruthy();
        });
        expect(screen.queryByTestId('subscription-detail-read-only')).toBeNull();
        expect(SUBSCRIPTION_STATES.filter(isTerminalSubscriptionState)).toEqual([
            'cancelled',
            'expired',
        ]);

        await renderDetail(liveWorld({ state: 'cancelled', nextDeliveryDate: null }));
        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-read-only')).toBeTruthy();
        });
        expect(screen.queryByTestId('subscription-detail-actions')).toBeNull();
    });
});
