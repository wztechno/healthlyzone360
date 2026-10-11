import type {
    AllergenCode,
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
import { DeliveryWindowId, isDietClassification } from '@healthy360/domain-types';

import type {
    BranchOperating,
    DeliveryWindow,
    DeliveryZoneAdmin,
    DeliveryZoneAdminFilter,
    IngredientAdmin,
    IngredientAdminFilter,
    IngredientAdminSort,
    IngredientCategoryAdmin,
    ItemChannelPrices,
    KitchenAdminRepository,
    MealAdmin,
    MealAdminFilter,
    PlanAdmin,
    PlanAdminFilter,
    PlanMenu,
    PriceListAdmin,
    PriceListAdminFilter,
    PublishableStatus,
    ProductAdmin,
    ProductAdminFilter,
    RecipeAdmin,
    RecipeAdminFilter,
    ReferenceSeries,
    RecipeAdminSummary,
    TechnicalSheetAdmin,
} from '../contracts/kitchen-admin.ts';
import { ApiError, apiFailure, throwFailure } from '../contracts/failure.ts';
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
    IngredientCategory as WireIngredientCategory,
    MealCombinationOption,
    NumberedPaginationMeta,
    PaginatedOrNumberedMeta,
    PlanDurationAssignment,
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
    DELIVERY_ZONE_WIRE_STATUS,
    PRICE_LIST_WIRE_STATUS,
    mapIngredientCategoryAdmin,
    type WireRecipePackagingLine,
    buildSalesChannelLookup,
    mapBranchOperating,
    mapChannelAssignments,
    mapDerivedAllergenCodes,
    mapDeliveryWindow,
    mapDeliveryZoneAdmin,
    mapIngredientAdmin,
    mapMealAdminFromItem,
    mapPlanAdminFromItem,
    mapPlanCombination,
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
    planDurationsFromAssignments,
    priceListChannelsFromAssignments,
    mapItemChannelPrices,
    type CategoryLookup,
    type SalesChannelLookup,
    type WireItemChannelPrices,
} from './kitchen-admin-mappers.ts';
import { memoiseAsync, memoiseAsyncPer } from './once.ts';
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
        // `has_more` is still the look-ahead row; `total` is the endpoint's separate count of the
        // filtered set, absent from an endpoint that cannot say — `null` then, as before.
        totalCount: meta.total ?? null,
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
    | 'nextReference'
    | 'listIngredients'
    | 'getIngredient'
    | 'getIngredientsByIds'
    | 'listIngredientCategories'
    | 'listRecipes'
    | 'getRecipe'
    | 'getRecipeTechnicalSheet'
    | 'listProducts'
    | 'getProduct'
    | 'getItemChannelPrices'
    | 'listMeals'
    | 'getMeal'
    | 'listPlans'
    | 'getPlan'
    | 'getPlanMenu'
    | 'listPriceLists'
    | 'getPriceList'
    | 'listZones'
    | 'getZone'
    | 'getZoneWindows'
    | 'listDeliveryWindows'
    | 'getBranchOperating'
>;

/** Ids per `GET /catalogue/ingredients?ids[]=…` — the endpoint's `MAX_IDS`. */
const INGREDIENT_IDS_PER_REQUEST = 100;

/** A price list's entries per page — the endpoint's `CursorPage::MAX_LIMIT`, so a list is few reads. */
const PRICE_LIST_ENTRY_PAGE = 100;

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

/**
 * The single wire `status` a price-list or zone index takes, from the contract's `statuses`.
 *
 * `undefined` is no filter; `null` is a filter no row can satisfy (only unreachable states such as
 * `review_required`), answered without a request. Two distinct wire states are refused: the index
 * takes one, and dropping the filter would widen the answer while the default also hides archived.
 */
