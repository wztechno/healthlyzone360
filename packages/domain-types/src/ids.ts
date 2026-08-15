import type { Brand } from './brand.ts';

/**
 * The platform issues UUIDv7 identifiers (plan §8). The codecs below validate the *shape* of an
 * identifier; they never generate one, because identifiers are always server-issued.
 */
export const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Reads the version nibble of a well-formed UUID (7 for UUIDv7). */
export function uuidVersion(value: string): number | null {
    if (!UUID_PATTERN.test(value)) return null;
    const nibble = value.charAt(14);
    const parsed = Number.parseInt(nibble, 16);
    return Number.isNaN(parsed) ? null : parsed;
}

export class InvalidIdentifierError extends Error {
    readonly label: string;
    readonly received: unknown;

    constructor(label: string, received: unknown, expectation = 'a UUID string') {
        super(`Invalid ${label}: expected ${expectation}, received ${JSON.stringify(received)}`);
        this.name = 'InvalidIdentifierError';
        this.label = label;
        this.received = received;
    }
}

export interface IdCodec<T extends string> {
    /** Human-readable name, used in error messages and test output. */
    readonly label: string;
    /** Runtime guard: true when `value` is a UUID string. */
    is(value: unknown): value is T;
    /** Validates and brands. Throws `InvalidIdentifierError` when the shape is wrong. */
    parse(value: unknown): T;
    /** Validates and brands, returning `null` instead of throwing. */
    safeParse(value: unknown): T | null;
    /**
     * Brands without validating. Reserved for fixtures and for values that have already been
     * validated at a system boundary (e.g. the generated OpenAPI client).
     */
    unsafe(value: string): T;
}

function createIdCodec<T extends string>(label: string): IdCodec<T> {
    return {
        label,
        is(value: unknown): value is T {
            return isUuid(value);
        },
        parse(value: unknown): T {
            if (!isUuid(value)) throw new InvalidIdentifierError(label, value);
            return value as T;
        },
        safeParse(value: unknown): T | null {
            return isUuid(value) ? (value as T) : null;
        },
        unsafe(value: string): T {
            return value as T;
        },
    };
}

export type UserId = Brand<string, 'UserId'>;
export type OrganisationId = Brand<string, 'OrganisationId'>;
export type BranchId = Brand<string, 'BranchId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type RoleId = Brand<string, 'RoleId'>;
export type DeviceId = Brand<string, 'DeviceId'>;

export const UserId: IdCodec<UserId> = createIdCodec<UserId>('UserId');
export const OrganisationId: IdCodec<OrganisationId> =
    createIdCodec<OrganisationId>('OrganisationId');
export const BranchId: IdCodec<BranchId> = createIdCodec<BranchId>('BranchId');
export const MembershipId: IdCodec<MembershipId> = createIdCodec<MembershipId>('MembershipId');
export const RoleId: IdCodec<RoleId> = createIdCodec<RoleId>('RoleId');
export const DeviceId: IdCodec<DeviceId> = createIdCodec<DeviceId>('DeviceId');

/* ------------------------------------------------------------------------------------------------
 * Nutrition, marketplace and commerce identifiers (Prompt 2).
 *
 * Every one of these is a server-issued UUIDv7 like the foundation identifiers above, so they share
 * the same codec. They are separate *brands* rather than one `EntityId` because the planner passes
 * four or five identifiers through the same call signatures and a transposed pair would otherwise
 * typecheck perfectly.
 * ---------------------------------------------------------------------------------------------- */

export type KitchenId = Brand<string, 'KitchenId'>;
export type KitchenBranchId = Brand<string, 'KitchenBranchId'>;
export type DeliveryZoneId = Brand<string, 'DeliveryZoneId'>;
export type IngredientId = Brand<string, 'IngredientId'>;
export type RecipeId = Brand<string, 'RecipeId'>;
export type MealId = Brand<string, 'MealId'>;
export type MealPlanId = Brand<string, 'MealPlanId'>;
export type MealPlanEntryId = Brand<string, 'MealPlanEntryId'>;
export type GroceryListId = Brand<string, 'GroceryListId'>;
export type SubscriptionPlanId = Brand<string, 'SubscriptionPlanId'>;
export type PlanVariantId = Brand<string, 'PlanVariantId'>;
export type SubscriptionId = Brand<string, 'SubscriptionId'>;
export type CartId = Brand<string, 'CartId'>;
export type OrderId = Brand<string, 'OrderId'>;
export type DietitianId = Brand<string, 'DietitianId'>;
export type NutritionTargetId = Brand<string, 'NutritionTargetId'>;
export type VdSessionId = Brand<string, 'VdSessionId'>;
export type VdMessageId = Brand<string, 'VdMessageId'>;
export type QuotationId = Brand<string, 'QuotationId'>;
export type CorporateProgrammeId = Brand<string, 'CorporateProgrammeId'>;
export type VolumeTierId = Brand<string, 'VolumeTierId'>;

