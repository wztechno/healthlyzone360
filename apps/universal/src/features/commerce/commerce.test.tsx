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
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';

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
import {
    CONFIGURATOR_STEPS,
    combinationKey,
    configuredDeliveryDates,
    diffAllergens,
    discountedTotalMinorUnits,
    firstIncompleteStep,
    grossMinorUnits,
    initialConfiguratorState,
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
    it('is three steps, and settles delivery and allergies before the review', () => {
        expect([...CONFIGURATOR_STEPS]).toEqual(['plan', 'delivery', 'review']);
        // Doc 17, SUB-02: the area and the allergies are both answered before anything is created.
        expect(stepPosition('delivery')).toBeLessThan(stepPosition('review'));
    });

    it('walks forwards and backwards and stops at both ends', () => {
        expect(previousConfiguratorStep('plan')).toBeNull();
        expect(nextConfiguratorStep('review')).toBeNull();
        expect(nextConfiguratorStep('plan')).toBe('delivery');
        expect(previousConfiguratorStep('review')).toBe('delivery');
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
            // A saved address is the only way the address requirement is met (plans-02).
            hasSavedAddress: true,
            earliestStartDate: '2026-07-31',
            storedAllergens: [],
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

    it('asks for an acknowledgement only when an allergy from the profile is dropped', () => {
        const { state, context } = fixture();
        const unacknowledged = { ...state, checksAcknowledged: false };
        // Nothing dropped: nothing to acknowledge.
        expect(validateConfiguratorStep('delivery', unacknowledged, context)).toEqual([]);
        // The profile excludes tree nuts and this subscription would not.
        const relaxed = { ...context, storedAllergens: [TREE_NUT] };
        expect(validateConfiguratorStep('delivery', unacknowledged, relaxed)).toContain(
            'commerce:configurator.issues.checks',
        );
        expect(validateConfiguratorStep('delivery', state, relaxed)).toEqual([]);
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
        expect(screen.getByTestId('checkout-success-total-amount')).toHaveTextContent('AED 60.00');
        expect(screen.getByTestId('checkout-success-items')).toHaveTextContent(
            new RegExp(BASKET_MEAL.name),
        );

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

/* ══ screens: the configurator ═════════════════════════════════════════════════════════════════ */

interface ConfiguratorOptions {
    readonly plan?: (() => Promise<SubscriptionPlan>) | undefined;
    readonly quote?: SubscriptionQuote | undefined;
    readonly addresses?: readonly CustomerAddress[] | undefined;
    readonly targets?: StoredNutritionTarget | null | undefined;
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
            listMeals: async () => page(MENU_MEALS),
        },
        // The configurator opens on a person's stored restrictions rather than on a blank form.
        nutrition: {
            getCurrentTargets: async () =>
                options.targets === undefined ? STORED_TARGET : options.targets,
        },
        account: {
            listAddresses: async () => options.addresses ?? [],
            getChecklist: async () => options.checklist ?? READY_CHECKLIST,
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

/**
 * Plan → delivery → review, for a person with one saved address in a served area — which the
 * delivery step chooses on its own, as the checkout does (HA-22).
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
    });

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
            expect(screen.getByTestId('configurator-duration-4w')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-duration-4w')).toHaveTextContent(/10% off/);
    });

    it('pre-fills the allergies already on the profile, and gates removing one', async () => {
        await renderConfigurator({ planId: String(PLAN.id) }, { addresses: [HOME_ADDRESS] });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });

        await pressNext(1);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();
        });

        // The authored profile records one allergy: tree nuts.
        const chip = await waitFor(() => screen.getByTestId(`configurator-allergen-${TREE_NUT}`));
        await act(async () => {
            fireEvent.press(chip);
        });

        await waitFor(() => {
            expect(screen.getByTestId('configurator-allergen-relaxed')).toBeTruthy();
        });

        // Dropping a recorded allergy has to be acknowledged before the flow moves on.
        await pressNext(1);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-issue-checks')).toBeTruthy();
        });
        expect(screen.getByTestId('configurator-step-delivery')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-checks-acknowledge-control'));
        });
        await pressNext(1);
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-review')).toBeTruthy();
        });
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

    it('goes back to a step from its Edit on the review', async () => {
        await renderConfigurator({ planId: String(PLAN.id) }, { addresses: [HOME_ADDRESS] });

        await walkToReviewStep();

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-review-plan-edit'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('configurator-step-plan')).toBeTruthy();
        });
        // Edit is a step of its own in history, like Continue: Back returns to the review.
        const opened = routerMock.__push.mock.calls.at(-1)?.[0] as string;
        expect(pathnameOf(opened)).toBe(CONFIGURATOR_PATH);
        expect(queryOf(opened)['step']).toBeUndefined();
    }, 30_000);

    it('walks the three steps and creates a real subscription at the end', async () => {
        const created = testSubscription({ state: 'active' });
        const harness = await renderConfigurator(
            { planId: String(PLAN.id) },
            {
                addresses: [HOME_ADDRESS],
                commerce: { createSubscription: async () => created },
            },
        );

        await walkToReviewStep();
        expect(screen.getByTestId('medical-disclaimer')).toBeTruthy();
        expect(screen.getByTestId('configurator-summary-address')).toHaveTextContent(
            /12 Sunset Street/,
        );

        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-confirm-acknowledge-control'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('configurator-create'));
        });

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

        // What the three steps actually sent: the configuration the person assembled, the saved
        // address it is delivered to, the acknowledgement the contract requires, and nothing
        // resembling a payment.
        expect(harness.repositories.commerce.createSubscription).toHaveBeenCalledTimes(1);
        const request = (harness.repositories.commerce.createSubscription as unknown as jest.Mock)
            .mock.calls[0]?.[0] as {
            configuration: SubscriptionConfiguration;
            acknowledgedTerms: boolean;
            addressId?: string;
        };
        expect(request.acknowledgedTerms).toBe(true);
        expect(request.addressId).toBe(HOME_ADDRESS.id);
        expect(request.configuration.planId).toBe(PLAN.id);
        expect(request.configuration.address.area).toBe(HOME_ADDRESS.areaName);
        expect(request.configuration.slotCode).toBe(DEFAULT_SLOT_CODE);
        // The set-up is spent: its draft is gone.
        expect(configuratorDrafts.read(configuratorDraftKey(String(PLAN.id)))).toBeNull();
    }, 30_000);

    /**
     * The repository refuses a creation whose summary was never acknowledged. That guard now lives
     * on the server, so what this asserts is the client half: the request is never sent at all.
     */
    it('will not send a creation whose terms were never acknowledged', async () => {
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
    const at = (step: 'plan' | 'delivery' | 'review', address: string | undefined) =>
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
                duration: '4w',
                slotCode: 'evening',
                deliveryWeekdays: [1, 3, 9],
                excludeAllergens: ['tree_nut'],
                termsAcknowledged: true,
                variantId: 'from-somewhere',
            }),
        ).toEqual({ duration: '4w', slotCode: 'evening', excludeAllergens: ['tree_nut'] });
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