function soleLifecycleStatus<TWire extends string>(
    statuses: readonly PublishableStatus[] | undefined,
    toWire: Readonly<Record<PublishableStatus, TWire | null>>,
): TWire | null | undefined {
    if (statuses === undefined || statuses.length === 0) return undefined;

    const wire = [...new Set(statuses.map((status) => toWire[status]))].filter(
        (status): status is TWire => status !== null,
    );
    if (wire.length === 0) return null;
    if (wire.length > 1) {
        throwFailure(
            apiFailure('server', {
                message: `The list filters on one status at a time; ${wire.join(' and ')} were both asked for.`,
            }),
        );
    }
    return wire[0];
}

const NOTHING_MATCHES = { items: [], nextCursor: null, hasMore: false, totalCount: 0 } as const;

/**
 * The one allergen class an endpoint can take, out of a filter that is typed to carry several.
 *
 * `/catalogue/recipes` and `/catalogue/items` both accept a single `allergen`, because a single
 * class is the question a list column asks — its menu is single-select and clearing is how you
 * ask a different one. The plural field on the filter is there because the ingredient twin
 * genuinely takes a union, and one shape across the three filters is worth more than a field
 * that changes arity per entity.
 *
 * A caller passing several gets the first rather than a page-local pass over the union. The
 * ingredient repository does keep that pass, and can: it is answering a picker that loads one page
 * and means it. These two answer paged browse lists, where narrowing the loaded page leaves the
 * count and every page after it describing the unfiltered set — the failure this whole filter was
 * added to avoid, so it is not one to reintroduce as a fallback.
 */
function soleAllergen(codes?: readonly AllergenCode[] | undefined): string | undefined {
    return codes === undefined || codes.length === 0 ? undefined : codes[0];
}

/**
 * A sort key's wire spelling.
 *
 * The map is stated rather than derived from the key's own text because two of the seven are not
 * named after the column they sort by: `unitPrice` is `unit_price_amount` on the row, and `name`
 * is whichever of the two name columns the interface is reading. A `camelCase` → `snake_case`
 * transform would be right five times out of seven, which is the worst kind of right.
 */
function ingredientSortParameter(
    sort: IngredientAdminSort,
    language: 'en' | 'ar' | undefined,
): string {
    if (sort === 'name') return language === 'ar' ? 'name_ar' : 'name_en';
    if (sort === 'unitPrice') return 'unit_price';
    if (sort === 'updatedAt') return 'updated_at';
    return sort;
}

/*
 * The catalogue's reference reads, one shared in-flight request per transport (see `memoiseAsync`
 * for why the promise is the cache and why a rejection is not kept).
 *
 * Per transport rather than per repository object because the reads and the writes both translate
 * through them, and the writes build their own reads as well: opening the recipe editor reads the
 * recipe (unit id → code) while the rollup preview resolves every line's unit at once (code → id),
 * and those used to be three caches and, before the first answer, one request per caller. The
 * transport is created with the repositories, so the lifetime is the one the caches always had.
 */

/** The platform's measurement units, from `/catalogue/procurement/reference`. */
export const loadMeasurementUnits = memoiseAsyncPer(
    async (transport: Transport): Promise<readonly { id: string; code: string }[]> => {
        const reference = await transport.requestEnvelope<{
            measurement_units: Array<{ id: string; code: string }>;
        }>({ method: 'GET', path: '/catalogue/procurement/reference' });

        return reference.data.measurement_units;
    },
);

/**
 * The category rows and the id↔code lookup built from them, kept together:
 * `listIngredientCategories` answers from the same fetch the translation already needs, so a
 * screen that shows the tree and a write that resolves a code do not make two requests for one
 * response.
 */
export const loadIngredientCategories = memoiseAsyncPer(async (transport: Transport) => {
    const rows = await transport.request<WireIngredientCategory[]>({
        method: 'GET',
        path: '/catalogue/ingredient-categories',
    });

    return { rows, lookup: buildCategoryLookup(rows) };
});

