import { minorUnitExponent, money } from '@healthy360/domain-types';
import type {
    CurrencyCode,
    DeliveryZoneId,
    IngredientId,
    KitchenBranchId,
    KitchenId,
    MealId,
    Money,
    OrganisationId,
    PriceListId,
    ProductId,
    RecipeId,
    RecipeVersionId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { IngredientQuantity, MeasureUnit, Serving } from '@healthy360/nutrition';

import type { Recipe } from '../../contracts/foods.ts';
import type {
    AdminEntityMeta,
    AdminRecordMeta,
    BranchOperatingDay,
    ChannelAvailability,
    CostAmount,
    DeliveryWindow,
    IngredientAllergenMapping,
    LocalisedText,
    MealAvailabilityDay,
    PlanCombination,
    PlanDurationAdmin,
    PlanVariantAdmin,
    PriceListEntry,
    ProductPackVariant,
    RecipeAllergenDeclaration,
    RecipeLine,
    RecipeOutput,
    RecipeStepAdmin,
    ServiceArea,
} from '../../contracts/kitchen-admin.ts';
import { COST_DECIMAL_PLACES } from '../../contracts/kitchen-admin.ts';
import type {
    DeliveryZone,
    KitchenBranch,
    MarketplaceMeal,
    OpeningHours,
    SubscriptionPlan,
} from '../../contracts/marketplace.ts';
import { instantAt } from './constants.ts';
import type { PrototypeIngredient } from './fixtures/index.ts';

/**
 * The mutable catalogue world's record shapes, and the projections that turn them back into what a
 * consumer sees.
 *
 * ## Why every record carries its consumer projection
 *
 * The alternative — deriving `MarketplaceMeal` from `StoredMeal` on every read — sounds cleaner and
 * is a trap. The fixture world's consumer objects are the product of a *lot* of derivation (a meal's
 * facts are its recipe's per-serving facts scaled by a portion factor, its price is an ingredient
 * cost times a kitchen margin rounded to the nearest half-dirham), and re-deriving them at read time
 * would mean this refactor had to reproduce all of it exactly or silently change what forty screens
 * and two hundred assertions see.
 *
 * So the seed keeps the fixture object verbatim, and a *write* rebuilds only the fields it touched.
 * Behaviour today is identical by construction; behaviour after an admin edit is honest because the
 * edit is what changes the projection.
 *
 * ## Bilingual fields in an English fixture set
 *
 * The synthetic fixtures are authored in English. `ar` therefore mirrors `en` on every seeded row.
 * That is not a translation and is not presented as one: it is what an untranslated record looks
 * like, it is exactly what the readiness evaluator will one day refuse to publish, and it gives the
 * bilingual editor something real to correct. No Arabic string in this world is machine-translated.
 */

/** English text with the Arabic side mirrored — see the note above. */
export function untranslated(text: string): LocalisedText {
    return { en: text, ar: text };
}

/** Rounds a cost to the documented scale. Costs are major units, never minor (plan §4.4). */
export function roundCost(amount: number): number {
    const factor = 10 ** COST_DECIMAL_PLACES;
    return Math.round(amount * factor) / factor;
}

/** `Money` (minor units) → `CostAmount` (major units). The one place the two meet. */
export function costFromMoney(value: Money): CostAmount {
    return {
        amount: roundCost(value.amount / 10 ** minorUnitExponent(value.currency)),
        currency: value.currency,
    };
}

export function costAmount(amount: number, currency: CurrencyCode): CostAmount {
    return { amount: roundCost(amount), currency };
}

/** Sums costs that share a currency. `null` as soon as one contribution is unknown. */
export function sumCostAmounts(costs: readonly (CostAmount | null)[]): CostAmount | null {
    if (costs.length === 0) return null;
    let total = 0;
    let currency: CurrencyCode | null = null;
    for (const cost of costs) {
        if (cost === null) return null;
        currency ??= cost.currency;
        if (cost.currency !== currency) return null;
        total += cost.amount;
    }
    return currency === null ? null : costAmount(total, currency);
}

/**
 * How many grams a quantity is, for the roll-up.
 *
 * `null` — not zero — when the unit cannot be converted without knowing something this world does
 * not know. A silent zero would produce a nutrition label that is confidently wrong, which is the
 * one outcome the whole nutrition package exists to prevent.
 */
export function gramsFor(
    ingredient: PrototypeIngredient,
    quantity: number,
    unit: MeasureUnit,
): number | null {
    if (!Number.isFinite(quantity) || quantity < 0) return null;
    switch (unit) {
        case 'g':
            return quantity;
        case 'kg':
            return quantity * 1000;
        case 'piece':
        case 'slice':
        case 'portion':
        case 'cup': {
            const serving = servingForUnit(ingredient, unit);
            return serving?.grams === undefined || serving.grams === null
                ? null
                : quantity * serving.grams;
        }
        // Volume and spoon measures need a density this data set does not carry.
        case 'ml':
        case 'l':
        case 'tbsp':
        case 'tsp':
        default:
            return null;
    }
}

function servingForUnit(ingredient: PrototypeIngredient, unit: MeasureUnit): Serving | undefined {
    return (
        ingredient.servings.find((serving) => serving.unit === unit) ??
        ingredient.servings.find((serving) => serving.unit === 'portion')
    );
}

/* ------------------------------------------------------------------------------------------------
 * Stored records
 * ---------------------------------------------------------------------------------------------- */

export interface StoredIngredient {
    readonly id: IngredientId;
    meta: AdminEntityMeta;
    name: LocalisedText;
    reference: string | null;
    categoryCode: string;
    measurementUnit: MeasureUnit;
    costPer100g: CostAmount | null;
    allergens: IngredientAllergenMapping[];
    aliases: string[];
    notes: string | null;
    /** `null` for the shared platform library; set once a kitchen owns the row. */
    organisationId: OrganisationId | null;
    /** The fixture record the consumer surfaces already read. Rebuilt on a write. */
    consumer: PrototypeIngredient;
}

export interface StoredRecipeVersion {
    readonly id: RecipeVersionId;
    readonly versionNumber: number;
    status: 'draft' | 'review_required' | 'published' | 'retired';
    yieldQuantity: number;
    yieldUnit: MeasureUnit;
    yieldPieces: number | null;
    wastePercent: number;
    lines: RecipeLine[];
    outputs: RecipeOutput[];
    steps: RecipeStepAdmin[];
    allergens: RecipeAllergenDeclaration[];
    estimatedCost: CostAmount | null;
    derivationStale: boolean;
    publishedAt: string | null;
    /** What `foods.getRecipe` hands back for this version. */
    consumer: Recipe;
}

export interface StoredRecipe {
    readonly id: RecipeId;
    meta: AdminEntityMeta;
    name: LocalisedText;
    slug: string;
    description: LocalisedText;
    kitchenId: KitchenId | null;
    versions: StoredRecipeVersion[];
    currentVersionId: RecipeVersionId;
}

export interface StoredProduct {
    readonly id: ProductId;
    meta: AdminEntityMeta;
    name: LocalisedText;
    description: LocalisedText;
    categoryCode: string;
    kitchenId: KitchenId;
    isMarketPriced: boolean;
    isAssorted: boolean;
    packVariants: ProductPackVariant[];
    channelAvailability: ChannelAvailability[];
    recipeId: RecipeId | null;
    dataQualityFlags: string[];
}

export interface StoredPriceList {
    readonly id: PriceListId;
    meta: AdminEntityMeta;
    name: LocalisedText;
    currency: CurrencyCode;
    kitchenId: KitchenId;
    channels: ChannelAvailability['channel'][];
    entries: PriceListEntry[];
}

export interface StoredMeal {
    readonly id: MealId;
    meta: AdminEntityMeta;
    name: LocalisedText;
    description: LocalisedText;
    kitchenId: KitchenId;
    recipeId: RecipeId | null;
    recipeVersionId: RecipeVersionId | null;
    portionFactor: number;
    channelAvailability: ChannelAvailability[];
    availability: MealAvailabilityDay[];
    marginPercent: number | null;
    consumer: MarketplaceMeal;
}

export interface StoredPlan {
    readonly id: SubscriptionPlanId;
    meta: AdminEntityMeta;
    name: LocalisedText;
    summary: LocalisedText;
    description: LocalisedText;
    kitchenId: KitchenId;
    variants: PlanVariantAdmin[];
    durations: PlanDurationAdmin[];
    combinations: PlanCombination[];
    changeCutOffHours: number;
    deliveryWeekdays: number[];
    consumer: SubscriptionPlan;
}

export interface StoredZone {
    readonly id: DeliveryZoneId;
    meta: AdminEntityMeta;
    name: LocalisedText;
    kitchenId: KitchenId;
    branchIds: KitchenBranchId[];
    areaIds: string[];
    deliveryFeeMinor: number | null;
    minimumOrderMinor: number | null;
    currency: CurrencyCode;
    estimatedMinutes: number | null;
    deliveryWindows: DeliveryWindow[];
    /** What a consumer sees on a branch. Rebuilt on a write. */
    consumer: DeliveryZone;
}

export interface StoredBranchOperating {
    readonly branchId: KitchenBranchId;
    meta: AdminRecordMeta;
    timeZone: string;
    days: BranchOperatingDay[];
}

/* ------------------------------------------------------------------------------------------------
 * Projections back onto the consumer contract
 * ---------------------------------------------------------------------------------------------- */

/** A stored zone as a branch publishes it. */
export function projectZone(
    stored: StoredZone,
    areas: ReadonlyMap<string, ServiceArea>,
): DeliveryZone {
    const firstAreaId = stored.areaIds[0];
    const area = firstAreaId === undefined ? undefined : areas.get(firstAreaId);
    return {
        id: stored.id,
        name: stored.name.en,
        area: area?.name.en ?? '',
        countryCode: area?.countryCode ?? stored.consumer.countryCode,
        deliveryFee:
            stored.deliveryFeeMinor === null
                ? null
                : money(stored.deliveryFeeMinor, stored.currency),
        minimumOrder:
            stored.minimumOrderMinor === null
                ? null
                : money(stored.minimumOrderMinor, stored.currency),
        estimatedMinutes: stored.estimatedMinutes,
    };
}

/** Branch operating rows as the consumer contract's weekly opening hours. */
export function projectOpeningHours(stored: StoredBranchOperating): readonly OpeningHours[] {
    return stored.days.map((day) => ({
        weekday: day.weekday,
        opensAt: day.opensAt,
        closesAt: day.closesAt,
        orderCutOffAt: day.orderCutOffAt,
    }));
}

/** Consumer opening hours as admin rows. Used once, at seed time. */
export function operatingDaysFrom(hours: readonly OpeningHours[]): BranchOperatingDay[] {
    return hours.map((hour) => ({
        weekday: hour.weekday,
        opensAt: hour.opensAt,
        closesAt: hour.closesAt,
        orderCutOffAt: hour.orderCutOffAt,
    }));
}

/** Admin availability rows as the consumer contract's availability windows. */
export function projectAvailability(
    days: readonly MealAvailabilityDay[],
): MarketplaceMeal['availability'] {
    return days.map((day) => ({
        date: day.date,
        available: day.isAvailable,
        remaining: day.remaining,
        orderCutOffAt: day.orderCutOffAt === null ? null : instantAt(day.date, day.orderCutOffAt),
    }));
}

/** Consumer availability windows as admin rows. Used once, at seed time. */
export function availabilityDaysFrom(
    windows: MarketplaceMeal['availability'],
): MealAvailabilityDay[] {
    return windows.map((window) => ({
        date: window.date,
        isAvailable: window.available,
        remaining: window.remaining,
        // `2026-07-27T18:00:00.000Z` → `18:00`; `null` stays `null`.
        orderCutOffAt: window.orderCutOffAt === null ? null : window.orderCutOffAt.slice(11, 16),
    }));
}

/** Replaces one branch's opening hours and delivery zones inside a kitchen record. */
export function withBranch(
    branch: KitchenBranch,
    changes: {
        readonly openingHours?: readonly OpeningHours[] | undefined;
        readonly deliveryZones?: readonly DeliveryZone[] | undefined;
    },
): KitchenBranch {
    return {
        ...branch,
        ...(changes.openingHours === undefined ? {} : { openingHours: changes.openingHours }),
        ...(changes.deliveryZones === undefined ? {} : { deliveryZones: changes.deliveryZones }),
    };
}

/** A recipe version's admin lines as the nutrition package's ingredient quantities. */
export function quantitiesFrom(
    lines: readonly RecipeLine[],
    resolve: (id: IngredientId) => PrototypeIngredient | null,
): readonly IngredientQuantity[] {
    const quantities: IngredientQuantity[] = [];
    for (const line of lines) {
        const ingredient = resolve(line.ingredientId);
        if (ingredient === null) continue;
        quantities.push({
            ingredientId: line.ingredientId,
            name: ingredient.name,
            quantity: line.quantity,
            unit: line.unit,
            grams: gramsFor(ingredient, line.quantity, line.unit),
            per100g: ingredient.per100g,
            allergens: ingredient.allergens,
            optional: line.isOptional,
            estimatedCost: null,
        });
    }
    return quantities;
}
