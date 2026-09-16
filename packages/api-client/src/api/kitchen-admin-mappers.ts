import {
    AllergenCode,
    DeliveryWindowId,
    DeliveryZoneId,
    IngredientId,
    isCurrencyCode,
    KitchenBranchId,
    KitchenId,
    MealId,
    OrganisationId,
    PlanVariantId,
    PriceListId,
    ProductId,
    RecipeId,
    RecipeVersionId,
    ServiceAreaId,
    SubscriptionPlanId,
    type DietClassification,
    type SalesChannel,
} from '@healthy360/domain-types';
import { isMeasureUnit, type MeasureUnit, type NutritionFacts } from '@healthy360/nutrition';

import type {
    AllergenContainment,
    BranchOperating,
    BranchOperatingDay,
    ChannelAvailability,
    DeliveryWindow,
    DeliveryZoneAdmin,
    IngredientAdmin,
    IngredientAllergenMapping,
    IngredientCategoryAdmin,
    PackagingBasis,
    RecipePackagingLine,
    MealAdmin,
    MealAvailabilityDay,
    PlanAdmin,
    PlanCombination,
    PlanDurationAdmin,
    PlanMenu,
    PlanMenuEntry,
    PlanVariantAdmin,
    PriceListAdmin,
    PriceListEntry,
    ProductAdmin,
    ProductPackVariant,
    PublishableStatus,
    CostAmount,
    RecipeAdmin,
    RecipeAdminSummary,
    RecipeCostFigures,
    RecipeComputedCost,
    RecipeAllergenDeclaration,
    RecipeLine,
    RecipeOutput,
    RecipeRollupPreview,
    RecipeStepAdmin,
    RecipeVersionAdmin,
    RecipeVersionSummary,
    RollupWarning,
    ServiceArea,
    RecipeWeeklyCost,
    TechnicalSheetAdmin,
} from '../contracts/kitchen-admin.ts';
import { ALLERGEN_CONTAINMENTS } from '../contracts/kitchen-admin.ts';
import { UNKNOWN_ISO_DATE_TIME } from './mappers.ts';
import { mapNutritionFacts } from './marketplace-mappers.ts';
import type {
    AdminCatalogueItem,
    AdminCatalogueItemVariant,
    AdminChannelAssignment,
    AdminDeliveryArea,
    AdminIngredient,
    AdminPriceList,
    AdminPriceListEntry,
    AdminRecipe,
    AdminRecipeVersion,
    AdminSalesChannel,
    ComputedCost as WireComputedCost,
    CostSnapshot as WireCostSnapshot,
    DeliveryWindow as WireDeliveryWindow,
    DeliveryZone,
    DerivedAllergen,
    EnergyBand,
    IngredientAllergenMapping as WireAllergenMapping,
    IngredientCategory as WireIngredientCategory,
    IngredientStatus,
    IngredientVerificationStatus,
    MealCombinationOption,
    PlanDurationOption,
    PlanMenuCycle as WirePlanMenuCycle,
    PlanMenuEntry as WirePlanMenuEntry,
    PlanProfile,
    PlanVariantCell,
    PriceListChannelAssignment,
    PriceListStatus,
    RecipeLine as WireRecipeLine,
    RecipeRollupPreview as WireRecipeRollupPreview,
    RecipeOutput as WireRecipeOutput,
    RecipeStep as WireRecipeStep,
    RecipeVersionAllergen,
    RecipeVersionStatus,
    SalesChannelKind,
    BranchOperatingDay as WireBranchOperatingDay,
    CatalogueItemStatus,
    DeliveryZoneStatus,
    PriceStatus,
    TechnicalSheet as WireTechnicalSheet,
    WeeklyCost as WireWeeklyCost,
} from '../generated/types.ts';

/**
 * Wire ingredient lifecycle → the kitchen contract's publication vocabulary.
 *
 * The backend deliberately uses `active | inactive | archived` rather than
 * `draft | published | retired` (master plan v2 §4.7). `requires_review` on
 * the verification axis is what becomes `review_required` in the UI.
 */
export function mapIngredientPublishableStatus(
    status: IngredientStatus,
    verificationStatus: IngredientVerificationStatus,
): PublishableStatus {
    if (status === 'archived') {
        return 'retired';
    }

    if (verificationStatus === 'requires_review') {
        return 'review_required';
    }

    if (status === 'active') {
        return 'published';
    }

    return 'draft';
}

/** The inverse of {@link mapIngredientPublishableStatus} when the API supports a single `status` filter. */
export function apiStatusForPublishableFilter(status: PublishableStatus): IngredientStatus | null {
    if (status === 'retired') return 'archived';
    if (status === 'draft') return 'inactive';
    if (status === 'published') return 'active';

    return null;
}

export interface CategoryLookup {
    readonly codeToId: ReadonlyMap<string, string>;
    readonly idToCode: ReadonlyMap<string, string>;
    /**
     * Child code → parent code, for the codes that have a parent.
     *
     * `ingredient_categories` is one self-referencing table and the endpoint returns the whole tree
     * with `parent_id` on every row, so the shape is available here and was simply being discarded.
     * Keeping it is what lets a two-level picker exist at all, and what lets a caller check a leaf
     * belongs to the branch it is being filed under without a second round trip.
     */
    readonly parentOf: ReadonlyMap<string, string>;
}

export function buildCategoryLookup(categories: readonly WireIngredientCategory[]): CategoryLookup {
    const codeToId = new Map<string, string>();
    const idToCode = new Map<string, string>();

    for (const category of categories) {
        codeToId.set(category.code, category.id);
        idToCode.set(category.id, category.code);
    }

    // Second pass: a child can appear before its parent in the response, so the parent's code is
    // only reliably resolvable once every id is known.
    const parentOf = new Map<string, string>();

    for (const category of categories) {
        if (category.parent_id === null || category.parent_id === undefined) continue;
        const parent = idToCode.get(category.parent_id);
        if (parent !== undefined) parentOf.set(category.code, parent);
    }

    return { codeToId, idToCode, parentOf };
}

/**
 * One category row, wire → contract.
 *
 * `parent_id` is translated to the parent's *code* rather than passed through: the whole client
 * side of this feature — the filter, both pickers, the ingredient's own `categoryCode` — speaks
 * codes, and an id here would make every consumer carry the id→code map to use it. A parent id
 * that resolves to nothing is treated as top-level rather than dropped: a category with an
 * unresolvable parent is still a real category, and hiding it would hide the ingredients filed
 * under it.
 */