const loadSalesChannels = memoiseAsyncPer(
    async (transport: Transport): Promise<SalesChannelLookup> =>
        buildSalesChannelLookup(
            await transport.request<AdminSalesChannel[]>({
                method: 'GET',
                path: '/catalogue/sales-channels',
            }),
        ),
);

export function createApiKitchenAdminReads(transport: Transport): ApiKitchenAdminReads {
    const loadUnitCodes = memoiseAsync(async (): Promise<ReadonlyMap<string, string>> => {
        try {
            const units = await loadMeasurementUnits(transport);
            return new Map(units.map((row) => [row.id, row.code]));
        } catch (caught) {
            // A refused permission will not change mid-session, so the empty map is the answer and
            // is kept. Anything else (a 429 during a burst, a dropped connection) rejects, which
            // leaves nothing cached and lets the next read try again.
            if (caught instanceof ApiError && caught.code === 'authz.permission_denied') {
                return new Map();
            }
            throw caught;
        }
    });

    async function loadUnitCodeLookup(): Promise<ReadonlyMap<string, string>> {
        try {
            return await loadUnitCodes();
        } catch {
            // A member who cannot read the procurement reference still gets recipes; the units
            // fall back to the mapper's honest default — for this read only.
            return new Map();
        }
    }

    const loadCategories = () => loadIngredientCategories(transport);

    async function loadCategoryLookup(): Promise<CategoryLookup> {
        return (await loadCategories()).lookup;
    }

    const loadSalesChannelLookup = () => loadSalesChannels(transport);

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
        categoryId?: string | undefined,
        allergen?: string | undefined,
    ): Promise<CursorPage<AdminCatalogueItem>> {
        const envelope = await transport.requestEnvelope<AdminCatalogueItem[]>({
            method: 'GET',
            /*
             * `product_category_id` was never sent, which is why the products list's category
             * filter narrowed the page in hand and left the count describing the whole collection.
             * The endpoint has taken it all along; only the client had not asked.
             */
            path: `/catalogue/items${cursorQuery(pickCursorFilter(filter), {
                item_type: itemType,
                status,
                product_category_id: categoryId,
                allergen,
            })}`,
        });

        const meta = envelope.meta as PaginatedOrNumberedMeta;
        return mapAdminCursorPage(envelope.data, meta, (wire) => wire);
    }

    const reads: ApiKitchenAdminReads = {
        async nextReference(prefix: ReferenceSeries): Promise<string> {
            const envelope = await transport.requestEnvelope<{ readonly reference: string }>({
                method: 'GET',
                path: `/catalogue/references/next?prefix=${encodeURIComponent(prefix)}`,
            });

            return envelope.data.reference;
        },

        async listIngredientCategories(): Promise<readonly IngredientCategoryAdmin[]> {
            const { rows } = await loadCategories();
            const idToCode = new Map(rows.map((row) => [row.id, row.code]));

            // Sorted here rather than at each call site: three consumers need the same order and
            // the endpoint's own is not guaranteed. `display_order` is the catalogue's stated
            // intent; the code breaks ties so the list is at least stable when it is unset.
            return rows
                .map((row) => mapIngredientCategoryAdmin(row, idToCode))
                .sort(
                    (left, right) =>
                        left.displayOrder - right.displayOrder ||
                        left.code.localeCompare(right.code),
                );
        },

        async listIngredients(
            filter?: IngredientAdminFilter,
        ): Promise<CursorPage<IngredientAdmin>> {
            const lookup = await loadCategoryLookup();

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
                const only = statuses[0]!;
                // `review_required` is the verification axis, not the lifecycle one (see
                // `mapIngredientPublishableStatus`): unarchived and `requires_review`. Unarchived
                // is the browse default, so the verification filter alone is the whole predicate.
                if (only === 'review_required') {
                    search.set('verification_status', 'requires_review');
                } else {
                    const apiStatus = apiStatusForPublishableFilter(only);
                    if (apiStatus !== null) search.set('status', apiStatus);
                }
            }

            if (filter?.categoryCode !== undefined) {
                const categoryId = lookup.codeToId.get(filter.categoryCode);

                /*
                 * An unresolvable category returns nothing rather than everything.
                 *
                 * This used to drop the filter, and the packaging page is what that cost: it asked
                 * for one branch, the branch was removed from the taxonomy, the code stopped
                 * resolving, and the request degraded to the unfiltered list — so a page meant to
                 * show thirty-one boxes showed three hundred ingredients and looked like it had
                 * worked. Widening a request nobody widened is the worse of the two failures,
                 * because an empty page is obviously wrong and a full one is not.
                 */
                if (categoryId === undefined) {
                    return { items: [], nextCursor: null, hasMore: false, totalCount: 0 };
                }

                search.set('category', categoryId);
            }

            /*
             * An unresolvable *exclusion* is refused, not dropped.
             *
             * The mirror of the rule above, and the half that was still open. This used to skip
             * the constraint when the code did not resolve, on the argument that an exclusion
             * which cannot be translated must not become a narrower request by accident — and the
             * honest failure was said to be the unfiltered list.
             *
             * That argument does not survive packaging moving back into this table. The unfiltered
             * list is now food *and* thirty-three boxes, so a dropped exclusion is not the caller
             * getting "what they would have got before the filter existed" — it is the ingredient
             * picker quietly offering bin liners, which is the same failure the inclusive branch
             * above documents, pointed the other way. Neither list may widen by accident.
             *
             * It throws rather than returning empty because the two cases differ: an unresolvable
             * *inclusion* has an honest empty answer, while an unresolvable exclusion has no honest
             * answer at all — every row is a candidate and none can be ruled out.
             */
            if (filter?.excludeCategoryCode !== undefined) {
                const excludedId = lookup.codeToId.get(filter.excludeCategoryCode);

                if (excludedId === undefined) {
                    throwFailure(
                        apiFailure('server', {
                            message: `The category "${filter.excludeCategoryCode}" could not be resolved, so it cannot be excluded. Refusing rather than returning a list that would include it.`,
                        }),
                    );
                }

                search.set('exclude_category', excludedId);
            }

            if (filter?.referenceSeries !== undefined) {
                search.set('reference_series', filter.referenceSeries);
            }

            /*
             * One code goes to the server; more than one stays client-side.
             *
             * `allergen` narrows the whole collection, which is what a paged browse list needs — a
             * filter applied to the loaded page narrows that page while the count and every page
             * after it go on describing the unfiltered set. The endpoint takes a single class
             * because that is the question a list column asks; a caller passing several is asking
             * for a union the endpoint cannot express, so it keeps the page-local pass below and
             * the page-local caveat that comes with it.
             */
            const serverAllergen =
                filter?.allergenCodes !== undefined && filter.allergenCodes.length === 1
                    ? filter.allergenCodes[0]
                    : undefined;

            if (serverAllergen !== undefined) {
                search.set('allergen', serverAllergen);
            }

            /*
             * The order, for every page rather than the one in hand.
             *
             * `name` is the only key whose wire spelling is a decision: the list draws the
             * reader's own language and sorts on what it draws, so the column it names depends on
             * the interface, not on the row. The endpoint takes `name_en` / `name_ar` and does not
             * guess — see `IngredientAdminFilter.sortLanguage`.
             */
            if (filter?.sort !== undefined) {
                search.set('sort', ingredientSortParameter(filter.sort, filter.sortLanguage));
                search.set('direction', filter.sortDirection ?? 'asc');
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

            // A single status is answered by the server above; only a union is left.
            const needsClientStatusFilter =
                filter?.statuses !== undefined && filter.statuses.length > 1;

            if (!needsClientStatusFilter && filter?.ownedOnly !== true) {
                // The single-code case was answered by the server above; only a union is left.
                const allergenFilter =
                    serverAllergen === undefined &&
                    filter?.allergenCodes !== undefined &&
                    filter.allergenCodes.length > 0;
                if (!allergenFilter) return page;
            }

            const items = page.items.filter((row) => {
                if (filter?.statuses !== undefined && filter.statuses.length > 0) {
                    if (!filter.statuses.includes(row.meta.status)) return false;
                }
                if (filter?.ownedOnly === true && row.organisationId === null) return false;
                if (
                    serverAllergen === undefined &&
                    filter?.allergenCodes !== undefined &&
                    filter.allergenCodes.length > 0
                ) {
                    const codes = filter.allergenCodes;
                    if (!row.allergens.some((mapping) => codes.includes(mapping.allergenCode))) {
                        return false;
                    }
                }
                return true;
            });

            // The page was narrowed here, so the server's keyset `total` describes a wider set than
            // these rows. A numbered page keeps its `total_count`: its pager needs one, and that
            // caveat is the one the page-local filter above has always carried.
            return { ...page, items, totalCount: isNumbered(meta) ? page.totalCount : null };
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

            // The allergen mappings ride on the resource now, so the second request this used to
            // make is gone. `/catalogue/ingredients/{id}/allergens` remains the mapping editor's
            // own resource and is what the PUT writes against; it is simply not needed to render a
            // record whose declaration arrived with it.
            const aliases = envelope.data.aliases.map((row) => row.alias);

            return mapIngredientAdmin(envelope.data.ingredient, lookup, { aliases });
        },

        async getIngredientsByIds(
            ingredientIds: readonly IngredientId[],
        ): Promise<readonly IngredientAdmin[]> {
            const unique = [...new Set(ingredientIds.map(String))];
            if (unique.length === 0) return [];

            const lookup = await loadCategoryLookup();
            const chunks: Promise<readonly IngredientAdmin[]>[] = [];

            // The endpoint's own ceiling, and `limit` must cover the chunk or it would page it.
            // 100 uuids as `ids[]` is ~4.7 KB of request line — inside nginx's 8 KB.
            for (let from = 0; from < unique.length; from += INGREDIENT_IDS_PER_REQUEST) {
                const chunk = unique.slice(from, from + INGREDIENT_IDS_PER_REQUEST);
                const params = new URLSearchParams({ limit: String(chunk.length) });
                for (const id of chunk) params.append('ids[]', id);

                chunks.push(
                    transport
                        .requestEnvelope<AdminIngredient[]>({
                            method: 'GET',
                            path: `/catalogue/ingredients?${params.toString()}`,
                        })
                        // Mapped exactly as `getIngredient` maps the show endpoint, whose
                        // `aliases` sit beside the ingredient rather than on it.
                        .then((envelope) =>
                            envelope.data.map((wire) =>
                                mapIngredientAdmin(wire, lookup, {
                                    aliases: (wire.aliases ?? []).map((row) => row.alias),
                                }),
                            ),
                        ),
                );
            }

            return (await Promise.all(chunks)).flat();
        },

        async listRecipes(filter?: RecipeAdminFilter): Promise<CursorPage<RecipeAdminSummary>> {
            /*
             * The status filter, sent as the caller asked for it.
             *
             * This used to translate into the recipe identity's own vocabulary — `published` became
             * `active`, `retired` became `archived` — and **silently dropped `draft` and
             * `review_required`**, because the identity has no such states. Picking either in the
             * list's Status column therefore sent no filter at all and the page answered with
             * everything, which read as a filter that did not work.
             *
             * The endpoint now accepts all six and narrows the version ones against the *current*
             * version, which is the one the row displays. Still one value: the column's menu is
             * single-select, and a union is not a query this endpoint expresses.
             */
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0]
                    : undefined;

            const envelope = await transport.requestEnvelope<AdminRecipe[]>({
                method: 'GET',
                path: `/catalogue/recipes${cursorQuery(pickCursorFilter(filter), {
                    status,
                    stale_only: filter?.staleOnly === true ? '1' : undefined,
                    allergen: soleAllergen(filter?.allergenCodes),
                    // The recipe book's own axes. `kind` and `selling_status` are refused for a
                    // caller who cannot see the catalogue, so the list hook only sets them when
                    // the reader holds that permission.
                    kind: filter?.kind,
                    selling_status: filter?.sellingStatus,
                    category: filter?.category,
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
                        packaging_waste_percent: '0.00',
                        derivation_state: 'current',
                        lock_version: 1,
                    },
                    { lines: [], packaging: [], outputs: [], steps: [], allergens: [] },
                );

                return mapRecipeAdmin(recipeWire, versionsWire, emptyVersion);
            }

            const versionEnvelope = await transport.requestEnvelope<{
                version: AdminRecipeVersion;
                lines: WireRecipeLine[];
                packaging: WireRecipePackagingLine[];
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
                    packaging: versionEnvelope.data.packaging,
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
                filter?.categoryId,
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

        async getItemChannelPrices(itemId: ProductId | MealId): Promise<ItemChannelPrices> {
            const data = await transport.request<WireItemChannelPrices>({
                method: 'GET',
                path: `/catalogue/items/${encodeURIComponent(String(itemId))}/channel-prices`,
            });
            return mapItemChannelPrices(data);
        },

        async listMeals(filter?: MealAdminFilter): Promise<CursorPage<MealAdmin>> {
            const status =
                filter?.statuses !== undefined && filter.statuses.length === 1
                    ? filter.statuses[0]
                    : undefined;

            const page = await listCatalogueItems(
                'meal',
                pickCursorFilter(filter),
                status,
                filter?.categoryId,
                soleAllergen(filter?.allergenCodes),
            );
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

            /*
             * What this plan actually offers — its configurations' duration assignments — rather
             * than the kitchen's whole duration vocabulary, which is shared by every plan. Reading
             * the vocabulary made each plan show every length any plan had ever used, so replacing
             * 20 days with 28 read back as both; and it carried no discount, so a stated one read
             * back as "not set".
             */
            const assignments = await transport
                .requestEnvelope<{ assignments: PlanDurationAssignment[] }>({
                    method: 'GET',
                    path: `/catalogue/plans/${encodeURIComponent(id)}/variant-durations`,
                })
                .then((envelope) => envelope.data.assignments)
                .catch((): PlanDurationAssignment[] => []);

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
                durations: planDurationsFromAssignments(assignments, durations),
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
            const status = soleLifecycleStatus(filter?.statuses, PRICE_LIST_WIRE_STATUS);
            if (status === null) return NOTHING_MATCHES;

            const envelope = await transport.requestEnvelope<AdminPriceList[]>({
                method: 'GET',
                path: `/catalogue/price-lists${cursorQuery(pickCursorFilter(filter), { status })}`,
            });

            const meta = envelope.meta as PaginatedOrNumberedMeta;
            const page = mapAdminCursorPage(envelope.data, meta, (wire) => mapPriceListAdmin(wire));

            /*
             * Whole records only on request. The plan editor's publish gate counts a plan's
             * confirmed prices from the entries, the price-list screen its entry split and the
             * review queue its inconsistent rows, so those callers pass `includeEntries`; mapping the
             * index alone drew every list as "Nothing priced yet" for them. A count passes nothing
             * and costs one request rather than 1 + 2 per row.
             */
            if (filter?.includeEntries !== true) return page;

            const items = await Promise.all(page.items.map((list) => reads.getPriceList(list.id)));
            return { ...page, items };
        },

        async getPriceList(priceListId: PriceListId): Promise<PriceListAdmin> {
            const id = String(priceListId);

            /*
             * **Every** page of entries. The endpoint is cursor-paged at 25 by default, and the
             * editor saves with `PUT …/entries`, which replaces the whole set — so a list read one
             * page short was a list whose save deleted every price past the 25th.
             */
            const readEntries = (cursor: string | undefined) =>
                transport.requestEnvelope<AdminPriceListEntry[]>({
                    method: 'GET',
                    path: `/catalogue/price-lists/${encodeURIComponent(id)}/entries${cursorQuery({
                        limit: PRICE_LIST_ENTRY_PAGE,
                        cursor,
                    })}`,
                });
            const nextCursor = (meta: unknown): string | undefined => {
                const paging = meta as { has_more?: boolean; next_cursor?: string | null };
                return paging.has_more === true && typeof paging.next_cursor === 'string'
                    ? paging.next_cursor
                    : undefined;
            };

            // The channel vocabulary, the list and its first page of entries depend on nothing
            // of each other, so they are one round rather than three in a row.
            const [lookup, showEnvelope, firstPage] = await Promise.all([
                loadSalesChannelLookup(),
                transport.requestEnvelope<{
                    price_list: AdminPriceList;
                    channels: PriceListChannelAssignment[];
                }>({
                    method: 'GET',
                    path: `/catalogue/price-lists/${encodeURIComponent(id)}`,
                }),
                readEntries(undefined),
            ]);

            const entriesWire: AdminPriceListEntry[] = [...firstPage.data];
            let cursor = nextCursor(firstPage.meta);
            while (cursor !== undefined) {
                const page = await readEntries(cursor);
                entriesWire.push(...page.data);
                cursor = nextCursor(page.meta);
            }

            /*
             * Each row says what it prices — the article's type and the variant's code — so the
             * mapping needs nothing else. It used to read every article behind the list one
             * request at a time, and the editor showed a skeleton until the last one answered: a
             * minute and more on a list of thirty.
             */
            const entries = entriesWire.map((entry) =>
                mapPriceListEntry(
                    entry,
                    entry.catalogue_item_type ?? 'product',
                    entry.catalogue_item_id,
                    entry.catalogue_item_variant_code ?? null,
                ),
            );

            const channels = priceListChannelsFromAssignments(showEnvelope.data.channels, lookup);

            return mapPriceListAdmin(showEnvelope.data.price_list, {
                channels,
                entries,
            });
        },

        async listZones(filter?: DeliveryZoneAdminFilter): Promise<CursorPage<DeliveryZoneAdmin>> {
            const status = soleLifecycleStatus(filter?.statuses, DELIVERY_ZONE_WIRE_STATUS);
            if (status === null) return NOTHING_MATCHES;

            const envelope = await transport.requestEnvelope<DeliveryZone[]>({
                method: 'GET',
                path: `/catalogue/delivery-zones${cursorQuery(pickCursorFilter(filter), { status })}`,
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

            return mapDeliveryZoneAdmin(showEnvelope.data.delivery_zone, {
                areas: areasWire.map(mapServiceAreaFromDeliveryArea),
            });
        },

        async getZoneWindows(zoneId: DeliveryZoneId): Promise<readonly DeliveryWindowId[]> {
            const envelope = await transport.requestEnvelope<{
                readonly delivery_window_ids: readonly string[];
            }>({
                method: 'GET',
                path: `/catalogue/delivery-zones/${encodeURIComponent(String(zoneId))}/windows`,
            });
            return envelope.data.delivery_window_ids.map((id) => DeliveryWindowId.unsafe(id));
        },

        async listDeliveryWindows(): Promise<readonly DeliveryWindow[]> {
            const windows = await transport.request<WireDeliveryWindow[]>({
                method: 'GET',
                path: '/catalogue/delivery-windows',
            });
            return windows.map(mapDeliveryWindow);
        },

        async getBranchOperating(branchId: KitchenBranchId): Promise<BranchOperating> {
            const daysWire = await transport.request<WireBranchOperatingDay[]>({
                method: 'GET',
                path: '/kitchen/branch-operating',
            });

            return mapBranchOperating(branchId, daysWire);
        },
    };

    return reads;
}
