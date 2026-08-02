import {
    CartId,
    CorporateProgrammeId,
    DeliveryWindowId,
    DeliveryZoneId,
    DietitianId,
    GroceryListId,
    IngredientId,
    KitchenBranchId,
    KitchenId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
    NutritionTargetId,
    OrderId,
    OrganisationId,
    PlanVariantId,
    PriceListId,
    ProductId,
    QuotationId,
    RecipeId,
    RecipeVersionId,
    ServiceAreaId,
    SubscriptionId,
    SubscriptionPlanId,
    VdMessageId,
    VdSessionId,
    VolumeTierId,
} from '@healthy360/domain-types';

/**
 * Deterministic identifiers for the Prompt 2 prototype world.
 *
 * Same discipline as `../ids.ts` and `@healthy360/testing`'s `FIXTURE_IDS`: a fixed UUIDv7 prefix
 * and a band per entity type, so an identifier read off a failing assertion says what it points at
 * without a lookup. Nothing here is random.
 *
 * The prefix is `01935f6d-…` — one greater than the foundation's `01935f6c-…` — so the whole
 * prototype world is provably disjoint from the mock store's accounts and from the unit fixtures.
 * `ids.test.ts` asserts that, and asserts the two deliberate exceptions: kitchen 1 and its Al Quoz
 * branch reuse the **existing** Verdant Kitchen organisation and branch identifiers, because the
 * prototype marketplace and the foundation's organisation world are meant to describe one place.
 */
export const PROTOTYPE_ID_PREFIX = '01935f6d-0000-7000-8000-';

/** Two hex digits per entity type, occupying byte 5 of the final UUID group. */
export const PROTOTYPE_ID_BANDS = {
    kitchen: 'f0',
    kitchenBranch: 'f1',
    deliveryZone: 'f2',
    ingredient: 'a0',
    recipe: 'b0',
    meal: 'c0',
    subscriptionPlan: 'd0',
    planVariant: 'd1',
    mealPlan: 'e0',
    mealPlanEntry: 'e1',
    groceryList: 'e2',
    nutritionTarget: '90',
    vdSession: '91',
    vdMessage: '92',
    dietitian: '80',
    review: '81',
    cart: '70',
    order: '71',
    subscription: '72',
    corporateProgramme: '60',
    quotation: '61',
    volumeTier: '62',

    /**
     * Kitchen-management bands (K1).
     *
     * `recipeVersion` sits beside `recipe` and `product`/`priceList` beside `meal`, so a band read
     * off a failing assertion still says which part of the world it came from. `serviceArea` and
     * `deliveryWindow` join the delivery bands for the same reason.
     */
    recipeVersion: 'b1',
    product: 'c1',
    priceList: 'c2',
    deliveryWindow: 'f3',
    serviceArea: 'f4',
} as const;

export type PrototypeIdBand = keyof typeof PROTOTYPE_ID_BANDS;

export const PROTOTYPE_ID_BAND_NAMES = Object.keys(
    PROTOTYPE_ID_BANDS,
) as readonly PrototypeIdBand[];

/** The largest ordinal a band can carry. Two hex digits: 0–255 rows per entity type. */
export const PROTOTYPE_ORDINAL_LIMIT = 0xff;

export class PrototypeIdRangeError extends RangeError {
    constructor(band: PrototypeIdBand, ordinal: number) {
        super(
            `Prototype ordinal ${String(ordinal)} is outside the ${band} band. ` +
                `Ordinals are a single byte (0–${PROTOTYPE_ORDINAL_LIMIT}).`,
        );
        this.name = 'PrototypeIdRangeError';
    }
}

/**
 * `01935f6d-0000-7000-8000-00000000<band><ordinal>`.
 *
 * Eight zero digits keep the final group at exactly twelve characters, which is what makes the
 * result a well-formed UUID rather than something that merely looks like one.
 */
export function prototypeId(band: PrototypeIdBand, ordinal: number): string {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal > PROTOTYPE_ORDINAL_LIMIT) {
        throw new PrototypeIdRangeError(band, ordinal);
    }
    const suffix = ordinal.toString(16).padStart(2, '0');
    return `${PROTOTYPE_ID_PREFIX}00000000${PROTOTYPE_ID_BANDS[band]}${suffix}`;
}

/* ------------------------------------------------------------------------------------------------
 * Branded constructors, one per band.
 *
 * They exist so that a fixture reads `mealId(3)` rather than repeating the codec and the band at
 * every call site — and so the compiler still refuses to hand a `MealId` to a `RecipeId` parameter.
 * ---------------------------------------------------------------------------------------------- */

export const kitchenIdAt = (ordinal: number): KitchenId =>
    KitchenId.unsafe(prototypeId('kitchen', ordinal));
export const kitchenBranchIdAt = (ordinal: number): KitchenBranchId =>
    KitchenBranchId.unsafe(prototypeId('kitchenBranch', ordinal));
export const deliveryZoneIdAt = (ordinal: number): DeliveryZoneId =>
    DeliveryZoneId.unsafe(prototypeId('deliveryZone', ordinal));
export const ingredientIdAt = (ordinal: number): IngredientId =>
    IngredientId.unsafe(prototypeId('ingredient', ordinal));
