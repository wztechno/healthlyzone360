import type {
    IngredientId,
    KitchenBranchId,
    DeliveryZoneId,
    MealId,
    PriceListId,
    ProductId,
    RecipeId,
    SubscriptionPlanId,
    DietClassification,
} from '@healthy360/domain-types';
import { isDietClassification } from '@healthy360/domain-types';

import type {
    BranchOperating,
    DeliveryZoneAdmin,
    IngredientAdmin,
    IngredientAdminFilter,
    KitchenAdminRepository,
    MealAdmin,
    MealAdminFilter,
    PlanAdmin,
    PlanAdminFilter,
    PriceListAdmin,
    PriceListAdminFilter,
    ProductAdmin,
    ProductAdminFilter,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
} from '../contracts/kitchen-admin.ts';
import type { CursorPage } from '../contracts/pagination.ts';
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
    MealCombinationOption,
    PaginationMeta,
    PlanDurationOption,
    PlanProfile,
    PlanVariantCell,
    PriceListChannelAssignment,
    RecipeLine as WireRecipeLine,
    RecipeOutput as WireRecipeOutput,
    RecipeStep as WireRecipeStep,
    RecipeVersionAllergen,
    BranchOperatingDay as WireBranchOperatingDay,
} from '../generated/types.ts';
import {
    apiStatusForPublishableFilter,
    buildCategoryLookup,
    buildSalesChannelLookup,
    mapBranchOperating,
    mapChannelAssignments,
    mapDerivedAllergenCodes,
    mapDeliveryWindow,
    mapDeliveryZoneAdmin,
    mapIngredientAdmin,
    mapIngredientAllergenMapping,
    mapMealAdminFromItem,
    mapPlanAdminFromItem,
    mapPlanCombination,
    mapPlanDuration,
    mapPlanVariantsFromCells,
    mapPriceListAdmin,
    mapPriceListEntry,
    mapProductAdminFromItem,
    mapProductPackVariants,
    mapRecipeAdmin,
    mapRecipeAdminSummary,
    mapRecipeVersionAdmin,
    mapServiceAreaFromDeliveryArea,
    pickCurrentRecipeVersion,
    priceListChannelsFromAssignments,
    type CategoryLookup,
    type SalesChannelLookup,
} from './kitchen-admin-mappers.ts';
import { mapCursorPage } from './marketplace-mappers.ts';
import type { Transport } from './transport.ts';

type CatalogueItemShowPayload = {
    readonly item: AdminCatalogueItem;
    readonly variants: AdminCatalogueItemVariant[];
    readonly diet_classifications: string[];
    readonly channels: AdminChannelAssignment[];
};

/**
 * Kitchen catalogue reads served by the API today.
 *
 * Writes still reject with `prototype.not_implemented` until their slices land.
 */
export type ApiKitchenAdminReads = Pick<
    KitchenAdminRepository,
    | 'listIngredients'
    | 'getIngredient'
    | 'listRecipes'
    | 'getRecipe'
    | 'listProducts'
    | 'getProduct'
    | 'listMeals'
    | 'getMeal'
    | 'listPlans'
    | 'getPlan'
    | 'listPriceLists'
    | 'getPriceList'
    | 'listZones'
    | 'getZone'
    | 'getBranchOperating'
>;

function cursorQuery(
    filter?: { readonly limit?: number; readonly cursor?: string; readonly query?: string },
    extra?: Record<string, string | undefined>,
): string {
    const search = new URLSearchParams();

    if (filter?.limit !== undefined) search.set('limit', String(filter.limit));
    if (filter?.cursor !== undefined) search.set('cursor', filter.cursor);
    if (filter?.query !== undefined && filter.query.trim() !== '') {
        search.set('query', filter.query.trim());
    }

    if (extra !== undefined) {
        for (const [key, value] of Object.entries(extra)) {
            if (value !== undefined && value !== '') search.set(key, value);
        }
    }

    const rendered = search.toString();
    return rendered === '' ? '' : `?${rendered}`;
}

