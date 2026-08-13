import {
    ApiError,
    apiFailure,
    orderPlacementRefusedFailure,
    validationFailure,
} from '@healthy360/api-client/contracts';
import type {
    AddCartItemRequest,
    Cart,
    CartItem,
    ChangeAddressRequest,
    ChangeSlotRequest,
    CheckoutPreview,
    CommerceRepository,
    CustomerAddress,
    DeliveryAddress,
    Kitchen,
    KitchenBranch,
    KitchenSalesChannels,
    MarketplaceMeal,
    PlaceOrderRequest,
    PlacedOrder,
    PlanDurationOption,
    PlanVariant,
    PreviewCheckoutRequest,
    SkipDayRequest,
    StoredNutritionTarget,
    Subscription,
    SubscriptionBalance,
    SubscriptionConfiguration,
    SubscriptionDelivery,
    SubscriptionFilter,
    SubscriptionPlan,
    SubscriptionPreview,
    SubscriptionQuote,
} from '@healthy360/api-client/contracts';
import { PLAN_DURATIONS, PLAN_DURATION_WEEKS, SUBSCRIPTION_STATES } from '@healthy360/domain-types';
import type {
    AllergenCode,
    CartId,
    KitchenId,
    MealId,
    Money,
    NutritionTargetId,
    OrderId,
    PlanDuration,
    PlanVariantId,
    SalesChannel,
    ServiceAreaId,
    SubscriptionId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { NutritionConstraint } from '@healthy360/nutrition';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

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
import {
    CONFIGURATOR_STEPS,
    combinationKey,
    configuredDeliveryDates,
    diffAllergens,
    discountedTotalMinorUnits,
    firstIncompleteStep,
    grossMinorUnits,
    initialConfiguratorState,
    isBeforePriceStep,
    isStepReachable,
    mealCombinations,
    nextConfiguratorStep,
    perDeliveryPrice,
    previousConfiguratorStep,
    savingMinorUnits,
    stepPosition,
    storedAllergenCodes,
    storedDietClassifications,
    toConfiguration,
    validateConfiguratorStep,
    variantForCombination,
    weeksFor,
} from './configurator.ts';
import type { ConfiguratorState, StepContext } from './configurator.ts';
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
 * is mocked rather than rendered — the same seam the marketplace and catalogue suites use.
 */
jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/customer/cart',
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
    globalThis.localStorage?.clear();
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
const TREE_NUT = 'tree_nut' as AllergenCode;

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

/**
 * The published totals, computed by hand from the advertised band's 475.00 a week.
 *
 * Deliberately *not* produced by `discountedTotalMinorUnits`: these are what the catalogue says a
 * duration costs, and the whole point of the duration-pricing case below is that the client's own
 * arithmetic reproduces them. Deriving them from the function under test would make that vacuous.
 *
 * 1w — 47 500 × 1, no discount.        2w — 47 500 × 2 = 95 000, less 5 %  → 90 250.
 * 4w — 47 500 × 4 = 190 000, less 10 % → 171 000.  12w — 47 500 × 12 = 570 000, less 20 % → 456 000.
 */
/** The authored options always carry a total; the contract allows `null` for multi-config plans. */
type AuthoredDurationOption = PlanDurationOption & { readonly totalPrice: Money };

const PLAN_DURATION_OPTIONS: readonly AuthoredDurationOption[] = [
    { duration: '1w', discountPercent: 0, totalPrice: { amount: 47_500, currency: AED } },
    { duration: '2w', discountPercent: 5, totalPrice: { amount: 90_250, currency: AED } },
    { duration: '4w', discountPercent: 10, totalPrice: { amount: 171_000, currency: AED } },
    { duration: '12w', discountPercent: 20, totalPrice: { amount: 456_000, currency: AED } },
];

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
    sampleMealIds: MENU_MEALS.map((meal) => meal.id),
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

/* ── the person's stored nutrition profile ───────────────────────────────────────────────────── */

const STORED_CONSTRAINTS: readonly NutritionConstraint[] = [
    {
        kind: 'allergy',
        code: 'tree_nut',
        label: 'Tree nuts',
        severity: 'critical',
        source: 'user',
        note: null,
    },
    {
        kind: 'preference',
        code: 'mediterranean',
        label: 'Mediterranean',
        severity: 'advisory',
        source: 'user',
        note: null,
    },
];

/** One stored target, carrying the one allergy the configurator is expected to pre-fill. */
const STORED_TARGET: StoredNutritionTarget = {
    id: uuid(10, 1) as NutritionTargetId,
    result: {
        id: uuid(10, 1) as NutritionTargetId,
        prototype: true,
        method: 'mifflin_st_jeor',
        request: {
            measurementSystem: 'metric',
            ageYears: 34,
            sexForCalculation: 'female',
            heightCentimetres: 168,
            weightKilograms: 64,
            activityLevel: 'moderately_active',
            goal: 'maintain',
            pace: 'standard',
            constraints: STORED_CONSTRAINTS,
        },
        basalMetabolicRate: 1380,
        maintenanceEnergy: 2140,
        targetEnergy: 2140,
        energyTolerance: { min: 2033, max: 2247 },
        macros: [],
        nutrients: [],
        explanation: {
            summary: 'Authored by this test.',
            steps: [],
            assumptions: [],
            citations: [],
            disclaimer: 'Not medical advice.',
        },
        requiresProfessionalReview: false,
        reviewReasons: [],
        override: null,
        calculatedAt: '2026-08-01T09:00:00.000Z',
    },
    professionallyApproved: false,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T09:00:00.000Z',
};

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
        duration: '4w',
        startDate: '2026-08-03',
        deliveryWeekdays: [1, 3, 5],
        slotCode: 'midday',
        address: SUBSCRIPTION_ADDRESS,
        dietClassifications: [],
        excludeAllergens: [],
        selectedMealIds: [],
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
        days: { total: 12, consumed: 3, remaining: 9 },
        nextDeliveryDate: NEXT_DELIVERY,
        skippedDates: [],
        pausedUntil: null,
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

/** The plan delivers every day. `allowsFreeSelection` is off, so no menu request is made. */
function testQuote(overrides: Partial<SubscriptionQuote> = {}): SubscriptionQuote {
    return {
        planId: PLAN_ID,
        variantId: ADVERTISED_VARIANT.id,
        duration: DEFAULT_DURATION,
        available: true,
        availableWeekdays: [1, 2, 3, 4, 5, 6, 7],
        days: 7,
        listPrice: ADVERTISED_VARIANT.pricePerWeek,
        discountPercent: 0,
        perDayPrice: { amount: 6786, currency: AED },
        total: durationOption(DEFAULT_DURATION).totalPrice,
        allowsFreeSelection: false,
        changeCutoffHours: 24,
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
    readonly deliveryCount?: number | undefined;
    readonly firstDeliveryDate?: string | undefined;
}

/**
 * What a priced proposal comes back as.
 *
 * The delivery count is `weekdays × weeks` rather than a re-run of `deliveryDatesFor`, so a case
 * that compares the client's derived dates against this figure is comparing two independent
 * calculations rather than one function with itself.
 */
function subscriptionPreview(
    configuration: SubscriptionConfiguration,
    overrides: PreviewOverrides = {},
): SubscriptionPreview {
    const option = durationOption(configuration.duration);
    const variant = variantById(configuration.variantId);
    const weeks = PLAN_DURATION_WEEKS[configuration.duration];
    const deliveryCount = overrides.deliveryCount ?? configuration.deliveryWeekdays.length * weeks;

    return {
        configuration,
        lines: [{ code: 'weekly', label: 'Weekly price', amount: variant.pricePerWeek }],
        weeklyPrice: variant.pricePerWeek,
        discountPercent: option.discountPercent,
        total: option.totalPrice,
        firstDeliveryDate: overrides.firstDeliveryDate ?? configuration.startDate,
        lastDeliveryDate: plusDays(configuration.startDate, weeks * 7 - 1),
        deliveryCount,
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
    });

    it('produces the delivery dates a whole-week configuration implies', () => {
        // Monday, Wednesday, Friday across two weeks from a Monday start: six deliveries.
        const dates = deliveryDatesFor('2026-07-27', [1, 3, 5], 2);
        expect(dates).toEqual([
            '2026-07-27',
            '2026-07-29',
            '2026-07-31',
            '2026-08-03',
            '2026-08-05',
            '2026-08-07',
        ]);
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
    it('asks both dispositive questions before it shows a price', () => {
        expect([...CONFIGURATOR_STEPS]).toEqual([
            'plan',
            'combination',
            'duration',
            'dietary',
            'delivery',
            'meals',
            'summary',
            'confirm',
        ]);
        // Doc 17, SUB-02: allergies (step 4) and delivery area (step 5) both precede the price.
        expect(stepPosition('dietary')).toBeLessThan(stepPosition('summary'));
        expect(stepPosition('delivery')).toBeLessThan(stepPosition('summary'));
    });

    it('marks every step up to the sample week as being before the price', () => {
        expect(isBeforePriceStep('delivery')).toBe(true);
        expect(isBeforePriceStep('meals')).toBe(true);
        expect(isBeforePriceStep('summary')).toBe(false);
        expect(isBeforePriceStep('confirm')).toBe(false);
    });

    it('walks forwards and backwards and stops at both ends', () => {
        expect(previousConfiguratorStep('plan')).toBeNull();
        expect(nextConfiguratorStep('confirm')).toBeNull();
        expect(nextConfiguratorStep('plan')).toBe('combination');
        expect(previousConfiguratorStep('summary')).toBe('meals');
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
    it.each(PLAN_DURATIONS)(
        'derives the same %s total the catalogue publishes for the advertised band',
        (duration: PlanDuration) => {
            const option = durationOption(duration);

            expect(
                discountedTotalMinorUnits(
                    ADVERTISED_VARIANT.pricePerWeek.amount,
                    weeksFor(duration),
                    option.discountPercent,
                ),
            ).toBe(option.totalPrice.amount);
        },
    );

    it('reports the saving as the difference between gross and discounted', () => {
        const gross = grossMinorUnits(47_500, 4);
        expect(gross).toBe(190_000);
        expect(discountedTotalMinorUnits(47_500, 4, 10)).toBe(171_000);
        expect(savingMinorUnits(47_500, 4, 10)).toBe(19_000);
        expect(savingMinorUnits(47_500, 1, 0)).toBe(0);
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

describe('the allergy change (doc 11, DEF-06)', () => {
    const treeNut = TREE_NUT;
    const milk = 'milk' as AllergenCode;

    it('treats an added exclusion as a tightening that needs no ceremony', () => {
        const change = diffAllergens([treeNut], [treeNut, milk]);
        expect(change.added).toEqual([milk]);
        expect(change.removed).toEqual([]);
        expect(change.changed).toBe(true);
        expect(change.relaxed).toBe(false);
    });

    it('flags a removed exclusion as a relaxation, because that is a safety decision', () => {
        const change = diffAllergens([treeNut, milk], [milk]);
        expect(change.removed).toEqual([treeNut]);
        expect(change.relaxed).toBe(true);
    });

    it('reports no change when the sets match, whatever their order', () => {
        const change = diffAllergens([treeNut, milk], [milk, treeNut]);
        expect(change.changed).toBe(false);
        expect(change.relaxed).toBe(false);
    });

    it('reads only the allergy constraints out of a stored profile', () => {
        const constraints: readonly NutritionConstraint[] = [
            {
                kind: 'allergy',
                code: 'tree_nut',
                label: 'tree_nut',
                severity: 'critical',
                source: 'user',
                note: null,
            },
            {
                kind: 'intolerance',
                code: 'milk',
                label: 'milk',
                severity: 'strict',
                source: 'user',
                note: null,
            },
        ];
        expect(storedAllergenCodes(constraints)).toEqual([treeNut]);
        expect(storedAllergenCodes(undefined)).toEqual([]);
    });

    it('reads a diet preference only when the plan can actually cook to it', () => {
        const constraints: readonly NutritionConstraint[] = [
            {
                kind: 'preference',
                code: 'mediterranean',
                label: 'mediterranean',
                severity: 'advisory',
                source: 'user',
                note: null,
            },
        ];
        expect(storedDietClassifications(constraints, ['omnivore', 'mediterranean'])).toEqual([
            'mediterranean',
        ]);
        expect(storedDietClassifications(constraints, ['vegan'])).toEqual([]);
    });
});

describe('step validation', () => {
    function fixture(): {
        readonly state: ConfiguratorState;
        readonly context: StepContext;
    } {
        const state: ConfiguratorState = {
            ...initialConfiguratorState({
                plan: PLAN,
                startDate: '2026-08-03',
                allowedWeekdays: [1, 2, 3, 4, 5, 7],
            }),
            address: COMPLETE_ADDRESS,
            checksAcknowledged: true,
            termsAcknowledged: true,
        };
        const context: StepContext = {
            plan: PLAN,
            allowedWeekdays: [1, 2, 3, 4, 5, 7],
            areaStatus: 'served',
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

    it('will not leave the delivery step until both checks are acknowledged', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, checksAcknowledged: false },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.checks');
    });

    it('will not leave the delivery step on an incomplete address', () => {
        const { state, context } = fixture();
        const issues = validateConfiguratorStep(
            'delivery',
            { ...state, address: EMPTY_ADDRESS },
            context,
        );
        expect(issues).toContain('commerce:configurator.issues.address');
    });

    it('will not confirm without the terms acknowledgement the repository requires', () => {
        const { state, context } = fixture();
        expect(
            validateConfiguratorStep('confirm', { ...state, termsAcknowledged: false }, context),
        ).toEqual(['commerce:configurator.issues.terms']);
    });

    it('makes a later step unreachable while an earlier one is unanswered', () => {
        const { state, context } = fixture();
        const broken = { ...state, deliveryWeekdays: [] };
        expect(isStepReachable('summary', broken, context)).toBe(false);
        expect(isStepReachable('dietary', broken, context)).toBe(true);
        expect(firstIncompleteStep(broken, context)).toBe('delivery');
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
        expect(toConfiguration({ ...base, startDate: null }, PLAN, toDeliveryAddress)).toBeNull();
        expect(
            toConfiguration({ ...base, deliveryWeekdays: [] }, PLAN, toDeliveryAddress),
        ).toBeNull();
    });

    it('derives the same delivery dates the repository will bill for', () => {
        const state: ConfiguratorState = {
            ...initialConfiguratorState({ plan: PLAN, startDate: '2026-08-03' }),
            duration: '1w',
            deliveryWeekdays: [1, 3, 5],
            address: COMPLETE_ADDRESS,
        };
        const configuration = toConfiguration(state, PLAN, toDeliveryAddress);
        expect(configuration).not.toBeNull();

        // Three deliveries from a Monday start, and the first of them is the start date itself.
        // Authored here rather than read back from `configuredDeliveryDates`, so the two really are
        // two answers to the same question.
        const preview = subscriptionPreview(configuration!, {
            deliveryCount: 3,
            firstDeliveryDate: '2026-08-03',
        });

        expect(configuredDeliveryDates(state).length).toBe(preview.deliveryCount);
        expect(configuredDeliveryDates(state)[0]).toBe(preview.firstDeliveryDate);
    });
});

/* ══ pure: warnings and states ═════════════════════════════════════════════════════════════════ */

describe('preview warnings', () => {
    it('has written copy for every code the repository can emit', () => {
        expect(isKnownWarning(CHECKOUT_EMPTY_CART)).toBe(true);
        expect(isKnownWarning(SUBSCRIPTION_DAY_UNAVAILABLE)).toBe(true);
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

function renderCart(basket: Basket, options: { readonly latencyMs?: number } = {}) {
    return renderStubScreen(<CartScreen />, {
        session: testMeResponse(),
        ...(options.latencyMs === undefined ? {} : { latencyMs: options.latencyMs }),
        repositories: { commerce: basketRepository(basket) },
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
        expect(screen.getByTestId('cart-count')).toBeTruthy();
        // Two of a 45.00 meal: the line total is the repository's, and so is the priced total.
        expect(screen.getByTestId(`cart-line-${BASKET_LINE_ID}-total`)).toHaveTextContent(
            'AED 90.00',
        );
        await waitFor(() => {
            expect(screen.getByTestId('cart-price-total-amount')).toHaveTextContent('AED 90.00');
        });
        expect(screen.getByTestId('cart-price-subtotal-amount')).toHaveTextContent('AED 90.00');
        expect(screen.getByTestId('cart-price-no-payment')).toBeTruthy();
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
        await waitFor(() => {
            expect(screen.getByTestId('cart-checkout')).toBeTruthy();
        });
        await fireEvent.press(screen.getByTestId('cart-checkout'));
        expect(routerMock.__push).toHaveBeenCalledWith('/customer/checkout');
    });
});

/* ══ screens: checkout ═════════════════════════════════════════════════════════════════════════ */

interface CheckoutOptions {
    readonly addresses?: readonly CustomerAddress[] | undefined;
    readonly commerce?: Partial<CommerceRepository> | undefined;
}

function renderCheckout(basket: Basket, options: CheckoutOptions = {}) {
    return renderStubScreen(<CheckoutScreen />, {
        session: testMeResponse(),
        repositories: {
            commerce: { ...basketRepository(basket), ...options.commerce },
            account: { listAddresses: async () => options.addresses ?? [] },
            marketplace: { getKitchen: async () => KITCHEN },
        },
    });
}

/** Choose the one saved address and commit the delivery details, which reveals "place order". */
async function reviewCheckout(addressId: string): Promise<void> {
    await fireEvent.press(await screen.findByTestId('checkout-address-picker-trigger'));
    await fireEvent.press(await screen.findByTestId(`checkout-address-picker-option-${addressId}`));
    // Choosing an address re-prices, so the review control goes away and comes back.
    await waitFor(() => {
        expect(screen.getByTestId('checkout-review')).toBeTruthy();
    });
    await act(async () => {
        fireEvent.press(screen.getByTestId('checkout-review'));
    });
    await waitFor(() => {
        expect(screen.getByTestId('checkout-place-order')).toBeTruthy();
    });
}

describe('CheckoutScreen', () => {
    it('says there is nothing to check out when the basket is empty', async () => {
        await renderCheckout(basketOf(0));
        await waitFor(() => {
            expect(screen.getByTestId('checkout-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-browse')).toBeTruthy();
    });

    /**
     * The placement takes an address *identifier*, so a person with nothing saved cannot be given a
     * form to type into — they are sent to the address book, which is the only place that produces
     * one.
     */
    it('sends somebody with no saved address to the address book', async () => {
        await renderCheckout(basketOf(1), { addresses: [] });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-addresses-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-add-address')).toBeTruthy();
    });

    it('picks a saved address and a kitchen window, and never a payment instrument', async () => {
        await renderCheckout(basketOf(1), { addresses: [HOME_ADDRESS] });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-picker')).toBeTruthy();
        });

        expect(screen.getByTestId('checkout-slot-picker')).toBeTruthy();
        expect(screen.getByTestId('checkout-date-field')).toBeTruthy();
        // Cash on delivery, stated on the summary once the basket has been priced.
        expect(await screen.findByTestId('checkout-payment-notice')).toBeTruthy();

        // The property that matters most on this screen is an absence.
        expect(screen.queryByTestId('checkout-card-number')).toBeNull();
        expect(screen.queryByTestId('checkout-payment')).toBeNull();
    });

    it('refuses to review until an address has been chosen', async () => {
        await renderCheckout(basketOf(1), { addresses: [HOME_ADDRESS] });
        await waitFor(() => {
            expect(screen.getByTestId('checkout-review')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-review'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-address-error')).toBeTruthy();
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

        expect(screen.getByTestId('checkout-committed-address')).toBeTruthy();
        expect(screen.getByTestId('checkout-committed-slot')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('checkout-place-order'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('checkout-success-screen')).toBeTruthy();
        });
        expect(screen.getByTestId('checkout-success-reference')).toHaveTextContent('H360-4821');
        // Cash on delivery, said out loud rather than implied by the absence of a receipt.
        expect(screen.getByTestId('checkout-success-cod')).toBeTruthy();

        // The confirmation prices itself from the placed order — the preview query dies with the
        // emptied basket, and a price block fed from there rendered nothing.
        expect(screen.getByTestId('checkout-success-price-subtotal-amount')).toHaveTextContent(
            'AED 45.00',
        );
        expect(screen.getByTestId('checkout-success-price-total-amount')).toHaveTextContent(/\d/);

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
});

/* ══ screens: the configurator ═════════════════════════════════════════════════════════════════ */

interface ConfiguratorOptions {
    readonly plan?: (() => Promise<SubscriptionPlan>) | undefined;
    readonly quote?: SubscriptionQuote | undefined;
    readonly addresses?: readonly CustomerAddress[] | undefined;
    readonly targets?: StoredNutritionTarget | null | undefined;
    readonly commerce?: Partial<CommerceRepository> | undefined;
    readonly latencyMs?: number | undefined;
}

function configuratorRepositories(options: ConfiguratorOptions = {}): RepositoryOverrides {
    return {
        marketplace: {
            getPlan: options.plan ?? (async () => PLAN),
            getKitchen: async () => KITCHEN,
            listMeals: async () => page(MENU_MEALS),
        },
        // The configurator opens on a person's stored restrictions rather than on a blank form.
        nutrition: {
            getCurrentTargets: async () =>
                options.targets === undefined ? STORED_TARGET : options.targets,
        },
        account: { listAddresses: async () => options.addresses ?? [] },
        commerce: {
            getSubscriptionQuote: async () => options.quote ?? testQuote(),
            previewSubscription: async (configuration: SubscriptionConfiguration) =>
                subscriptionPreview(configuration),
            ...options.commerce,
        },
    };
}

function renderConfigurator(
    props: { readonly planId: string | undefined; readonly variantId?: string | undefined },
    options: ConfiguratorOptions = {},
) {
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
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-next'));
        });
    }
}

async function fillAddress(prefix: string, area: string): Promise<void> {
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(`${prefix}-label-input`), 'Home');
        fireEvent.changeText(screen.getByTestId(`${prefix}-line1-input`), 'Apartment 3');
        fireEvent.changeText(screen.getByTestId(`${prefix}-city-input`), 'Dubai');
        fireEvent.changeText(screen.getByTestId(`${prefix}-countryCode-input`), 'AE');
    });
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(`${prefix}-area-input`), area);
    });
}

/** Plan → combination → duration → dietary → delivery → meals → summary → confirm. */
async function walkToConfirmStep(): Promise<void> {
    await waitFor(() => {
        expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
    });

    // 1 plan → 2 combination → 3 duration → 4 dietary → 5 delivery
    await pressNext(4);
    await waitFor(() => {
        expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
    });

    await fillAddress('configurator-address-form', SERVED_AREAS[0]!);
    await waitFor(() => {
        expect(screen.getByTestId('configurator-area-served')).toBeTruthy();
    });
    await act(async () => {
        fireEvent.press(screen.getByTestId('configurator-checks-acknowledge-control'));
    });
    await pressNext(1);

    // 6 the sample week
    await waitFor(() => {
        expect(screen.getByTestId('configurator-step-meals')).toBeTruthy();
    });
    expect(screen.getByTestId('configurator-meals-note')).toBeTruthy();
    await pressNext(1);

    // 7 the first price anybody has seen
    await waitFor(
        () => {
            expect(screen.getByTestId('configurator-price-total-amount')).toBeTruthy();
        },
        { timeout: 5000 },
    );
    expect(screen.getByTestId('configurator-price-per-delivery-amount')).toBeTruthy();
    expect(screen.getByTestId('configurator-summary-checks')).toBeTruthy();
    await pressNext(1);

    // 8 confirm
    await waitFor(() => {
        expect(screen.getByTestId('configurator-step-confirm')).toBeTruthy();
    });
}

describe('SubscriptionConfiguratorScreen', () => {
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

    it('opens on the calorie band, the macro ranges and their variability caveat', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-energy-band')).toBeTruthy();
        expect(screen.getByTestId('configurator-macro-protein')).toBeTruthy();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
        expect(screen.getByTestId('configurator-stepper')).toBeTruthy();
    });

    it('shows no price at all before the summary step, and says why', async () => {
        const harness = await renderConfigurator({ planId: String(PLAN.id) });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-price-later')).toBeTruthy();
        expect(screen.queryByTestId('configurator-price')).toBeNull();
        // Structural, not cosmetic: no configuration reaches the preview before the summary step,
        // so nothing earlier *can* show a price.
        expect(harness.repositories.commerce.previewSubscription).not.toHaveBeenCalled();
    });

    it('opens on the variant the plan page was showing when one is supplied', async () => {
        const light = PLAN.variants[0]!;

        await renderConfigurator({ planId: String(PLAN.id), variantId: String(light.id) });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-energy-band')).toBeTruthy();
        });
        expect(screen.getByTestId(`configurator-variant-${String(light.id)}`)).toBeTruthy();
        // The band on screen is the supplied variant's, not the plan's own default one.
        expect(screen.getByTestId('configurator-energy-band')).toHaveTextContent(/1,400 to 1,600/);
    });

    it('states that the combination and the calorie band are not independent', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(1);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-combination')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-combination-note')).toBeTruthy();
    });

    it('attaches the discount to the duration option itself (doc 17, SUB-05)', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(2);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-duration')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-duration-4w-discount')).toHaveTextContent(
            /10 % off/,
        );
        expect(screen.getByTestId('configurator-duration-4w-total')).toBeTruthy();
        expect(screen.queryByTestId('configurator-price')).toBeNull();
    });

    it('pre-fills the allergies already on the profile, and flags removing one', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(3);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-dietary')).toBeTruthy();
        });

        // The authored profile records one allergy: tree nuts.
        const chip = await waitFor(() => screen.getByTestId(`configurator-allergen-${TREE_NUT}`));
        await act(async () => {
            fireEvent.press(chip);
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-allergen-relaxed')).toBeTruthy();
        });
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
    });

    it('will not leave the delivery step until the two checks are acknowledged', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(4);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-checks')).toBeTruthy();

        await pressNext(1);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-issues')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
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

        await pressNext(4);

        await waitFor(() => {
            expect(screen.getByTestId('configurator-weekdays-limited')).toBeTruthy();
        });
        const saturday = screen.getByTestId('configurator-weekday-6');
        expect(saturday.props.accessibilityState?.disabled ?? saturday.props['aria-disabled']).toBe(
            true,
        );
    });

    it('walks all eight steps and creates a real subscription at the end', async () => {
        const created = testSubscription({ state: 'active' });
        const harness = await renderConfigurator(
            { planId: String(PLAN.id) },
            { commerce: { createSubscription: async () => created } },
        );

        await walkToConfirmStep();

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-confirm-acknowledge-control'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-create'));
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('configurator-success-screen')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.getByTestId('configurator-success-state')).toBeTruthy();

        // What the eight steps actually sent: the configuration the person assembled, the
        // acknowledgement the contract requires, and nothing resembling a payment.
        expect(harness.repositories.commerce.createSubscription).toHaveBeenCalledTimes(1);
        const request = (harness.repositories.commerce.createSubscription as unknown as jest.Mock)
            .mock.calls[0]?.[0] as {
            configuration: SubscriptionConfiguration;
            acknowledgedTerms: boolean;
        };
        expect(request.acknowledgedTerms).toBe(true);
        expect(request.configuration.planId).toBe(PLAN.id);
        expect(request.configuration.address.area).toBe(SERVED_AREAS[0]);
        expect(request.configuration.slotCode).toBe(DEFAULT_SLOT_CODE);
    }, 30_000);

    it('surfaces the checkpoint refusal when the two checks were never acknowledged', async () => {
        await renderConfigurator({ planId: String(PLAN.id) });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(4);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        });

        // Pressing Next without the acknowledgement names the missing answer rather than
        // silently doing nothing, which is the whole point of the checkpoint.
        await pressNext(1);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-issue-checks')).toBeTruthy();
        });
    });

    /**
     * The repository refuses a creation whose summary was never acknowledged. That guard now lives
     * on the server, so what this asserts is the client half: the request is never sent at all.
     */
    it('will not send a creation whose terms summary was never acknowledged', async () => {
        const harness = await renderConfigurator(
            { planId: String(PLAN.id) },
            { commerce: { createSubscription: async () => testSubscription() } },
        );

        await walkToConfirmStep();

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-create'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-issue-terms')).toBeTruthy();
        });
        expect(harness.repositories.commerce.createSubscription).not.toHaveBeenCalled();
        expect(screen.queryByTestId('configurator-success-screen')).toBeNull();
    }, 30_000);
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
    });
});