export const KitchenId: IdCodec<KitchenId> = createIdCodec<KitchenId>('KitchenId');
export const KitchenBranchId: IdCodec<KitchenBranchId> =
    createIdCodec<KitchenBranchId>('KitchenBranchId');
export const DeliveryZoneId: IdCodec<DeliveryZoneId> =
    createIdCodec<DeliveryZoneId>('DeliveryZoneId');
export const IngredientId: IdCodec<IngredientId> = createIdCodec<IngredientId>('IngredientId');
export const RecipeId: IdCodec<RecipeId> = createIdCodec<RecipeId>('RecipeId');
export const MealId: IdCodec<MealId> = createIdCodec<MealId>('MealId');
export const MealPlanId: IdCodec<MealPlanId> = createIdCodec<MealPlanId>('MealPlanId');
export const MealPlanEntryId: IdCodec<MealPlanEntryId> =
    createIdCodec<MealPlanEntryId>('MealPlanEntryId');
export const GroceryListId: IdCodec<GroceryListId> = createIdCodec<GroceryListId>('GroceryListId');
export const SubscriptionPlanId: IdCodec<SubscriptionPlanId> =
    createIdCodec<SubscriptionPlanId>('SubscriptionPlanId');
export const PlanVariantId: IdCodec<PlanVariantId> = createIdCodec<PlanVariantId>('PlanVariantId');
export const SubscriptionId: IdCodec<SubscriptionId> =
    createIdCodec<SubscriptionId>('SubscriptionId');
export const CartId: IdCodec<CartId> = createIdCodec<CartId>('CartId');
export const OrderId: IdCodec<OrderId> = createIdCodec<OrderId>('OrderId');
export const DietitianId: IdCodec<DietitianId> = createIdCodec<DietitianId>('DietitianId');
export const NutritionTargetId: IdCodec<NutritionTargetId> =
    createIdCodec<NutritionTargetId>('NutritionTargetId');
export const VdSessionId: IdCodec<VdSessionId> = createIdCodec<VdSessionId>('VdSessionId');
export const VdMessageId: IdCodec<VdMessageId> = createIdCodec<VdMessageId>('VdMessageId');
export const QuotationId: IdCodec<QuotationId> = createIdCodec<QuotationId>('QuotationId');
export const CorporateProgrammeId: IdCodec<CorporateProgrammeId> =
    createIdCodec<CorporateProgrammeId>('CorporateProgrammeId');
export const VolumeTierId: IdCodec<VolumeTierId> = createIdCodec<VolumeTierId>('VolumeTierId');

/* ------------------------------------------------------------------------------------------------
 * Kitchen catalogue management identifiers (K1).
 *
 * These name rows that only ever appear on a *management* surface. A consumer never sees a recipe
 * version, a price list or a service-area row, which is why none of them has a counterpart in the
 * marketplace contract — the separation is the point, and giving them their own brands is what stops
 * an admin identifier being handed to a consumer-facing call by accident.
 * ---------------------------------------------------------------------------------------------- */

export type ProductId = Brand<string, 'ProductId'>;
export type PriceListId = Brand<string, 'PriceListId'>;
export type RecipeVersionId = Brand<string, 'RecipeVersionId'>;
export type DeliveryWindowId = Brand<string, 'DeliveryWindowId'>;
export type ServiceAreaId = Brand<string, 'ServiceAreaId'>;

export const ProductId: IdCodec<ProductId> = createIdCodec<ProductId>('ProductId');
export const PriceListId: IdCodec<PriceListId> = createIdCodec<PriceListId>('PriceListId');
export const RecipeVersionId: IdCodec<RecipeVersionId> =
    createIdCodec<RecipeVersionId>('RecipeVersionId');
