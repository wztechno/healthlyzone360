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
import { isMeasureUnit, type MeasureUnit } from '@healthy360/nutrition';

import type {
    BranchOperating,
    BranchOperatingDay,
    ChannelAvailability,
    DeliveryWindow,
    DeliveryZoneAdmin,
    IngredientAdmin,
    IngredientAllergenMapping,
    MealAdmin,
    PlanAdmin,
    PlanCombination,
    PlanDurationAdmin,
    PlanVariantAdmin,
    PriceListAdmin,
    PriceListEntry,
    ProductAdmin,
    ProductPackVariant,
    PublishableStatus,
    RecipeAdmin,
    RecipeAdminSummary,
    RecipeAllergenDeclaration,
    RecipeLine,
    RecipeOutput,
    RecipeStepAdmin,
    RecipeVersionAdmin,
    RecipeVersionSummary,
    ServiceArea,
} from '../contracts/kitchen-admin.ts';
import { UNKNOWN_ISO_DATE_TIME } from './mappers.ts';
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
    PlanProfile,
    PlanVariantCell,
    PriceListChannelAssignment,
    PriceListStatus,
    RecipeLine as WireRecipeLine,
    RecipeOutput as WireRecipeOutput,
    RecipeStep as WireRecipeStep,
    RecipeVersionAllergen,
    RecipeVersionStatus,
    SalesChannelKind,
    BranchOperatingDay as WireBranchOperatingDay,
    CatalogueItemStatus,
    DeliveryZoneStatus,
    PriceStatus,
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
}

export function buildCategoryLookup(categories: readonly WireIngredientCategory[]): CategoryLookup {
    const codeToId = new Map<string, string>();
    const idToCode = new Map<string, string>();

    for (const category of categories) {
        codeToId.set(category.code, category.id);
        idToCode.set(category.id, category.code);
    }

    return { codeToId, idToCode };
}

function categoryCodeFor(
    lookup: CategoryLookup,
    categoryId: string | null,
    subcategoryId: string | null | undefined,
): string {
    if (subcategoryId !== null && subcategoryId !== undefined) {
        const sub = lookup.idToCode.get(subcategoryId);
        if (sub !== undefined) return sub;
    }

    if (categoryId !== null) {
        const parent = lookup.idToCode.get(categoryId);
        if (parent !== undefined) return parent;
    }

    return 'uncategorized';
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

export function mapIngredientAdmin(
    wire: AdminIngredient,
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
        categoryCode: categoryCodeFor(
            lookup,
            wire.ingredient_category_id,
            wire.ingredient_subcategory_id,
        ),
        measurementUnit: mapMeasureUnit(wire.default_unit_code),
        costPer100g: null,
        per100g: null,
        allergens: options?.allergens ?? [],
        dietClassifications: [],
        aliases: options?.aliases ?? [],
        organisationId:
            wire.organisation_id === null ? null : OrganisationId.unsafe(wire.organisation_id),
        notes: wire.notes ?? null,
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

export function mapRecipeIdentityPublishableStatus(
    recipeStatus: AdminRecipe['status'],
    publishedVersionNumber: number | null,
): PublishableStatus {
    if (recipeStatus === 'archived') return 'retired';
    if (publishedVersionNumber !== null) return 'published';
    return 'draft';
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

export function buildSalesChannelLookup(channels: readonly AdminSalesChannel[]): SalesChannelLookup {
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
                label: localised(
                    variant.name_en ?? variant.code,
                    variant.name_ar,
                ),
                netQuantity: parseDecimal(pack.pack_quantity),
                netUnit: mapMeasureUnit(null),
                unitsPerPack: pack.pack_piece_count ?? 1,
            };
        });
}