export function mapIngredientCategoryAdmin(
    wire: WireIngredientCategory,
    idToCode: ReadonlyMap<string, string>,
): IngredientCategoryAdmin {
    const parentCode =
        wire.parent_id === null || wire.parent_id === undefined
            ? null
            : (idToCode.get(wire.parent_id) ?? null);

    return {
        code: wire.code,
        name: { en: wire.name_en, ar: wire.name_ar },
        parentCode,
        displayOrder: wire.display_order,
        isActive: wire.is_active,
    };
}

/**
 * The category the ingredient is filed under, and the leaf within it.
 *
 * These used to be one value, with the child preferred — which read back plausibly and then
 * corrupted the record on the next save, because the write layer only ever sent
 * `ingredient_category_id`. Saving a sub-categorised ingredient unchanged therefore wrote the
 * *child's* id into the parent column. Returning the pair is what makes the round trip lossless.
 *
 * A sub-category id that resolves to no known code is dropped rather than guessed at: the category
 * is still right, and a leaf nobody can name is not information.
 */
function categoryPairFor(
    lookup: CategoryLookup,
    categoryId: string | null,
    subcategoryId: string | null | undefined,
): { readonly categoryCode: string; readonly subcategoryCode: string | null } {
    const categoryCode = categoryId === null ? undefined : lookup.idToCode.get(categoryId);
    const subcategoryCode =
        subcategoryId === null || subcategoryId === undefined
            ? undefined
            : lookup.idToCode.get(subcategoryId);

    return {
        categoryCode: categoryCode ?? 'uncategorized',
        subcategoryCode: subcategoryCode ?? null,
    };
}

function mapMeasureUnit(code: string | null | undefined): MeasureUnit {
    if (code !== null && code !== undefined && isMeasureUnit(code)) {
        return code;
    }

    return 'g';
}

function mapAllergenVerification(
    status: WireAllergenMapping['verification_status'],
): IngredientAllergenMapping['verification'] {
    switch (status) {
        case 'verified':
            return 'operator_confirmed';
        case 'requires_supplier_confirmation':
            return 'supplier_declared';
        default:
            return 'unverified';
    }
}

function mapMarketScope(scope: WireAllergenMapping['market_scope']): readonly string[] {
    if (scope === 'us_only') return ['US'];
    if (scope === 'eu_only') return ['EU'];

    return [];
}

export function mapIngredientAllergenMapping(wire: WireAllergenMapping): IngredientAllergenMapping {
    return {
        allergenCode: AllergenCode.unsafe(wire.allergen_code),
        containment: wire.containment,
        marketScope: mapMarketScope(wire.market_scope),
        verification: mapAllergenVerification(wire.verification_status),
        sourceNote: wire.evidence ?? null,
    };
}

/**
 * The three fields packaging brought back with it, which the generated `AdminIngredient` does not
 * know about yet.
 *
 * `apps/api/openapi/healthy360.v1.yaml` describes the ingredient resource as it was before the two
 * families were merged. Widening here rather than editing the generated types keeps the generator
 * authoritative: regenerate the spec and this alias becomes `AdminIngredient` again, deletable in
 * one line.
 */
type WireIngredient = AdminIngredient & {
    readonly purchase_price_amount?: string | null;
    readonly purchase_price_currency?: string | null;
    readonly waste_percent?: string | null;
    readonly capacity_quantity?: string | null;
    readonly capacity_unit_code?: string | null;
};

export function mapIngredientAdmin(
    wire: WireIngredient,
    lookup: CategoryLookup,
    options?: {
        readonly aliases?: readonly string[];
        readonly allergens?: readonly IngredientAllergenMapping[];
    },
): IngredientAdmin {
    const publishableStatus = mapIngredientPublishableStatus(wire.status, wire.verification_status);

    return {
        id: IngredientId.unsafe(wire.id),
        meta: {
            lockVersion: wire.lock_version,
            status: publishableStatus,
            updatedAt: wire.updated_at ?? UNKNOWN_ISO_DATE_TIME,
            updatedByName: null,
        },
        name: { en: wire.name_en, ar: wire.name_ar },
        reference: wire.source_ref ?? null,
        ...categoryPairFor(lookup, wire.ingredient_category_id, wire.ingredient_subcategory_id),
        measurementUnit: mapMeasureUnit(wire.default_unit_code),
        purchaseUnit:
            wire.purchase_unit_code == null ? null : mapMeasureUnit(wire.purchase_unit_code),
        composition: wire.composition ?? null,
        itemsPerUnit: wire.items_per_unit == null ? null : parseDecimal(wire.items_per_unit),
        gramsPerUnit: wire.grams_per_unit == null ? null : parseDecimal(wire.grams_per_unit),
        /*
         * Packaging's three figures, null on food.
         *
         * `purchasePrice` is per purchase *pack* and `unitPrice` below is per issued *unit*; they
         * are two fields because they are two denominators, and folding them together scales a
         * cost by `itemsPerUnit` without saying so.
         */
        purchasePrice: mapCostAmount(
            wire.purchase_price_amount ?? null,
            wire.purchase_price_currency ?? null,
        ),
        wastePercent: wire.waste_percent == null ? null : parseDecimal(wire.waste_percent),
        // Both halves or nothing: a quantity with no unit is not a capacity, it is a number.
        capacity:
            wire.capacity_quantity == null || wire.capacity_unit_code == null
                ? null
                : {
                      quantity: parseDecimal(wire.capacity_quantity),
                      unit: mapMeasureUnit(wire.capacity_unit_code),
                  },
        b2bPrice: mapCostAmount(wire.b2b_price_amount, wire.price_currency_code),
        b2cPrice: mapCostAmount(wire.b2c_price_amount, wire.price_currency_code),
        unitPrice: mapCostAmount(wire.unit_price_amount, wire.price_currency_code),
        // The column defaults to false and the presenter always sends it; `undefined` here means an
        // older payload, and "not on sale" is the safe reading of one.
        isSellable: wire.is_sellable ?? false,
        costPer100g: null,
        per100g: mapIngredientPer100g(wire),
        // Set only on a sub-recipe's output, where the facts beside it are derived from the
        // formulation rather than entered — which is what makes them read-only.
        nutritionDerivedFromVersionId:
            wire.nutrition_derived_from_version_id == null
                ? null
                : RecipeVersionId.unsafe(wire.nutrition_derived_from_version_id),
        // `?? null`, never `?? false`: the column has three states and "nobody has said" is one of
        // them. Reading an absent flag as "declared" would badge 306 seeded rows as somebody's
        // statement about the thing in the store cupboard.
        nutritionEstimated: wire.nutrition_estimated ?? null,
        nutritionNote: wire.nutrition_note ?? null,
        // Both the collection and the single resource carry the mappings, so the list's allergen
        // column and its View panel state the real declaration rather than "none declared" on every
        // row — which is what they did while this could only be filled from the dedicated
        // sub-resource, and no list can afford a request per row. The override stays for the callers
        // that read that sub-resource directly.
        allergens: options?.allergens ?? (wire.allergens ?? []).map(mapIngredientAllergenMapping),
        dietClassifications: [],
        aliases: options?.aliases ?? [],
        organisationId:
            wire.organisation_id === null ? null : OrganisationId.unsafe(wire.organisation_id),
        // `is_editable` answers for this caller; `is_platform` only says which library the row is
        // in. A platform row is writable by the platform operator, so the client must not infer the
        // first from the second. `undefined` means an older payload, where read-only is the safe
        // reading.
        isEditable: wire.is_editable ?? false,
        forkedFromId:
            wire.forked_from_ingredient_id == null
                ? null
                : IngredientId.unsafe(wire.forked_from_ingredient_id),
        notes: wire.notes ?? null,
    };
}

