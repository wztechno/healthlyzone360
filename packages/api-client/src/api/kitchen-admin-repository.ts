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
    RecipeVersionId,
} from '@healthy360/domain-types';
import { isDietClassification } from '@healthy360/domain-types';

import type {
    BranchOperating,
    DeliveryZoneAdmin,
    DeliveryZoneAdminFilter,
    IngredientAdmin,
    IngredientAdminFilter,
    KitchenAdminRepository,
    MealAdmin,
    MealAdminFilter,
    PlanAdmin,
    PlanAdminFilter,
    PlanMenu,
    PriceListAdmin,
    PriceListAdminFilter,
    ProductAdmin,
    ProductAdminFilter,
    RecipeAdmin,
    RecipeAdminFilter,
    RecipeAdminSummary,
    TechnicalSheetAdmin,
} from '../contracts/kitchen-admin.ts';
import { ApiError } from '../contracts/failure.ts';
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
    NumberedPaginationMeta,
    PaginatedOrNumberedMeta,
    PlanDurationOption,
    PlanMenuCycle as WirePlanMenuCycle,
    PlanMenuEntry as WirePlanMenuEntry,
    PlanProfile,
    PlanVariantCell,
    PriceListChannelAssignment,
    RecipeLine as WireRecipeLine,
    RecipeOutput as WireRecipeOutput,
    RecipeStep as WireRecipeStep,
    RecipeVersionAllergen,
    BranchOperatingDay as WireBranchOperatingDay,
    TechnicalSheet as WireTechnicalSheet,
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
    mapPlanMenu,
    mapPlanVariantsFromCells,
    mapPriceListAdmin,
    mapPriceListEntry,
    mapProductAdminFromItem,
    mapProductPackVariants,
    mapRecipeAdmin,
    mapTechnicalSheetAdmin,
    mapRecipeAdminSummary,
    mapRecipeVersionAdmin,
    mapServiceAreaFromDeliveryArea,
    pickCurrentRecipeVersion,
    priceListChannelsFromAssignments,
    type CategoryLookup,
    type SalesChannelLookup,
} from './kitchen-admin-mappers.ts';
import type { Transport } from './transport.ts';

type CursorQueryFilter = {
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
    readonly query?: string | undefined;
    readonly page?: number | undefined;
    readonly perPage?: number | undefined;
};

function pickCursorFilter(filter?: CursorQueryFilter): CursorQueryFilter | undefined {
    if (filter === undefined) return undefined;

    const picked: {
        limit?: number;
        cursor?: string;
        query?: string;
        page?: number;
        perPage?: number;
    } = {};
    if (filter.limit !== undefined) picked.limit = filter.limit;
    if (filter.cursor !== undefined) picked.cursor = filter.cursor;
    if (filter.query !== undefined) picked.query = filter.query;
    if (filter.page !== undefined) picked.page = filter.page;
    if (filter.perPage !== undefined) picked.perPage = filter.perPage;

    if (Object.keys(picked).length === 0) return undefined;
    return picked;
}

/**
 * Whether the envelope describes a numbered page rather than a step of a keyset walk.
 *
 * Read off the response instead of off the request, because the response is what actually has to be
 * mapped: an endpoint that ignored a `page` it does not support would otherwise be read as numbered
 * and answer `hasMore: false` on a list with more to come.
 */
function isNumbered(meta: PaginatedOrNumberedMeta): meta is NumberedPaginationMeta {
    return 'total_pages' in meta;
}

function mapAdminCursorPage<TWire, TDomain>(
    data: readonly TWire[],
    meta: PaginatedOrNumberedMeta,
    map: (wire: TWire) => TDomain | null,
): CursorPage<TDomain> {
    const items: TDomain[] = [];
    for (const wire of data) {
        const mapped = map(wire);
        if (mapped !== null) items.push(mapped);
    }

    if (isNumbered(meta)) {
        return {
            items,
            // A numbered page has no cursor to hand out. Handing one out anyway would invite a
            // caller to mix the two and land somewhere neither describes.
            nextCursor: null,
            hasMore: meta.page < meta.total_pages,
            totalCount: meta.total_count,
        };
    }

    return {
        items,
        nextCursor: meta.next_cursor,
        hasMore: meta.has_more,
        // The keyset path answers `has_more` by reading one row beyond the page rather than by
        // counting, so there is no total to report and `null` is the truthful answer.
        totalCount: null,
    };
}