export const recipeIdAt = (ordinal: number): RecipeId =>
    RecipeId.unsafe(prototypeId('recipe', ordinal));
export const mealIdAt = (ordinal: number): MealId => MealId.unsafe(prototypeId('meal', ordinal));
export const subscriptionPlanIdAt = (ordinal: number): SubscriptionPlanId =>
    SubscriptionPlanId.unsafe(prototypeId('subscriptionPlan', ordinal));
export const planVariantIdAt = (ordinal: number): PlanVariantId =>
    PlanVariantId.unsafe(prototypeId('planVariant', ordinal));
export const mealPlanIdAt = (ordinal: number): MealPlanId =>
    MealPlanId.unsafe(prototypeId('mealPlan', ordinal));
export const mealPlanEntryIdAt = (ordinal: number): MealPlanEntryId =>
    MealPlanEntryId.unsafe(prototypeId('mealPlanEntry', ordinal));
export const groceryListIdAt = (ordinal: number): GroceryListId =>
    GroceryListId.unsafe(prototypeId('groceryList', ordinal));
export const nutritionTargetIdAt = (ordinal: number): NutritionTargetId =>
    NutritionTargetId.unsafe(prototypeId('nutritionTarget', ordinal));
export const vdSessionIdAt = (ordinal: number): VdSessionId =>
    VdSessionId.unsafe(prototypeId('vdSession', ordinal));
export const vdMessageIdAt = (ordinal: number): VdMessageId =>
    VdMessageId.unsafe(prototypeId('vdMessage', ordinal));
export const dietitianIdAt = (ordinal: number): DietitianId =>
    DietitianId.unsafe(prototypeId('dietitian', ordinal));
export const reviewIdAt = (ordinal: number): string => prototypeId('review', ordinal);
export const cartIdAt = (ordinal: number): CartId => CartId.unsafe(prototypeId('cart', ordinal));
export const orderIdAt = (ordinal: number): OrderId =>
    OrderId.unsafe(prototypeId('order', ordinal));
export const subscriptionIdAt = (ordinal: number): SubscriptionId =>
    SubscriptionId.unsafe(prototypeId('subscription', ordinal));
export const corporateProgrammeIdAt = (ordinal: number): CorporateProgrammeId =>
    CorporateProgrammeId.unsafe(prototypeId('corporateProgramme', ordinal));
export const quotationIdAt = (ordinal: number): QuotationId =>
    QuotationId.unsafe(prototypeId('quotation', ordinal));
export const volumeTierIdAt = (ordinal: number): VolumeTierId =>
    VolumeTierId.unsafe(prototypeId('volumeTier', ordinal));
export const recipeVersionIdAt = (ordinal: number): RecipeVersionId =>
    RecipeVersionId.unsafe(prototypeId('recipeVersion', ordinal));
export const productIdAt = (ordinal: number): ProductId =>
    ProductId.unsafe(prototypeId('product', ordinal));
export const priceListIdAt = (ordinal: number): PriceListId =>
    PriceListId.unsafe(prototypeId('priceList', ordinal));
export const deliveryWindowIdAt = (ordinal: number): DeliveryWindowId =>
    DeliveryWindowId.unsafe(prototypeId('deliveryWindow', ordinal));
export const serviceAreaIdAt = (ordinal: number): ServiceAreaId =>
    ServiceAreaId.unsafe(prototypeId('serviceArea', ordinal));

/**
 * Where the store starts minting identifiers for rows a *person* creates — an added planner entry,
 * a new subscription, a Virtual Dietitian reply.
 *
 * Fixtures occupy the low ordinals; runtime rows occupy `0x80` upwards. Keeping the two apart means
 * a test can tell "this came from the fixture set" from "this was created by the interaction under
 * test" by looking at the identifier.
 */
export const PROTOTYPE_RUNTIME_ORDINAL_START = 0x80;

/**
 * The bands a kitchen-management row is minted in.
 *
 * Named as a set so a test can assert that every one of them respects
 * {@link PROTOTYPE_RUNTIME_ORDINAL_START} for rows a *person* created — the property that lets a
 * failing admin test say "this ingredient came out of the seed" or "this ingredient was created by
 * the interaction under test" from the identifier alone, with no lookup.
 */
export const KITCHEN_ADMIN_ID_BANDS: readonly PrototypeIdBand[] = [
    'recipeVersion',
    'product',
    'priceList',
    'deliveryWindow',
    'serviceArea',
];

/**
 * Buyer organisations for the corporate programmes.
 *
 * Organisations are a *foundation* entity — `../ids.ts` owns their band — so the prototype does not
 * mint one of its own. The two buyers that are not already in the mock world (a gym and a facilities
 * supplier) therefore take identifiers from the top of the corporate-programme band, at ordinals
 * `0xe0` and above, which no programme fixture reaches. Documented here rather than discovered later.
 */
export const PROTOTYPE_BUYER_ORGANISATION_ORDINAL_START = 0xe0;

export const buyerOrganisationIdAt = (offset: number): OrganisationId =>
    OrganisationId.unsafe(
        prototypeId('corporateProgramme', PROTOTYPE_BUYER_ORGANISATION_ORDINAL_START + offset),
    );