/**
 * The slim per-100 g payload an ingredient stores, lifted into the full facts
 * envelope the screens render. Provenance is honest about what it is: a
 * professional entry recorded on the ingredient, not a laboratory analysis and
 * not a derivation — those arrive with the recipe-rollup phase.
 *
 * ## An estimated row says so in the provenance line, not only on a badge
 *
 * `nutrition_estimated` is what the reference document flags on 56 of its 306
 * rows: a figure true of the *category* rather than measured of this
 * ingredient. Every reader of these facts renders `source.label` and
 * `calculation.notes` — that is what the "how was this worked out?" panel is —
 * so the flag belongs there as well as on the editor's badge. A badge only one
 * screen draws is provenance that travels no further than that screen.
 *
 * **`source.kind` stays `professional_entry`.** The union has no member for
 * "representative figure": its options describe *who* recorded a value, and an
 * estimate flag describes *how good* it is. `estimated` is a `NutritionValueKind`
 * rather than a source kind, but the amounts are still points and not ranges —
 * they carry no tolerance — so restating them as estimates would claim a
 * precision contract the envelope cannot honour. The honest answer is the true
 * source kind with the caveat stated in words beside it.
 */
function mapIngredientPer100g(wire: AdminIngredient): NutritionFacts | null {
    const payload = wire.nutrition_per_100g;
    if (payload == null) return null;

    const recordedAt = wire.updated_at ?? UNKNOWN_ISO_DATE_TIME;
    const estimated = wire.nutrition_estimated === true;
    const note = wire.nutrition_note ?? null;

    return {
        basis: 'per_100g',
        kind: 'actual',
        serving: null,
        totalGrams: 100,
        amounts: payload.amounts.map((amount) => ({
            nutrientId: amount.nutrient_id,
            unit: amount.unit,
            value: amount.value,
            kind: 'actual',
            tolerance: null,
        })),
        source: {
            // See the note above on why an estimate does not move this.
            kind: 'professional_entry',
            label: estimated
                ? 'Estimated reference facts — representative of the category, not measured'
                : 'Kitchen-recorded reference facts',
            version: 'ingredient-record',
            calculatedAt: recordedAt,
        },
        calculation: {
            method: 'as_recorded',
            basis: 'per_100g',
            calculatedAt: recordedAt,
            prototype: false,
            rounding: 'as_entered',
            notes: note === null ? [] : [note],
        },
    };
}

/* ------------------------------------------------------------------------------------------------
 * Shared catalogue mappings
 * ---------------------------------------------------------------------------------------------- */

export function mapKitchenId(organisationId: string): KitchenId {
    return KitchenId.unsafe(organisationId);
}

