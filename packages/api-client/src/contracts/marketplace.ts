import type {
    AllergenCode,
    DeliveryZoneId,
    DietClassification,
    DietitianId,
    IsoDateTime,
    KitchenBranchId,
    KitchenId,
    Locale,
    MealId,
    MealType,
    Money,
    PlanDuration,
    PlanVariantId,
    SalesChannel,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { NutritionFacts, Serving } from '@healthy360/nutrition';

import type {
    CursorPage,
    CursorPageRequest,
    NumericRangeFilter,
    SortDirection,
} from './pagination.ts';

/**
 * The public marketplace contract (Prompt 2, "Public marketplace").
 *
 * **Proposed, not implemented.** No backend endpoint behind this exists yet; the drafts in
 * `docs/api/proposed/marketplace.v1.draft.yaml` are the wire counterpart. A screen depends on this
 * interface, gets the mock world today and the API repository later, and does not change.
 *
 * One rule runs through the whole module: **consumer-facing shapes carry consumer prices only.**
 * There is no field here for a negotiated contract price, a volume tier or a minimum order — those
 * live in `./business.ts`, behind a contract the consumer screens never import. Privacy by absence
 * is the only version of this that survives a refactor.
 */

export interface DeliveryZone {
    readonly id: DeliveryZoneId;
    readonly name: string;
    /** Free-form area label, e.g. `Jumeirah 1`. Geometry is a backend concern. */
    readonly area: string;
    readonly countryCode: string;
    readonly deliveryFee: Money | null;
    readonly minimumOrder: Money | null;
    /** Minutes from order to delivery, as advertised. */
    readonly estimatedMinutes: number | null;
}

export interface OpeningHours {
    /** `1` is Monday, per ISO 8601. */
    readonly weekday: number;
    /** `HH:mm`, kitchen-local. `null`/`null` means closed that day. */
    readonly opensAt: string | null;
    readonly closesAt: string | null;
    /** Last time an order for the same day is accepted, `HH:mm`. */
    readonly orderCutOffAt: string | null;
}

export interface KitchenBranch {
    readonly id: KitchenBranchId;
    readonly kitchenId: KitchenId;
    readonly name: string;
    readonly area: string;
    readonly countryCode: string;
    readonly timeZone: string;
    readonly deliveryZones: readonly DeliveryZone[];
    readonly openingHours: readonly OpeningHours[];
    readonly supportsPickup: boolean;
    readonly isActive: boolean;
}

/** A named delivery slot the kitchen publishes for checkout. */
export interface KitchenDeliveryWindow {
    readonly code: string;
    /** Localised label from the server (`Accept-Language`). */
    readonly label: string;
    /** `HH:mm`, kitchen-local. */
    readonly startsAt: string;
    readonly endsAt: string;
    /**
     * ISO weekdays the window runs on (1 = Monday … 7 = Sunday).
     * Empty means every day.
     */
    readonly weekdays: readonly number[];
}

/**
 * Which channels a kitchen is configured for. Eight independent switches rather than a single
 * "type", because a kitchen that delivers to consumers and also fulfils corporate contracts is the
 * normal case, not an exception.
 */
export type KitchenSalesChannels = Readonly<Record<SalesChannel, boolean>>;

export interface Kitchen {
    readonly id: KitchenId;
    readonly name: string;
    readonly slug: string;
    readonly tagline: string;
    readonly description: string;
    readonly countryCode: string;
    readonly cuisines: readonly string[];
    readonly dietClassifications: readonly DietClassification[];
    readonly channels: KitchenSalesChannels;
    readonly branches: readonly KitchenBranch[];
    /** Active delivery slots published by the kitchen for checkout pickers. */
    readonly deliveryWindows: readonly KitchenDeliveryWindow[];
    /** Average of published ratings, 0–5, or `null` when too few have been left. */
    readonly rating: number | null;
    readonly ratingCount: number;
    /** Generated placeholder identifier — never a remote image URL. */
    readonly imagePlaceholderId: string;
    readonly isVerified: boolean;
}

export interface MealAvailability {
    /** `YYYY-MM-DD`. */
    readonly date: string;
    readonly available: boolean;
    /** `null` when the kitchen does not publish remaining stock. */
    readonly remaining: number | null;
    readonly orderCutOffAt: IsoDateTime | null;
}

export interface MarketplaceMeal {
    readonly id: MealId;
    readonly kitchenId: KitchenId;
    readonly kitchenName: string;
    /** Prepared meal or sellable product (sauce, frozen pack, and so on). */
    readonly itemType: 'meal' | 'product';
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly mealTypes: readonly MealType[];
    readonly dietClassifications: readonly DietClassification[];
    readonly cuisines: readonly string[];
    readonly allergens: readonly AllergenCode[];
    readonly serving: Serving;
    /** Per-serving facts. Always carries its own source and calculation timestamp. */
    readonly nutrition: NutritionFacts;
    /** The consumer price. B2B pricing is deliberately not representable here. */
    readonly price: Money;
    readonly preparationMinutes: number | null;
    readonly imagePlaceholderId: string;
    readonly availability: readonly MealAvailability[];
    readonly channels: KitchenSalesChannels;
    readonly rating: number | null;
    readonly ratingCount: number;
}

export interface PlanVariant {
    readonly id: PlanVariantId;
    readonly planId: SubscriptionPlanId;
    readonly name: string;
    /** Advertised energy band, kcal per day. */
    readonly energyRange: { readonly min: number; readonly max: number };
    readonly proteinRange: { readonly min: number; readonly max: number } | null;
    readonly carbohydrateRange: { readonly min: number; readonly max: number } | null;
    readonly fatRange: { readonly min: number; readonly max: number } | null;
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    readonly pricePerWeek: Money;
}

export interface PlanDurationOption {
    readonly duration: PlanDuration;
    /** Whole percent off the weekly price, `0` when none is offered. */
    readonly discountPercent: number;
    /**
     * The whole-run price, when the platform can state one figure for the plan.
     *
     * `null` for a plan with more than one active configuration: its variants carry different
     * weekly prices, so a single plan-level total would be a figure no kitchen quoted. A consumer
     * of this shape derives the total for the variant actually in front of the person —
     * `pricePerWeek × weeks × (1 − discount)` — which is what the configurator and the catalogue
     * both do.
     */
    readonly totalPrice: Money | null;
}

export interface SubscriptionPlan {
    readonly id: SubscriptionPlanId;
    readonly kitchenId: KitchenId;
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
    readonly description: string;
    readonly categorySlugs: readonly string[];
    readonly dietClassifications: readonly DietClassification[];
    readonly variants: readonly PlanVariant[];
    readonly durations: readonly PlanDurationOption[];
    /** A representative week, for the "sample menu" panel. */
    readonly sampleMealIds: readonly MealId[];
    readonly imagePlaceholderId: string;
    readonly rating: number | null;
    readonly ratingCount: number;
}

export interface DietCategory {
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly classification: DietClassification | null;
    readonly planCount: number;
    readonly mealCount: number;
    readonly imagePlaceholderId: string;
}

export interface Dietitian {
    readonly id: DietitianId;
    readonly displayName: string;
    readonly headline: string;
    readonly biography: string;
    /** Registration body and number as published by the professional; never inferred. */
    readonly credentials: readonly string[];
    readonly specialisms: readonly string[];
    readonly locales: readonly Locale[];
    readonly countryCode: string;
    readonly kitchenIds: readonly KitchenId[];
    readonly acceptingClients: boolean;
    readonly imagePlaceholderId: string;
    readonly rating: number | null;
    readonly ratingCount: number;
}

/* ------------------------------------------------------------------------------------------------
 * Filters
 * ---------------------------------------------------------------------------------------------- */

export const MEAL_SORTS = [
    'relevance',
    'price',
    'energy',
    'protein',
    'rating',
    'preparation_time',
] as const;
export type MealSort = (typeof MEAL_SORTS)[number];

export interface KitchenFilter extends CursorPageRequest {
    readonly query?: string | undefined;
    readonly countryCode?: string | undefined;
    readonly area?: string | undefined;
    readonly cuisines?: readonly string[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    /** Only kitchens configured for these channels. Consumer screens pass `marketplace`/`b2c`. */
    readonly channels?: readonly SalesChannel[] | undefined;
    readonly deliversToZoneId?: DeliveryZoneId | undefined;
}

export interface MealFilter extends CursorPageRequest {
    readonly query?: string | undefined;
    readonly kitchenIds?: readonly KitchenId[] | undefined;
    /** Restrict to `meal`, `product`, or both. Omit for both. */
    readonly itemTypes?: readonly ('meal' | 'product')[] | undefined;
    readonly mealTypes?: readonly MealType[] | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly cuisines?: readonly string[] | undefined;
    /** Meals containing any of these allergens are excluded. */
    readonly excludeAllergens?: readonly AllergenCode[] | undefined;
    readonly energy?: NumericRangeFilter | undefined;
    readonly protein?: NumericRangeFilter | undefined;
    readonly carbohydrate?: NumericRangeFilter | undefined;
    readonly fat?: NumericRangeFilter | undefined;
    /** Price in minor units of the caller's currency. */
    readonly price?: NumericRangeFilter | undefined;
    readonly preparationMinutes?: NumericRangeFilter | undefined;
    /** `YYYY-MM-DD` — only meals orderable that day. */
    readonly availableOn?: string | undefined;
    readonly sort?: MealSort | undefined;
    readonly direction?: SortDirection | undefined;
}

export interface PlanFilter extends CursorPageRequest {
    readonly query?: string | undefined;
    readonly kitchenIds?: readonly KitchenId[] | undefined;
    readonly categorySlug?: string | undefined;
    readonly dietClassifications?: readonly DietClassification[] | undefined;
    readonly energy?: NumericRangeFilter | undefined;
    readonly duration?: PlanDuration | undefined;
    readonly mealsPerDay?: number | undefined;
}

export interface DietitianFilter extends CursorPageRequest {
    readonly query?: string | undefined;
    readonly specialism?: string | undefined;
    readonly locale?: Locale | undefined;
    readonly countryCode?: string | undefined;
    readonly acceptingClients?: boolean | undefined;
}

/**
 * Everything the anonymous marketplace can read. Nothing here needs a session, which is why it is
 * the one contract whose data may be cached across a sign-out.
 */
export interface MarketplaceRepository {
    listKitchens(filter?: KitchenFilter): Promise<CursorPage<Kitchen>>;
    /** Rejects with `resource.not_found` for an unknown or unpublished kitchen. */
    getKitchen(kitchenId: KitchenId): Promise<Kitchen>;

    listMeals(filter?: MealFilter): Promise<CursorPage<MarketplaceMeal>>;
    getMeal(mealId: MealId): Promise<MarketplaceMeal>;

    listPlans(filter?: PlanFilter): Promise<CursorPage<SubscriptionPlan>>;
    getPlan(planId: SubscriptionPlanId): Promise<SubscriptionPlan>;

    listDietitians(filter?: DietitianFilter): Promise<CursorPage<Dietitian>>;
    getDietitian(dietitianId: DietitianId): Promise<Dietitian>;

    /** The diet-category navigation. Small and stable, so it is not paginated. */
    listDietCategories(): Promise<readonly DietCategory[]>;
}
