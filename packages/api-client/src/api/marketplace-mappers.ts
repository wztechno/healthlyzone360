import {
    AllergenCode,
    DeliveryZoneId,
    KitchenBranchId,
    KitchenId,
    MealId,
    SALES_CHANNELS,
    isCurrencyCode,
} from '@healthy360/domain-types';
import type {
    DietClassification,
    Money,
    SalesChannel,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { NutritionFacts, Serving } from '@healthy360/nutrition';

import type {
    DeliveryZone,
    Kitchen,
    KitchenBranch,
    KitchenSalesChannels,
    MarketplaceMeal,
    MealAvailability,
    OpeningHours,
} from '../contracts/marketplace.ts';
import type { CursorPage } from '../contracts/pagination.ts';
import type {
    MarketplaceBranch as WireBranch,
    MarketplaceDeliveryZone as WireZone,
    MarketplaceKitchen as WireKitchen,
    MarketplaceListMeta as WireListMeta,
    MarketplaceMeal as WireMeal,
    MarketplaceMoney as WireMoney,
    MarketplaceOpeningHours as WireOpeningHours,
    MarketplaceSalesChannels as WireChannels,
} from '../generated/types.ts';
import { UNKNOWN_ISO_DATE_TIME } from './mappers.ts';

/**
 * Wire (`snake_case`, OpenAPI) → domain (`camelCase`, the marketplace contract).
 *
 * The two are close but not identical, and every place they differ is recorded here rather than
 * papered over. Three of the differences are worth reading before the code.
 *
 * ## 1. Nutrition may be absent, and preview facts are explicitly labelled
 *
 * `MarketplaceMeal.nutrition` is a required `NutritionFacts` and `serving` a required `Serving`,
 * while the API permits both to be `null` until a kitchen records a source. The API demo menu has
 * source-labelled component estimates, so this mapper carries them through unchanged in meaning;
 * their `synthetic_prototype` kind makes the preview status visible in the facts panel. When a
 * record has no facts, {@link NO_NUTRITION_FACTS} remains the honest fallback: an empty amount list
 * with an explicit explanation rather than invented values.
 *
 * ## 2. `LocalisedText` versus one server-chosen name
 *
 * Nothing in this file needs it: every consumer shape carries a single `name` and the server has
 * already chosen the language from `Accept-Language` (§4.8). The *admin* contracts are the ones that
 * need both columns, which is why the two reference families they consume are not switched here.
 *
 * ## 3. Ratings, cuisines, meal types and preparation time
 *
 * All absent server-side, all carried as honest empties by the projection, all mapped straight
 * through. They are not filled in here either.
 */

/**
 * The facts a meal carries when the platform stores none.
 *
 * Every field is chosen so that nothing can be read as a measurement. `amounts` is empty, so no
 * nutrient has a value; `totalGrams` is null; `calculation.method` names the absence rather than a
 * routine; the notes say it in a sentence, and the meal screen renders those notes verbatim.
 *
 * `source.kind` has to be one of five stored values and none of them means "none" — the union
 * belongs to `@healthy360/nutrition` and predates this gap. `synthetic_prototype` is the least
 * wrong: it is the kind every consumer already treats as non-authoritative, and paired with an
 * empty amount list it cannot be mistaken for a figure. The `label` says plainly that there is no
 * source. Widening the union to carry an explicit "unrecorded" kind is an N1 change, made where the
 * real source arrives rather than guessed at here.
 */
export const NO_NUTRITION_FACTS: NutritionFacts = {
    basis: 'per_serving',
    kind: 'planned',
    serving: null,
    totalGrams: null,
    amounts: [],
    source: {
        kind: 'synthetic_prototype',
        label: 'No nutrition source is recorded for this meal.',
        version: '0',
        // Empty on purpose — screens must not format this (see `UNKNOWN_ISO_DATE_TIME`).
        calculatedAt: UNKNOWN_ISO_DATE_TIME,
    },
    calculation: {
        method: 'none.no_recorded_source',
        basis: 'per_serving',
        calculatedAt: UNKNOWN_ISO_DATE_TIME,
        prototype: true,
        rounding: 'none',
        notes: [
            'The platform holds no nutrition figures for this meal. Nothing here is estimated: a ' +
                'figure would have to be invented, and an invented figure is worse than none.',
        ],
    },
};

/**
 * The serving a meal carries when nobody has stated one.
 *
 * A meal is sold as one portion — that much is true of every row on this endpoint by construction —
 * and the mass of that portion is unknown, which `grams: null` says. The label is empty rather than
 * "1 portion" so that a screen printing it shows nothing rather than a phrase the kitchen never
 * wrote.
 */
export const UNSTATED_SERVING: Serving = {
    label: '',
    quantity: 1,
    unit: 'portion',
    grams: null,
    millilitres: null,
    householdMeasure: null,
};

/** Wire serving → the nutrition package's camel-case representation. */
function mapServing(wire: NonNullable<WireMeal['serving']>): Serving {
    return {
        label: wire.label,
        quantity: wire.quantity,
        unit: wire.unit,
        grams: wire.grams,
        millilitres: wire.millilitres,
        householdMeasure: wire.household_measure,
    };
}

/**
 * The API's facts schema intentionally mirrors `@healthy360/nutrition`; this
 * function only converts transport casing and preserves source/prototype
 * metadata so the UI can distinguish an estimate from a verified analysis.
 */
function mapNutritionFacts(wire: NonNullable<WireMeal['nutrition']>): NutritionFacts {
    return {
        basis: wire.basis,
        kind: wire.kind,
        serving: wire.serving === null ? null : mapServing(wire.serving),
        totalGrams: wire.total_grams,
        amounts: wire.amounts.map((amount) => ({
            nutrientId: amount.nutrient_id,
            unit: amount.unit,
            value: amount.value,
            kind: amount.kind,
            tolerance: null,
        })),
        source: {
            kind: wire.source.kind,
            label: wire.source.label,
            version: wire.source.version,
            calculatedAt: wire.source.calculated_at,
        },
        calculation: {
            method: wire.calculation.method,
            basis: wire.calculation.basis,
            calculatedAt: wire.calculation.calculated_at,
            prototype: wire.calculation.prototype,
            rounding: wire.calculation.rounding,
            notes: wire.calculation.notes,
        },
    };
}

/**
 * Wire money → `Money`.
 *
 * The currency is validated rather than asserted: `currency_code` is a three-letter string on the
 * wire and `Money.currency` is a closed union, and a code the client does not know is a real
 * possibility the day a kitchen opens in a new market. Returning `null` lets the caller decide;
 * for a meal's price the caller drops the meal, which is the same rule the server applies to a meal
 * it cannot price.
 */
export function mapMoney(wire: WireMoney | null | undefined): Money | null {
    if (wire === null || wire === undefined) return null;
    if (!isCurrencyCode(wire.currency)) return null;
    return { amount: wire.amount, currency: wire.currency };
}

export function mapSalesChannels(wire: WireChannels): KitchenSalesChannels {
    // Built by walking the domain's own channel list rather than by spreading the wire object, so
    // a switch the server stops sending becomes `false` here instead of `undefined` in a boolean.
    const channels = {} as Record<SalesChannel, boolean>;
    for (const channel of SALES_CHANNELS) {
        channels[channel] = wire[channel] === true;
    }
    return channels;
}

export function mapDeliveryZone(wire: WireZone): DeliveryZone {
    return {
        id: DeliveryZoneId.unsafe(wire.id),
        name: wire.name,
        area: wire.area,
        countryCode: wire.country_code,
        deliveryFee: mapMoney(wire.delivery_fee),
        minimumOrder: mapMoney(wire.minimum_order),
        estimatedMinutes: wire.estimated_minutes,
    };
}

export function mapOpeningHours(wire: WireOpeningHours): OpeningHours {
    return {
        weekday: wire.weekday,
        opensAt: wire.opens_at,
        closesAt: wire.closes_at,
        orderCutOffAt: wire.order_cut_off_at,
    };
}

export function mapKitchenBranch(wire: WireBranch): KitchenBranch {
    return {
        id: KitchenBranchId.unsafe(wire.id),
        kitchenId: KitchenId.unsafe(wire.kitchen_id),
        name: wire.name,
        area: wire.area,
        countryCode: wire.country_code,
        timeZone: wire.time_zone,
        deliveryZones: wire.delivery_zones.map(mapDeliveryZone),
        openingHours: wire.opening_hours.map(mapOpeningHours),
        supportsPickup: wire.supports_pickup,
        isActive: wire.is_active,
    };
}

export function mapKitchen(wire: WireKitchen): Kitchen {
    const windows = (
        wire as WireKitchen & {
            readonly delivery_windows?: readonly {
                readonly code: string;
                readonly label: string;
                readonly starts_at: string;
                readonly ends_at: string;
                readonly weekdays: readonly number[];
            }[];
        }
    ).delivery_windows;

    return {
        id: KitchenId.unsafe(wire.id),
        name: wire.name,
        slug: wire.slug,
        tagline: wire.tagline,
        description: wire.description,
        countryCode: wire.country_code,
        cuisines: wire.cuisines,
        dietClassifications: wire.diet_classifications as readonly DietClassification[],
        channels: mapSalesChannels(wire.channels),
        branches: wire.branches.map(mapKitchenBranch),
        deliveryWindows: (windows ?? []).map((window) => ({
            code: window.code,
            label: window.label,
            startsAt: window.starts_at,
            endsAt: window.ends_at,
            weekdays: window.weekdays,
        })),
        rating: wire.rating,
        ratingCount: wire.rating_count,
        imagePlaceholderId: wire.image_placeholder_id,
        isVerified: wire.is_verified,
    };
}

export function mapMealAvailability(wire: {
    date: string;
    available: boolean;
    remaining: number | null;
    order_cut_off_at: string | null;
}): MealAvailability {
    return {
        date: wire.date,
        available: wire.available,
        remaining: wire.remaining,
        orderCutOffAt: wire.order_cut_off_at,
    };
}

/**
 * Wire meal → `MarketplaceMeal`, or `null` when the price is unusable.
 *
 * The only way to reach `null` is a currency this client does not recognise. Dropping the meal is
 * the same decision the server makes about a meal it cannot price, applied to the one failure the
 * server cannot see: a `Money` whose currency the domain union does not carry cannot be formatted,
 * and a price that cannot be formatted must not reach a buy button.
 */
export function mapMarketplaceMeal(wire: WireMeal): MarketplaceMeal | null {
    const price = mapMoney(wire.price);
    if (price === null) return null;

    const nutrition =
        wire.nutrition === null ? NO_NUTRITION_FACTS : mapNutritionFacts(wire.nutrition);
    const serving = wire.serving === null ? UNSTATED_SERVING : mapServing(wire.serving);

    return {
        id: MealId.unsafe(wire.id),
        kitchenId: KitchenId.unsafe(wire.kitchen_id),
        kitchenName: wire.kitchen_name,
        // Faithful for the four known kinds; an unknown future kind renders
        // as a meal rather than crashing a listing page.
        itemType:
            wire.item_type === 'product' ||
            wire.item_type === 'sauce' ||
            wire.item_type === 'dressing'
                ? wire.item_type
                : 'meal',
        publishedCategory: wire.published_category
            ? { code: wire.published_category.code, name: wire.published_category.name }
            : null,
        name: wire.name,
        slug: wire.slug,
        description: wire.description,
        mealTypes: wire.meal_types as MarketplaceMeal['mealTypes'],
        dietClassifications: wire.diet_classifications as readonly DietClassification[],
        cuisines: wire.cuisines,
        // Parsed rather than branded blind: an allergen code is a regulatory identity, and a code
        // this build does not recognise must not silently become one it does. `safeParse` drops it,
        // which is the safe direction only because the *server* is the authority on what a meal
        // contains and a client that cannot name a code cannot filter on it either.
        allergens: wire.allergens
            .map((code) => AllergenCode.safeParse(code))
            .filter((code): code is AllergenCode => code !== null),
        serving,
        nutrition,
        price,
        preparationMinutes: wire.preparation_minutes,
        imagePlaceholderId: wire.image_placeholder_id,
        availability: wire.availability.map(mapMealAvailability),
        channels: mapSalesChannels(wire.channels),
        rating: wire.rating,
        ratingCount: wire.rating_count,
    };
}

/**
 * `data` + `meta` → `CursorPage`.
 *
 * `totalCount` is **null**, always, and that is the wire telling the truth rather than the mapper
 * losing information: the marketplace pages a keyset, which cannot know a total without a second
 * count that would disagree with the page under concurrent writes. The contract reserves `null`
 * for exactly that, and every consumer already handles it.
 */
export function mapCursorPage<TWire, TDomain>(
    data: readonly TWire[],
    meta: WireListMeta,
    map: (wire: TWire) => TDomain | null,
): CursorPage<TDomain> {
    const items: TDomain[] = [];
    for (const wire of data) {
        const mapped = map(wire);
        if (mapped !== null) items.push(mapped);
    }

    return {
        items,
        nextCursor: meta.next_cursor,
        hasMore: meta.has_more,
        totalCount: null,
    };
}

/** Identifiers a caller may pass straight to a path. Slugs and UUIDs are both accepted server-side. */
export function pathSegment(id: KitchenId | MealId | SubscriptionPlanId | string): string {
    return encodeURIComponent(String(id));
}

/**
 * A comma-separated query parameter, or nothing.
 *
 * The marketplace endpoints read list filters as one comma-separated value rather than as repeated
 * keys, which is what the OpenAPI document says and what the controllers parse.
 */
export function listParameter(values: readonly string[] | undefined): string | undefined {
    if (values === undefined || values.length === 0) return undefined;
    return values.join(',');
}