function parseDecimal(value: string | number | null | undefined, fallback = 0): number {
    if (value === null || value === undefined) return fallback;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function localised(en: string, ar: string | null | undefined): { en: string; ar: string } {
    return { en, ar: ar ?? '' };
}

export function mapCataloguePublishableStatus(status: CatalogueItemStatus): PublishableStatus {
    return status;
}

export function mapPriceListPublishableStatus(status: PriceListStatus): PublishableStatus {
    if (status === 'active') return 'published';
    if (status === 'archived') return 'retired';
    return 'draft';
}

export function mapDeliveryZonePublishableStatus(status: DeliveryZoneStatus): PublishableStatus {
    if (status === 'active') return 'published';
    if (status === 'archived') return 'retired';
    return 'draft';
}

/**
 * A recipe's state as a list renders it: the current version's, unless the identity is archived.
 *
 * The archive check comes first because it is the one fact the *identity* owns. `recipes.status` is
 * `active | archived`; everything else belongs to a version, and an archived recipe is retired
 * whatever its versions still say.
 *
 * This used to be derived from the identity plus `published_version_number` alone, which made
 * `review_required` unreachable — there was no input that could produce it. A recipe carrying a
 * quarantined version reported `published`, so the Review stat card sat at zero, `/kitchen/review`
 * never listed a recipe, and a quarantine was invisible on the one screen built to surface it.
 */
export function mapRecipeIdentityPublishableStatus(
    recipeStatus: AdminRecipe['status'],
    currentVersionStatus: RecipeVersionStatus | null,
    publishedVersionNumber: number | null,
): PublishableStatus {
    if (recipeStatus === 'archived') return 'retired';
    if (currentVersionStatus !== null)
        return mapRecipeVersionPublishableStatus(currentVersionStatus);

    // A recipe with no versions at all. The create path makes it unreachable, but the shape allows
    // it, and "published because something is published" is the honest fallback for a row that
    // predates the column.
    return publishedVersionNumber !== null ? 'published' : 'draft';
}

export function mapRecipeVersionPublishableStatus(status: RecipeVersionStatus): PublishableStatus {
    return status;
}

export function mapSalesChannelKind(kind: SalesChannelKind): SalesChannel {
    switch (kind) {
        case 'b2c_web':
            return 'b2c';
        case 'b2b':
            return 'b2b';
        case 'pos':
            return 'pos';
        case 'marketplace':
            return 'marketplace';
        case 'corporate':
            return 'corporate';
        default:
            return 'b2b';
    }
}

export interface SalesChannelLookup {
    readonly idToChannel: ReadonlyMap<string, AdminSalesChannel>;
}

export function buildSalesChannelLookup(
    channels: readonly AdminSalesChannel[],
): SalesChannelLookup {
    const idToChannel = new Map<string, AdminSalesChannel>();
    for (const channel of channels) {
        idToChannel.set(channel.id, channel);
    }
    return { idToChannel };
}

export function salesChannelForId(
    lookup: SalesChannelLookup,
    salesChannelId: string,
): SalesChannel {
    const channel = lookup.idToChannel.get(salesChannelId);
    if (channel === undefined) return 'b2c';
    return mapSalesChannelKind(channel.channel_kind);
}

export function mapChannelAssignments(
    wireChannels: readonly AdminChannelAssignment[],
    lookup: SalesChannelLookup,
): readonly ChannelAvailability[] {
    return wireChannels.map((row) => ({
        channel: salesChannelForId(lookup, row.sales_channel_id),
        isAvailable: row.is_available,
        availableFrom: row.available_from,
        availableUntil: row.available_to,
    }));
}

export function mapProductPackVariants(
    variants: readonly AdminCatalogueItemVariant[],
): readonly ProductPackVariant[] {
    return variants
        .filter((variant) => variant.pack !== null)
        .map((variant) => {
            const pack = variant.pack!;
            return {
                code: variant.code,
                label: localised(variant.name_en ?? variant.code, variant.name_ar),
                netQuantity: parseDecimal(pack.pack_quantity),
                netUnit: mapMeasureUnit(null),
                unitsPerPack: pack.pack_piece_count ?? 1,
            };
        });
}

function mapCatalogueItemMeta(wire: AdminCatalogueItem): IngredientAdmin['meta'] {
    return {
        lockVersion: wire.lock_version,
        status: mapCataloguePublishableStatus(wire.status),
        updatedAt: wire.updated_at ?? UNKNOWN_ISO_DATE_TIME,
        updatedByName: null,
    };
}

export function mapProductAdminFromItem(
    wire: AdminCatalogueItem,
    options?: {
        readonly packVariants?: readonly ProductPackVariant[];
        readonly channelAvailability?: readonly ChannelAvailability[];
        readonly dietClassifications?: readonly DietClassification[];
    },
): ProductAdmin {
    return {
        id: ProductId.unsafe(wire.id),
        meta: mapCatalogueItemMeta(wire),
        itemType:
            wire.item_type === 'sauce' || wire.item_type === 'dressing'
                ? wire.item_type
                : 'product',
        reference: wire.source_ref ?? null,
        name: localised(wire.name_en, wire.name_ar),
        description: localised(wire.description_en ?? '', wire.description_ar),
        categoryId: wire.product_category_id ?? null,
        categoryCode: wire.product_category_code ?? 'uncategorized',
        kitchenCategory: wire.kitchen_category ?? null,
        kitchenSubcategory: wire.kitchen_subcategory ?? null,
        composition: wire.composition ?? null,
        kitchenId: mapKitchenId(wire.organisation_id),
        isMarketPriced: wire.is_market_priced,
        isAssorted: wire.is_assorted,
        packVariants: options?.packVariants ?? [],
        channelAvailability: options?.channelAvailability ?? [],
        recipeId: wire.recipe_id == null ? null : RecipeId.unsafe(wire.recipe_id),
        dietClassifications: options?.dietClassifications ?? [],
        dataQualityFlags: wire.data_quality_flags,
    };
}

type MealAvailabilityDayWire = {
    readonly date: string;
    readonly is_available: boolean;
    readonly remaining_portions: number | null;
    readonly order_cut_off_at: string | null;
};

export function mapMealAdminFromItem(
    wire: AdminCatalogueItem & {
        readonly availability_days?: readonly MealAvailabilityDayWire[];
    },
    options?: {
        readonly channelAvailability?: readonly ChannelAvailability[];
        readonly dietClassifications?: readonly DietClassification[];
        readonly allergens?: readonly AllergenCode[];
        readonly availability?: readonly MealAvailabilityDay[];
    },
): MealAdmin {
    const availabilityFromWire =
        wire.availability_days === undefined
            ? undefined
            : mapMealAvailabilityDays(wire.availability_days);

    return {
        id: MealId.unsafe(wire.id),
        meta: mapCatalogueItemMeta(wire),
        name: localised(wire.name_en, wire.name_ar),
        description: localised(wire.description_en ?? '', wire.description_ar),
        kitchenCategory: wire.kitchen_category ?? null,
        kitchenSubcategory: wire.kitchen_subcategory ?? null,
        composition: wire.composition ?? null,
        kitchenId: mapKitchenId(wire.organisation_id),
        recipeId: wire.recipe_id == null ? null : RecipeId.unsafe(wire.recipe_id),
        recipeVersionId: null,
        // The `== null` fallback is for a payload predating the column, not for
        // a server that omits it: the field is required on `AdminCatalogueItem`
        // and NOT NULL in the database, and one piece per sold unit is exactly
        // what a row without the column meant.
        portionFactor: wire.portion_factor == null ? 1 : Number(wire.portion_factor),
        mealTypes: [],
        dietClassifications: options?.dietClassifications ?? [],
        allergens: options?.allergens ?? [],
        channelAvailability: options?.channelAvailability ?? [],
        availability: options?.availability ?? availabilityFromWire ?? [],
        imagePlaceholderId: wire.image_placeholder_id ?? '',
        marginPercent: null,
    };
}

export function mapMealAvailabilityDays(
    days: readonly {
        readonly date: string;
        readonly is_available: boolean;
        readonly remaining_portions: number | null;
        readonly order_cut_off_at: string | null;
    }[],
): readonly MealAvailabilityDay[] {
    return days.map((day) => ({
        date: day.date,
        isAvailable: day.is_available,
        remaining: day.remaining_portions,
        orderCutOffAt: day.order_cut_off_at,
    }));
}

/**
 * The roll-up preview, as the editor's Technical sheet reads it.
 *
 * The three nutrition fields are `null` or they are facts, and the `null` is
 * load-bearing: the server withholds all three the moment one line cannot be
 * resolved, and `warnings` names the ingredients responsible. Nothing is
 * substituted for them here — an empty envelope would render as a panel of
 * zeroes, which is a claim about the dish rather than a gap in the data.
 */
export function mapRecipeRollupPreview(wire: WireRecipeRollupPreview): RecipeRollupPreview {
    const estimated =
        wire.estimated_cost !== null && isCurrencyCode(wire.estimated_cost.currency)
            ? {
                  amount: Number(wire.estimated_cost.amount),
                  currency: wire.estimated_cost.currency,
              }
            : null;

    const warnings: RollupWarning[] = wire.warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        ingredientIds: (warning.ingredient_ids ?? []).map((id) => IngredientId.unsafe(id)),
    }));

    return {
        perRecipe: wire.per_recipe === null ? null : mapNutritionFacts(wire.per_recipe),
        perServing: wire.per_serving === null ? null : mapNutritionFacts(wire.per_serving),
        per100g: wire.per_100g === null ? null : mapNutritionFacts(wire.per_100g),
        allergenSources: wire.allergen_sources.flatMap((source) => {
            if (!ALLERGEN_CONTAINMENTS.includes(source.containment as AllergenContainment)) {
                return [];
            }
            return [
                {
                    allergenCode: AllergenCode.unsafe(source.allergen_code),
                    containment: source.containment as AllergenContainment,
                    ingredientIds: source.ingredient_ids.map((id) => IngredientId.unsafe(id)),
                },
            ];
        }),
        estimatedCost: estimated,
        computedCost: mapComputedCost(wire.computed_cost),
        warnings,
    };
}