/**
 * One subscription's world, held in a mutable object the overrides read at call time — so a
 * transition really changes it and the screen's own invalidation is what redraws.
 */
interface SubscriptionWorld {
    subscription: Subscription;
}

function liveWorld(overrides: Partial<Subscription> = {}): SubscriptionWorld {
    return { subscription: testSubscription(overrides) };
}

interface DetailOptions {
    readonly addresses?: readonly CustomerAddress[] | undefined;
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
                account: { listAddresses: async () => options.addresses ?? [] },
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

    it('renders the record, the configuration table and the actions', async () => {
        await renderDetail(liveWorld());

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-name')).toHaveTextContent(PLAN.name);
        });
        expect(screen.getByTestId('subscription-detail-timeline')).toBeTruthy();
        expect(screen.getByTestId('subscription-detail-config-table')).toBeTruthy();
        expect(screen.getByTestId('subscription-detail-next')).toBeTruthy();
        expect(screen.getByTestId('subscription-pause')).toBeTruthy();
        expect(screen.getByTestId('subscription-skip')).toBeTruthy();
        expect(screen.getByTestId('subscription-change-address')).toBeTruthy();
        expect(screen.getByTestId('subscription-change-slot')).toBeTruthy();
        // Resume is not offered from an active subscription: the repository would refuse it.
        expect(screen.queryByTestId('subscription-resume')).toBeNull();
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

        await waitFor(() => {
            expect(screen.getByTestId('subscription-detail-error')).toHaveTextContent(
                /already paused/,
            );
        });
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