type CatalogueItemShowPayload = {
    readonly item: AdminCatalogueItem;
    readonly variants: AdminCatalogueItemVariant[];
    readonly diet_classifications: string[];
    readonly channels: AdminChannelAssignment[];
    readonly availability_days?: ReadonlyArray<{
        readonly date: string;
        readonly is_available: boolean;
        readonly remaining_portions: number | null;
        readonly order_cut_off_at: string | null;
    }>;
};

/**
 * Kitchen catalogue reads served by the API today.
 *
 * Writes still reject with `prototype.not_implemented` until their slices land.
 * Catalogue reads and a first wave of writes are overridden in `repositories.ts`.
 */
export type ApiKitchenAdminReads = Pick<
    KitchenAdminRepository,
    | 'listIngredients'
    | 'getIngredient'
    | 'listRecipes'
    | 'getRecipe'
    | 'getRecipeTechnicalSheet'
    | 'listProducts'
    | 'getProduct'
    | 'listMeals'
    | 'getMeal'
    | 'listPlans'
    | 'getPlan'
    | 'getPlanMenu'
    | 'listPriceLists'
    | 'getPriceList'
    | 'listZones'
    | 'getZone'
    | 'getBranchOperating'
>;

function cursorQuery(
    filter?: CursorQueryFilter,
    extra?: Record<string, string | undefined>,
): string {
    const search = new URLSearchParams();

    if (filter?.limit !== undefined) search.set('limit', String(filter.limit));
    if (filter?.cursor !== undefined) search.set('cursor', filter.cursor);
    // Only the kitchen catalogue accepts these; every other endpoint answers 400. Which is which is
    // settled by `docs/api/conventions.md`, and by only these seven filters carrying the fields.
    if (filter?.page !== undefined) search.set('page', String(filter.page));
    if (filter?.perPage !== undefined) search.set('per_page', String(filter.perPage));
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
    let unitCodeLookup: ReadonlyMap<string, string> | null = null;

    async function loadUnitCodeLookup(): Promise<ReadonlyMap<string, string>> {
        if (unitCodeLookup !== null) return unitCodeLookup;

        try {
            const reference = await transport.requestEnvelope<{
                measurement_units: Array<{ id: string; code: string }>;
            }>({ method: 'GET', path: '/catalogue/procurement/reference' });

            unitCodeLookup = new Map(
                reference.data.measurement_units.map((row) => [row.id, row.code]),
            );
        } catch {
            // A member who cannot read the procurement reference still gets
            // recipes; the units fall back to the mapper's honest default.
            unitCodeLookup = new Map();
        }

        return unitCodeLookup;
    }

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
        filter?: CursorQueryFilter,
        status?: string | undefined,
    ): Promise<CursorPage<AdminCatalogueItem>> {
        const envelope = await transport.requestEnvelope<AdminCatalogueItem[]>({
            method: 'GET',
            path: `/catalogue/items${cursorQuery(pickCursorFilter(filter), {
                item_type: itemType,
                status,
            })}`,
        });

        const meta = envelope.meta as PaginatedOrNumberedMeta;
        return mapAdminCursorPage(envelope.data, meta, (wire) => wire);
    }

    return {
        async listIngredients(
            filter?: IngredientAdminFilter,
        ): Promise<CursorPage<IngredientAdmin>> {
            const lookup = await loadCategoryLookup();
            categoryLookup = lookup;

            const search = new URLSearchParams();

            if (filter?.limit !== undefined) search.set('limit', String(filter.limit));
            if (filter?.cursor !== undefined) search.set('cursor', filter.cursor);
            if (filter?.page !== undefined) search.set('page', String(filter.page));
            if (filter?.perPage !== undefined) search.set('per_page', String(filter.perPage));
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

            const meta = envelope.meta as PaginatedOrNumberedMeta;
            const page = mapAdminCursorPage(envelope.data, meta, (wire) =>
                mapIngredientAdmin(wire, lookup),
            );

            const needsClientStatusFilter =
                filter?.statuses !== undefined &&
                (filter.statuses.length > 1 ||
                    filter.statuses.some(
                        (status) => apiStatusForPublishableFilter(status) === null,
                    ));

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

        async listRecipes(filter?: RecipeAdminFilter): Promise<CursorPage<RecipeAdminSummary>> {
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
                path: `/catalogue/recipes${cursorQuery(pickCursorFilter(filter), {
                    status: status === 'active' ? undefined : status,
                    stale_only: filter?.staleOnly === true ? '1' : undefined,
                })}`,
            });

            const meta = envelope.meta as PaginatedOrNumberedMeta;
            return mapAdminCursorPage(envelope.data, meta, (wire) => mapRecipeAdminSummary(wire));
        },

        async getRecipeTechnicalSheet(
            recipeId: RecipeId,
            versionId: RecipeVersionId,
        ): Promise<TechnicalSheetAdmin | null> {
            try {
                const sheet = await transport.request<WireTechnicalSheet>({
                    method: 'GET',
                    path: `/catalogue/recipes/${encodeURIComponent(String(recipeId))}/versions/${encodeURIComponent(String(versionId))}/technical-sheet`,
                });

                return mapTechnicalSheetAdmin(sheet);
            } catch (caught) {
                // The sheet is the confidential half of a recipe. A member
                // without recipe.view_costs_organisation still gets the
                // formulation screen — just without the money on it.
                if (caught instanceof ApiError && caught.code === 'authz.permission_denied') {
                    return null;
                }

                throw caught;
            }
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

            const unitsById = await loadUnitCodeLookup();
            const currentVersion = mapRecipeVersionAdmin(
                versionEnvelope.data.version,
                {
                    lines: versionEnvelope.data.lines,
                    outputs: versionEnvelope.data.outputs,
                    steps: versionEnvelope.data.steps,
                    allergens: versionEnvelope.data.allergens,
                },
                unitsById,
            );

            return mapRecipeAdmin(recipeWire, versionsWire, currentVersion);
        },

        async listProducts(filter?: ProductAdminFilter): Promise<CursorPage<ProductAdmin>> {
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0]
                    : undefined;

            const page = await listCatalogueItems(
                filter?.itemType ?? 'product',
                pickCursorFilter(filter),
                status,
            );
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

            const page = await listCatalogueItems('meal', pickCursorFilter(filter), status);
            return {
                ...page,
                items: page.items.map((wire) => mapMealAdminFromItem(wire)),
            };
        },

        async getMeal(mealId: MealId): Promise<MealAdmin> {
            const lookup = await loadSalesChannelLookup();
            const show = await fetchCatalogueItemShow(String(mealId));

            /*
             * `data` is `{ allergens: [...] }` here, not the bare list the ingredient twin
             * answers with: this endpoint states the *basis* of the derivation in `meta`, so
             * its rows live under a key (`ShowCatalogueItemAllergensResponses`). Reading the
             * envelope as an array made every meal read throw `allergens.map is not a
             * function` — including the one `createMeal` returns through, which is how a save
             * that the server had already accepted looked like a save nobody pressed.
             */
            const allergenWire = await transport.request<{
                readonly allergens: readonly DerivedAllergen[];
            }>({
                method: 'GET',
                path: `/catalogue/items/${encodeURIComponent(String(mealId))}/allergens`,
            });

            return mapMealAdminFromItem(
                // `availability_days` is spread in only when the show payload carried it:
                // under `exactOptionalPropertyTypes` an explicit `undefined` is not the same
                // as an absent key, and the mapper's optional field means "absent", not "unknown".
                show.availability_days === undefined
                    ? show.item
                    : { ...show.item, availability_days: show.availability_days },
                {
                    channelAvailability: mapChannelAssignments(show.channels, lookup),
                    dietClassifications: show.diet_classifications.filter(
                        (code): code is DietClassification => isDietClassification(code),
                    ),
                    allergens: mapDerivedAllergenCodes(allergenWire.allergens),
                },
            );
        },

        async listPlans(filter?: PlanAdminFilter): Promise<CursorPage<PlanAdmin>> {
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0]
                    : undefined;

            const page = await listCatalogueItems(
                'subscription_plan',
                pickCursorFilter(filter),
                status,
            );
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

            /*
             * Four optional reads, each degrading to an empty list.
             *
             * `.catch(() => [])` rather than a `let` and a `try`/`catch`: every branch of those
             * assigned, which made the declaration's initialiser dead code the linter was right to
             * flag. The behaviour is unchanged — a vocabulary endpoint that is unreachable leaves
             * the plan renderable with the parts that did load, which is the point of not awaiting
             * them together.
             */
            const cells = await transport
                .requestEnvelope<{
                    item: AdminCatalogueItem;
                    cells: PlanVariantCell[];
                }>({
                    method: 'GET',
                    path: `/catalogue/plans/${encodeURIComponent(id)}/variants`,
                })
                .then((envelope) => envelope.data.cells)
                .catch((): PlanVariantCell[] => []);

            const durations = await transport
                .request<PlanDurationOption[]>({
                    method: 'GET',
                    path: '/catalogue/plan-vocabulary/durations',
                })
                .catch((): PlanDurationOption[] => []);

            const combinations = await transport
                .request<MealCombinationOption[]>({
                    method: 'GET',
                    path: '/catalogue/plan-vocabulary/combinations',
                })
                .catch((): MealCombinationOption[] => []);

            const bands = await transport
                .request<EnergyBand[]>({
                    method: 'GET',
                    path: '/catalogue/plan-vocabulary/energy-bands',
                })
                .catch((): EnergyBand[] => []);

            const bandMap = new Map(bands.map((band) => [band.id, band]));

            return mapPlanAdminFromItem(profileEnvelope.data.item, {
                profile: profileEnvelope.data.profile,
                variants: mapPlanVariantsFromCells(cells, bandMap),
                durations: durations.map(mapPlanDuration),
                combinations: combinations.map(mapPlanCombination),
            });
        },

        /**
         * The plan's fixed menu.
         *
         * One request, and **no `.catch(() => [])`** of the kind `getPlan` uses for its vocabulary
         * reads: a menu that failed to load and rendered as an empty one would invite somebody to
         * save that emptiness back, which is the write that withdraws the menu and turns the
         * kitchen's stock deduction off again. A failure here has to reach the screen.
         */
        async getPlanMenu(planId: SubscriptionPlanId): Promise<PlanMenu> {
            const envelope = await transport.requestEnvelope<{
                item: AdminCatalogueItem;
                cycle: WirePlanMenuCycle;
                entries: WirePlanMenuEntry[];
            }>({
                method: 'GET',
                path: `/catalogue/plans/${encodeURIComponent(String(planId))}/menu`,
            });

            return mapPlanMenu(envelope.data.item, envelope.data.cycle, envelope.data.entries);
        },

        async listPriceLists(filter?: PriceListAdminFilter): Promise<CursorPage<PriceListAdmin>> {
            const envelope = await transport.requestEnvelope<AdminPriceList[]>({
                method: 'GET',
                path: `/catalogue/price-lists${cursorQuery(pickCursorFilter(filter))}`,
            });

            const meta = envelope.meta as PaginatedOrNumberedMeta;
            return mapAdminCursorPage(envelope.data, meta, (wire) => mapPriceListAdmin(wire));
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

            const channels = priceListChannelsFromAssignments(showEnvelope.data.channels, lookup);

            return mapPriceListAdmin(showEnvelope.data.price_list, {
                channels,
                entries,
            });
        },

        async listZones(filter?: DeliveryZoneAdminFilter): Promise<CursorPage<DeliveryZoneAdmin>> {
            const envelope = await transport.requestEnvelope<DeliveryZone[]>({
                method: 'GET',
                path: `/catalogue/delivery-zones${cursorQuery(pickCursorFilter(filter))}`,
            });

            const meta = envelope.meta as PaginatedOrNumberedMeta;
            return mapAdminCursorPage(envelope.data, meta, (wire) => mapDeliveryZoneAdmin(wire));
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

            // Optional, on the same terms as the plan vocabulary above: a zone is still worth
            // showing when the shared window list cannot be reached.
            const windowsWire = await transport
                .request<WireDeliveryWindow[]>({
                    method: 'GET',
                    path: '/catalogue/delivery-windows',
                })
                .catch((): WireDeliveryWindow[] => []);

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