export function mapPlanAdminFromItem(
    wire: AdminCatalogueItem,
    options?: {
        readonly profile?: PlanProfile | null;
        readonly variants?: readonly PlanVariantAdmin[];
        readonly durations?: readonly PlanDurationAdmin[];
        readonly combinations?: readonly PlanCombination[];
    },
): PlanAdmin {
    const profile = options?.profile;

    return {
        id: SubscriptionPlanId.unsafe(wire.id),
        meta: mapCatalogueItemMeta(wire),
        name: localised(wire.name_en, wire.name_ar),
        summary: localised(profile?.summary_en ?? '', profile?.summary_ar),
        description: localised(wire.description_en ?? '', wire.description_ar),
        kitchenId: mapKitchenId(wire.organisation_id),
        categorySlugs: [],
        dietClassifications: [],
        variants: options?.variants ?? [],
        durations: options?.durations ?? [],
        combinations: options?.combinations ?? [],
        changeCutOffHours: profile?.change_cutoff_hours ?? 24,
        deliveryWeekdays: [1, 2, 3, 4, 5],
    };
}

export function mapRecipeAdminSummary(
    wire: AdminRecipe,
    options?: {
        readonly currentVersionNumber?: number;
        readonly versionCount?: number;
        readonly currentVersionStatus?: PublishableStatus;
        readonly allergenCodes?: readonly AllergenCode[];
    },
): RecipeAdminSummary {
    const currentVersionNumber =
        options?.currentVersionNumber ?? wire.published_version_number ?? 1;

    return {
        id: RecipeId.unsafe(wire.id),
        meta: {
            lockVersion: wire.lock_version,
            status: mapRecipeIdentityPublishableStatus(
                wire.status,
                wire.current_version_status,
                wire.published_version_number,
            ),
            updatedAt: wire.updated_at ?? UNKNOWN_ISO_DATE_TIME,
            updatedByName: null,
        },
        name: localised(wire.name_en, wire.name_ar),
        slug: wire.slug,
        kitchenId:
            wire.branch_id === null || wire.branch_id === undefined
                ? mapKitchenId(wire.organisation_id)
                : KitchenId.unsafe(wire.branch_id),
        reference: wire.source_ref ?? null,
        sourceKind: wire.source_kind ?? null,
        recipeCategory: wire.recipe_category ?? null,
        currentVersionNumber,
        versionCount: options?.versionCount ?? 1,
        currentVersionStatus:
            options?.currentVersionStatus ??
            (wire.current_version_status === null
                ? 'draft'
                : mapRecipeVersionPublishableStatus(wire.current_version_status)),
        allergenCodes:
            options?.allergenCodes ??
            wire.current_version_allergen_codes.map((code) => AllergenCode.unsafe(code)),
    };
}

export function pickCurrentRecipeVersion(
    versions: readonly AdminRecipeVersion[],
): AdminRecipeVersion | null {
    if (versions.length === 0) return null;

    const editable = versions.filter(
        (version) => version.status === 'draft' || version.status === 'review_required',
    );
    if (editable.length > 0) {
        return editable.reduce((best, version) =>
            version.version_number > best.version_number ? version : best,
        );
    }

    const published = versions.filter((version) => version.status === 'published');
    if (published.length > 0) {
        return published.reduce((best, version) =>
            version.version_number > best.version_number ? version : best,
        );
    }

    return versions.reduce((best, version) =>
        version.version_number > best.version_number ? version : best,
    );
}

/** Unit id → platform code, from `/catalogue/procurement/reference`. Empty when unreadable. */
export type UnitCodeLookup = ReadonlyMap<string, string>;

const NO_UNIT_LOOKUP: UnitCodeLookup = new Map<string, string>();

function measureUnitById(id: string | null | undefined, units: UnitCodeLookup): MeasureUnit {
    return mapMeasureUnit(id === null || id === undefined ? null : units.get(id));
}

function mapRecipeLine(wire: WireRecipeLine, units: UnitCodeLookup): RecipeLine {
    return {
        ingredientId: IngredientId.unsafe(wire.ingredient_id),
        ingredientName: localised(wire.source_designation ?? '', undefined),
        quantity: parseDecimal(wire.quantity),
        unit: measureUnitById(wire.unit_id, units),
        sourceDesignation: wire.source_designation ?? null,
        isOptional: false,
        lineCost: null,
    };
}

function mapRecipeOutput(wire: WireRecipeOutput, units: UnitCodeLookup): RecipeOutput {
    return {
        ingredientId: IngredientId.unsafe(wire.ingredient_id),
        ingredientName: localised('', undefined),
        quantity: parseDecimal(wire.output_quantity),
        unit: measureUnitById(wire.unit_id, units),
        isPrimary: wire.is_primary,
    };
}

function mapRecipeStep(wire: WireRecipeStep): RecipeStepAdmin {
    return {
        index: wire.step_number,
        instruction: localised(wire.instruction_en, wire.instruction_ar),
        minutes: wire.minutes ?? null,
    };
}

function mapRecipeAllergen(wire: RecipeVersionAllergen): RecipeAllergenDeclaration {
    const sourceIds =
        wire.source_ingredient_id === null || wire.source_ingredient_id === undefined
            ? []
            : [IngredientId.unsafe(wire.source_ingredient_id)];

    return {
        allergenCode: AllergenCode.unsafe(wire.allergen_code),
        containment: wire.containment,
        origin: wire.derivation,
        sourceIngredientIds: sourceIds,
    };
}

/** One packaging line on a recipe version, wire → contract. */
export interface WireRecipePackagingLine {
    readonly id: string;
    readonly line_number: number;
    readonly ingredient_id: string;
    readonly basis: string;
    readonly quantity: string | null;
    readonly unit_id: string | null;
    readonly comment: string | null;
}

function mapPackagingBasis(basis: string): PackagingBasis {
    return basis === 'per_container' || basis === 'per_batch' ? basis : 'fills_yield';
}