export function createApiKitchenAdminReads(transport: Transport): ApiKitchenAdminReads {
    let categoryLookup: CategoryLookup | null = null;
    let salesChannelLookup: SalesChannelLookup | null = null;

    async function loadCategoryLookup(): Promise<CategoryLookup> {
        if (categoryLookup !== null) return categoryLookup;

        const categories = await transport.request<WireIngredientCategory[]>({
            method: 'GET',
            path: '/catalogue/ingredient-categories',
        });

        categoryLookup = buildCategoryLookup(categories);
        return categoryLookup;
    }

    async function loadSalesChannelLookup(): Promise<SalesChannelLookup> {
        if (salesChannelLookup !== null) return salesChannelLookup;

        const channels = await transport.request<AdminSalesChannel[]>({
            method: 'GET',
            path: '/catalogue/sales-channels',
        });

        salesChannelLookup = buildSalesChannelLookup(channels);
        return salesChannelLookup;
    }

    async function fetchCatalogueItemShow(itemId: string): Promise<CatalogueItemShowPayload> {
        const envelope = await transport.requestEnvelope<CatalogueItemShowPayload>({
            method: 'GET',
            path: `/catalogue/items/${encodeURIComponent(itemId)}`,
        });
        return envelope.data;
    }

    async function listCatalogueItems(
        itemType: AdminCatalogueItem['item_type'],
        filter?: { readonly limit?: number; readonly cursor?: string; readonly query?: string },
        status?: string | undefined,
    ): Promise<CursorPage<AdminCatalogueItem>> {
        const envelope = await transport.requestEnvelope<AdminCatalogueItem[]>({
            method: 'GET',
            path: `/catalogue/items${cursorQuery(filter, {
                item_type: itemType,
                status,
            })}`,
        });

        const meta = envelope.meta as PaginationMeta;
        return mapCursorPage(envelope.data, meta, (wire) => wire);
    }

    return {
        async listIngredients(filter?: IngredientAdminFilter): Promise<CursorPage<IngredientAdmin>> {
            const lookup = await loadCategoryLookup();
            categoryLookup = lookup;

            const search = new URLSearchParams();

            if (filter?.limit !== undefined) search.set('limit', String(filter.limit));
            if (filter?.cursor !== undefined) search.set('cursor', filter.cursor);
            if (filter?.query !== undefined && filter.query.trim() !== '') {
                search.set('query', filter.query.trim());
            }

            const statuses = filter?.statuses;
            if (statuses !== undefined && statuses.length === 1) {
                const apiStatus = apiStatusForPublishableFilter(statuses[0]!);
                if (apiStatus !== null) search.set('status', apiStatus);
            }

            if (filter?.categoryCode !== undefined) {
                const categoryId = lookup.codeToId.get(filter.categoryCode);
                if (categoryId !== undefined) search.set('category', categoryId);
            }

            const rendered = search.toString();
            const path =
                rendered === '' ? '/catalogue/ingredients' : `/catalogue/ingredients?${rendered}`;

            const envelope = await transport.requestEnvelope<AdminIngredient[]>({
                method: 'GET',
                path,
            });

            const meta = envelope.meta as PaginationMeta;
            const page = mapCursorPage(envelope.data, meta, (wire) =>
                mapIngredientAdmin(wire, lookup),
            );

            const needsClientStatusFilter =
                filter?.statuses !== undefined &&
                (filter.statuses.length > 1 ||
                    filter.statuses.some((status) => apiStatusForPublishableFilter(status) === null));

            if (!needsClientStatusFilter && filter?.ownedOnly !== true) {
                const allergenFilter =
                    filter?.allergenCodes !== undefined && filter.allergenCodes.length > 0;
                if (!allergenFilter) return page;
            }

            const items = page.items.filter((row) => {
                if (filter?.statuses !== undefined && filter.statuses.length > 0) {
                    if (!filter.statuses.includes(row.meta.status)) return false;
                }
                if (filter?.ownedOnly === true && row.organisationId === null) return false;
                if (filter?.allergenCodes !== undefined && filter.allergenCodes.length > 0) {
                    const codes = filter.allergenCodes;
                    if (!row.allergens.some((mapping) => codes.includes(mapping.allergenCode))) {
                        return false;
                    }
                }
                return true;
            });

            return { ...page, items };
        },

        async getIngredient(ingredientId: IngredientId): Promise<IngredientAdmin> {
            const lookup = await loadCategoryLookup();

            const envelope = await transport.requestEnvelope<{
                ingredient: AdminIngredient;
                aliases: Array<{ alias: string }>;
            }>({
                method: 'GET',
                path: `/catalogue/ingredients/${encodeURIComponent(String(ingredientId))}`,
            });

            const allergenWire = await transport.request<WireAllergenMapping[]>({
                method: 'GET',
                path: `/catalogue/ingredients/${encodeURIComponent(String(ingredientId))}/allergens`,
            });

            const aliases = envelope.data.aliases.map((row) => row.alias);
            const allergens = allergenWire.map(mapIngredientAllergenMapping);

            return mapIngredientAdmin(envelope.data.ingredient, lookup, {
                aliases,
                allergens,
            });
        },

        async listRecipes(
            filter?: RecipeAdminFilter,
        ): Promise<CursorPage<RecipeAdminSummary>> {
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0] === 'retired'
                        ? 'archived'
                        : filter.statuses[0] === 'published'
                          ? 'active'
                          : undefined
                    : undefined;

            const envelope = await transport.requestEnvelope<AdminRecipe[]>({
                method: 'GET',
                path: `/catalogue/recipes${cursorQuery(filter, {
                    status: status === 'active' ? undefined : status,
                })}`,
            });

            const meta = envelope.meta as PaginationMeta;
            return mapCursorPage(envelope.data, meta, (wire) => mapRecipeAdminSummary(wire));
        },

        async getRecipe(recipeId: RecipeId): Promise<RecipeAdmin> {
            const showEnvelope = await transport.requestEnvelope<{
                recipe: AdminRecipe;
                versions: AdminRecipeVersion[];
            }>({
                method: 'GET',
                path: `/catalogue/recipes/${encodeURIComponent(String(recipeId))}`,
            });

            const recipeWire = showEnvelope.data.recipe;
            const versionsWire = showEnvelope.data.versions;
            const currentWire = pickCurrentRecipeVersion(versionsWire);

            if (currentWire === null) {
                const summary = mapRecipeAdminSummary(recipeWire, { versionCount: 0 });
                const emptyVersion = mapRecipeVersionAdmin(
                    {
                        id: recipeWire.id,
                        recipe_id: recipeWire.id,
                        version_number: 1,
                        status: 'draft',
                        completeness: 'indicative',
                        waste_coefficient_percent: '3.00',
                        derivation_state: 'current',
                        lock_version: 1,
                    },
                    { lines: [], outputs: [], steps: [], allergens: [] },
                );

                return mapRecipeAdmin(recipeWire, versionsWire, emptyVersion);
            }

            const versionEnvelope = await transport.requestEnvelope<{
                version: AdminRecipeVersion;
                lines: WireRecipeLine[];
                outputs: WireRecipeOutput[];
                steps: WireRecipeStep[];
                allergens: RecipeVersionAllergen[];
            }>({
                method: 'GET',
                path: `/catalogue/recipes/${encodeURIComponent(String(recipeId))}/versions/${encodeURIComponent(String(currentWire.version_number))}`,
            });

            const currentVersion = mapRecipeVersionAdmin(versionEnvelope.data.version, {
                lines: versionEnvelope.data.lines,
                outputs: versionEnvelope.data.outputs,
                steps: versionEnvelope.data.steps,
                allergens: versionEnvelope.data.allergens,
            });

            return mapRecipeAdmin(recipeWire, versionsWire, currentVersion);
        },

        async listProducts(filter?: ProductAdminFilter): Promise<CursorPage<ProductAdmin>> {
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0]
                    : undefined;

            const page = await listCatalogueItems('product', filter, status);
            return {
                ...page,
                items: page.items.map((wire) => mapProductAdminFromItem(wire)),
            };
        },

        async getProduct(productId: ProductId): Promise<ProductAdmin> {
            const lookup = await loadSalesChannelLookup();
            const show = await fetchCatalogueItemShow(String(productId));

            return mapProductAdminFromItem(show.item, {
                packVariants: mapProductPackVariants(show.variants),
                channelAvailability: mapChannelAssignments(show.channels, lookup),
                dietClassifications: show.diet_classifications.filter(
                    (code): code is DietClassification => isDietClassification(code),
                ),
            });
        },

        async listMeals(filter?: MealAdminFilter): Promise<CursorPage<MealAdmin>> {
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0]
                    : undefined;

            const page = await listCatalogueItems('meal', filter, status);
            return {
                ...page,
                items: page.items.map((wire) => mapMealAdminFromItem(wire)),
            };
        },

        async getMeal(mealId: MealId): Promise<MealAdmin> {
            const lookup = await loadSalesChannelLookup();
            const show = await fetchCatalogueItemShow(String(mealId));

            const allergenWire = await transport.request<DerivedAllergen[]>({
                method: 'GET',
                path: `/catalogue/items/${encodeURIComponent(String(mealId))}/allergens`,
            });

            return mapMealAdminFromItem(show.item, {
                channelAvailability: mapChannelAssignments(show.channels, lookup),
                dietClassifications: show.diet_classifications.filter(
                    (code): code is DietClassification => isDietClassification(code),
                ),
                allergens: mapDerivedAllergenCodes(allergenWire),
            });
        },

        async listPlans(filter?: PlanAdminFilter): Promise<CursorPage<PlanAdmin>> {
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0]
                    : undefined;

            const page = await listCatalogueItems('subscription_plan', filter, status);
            return {
                ...page,
                items: page.items.map((wire) => mapPlanAdminFromItem(wire)),
            };
        },

        async getPlan(planId: SubscriptionPlanId): Promise<PlanAdmin> {
            const id = String(planId);

            const profileEnvelope = await transport.requestEnvelope<{
                item: AdminCatalogueItem;
                profile: PlanProfile | null;
            }>({
                method: 'GET',
                path: `/catalogue/plans/${encodeURIComponent(id)}/profile`,
            });

            let cells: PlanVariantCell[] = [];
            let durations: PlanDurationOption[] = [];
            let combinations: MealCombinationOption[] = [];
            let bands: EnergyBand[] = [];

            try {
                const variantsEnvelope = await transport.requestEnvelope<{
                    item: AdminCatalogueItem;
                    cells: PlanVariantCell[];
                }>({
                    method: 'GET',
                    path: `/catalogue/plans/${encodeURIComponent(id)}/variants`,
                });
                cells = variantsEnvelope.data.cells;
            } catch {
                cells = [];
            }

            try {
                durations = await transport.request<PlanDurationOption[]>({
                    method: 'GET',
                    path: '/catalogue/plan-vocabulary/durations',
                });
            } catch {
                durations = [];
            }

            try {
                combinations = await transport.request<MealCombinationOption[]>({
                    method: 'GET',
                    path: '/catalogue/plan-vocabulary/combinations',
                });
            } catch {
                combinations = [];
            }

            try {
                bands = await transport.request<EnergyBand[]>({
                    method: 'GET',
                    path: '/catalogue/plan-vocabulary/energy-bands',
                });
            } catch {
                bands = [];
            }

            const bandMap = new Map(bands.map((band) => [band.id, band]));

            return mapPlanAdminFromItem(profileEnvelope.data.item, {
                profile: profileEnvelope.data.profile,
                variants: mapPlanVariantsFromCells(cells, bandMap),
                durations: durations.map(mapPlanDuration),
                combinations: combinations.map(mapPlanCombination),
            });
        },

        async listPriceLists(filter?: PriceListAdminFilter): Promise<CursorPage<PriceListAdmin>> {
            const envelope = await transport.requestEnvelope<AdminPriceList[]>({
                method: 'GET',
                path: `/catalogue/price-lists${cursorQuery(filter)}`,
            });

            const meta = envelope.meta as PaginationMeta;
            return mapCursorPage(envelope.data, meta, (wire) => mapPriceListAdmin(wire));
        },

        async getPriceList(priceListId: PriceListId): Promise<PriceListAdmin> {
            const lookup = await loadSalesChannelLookup();
            const id = String(priceListId);

            const showEnvelope = await transport.requestEnvelope<{
                price_list: AdminPriceList;
                channels: PriceListChannelAssignment[];
            }>({
                method: 'GET',
                path: `/catalogue/price-lists/${encodeURIComponent(id)}`,
            });

            const entriesWire = await transport.request<AdminPriceListEntry[]>({
                method: 'GET',
                path: `/catalogue/price-lists/${encodeURIComponent(id)}/entries`,
            });

            const itemTypes = new Map<string, AdminCatalogueItem['item_type']>();
            const variantCodes = new Map<string, string>();

            for (const entry of entriesWire) {
                if (!itemTypes.has(entry.catalogue_item_id)) {
                    try {
                        const show = await fetchCatalogueItemShow(entry.catalogue_item_id);
                        itemTypes.set(entry.catalogue_item_id, show.item.item_type);
                        for (const variant of show.variants) {
                            variantCodes.set(variant.id, variant.code);
                        }
                    } catch {
                        itemTypes.set(entry.catalogue_item_id, 'product');
                    }
                }
            }

            const entries = entriesWire.map((entry) => {
                const itemType = itemTypes.get(entry.catalogue_item_id) ?? 'product';
                const variantCode =
                    entry.catalogue_item_variant_id === null ||
                    entry.catalogue_item_variant_id === undefined
                        ? null
                        : (variantCodes.get(entry.catalogue_item_variant_id) ?? null);

                return mapPriceListEntry(entry, itemType, entry.catalogue_item_id, variantCode);
            });

            const channels = priceListChannelsFromAssignments(
                showEnvelope.data.channels,
                lookup,
            );

            return mapPriceListAdmin(showEnvelope.data.price_list, {
                channels,
                entries,
            });
        },

        async listZones(filter?: { readonly limit?: number; readonly cursor?: string }): Promise<
            CursorPage<DeliveryZoneAdmin>
        > {
            const envelope = await transport.requestEnvelope<DeliveryZone[]>({
                method: 'GET',
                path: `/catalogue/delivery-zones${cursorQuery(filter)}`,
            });

            const meta = envelope.meta as PaginationMeta;
            return mapCursorPage(envelope.data, meta, (wire) => mapDeliveryZoneAdmin(wire));
        },

        async getZone(zoneId: DeliveryZoneId): Promise<DeliveryZoneAdmin> {
            const id = String(zoneId);

            const showEnvelope = await transport.requestEnvelope<{
                delivery_zone: DeliveryZone;
            }>({
                method: 'GET',
                path: `/catalogue/delivery-zones/${encodeURIComponent(id)}`,
            });

            const areasWire = await transport.request<AdminDeliveryArea[]>({
                method: 'GET',
                path: `/catalogue/delivery-zones/${encodeURIComponent(id)}/areas`,
            });

            let windowsWire: WireDeliveryWindow[] = [];
            try {
                windowsWire = await transport.request<WireDeliveryWindow[]>({
                    method: 'GET',
                    path: '/catalogue/delivery-windows',
                });
            } catch {
                windowsWire = [];
            }

            return mapDeliveryZoneAdmin(showEnvelope.data.delivery_zone, {
                areas: areasWire.map(mapServiceAreaFromDeliveryArea),
                deliveryWindows: windowsWire.map(mapDeliveryWindow),
            });
        },

        async getBranchOperating(branchId: KitchenBranchId): Promise<BranchOperating> {
            const daysWire = await transport.request<WireBranchOperatingDay[]>({
                method: 'GET',
                path: '/kitchen/branch-operating',
            });

            return mapBranchOperating(branchId, daysWire);
        },
    };
}