function mapCatalogueItemMeta(
    wire: AdminCatalogueItem,
): IngredientAdmin['meta'] {
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
        name: localised(wire.name_en, wire.name_ar),
        description: localised(wire.description_en ?? '', wire.description_ar),
        categoryCode: wire.product_category_id ?? 'uncategorized',
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

export function mapMealAdminFromItem(
    wire: AdminCatalogueItem,
    options?: {
        readonly channelAvailability?: readonly ChannelAvailability[];
        readonly dietClassifications?: readonly DietClassification[];
        readonly allergens?: readonly AllergenCode[];
    },
): MealAdmin {
    return {
        id: MealId.unsafe(wire.id),
        meta: mapCatalogueItemMeta(wire),
        name: localised(wire.name_en, wire.name_ar),
        description: localised(wire.description_en ?? '', wire.description_ar),
        kitchenId: mapKitchenId(wire.organisation_id),
        recipeId: wire.recipe_id == null ? null : RecipeId.unsafe(wire.recipe_id),
        recipeVersionId: null,
        portionFactor: 1,
        mealTypes: [],
        dietClassifications: options?.dietClassifications ?? [],
        allergens: options?.allergens ?? [],
        channelAvailability: options?.channelAvailability ?? [],
        availability: [],
        imagePlaceholderId: wire.image_placeholder_id ?? '',
        marginPercent: null,
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
    options?: { readonly currentVersionNumber?: number; readonly versionCount?: number },
): RecipeAdminSummary {
    const currentVersionNumber =
        options?.currentVersionNumber ?? wire.published_version_number ?? 1;

    return {
        id: RecipeId.unsafe(wire.id),
        meta: {
            lockVersion: wire.lock_version,
            status: mapRecipeIdentityPublishableStatus(
                wire.status,
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
        currentVersionNumber,
        versionCount: options?.versionCount ?? 1,
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

function mapRecipeLine(wire: WireRecipeLine): RecipeLine {
    return {
        ingredientId: IngredientId.unsafe(wire.ingredient_id),
        ingredientName: localised(wire.source_designation ?? '', undefined),
        quantity: parseDecimal(wire.quantity),
        unit: mapMeasureUnit(null),
        sourceDesignation: wire.source_designation ?? null,
        isOptional: false,
        lineCost: null,
    };
}

function mapRecipeOutput(wire: WireRecipeOutput): RecipeOutput {
    return {
        ingredientId: IngredientId.unsafe(wire.ingredient_id),
        ingredientName: localised('', undefined),
        quantity: parseDecimal(wire.output_quantity),
        unit: mapMeasureUnit(null),
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

export function mapRecipeVersionAdmin(
    wire: AdminRecipeVersion,
    details: {
        readonly lines: readonly WireRecipeLine[];
        readonly outputs: readonly WireRecipeOutput[];
        readonly steps: readonly WireRecipeStep[];
        readonly allergens: readonly RecipeVersionAllergen[];
    },
): RecipeVersionAdmin {
    return {
        id: RecipeVersionId.unsafe(wire.id),
        recipeId: RecipeId.unsafe(wire.recipe_id),
        versionNumber: wire.version_number,
        status: mapRecipeVersionPublishableStatus(wire.status),
        yieldQuantity: parseDecimal(wire.yield_quantity, 1),
        yieldUnit: mapMeasureUnit(null),
        yieldPieces: wire.yield_piece_count ?? null,
        wastePercent: parseDecimal(wire.waste_coefficient_percent, 3),
        lines: details.lines.map(mapRecipeLine),
        outputs: details.outputs.map(mapRecipeOutput),
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
        branchIds:
            wire.branch_id === null
                ? []
                : [KitchenBranchId.unsafe(wire.branch_id)],
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

export function mapPlanVariantsFromCells(
    cells: readonly PlanVariantCell[],
    bands: ReadonlyMap<string, EnergyBand>,
): readonly PlanVariantAdmin[] {
    const grouped = new Map<string, PlanVariantCell[]>();

    for (const cell of cells) {
        const key = cell.energy_band_id ?? 'none';
        const group = grouped.get(key) ?? [];
        group.push(cell);
        grouped.set(key, group);
    }

    const variants: PlanVariantAdmin[] = [];

    for (const [bandKey, group] of grouped) {
        const lead = group[0]!;
        const band = bandKey === 'none' ? undefined : bands.get(bandKey);

        variants.push({
            id: PlanVariantId.unsafe(lead.catalogue_item_variant_id),
            name: localised(
                lead.name_en ?? band?.name_en ?? lead.code,
                lead.name_ar ?? band?.name_ar,
            ),
            energyBand: band
                ? { min: band.min_kcal, max: band.max_kcal }
                : { min: 0, max: 0 },
            mealsPerDay: lead.meals_per_day,
            snacksPerDay: lead.snacks_per_day,
            isActive: lead.status === 'active',
        });
    }

    return variants;
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