export function mapRecipePackagingLine(
    wire: WireRecipePackagingLine,
    units: UnitCodeLookup = NO_UNIT_LOOKUP,
): RecipePackagingLine {
    return {
        ingredientId: IngredientId.unsafe(wire.ingredient_id),
        basis: mapPackagingBasis(wire.basis),
        // The server computes this for two of the three bases, so it is read rather than echoed.
        quantity: parseDecimal(wire.quantity ?? '0', 0),
        unit: measureUnitById(wire.unit_id, units),
        comment: wire.comment ?? null,
    };
}

export function mapRecipeVersionAdmin(
    wire: AdminRecipeVersion,
    details: {
        readonly lines: readonly WireRecipeLine[];
        readonly packaging?: readonly WireRecipePackagingLine[] | undefined;
        readonly outputs: readonly WireRecipeOutput[];
        readonly steps: readonly WireRecipeStep[];
        readonly allergens: readonly RecipeVersionAllergen[];
    },
    units: UnitCodeLookup = NO_UNIT_LOOKUP,
): RecipeVersionAdmin {
    return {
        id: RecipeVersionId.unsafe(wire.id),
        recipeId: RecipeId.unsafe(wire.recipe_id),
        versionNumber: wire.version_number,
        status: mapRecipeVersionPublishableStatus(wire.status),
        yieldQuantity: parseDecimal(wire.yield_quantity, 1),
        yieldUnit: measureUnitById(wire.yield_unit_id, units),
        yieldPieces: wire.yield_piece_count ?? null,
        wastePercent: parseDecimal(wire.waste_coefficient_percent, 3),
        // The two list prices share one currency by construction — the column CHECK refuses an
        // amount without one — so both read the same code rather than each carrying its own.
        b2bPrice: mapCostAmount(wire.b2b_price_amount, wire.price_currency_code),
        b2cPrice: mapCostAmount(wire.b2c_price_amount, wire.price_currency_code),
        lines: details.lines.map((line) => mapRecipeLine(line, units)),
        packaging: (details.packaging ?? []).map((line) => mapRecipePackagingLine(line, units)),
        outputs: details.outputs.map((output) => mapRecipeOutput(output, units)),
        steps: details.steps.map(mapRecipeStep),
        allergens: details.allergens.map(mapRecipeAllergen),
        estimatedCost: null,
        derivationStale: wire.derivation_state === 'stale',
        publishedAt: wire.published_at ?? null,
    };
}

export function mapRecipeAdmin(
    recipeWire: AdminRecipe,
    versionsWire: readonly AdminRecipeVersion[],
    currentVersion: RecipeVersionAdmin,
): RecipeAdmin {
    const summary = mapRecipeAdminSummary(recipeWire, {
        currentVersionNumber: currentVersion.versionNumber,
        versionCount: versionsWire.length,
        // Taken from the version this read already resolved rather than from the wire fields.
        //
        // Only the *listing* fills `current_version_status` and `current_version_allergen_codes`:
        // the single-resource reads return the versions themselves, so the controller has nothing to
        // compute and sends null. Left alone, a record would report `published` on its own page
        // while the list it was opened from said `review_required` — the same recipe disagreeing
        // with itself one click apart.
        currentVersionStatus: currentVersion.status,
        allergenCodes: currentVersion.allergens.map((declared) => declared.allergenCode),
    });

    const currentVersionId = currentVersion.id;

    const versions: readonly RecipeVersionSummary[] = [...versionsWire]
        .sort((left, right) => right.version_number - left.version_number)
        .map((version) => ({
            id: RecipeVersionId.unsafe(version.id),
            versionNumber: version.version_number,
            status: mapRecipeVersionPublishableStatus(version.status),
            publishedAt: version.published_at ?? null,
            updatedAt: version.updated_at ?? summary.meta.updatedAt,
            isCurrent: RecipeVersionId.unsafe(version.id) === currentVersionId,
        }));

    return {
        ...summary,
        description: localised(recipeWire.notes ?? '', undefined),
        currentVersion,
        versions,
    };
}

function mapCostAmount(
    amount: string | null | undefined,
    currency: string | null | undefined,
): CostAmount | null {
    if (amount === null || amount === undefined || currency === null || currency === undefined) {
        return null;
    }

    const parsed = Number(amount);

    return Number.isFinite(parsed)
        ? { amount: parsed, currency: currency as CostAmount['currency'] }
        : null;
}

/**
 * The live cost block, wire → contract.
 *
 * `currency_code` is the block's, not each figure's: every amount inside one computation shares it
 * by construction, because a formulation carrying two currencies is refused rather than blended.
 */
function mapComputedCost(wire: WireComputedCost | null | undefined): RecipeComputedCost | null {
    if (wire === null || wire === undefined) return null;

    const currency = wire.currency_code;
    const amount = (value: string | null): CostAmount | null => mapCostAmount(value, currency);

    return {
        currency: isCurrencyCode(currency) ? currency : null,
        production: {
            total: amount(wire.production.total_input_cost_amount),
            costPerYieldUnit: amount(wire.production.cost_per_yield_unit_amount),
            costPerYieldUnitWithWaste: amount(
                wire.production.cost_per_yield_unit_with_waste_amount,
            ),
            costPerPiece: amount(wire.production.cost_per_piece_amount),
            costPerPieceWithWaste: amount(wire.production.cost_per_piece_with_waste_amount),
            wastePercent: Number(wire.production.waste_percent),
            uncostedLineNumbers: wire.production.uncosted_line_numbers,
            isComplete: wire.production.is_complete,
        },
        packaging: {
            total: amount(wire.packaging.total_packaging_cost_amount),
            costPerYieldUnit: amount(wire.packaging.cost_per_yield_unit_amount),
            costPerYieldUnitWithWaste: amount(wire.packaging.cost_per_yield_unit_with_waste_amount),
            wastePercent: Number(wire.packaging.waste_percent),
            uncostedLineNumbers: wire.packaging.uncosted_line_numbers,
            isComplete: wire.packaging.is_complete,
        },
        totalCostPerYieldUnit: amount(wire.total_cost_per_yield_unit_amount),
    };
}

/**
 * The weekly-priced block.
 *
 * Not nullable, unlike `computed`: a formulation nothing could be priced brings back an empty cost
 * block with its line sources intact, because "which ingredient has no price" is the whole answer in
 * that case and a null would throw it away.
 */