export const DeliveryWindowId: IdCodec<DeliveryWindowId> =
    createIdCodec<DeliveryWindowId>('DeliveryWindowId');
export const ServiceAreaId: IdCodec<ServiceAreaId> = createIdCodec<ServiceAreaId>('ServiceAreaId');

/* ------------------------------------------------------------------------------------------------
 * Kitchen ops identifiers (O1–O4).
 *
 * Receipts-only inventory, procurement, production and quality control. None of these rows has a
 * consumer counterpart either — a stock item, a supplier and a goods receipt are exactly as
 * management-only as a recipe version is, hence their own brands rather than a reused `string`.
 * ---------------------------------------------------------------------------------------------- */

export type StockItemId = Brand<string, 'StockItemId'>;
export type SupplierId = Brand<string, 'SupplierId'>;
export type GoodsReceiptId = Brand<string, 'GoodsReceiptId'>;
export type ProductionOrderId = Brand<string, 'ProductionOrderId'>;
export type QualityCheckId = Brand<string, 'QualityCheckId'>;

export const StockItemId: IdCodec<StockItemId> = createIdCodec<StockItemId>('StockItemId');
export const SupplierId: IdCodec<SupplierId> = createIdCodec<SupplierId>('SupplierId');
export const GoodsReceiptId: IdCodec<GoodsReceiptId> =
    createIdCodec<GoodsReceiptId>('GoodsReceiptId');
export const ProductionOrderId: IdCodec<ProductionOrderId> =
    createIdCodec<ProductionOrderId>('ProductionOrderId');
export const QualityCheckId: IdCodec<QualityCheckId> =
    createIdCodec<QualityCheckId>('QualityCheckId');

/** Every UUID identifier codec, keyed by label — handy for table-driven tests. */
export const ID_CODECS = {
    UserId,
    OrganisationId,
    BranchId,
    MembershipId,
    RoleId,
    DeviceId,
    KitchenId,
    KitchenBranchId,
    DeliveryZoneId,
    IngredientId,
    RecipeId,
    MealId,
    MealPlanId,
    MealPlanEntryId,
    GroceryListId,
    SubscriptionPlanId,
    PlanVariantId,
    SubscriptionId,
    CartId,
    OrderId,
    DietitianId,
    NutritionTargetId,
    VdSessionId,
    VdMessageId,
    QuotationId,
    CorporateProgrammeId,
    VolumeTierId,
    ProductId,
    PriceListId,
    RecipeVersionId,
    DeliveryWindowId,
    ServiceAreaId,
    StockItemId,
    SupplierId,
    GoodsReceiptId,
    ProductionOrderId,
    QualityCheckId,
} as const;

export type IdCodecName = keyof typeof ID_CODECS;

/* ------------------------------------------------------------------------------------------------
 * Code identifiers.
 *
 * Not everything the platform points at is a row with a generated key. Allergens are *reference
 * data* published as stable codes (`peanut`, `tree_nut`, `gluten`), the same way country codes and
 * locales are: a fixture, a translation key, an OpenAPI enum and a kitchen's data-entry form all
 * have to agree on the literal string, and a UUID would make that impossible to read or review.
 * ---------------------------------------------------------------------------------------------- */

/** Lowercase snake_case, 2–48 characters, letters and digits only between underscores. */
export const CODE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export function isEntityCode(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length >= 2 &&
        value.length <= 48 &&
        CODE_PATTERN.test(value)
    );
}

function createCodeCodec<T extends string>(label: string): IdCodec<T> {
    return {
        label,
        is(value: unknown): value is T {
            return isEntityCode(value);
        },
        parse(value: unknown): T {
            if (!isEntityCode(value)) {
                throw new InvalidIdentifierError(label, value, 'a lowercase snake_case code');
            }
            return value as T;
        },
        safeParse(value: unknown): T | null {
            return isEntityCode(value) ? (value as T) : null;
        },
        unsafe(value: string): T {
            return value as T;
        },
    };
}

export type AllergenCode = Brand<string, 'AllergenCode'>;
export const AllergenCode: IdCodec<AllergenCode> = createCodeCodec<AllergenCode>('AllergenCode');

/** Code-shaped identifier codecs, kept apart from `ID_CODECS` because they are not UUIDs. */
export const CODE_CODECS = {
    AllergenCode,
} as const;

export type CodeCodecName = keyof typeof CODE_CODECS;