function mapWeeklyCost(wire: WireWeeklyCost): RecipeWeeklyCost {
    const base = mapComputedCost(wire);

    return {
        ...(base ?? {
            currency: null,
            production: {
                total: null,
                costPerYieldUnit: null,
                costPerYieldUnitWithWaste: null,
                costPerPiece: null,
                costPerPieceWithWaste: null,
                wastePercent: 0,
                uncostedLineNumbers: [],
                isComplete: false,
            },
            packaging: {
                total: null,
                costPerYieldUnit: null,
                costPerYieldUnitWithWaste: null,
                wastePercent: 0,
                uncostedLineNumbers: [],
                isComplete: false,
            },
            totalCostPerYieldUnit: null,
        }),
        weeklyPricePublicationId: wire.weekly_price_publication_id ?? null,
        hasCarriedForwardPrices: wire.has_carried_forward_prices,
        ingredientsNeedingInitialPrice: wire.ingredients_needing_initial_price.map((id) =>
            IngredientId.unsafe(id),
        ),
        lineSources: wire.line_sources.map((source) => ({
            lineNumber: source.line_number,
            ingredientId: IngredientId.unsafe(source.ingredient_id),
            source: source.cost_source,
            unitCost: mapCostAmount(source.unit_cost_amount, source.cost_currency_code),
            effectiveFrom: source.effective_from ?? null,
            sourceRecipeVersionId:
                source.source_recipe_version_id === null || source.source_recipe_version_id === undefined
                    ? null
                    : RecipeVersionId.unsafe(source.source_recipe_version_id),
            carriedForward: source.carried_forward,
        })),
    };
}

function mapCostFigures(wire: WireCostSnapshot | null): RecipeCostFigures | null {
    if (wire === null) return null;

    const total = mapCostAmount(wire.total_input_cost_amount, wire.currency_code);
    if (total === null) return null;

    return {
        totalInputCost: total,
        costPerYieldUnit: mapCostAmount(wire.cost_per_yield_unit_amount, wire.currency_code),
        costPerYieldUnitWithWaste: mapCostAmount(
            wire.cost_per_yield_unit_with_waste_amount,
            wire.currency_code,
        ),
        costPerPiece: mapCostAmount(wire.cost_per_piece_amount, wire.currency_code),
        costPerPieceWithWaste: mapCostAmount(
            wire.cost_per_piece_with_waste_amount,
            wire.currency_code,
        ),
        wastePercent: Number(wire.waste_coefficient_percent),
        basisMismatch: wire.basis_mismatch,
        calculatedAt: wire.calculated_at,
    };
}

export function mapTechnicalSheetAdmin(wire: WireTechnicalSheet): TechnicalSheetAdmin {
    return {
        versionId: RecipeVersionId.unsafe(wire.version.id),
        currency: (wire.currency_code ?? null) as TechnicalSheetAdmin['currency'],
        currencyConflict: wire.currency_conflict,
        lines: wire.lines.map((line) => ({
            lineNumber: line.line_number,
            ingredientId: IngredientId.unsafe(line.ingredient_id),
            unitCost: mapCostAmount(line.unit_cost_amount, line.cost_currency_code),
            lineCost: mapCostAmount(line.line_cost_amount, line.cost_currency_code),
            comment: line.comment ?? null,
        })),
        uncostedLineNumbers: wire.uncosted_line_numbers,
        asRecorded: mapCostFigures(wire.snapshots.as_recorded),
        recalculated: mapCostFigures(wire.snapshots.recalculated),
        computed: mapComputedCost(wire.computed),
        weekly: mapWeeklyCost(wire.weekly),
    };
}

function mapPriceStatus(wire: PriceStatus): PriceListEntry['priceStatus'] {
    return wire;
}

export function mapPriceListEntry(
    wire: AdminPriceListEntry,
    itemType: AdminCatalogueItem['item_type'],
    itemId: string,
    variantCode: string | null,
): PriceListEntry {
    const itemRef =
        itemType === 'product'
            ? {
                  kind: 'product' as const,
                  productId: ProductId.unsafe(itemId),
                  packCode: variantCode,
              }
            : itemType === 'meal'
              ? { kind: 'meal' as const, mealId: MealId.unsafe(itemId) }
              : {
                    kind: 'plan' as const,
                    planId: SubscriptionPlanId.unsafe(itemId),
                    variantId:
                        wire.catalogue_item_variant_id === null ||
                        wire.catalogue_item_variant_id === undefined
                            ? null
                            : PlanVariantId.unsafe(wire.catalogue_item_variant_id),
                };

    return {
        item: itemRef,
        priceStatus: mapPriceStatus(wire.price_status),
        amountMinor: wire.unit_amount_minor ?? null,
        effectiveFrom: wire.effective_from,
        effectiveUntil: wire.effective_to ?? null,
        note: null,
    };
}

export function mapPriceListAdmin(
    wire: AdminPriceList,
    options?: {
        readonly channels?: readonly SalesChannel[];
        readonly entries?: readonly PriceListEntry[];
    },
): PriceListAdmin {
    const channels =
        options?.channels ??
        (wire.customer_scope === 'agreement' ? (['b2b'] as const) : (['b2c'] as const));

    return {
        id: PriceListId.unsafe(wire.id),
        meta: {
            lockVersion: wire.lock_version,
            status: mapPriceListPublishableStatus(wire.status),
            updatedAt: wire.updated_at ?? UNKNOWN_ISO_DATE_TIME,
            updatedByName: null,
        },
        name: localised(wire.name_en, wire.name_ar),
        currency: isCurrencyCode(wire.currency_code) ? wire.currency_code : 'USD',
        kitchenId:
            wire.branch_id === null || wire.branch_id === undefined
                ? mapKitchenId(wire.organisation_id)
                : KitchenId.unsafe(wire.branch_id),
        channels,
        entries: options?.entries ?? [],
    };
}

export function mapDeliveryWindow(wire: WireDeliveryWindow): DeliveryWindow {
    return {
        id: DeliveryWindowId.unsafe(wire.id),
        label: localised(wire.name_en, wire.name_ar),
        weekdays: wire.weekdays.length === 0 ? [1, 2, 3, 4, 5, 6, 7] : wire.weekdays,
        startsAt: wire.starts_at ?? '00:00',
        endsAt: wire.ends_at ?? '00:00',
        capacity: null,
        isActive: wire.is_active,
    };
}

export function mapServiceAreaFromDeliveryArea(wire: AdminDeliveryArea): ServiceArea {
    return {
        id: ServiceAreaId.unsafe(wire.id),
        name: localised(wire.name_en, wire.name_ar),
        countryCode: wire.country_code,
        parentName: wire.region === null ? null : localised(wire.region, wire.region),
        isActive: wire.is_active,
    };
}

export function mapDeliveryZoneAdmin(
    wire: DeliveryZone,
    options?: {
        readonly areas?: readonly ServiceArea[];
        readonly deliveryWindows?: readonly DeliveryWindow[];
    },
): DeliveryZoneAdmin {
    return {
        id: DeliveryZoneId.unsafe(wire.id),
        meta: {
            lockVersion: wire.lock_version,
            status: mapDeliveryZonePublishableStatus(wire.status),
            updatedAt: wire.updated_at ?? UNKNOWN_ISO_DATE_TIME,
            updatedByName: null,
        },
        name: localised(wire.name_en, wire.name_ar),
        kitchenId:
            wire.branch_id === null
                ? mapKitchenId(wire.organisation_id)
                : KitchenId.unsafe(wire.branch_id),
        branchIds: wire.branch_id === null ? [] : [KitchenBranchId.unsafe(wire.branch_id)],
        areas: options?.areas ?? [],
        deliveryFeeMinor: wire.delivery_fee_minor,
        minimumOrderMinor: wire.minimum_order_minor,
        currency: isCurrencyCode(wire.currency_code) ? wire.currency_code : 'USD',
        estimatedMinutes: wire.estimated_minutes,
        deliveryWindows: options?.deliveryWindows ?? [],
    };
}

export function mapPlanCombination(option: MealCombinationOption): PlanCombination {
    return {
        code: option.code,
        label: localised(option.name_en, option.name_ar),
        mealsPerDay: option.meals_per_day,
        snacksPerDay: 0,
        isAvailable: option.is_active,
    };
}

export function mapPlanDuration(option: PlanDurationOption): PlanDurationAdmin {
    return {
        kind: option.duration_kind,
        days: option.duration_days,
        discountPercent: null,
    };
}

/**
 * One cell, one variant.
 *
 * A cell carries its own `catalogue_item_variant_id`, and its identity on this API is the
 * combination *and* the band *and* the service tier — so an energy band routinely holds several
 * cells. Keying by `energy_band_id` alone and taking the first of each group silently discarded
 * every other variant in the band: the seeded family plan (one meal a day at 1600–1900 kcal in
 * three household sizes) read back as a single variant, and a cell switched on in a band that
 * already had one vanished on the next read while sitting in PostgreSQL.
 *
 * A band the plan does not portion by is `null` rather than missing, so it maps to the `0–0` band
 * the editor draws as "no band" instead of dropping the cell.
 */
export function mapPlanVariantsFromCells(
    cells: readonly PlanVariantCell[],
    bands: ReadonlyMap<string, EnergyBand>,
): readonly PlanVariantAdmin[] {
    return cells.map((cell) => {
        const band = cell.energy_band_id === null ? undefined : bands.get(cell.energy_band_id);

        return {
            id: PlanVariantId.unsafe(cell.catalogue_item_variant_id),
            name: localised(
                cell.name_en ?? band?.name_en ?? cell.code,
                cell.name_ar ?? band?.name_ar,
            ),
            energyBand: band ? { min: band.min_kcal, max: band.max_kcal } : { min: 0, max: 0 },
            mealsPerDay: cell.meals_per_day,
            snacksPerDay: cell.snacks_per_day,
            isActive: cell.status === 'active',
        };
    });
}

/**
 * One menu entry.
 *
 * The dish's name comes down resolved (`meal_name_en` / `meal_name_ar`) so a fourteen-day menu
 * renders from one read rather than fourteen; both sides are nullable on the wire for the row whose
 * meal has since been withdrawn, and an empty string is the honest rendering of that — the editor
 * says "this dish is gone" from the absence rather than from an invented name.
 */
function mapPlanMenuEntry(wire: WirePlanMenuEntry): PlanMenuEntry {
    return {
        id: wire.id,
        cycleDay: wire.cycle_day,
        slot: wire.slot,
        sequence: wire.sequence,
        mealId: MealId.unsafe(wire.meal_catalogue_item_id),
        mealName: localised(wire.meal_name_en ?? '', wire.meal_name_ar),
    };
}

/**
 * A plan's fixed menu, from the envelope that carries all three of its parts.
 *
 * `meta` is the **catalogue item's**, not the profile's: `subscription_plan_profiles` carries no
 * lock version, so the item's is what `If-Match` sends — the same rule the profile write follows.
 *
 * Entries arrive in the server's order and are kept in it. Sorting them here would put a second
 * opinion about what order a menu is in between the server and the screen, and the editor groups
 * them by day anyway.
 */
export function mapPlanMenu(
    item: AdminCatalogueItem,
    cycle: WirePlanMenuCycle,
    entries: readonly WirePlanMenuEntry[],
): PlanMenu {
    return {
        planId: SubscriptionPlanId.unsafe(item.id),
        meta: mapCatalogueItemMeta(item),
        cycleDays: cycle.cycle_days,
        anchorDate: cycle.anchor_date,
        entries: entries.map(mapPlanMenuEntry),
    };
}

export function mapBranchOperating(
    branchId: KitchenBranchId,
    daysWire: readonly WireBranchOperatingDay[],
): BranchOperating {
    const byWeekday = new Map(daysWire.map((day) => [day.weekday, day]));
    const days: BranchOperatingDay[] = [];

    for (let weekday = 1; weekday <= 7; weekday += 1) {
        const wire = byWeekday.get(weekday);
        if (wire === undefined) {
            days.push({
                weekday,
                opensAt: null,
                closesAt: null,
                orderCutOffAt: null,
            });
            continue;
        }

        days.push({
            weekday,
            opensAt: wire.is_open ? wire.opens_at : null,
            closesAt: wire.is_open ? wire.closes_at : null,
            orderCutOffAt: wire.order_cut_off_at,
        });
    }

    return {
        branchId,
        meta: {
            lockVersion: 0,
            updatedAt: UNKNOWN_ISO_DATE_TIME,
            updatedByName: null,
        },
        timeZone: 'UTC',
        days,
    };
}

export function mapDerivedAllergenCodes(
    allergens: readonly DerivedAllergen[],
): readonly AllergenCode[] {
    return allergens.map((row) => AllergenCode.unsafe(row.allergen_code));
}

export function priceListChannelsFromAssignments(
    assignments: readonly PriceListChannelAssignment[],
    lookup: SalesChannelLookup,
): readonly SalesChannel[] {
    const channels: SalesChannel[] = [];
    for (const assignment of assignments) {
        const mapped = salesChannelForId(lookup, assignment.sales_channel_id);
        if (!channels.includes(mapped)) channels.push(mapped);
    }
    return channels;
}
