import {
    DeliveryZoneId,
    IngredientId,
    MealId,
    ProductId,
    RecipeId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import type { KitchenBranchId, PriceListId } from '@healthy360/domain-types';
import type { MeasureUnit } from '@healthy360/nutrition';

import type {
    BranchOperating,
    CreateDeliveryZoneRequest,
    CreateIngredientRequest,
    CreateMealRequest,
    CreatePlanRequest,
    CreateProductRequest,
    CreateRecipeRequest,
    DeliveryZoneAdmin,
    IngredientAdmin,
    IngredientAllergenMapping,
    KitchenAdminRepository,
    LockedRequest,
    MealAdmin,
    PlanAdmin,
    PriceListAdmin,
    PriceListEntry,
    ProductAdmin,
    RecipeAdmin,
    RecipeRollupDraft,
    RecipeRollupPreview,
    SetBranchOperatingRequest,
    SetChannelAvailabilityRequest,
    SetDeliveryWindowsRequest,
    SetIngredientAllergensRequest,
    SetMealAvailabilityRequest,
    SetPlanCombinationsRequest,
    SetPlanDurationsRequest,
    SetPlanVariantsRequest,
    SetPriceListEntriesRequest,
    SetRecipeLinesRequest,
    SetRecipeOutputsRequest,
    SetRecipeStepsRequest,
    SetZoneAreasRequest,
    UpdateDeliveryZoneRequest,
    UpdateIngredientRequest,
    UpdateMealRequest,
    UpdatePlanRequest,
    UpdateProductRequest,
    UpdateRecipeRequest,
} from '../contracts/kitchen-admin.ts';
import type {
    AdminCatalogueItem,
    AdminCatalogueItemVariant,
    AdminIngredient,
    AdminRecipeVersion,
    AdminSalesChannel,
    DeliveryWindow as WireDeliveryWindow,
    EnergyBand,
    IngredientCategory,
    MealCombinationOption,
    PlanDurationOption,
    PlanVariantCell,
    ProcurementReference,
} from '../generated/types.ts';
import {
    buildCategoryLookup,
    mapRecipeRollupPreview,
    pickCurrentRecipeVersion,
    type CategoryLookup,
} from './kitchen-admin-mappers.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import type { Transport } from './transport.ts';

/**
 * Kitchen catalogue writes backed by real Laravel routes (K1 Phase 3).
 */
export type ApiKitchenAdminWrites = Pick<
    KitchenAdminRepository,
    | 'createIngredient'
    | 'updateIngredient'
    | 'archiveIngredient'
    | 'setIngredientAllergens'
    | 'createRecipe'
    | 'updateRecipe'
    | 'setRecipeLines'
    | 'setRecipeSteps'
    | 'setRecipeOutputs'
    | 'previewRecipeRollup'
    | 'publishRecipe'
    | 'retireRecipe'
    | 'createProduct'
    | 'updateProduct'
    | 'archiveProduct'
    | 'setProductChannelAvailability'
    | 'setPriceListEntries'
    | 'publishPriceList'
    | 'createMeal'
    | 'updateMeal'
    | 'publishMeal'
    | 'retireMeal'
    | 'setMealAvailability'
    | 'createPlan'
    | 'updatePlan'
    | 'publishPlan'
    | 'retirePlan'
    | 'setPlanVariants'
    | 'setPlanDurations'
    | 'setPlanCombinations'
    | 'createZone'
    | 'updateZone'
    | 'archiveZone'
    | 'setZoneAreas'
    | 'setDeliveryWindows'
    | 'setBranchOperating'
>;

function ifMatch(lockVersion: number): Readonly<Record<string, string>> {
    return { 'If-Match': `"${lockVersion}"` };
}

function descriptionWire(text: { readonly en: string; readonly ar?: string | undefined }): {
    readonly description_en?: string;
    readonly description_ar?: string;
} {
    return {
        description_en: text.en,
        ...(text.ar === undefined || text.ar === '' ? {} : { description_ar: text.ar }),
    };
}

function slugifyCode(label: string): string {
    const slug = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return slug === '' ? 'item' : slug;
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Heuristic sitting flags for org meal-combination vocabulary. The admin contract
 * carries meals/snacks counts; the wire carries breakfast/lunch/dinner booleans.
 */
function sittingsForMealsPerDay(mealsPerDay: number): {
    readonly includes_breakfast: boolean;
    readonly includes_lunch: boolean;
    readonly includes_dinner: boolean;
} {
    if (mealsPerDay >= 3) {
        return { includes_breakfast: true, includes_lunch: true, includes_dinner: true };
    }
    if (mealsPerDay === 2) {
        return { includes_breakfast: false, includes_lunch: true, includes_dinner: true };
    }
    return { includes_breakfast: false, includes_lunch: true, includes_dinner: false };
}

/**
 * The platform's measurement units, by code.
 *
 * `/catalogue/procurement/reference` is the only endpoint that publishes the
 * vocabulary itself — every other surface hands out the identifier of a unit
 * something already uses. It used to be read off `/catalogue/ingredients`,
 * which meant a unit no ingredient had been keyed in with was unresolvable:
 * the demo kitchen's ingredients are all in grams, so a pack quoted in
 * kilograms had no identifier to send and the write was refused. Every role
 * that holds `catalogue.manage_organisation` holds `inventory.view_organisation`
 * too, so the read is available wherever a catalogue write is.
 */
class MeasurementUnitLookup {
    readonly #codeToId = new Map<string, string>();

    #loaded = false;

    async resolve(transport: Transport, unit: MeasureUnit): Promise<string | null> {
        const cached = this.#codeToId.get(unit);
        if (cached !== undefined) return cached;
        if (this.#loaded) return null;

        const envelope = await transport.requestEnvelope<ProcurementReference>({
            method: 'GET',
            path: '/catalogue/procurement/reference',
        });

        for (const row of envelope.data.measurement_units) {
            this.#codeToId.set(row.code, row.id);
        }
        this.#loaded = true;

        return this.#codeToId.get(unit) ?? null;
    }
}

function wireAllergenVerification(
    verification: IngredientAllergenMapping['verification'],
): string | undefined {
    switch (verification) {
        case 'operator_confirmed':
        case 'laboratory_tested':
            return 'verified';
        case 'supplier_declared':
            return 'requires_supplier_confirmation';
        default:
            return 'unverified';
    }
}

function wireIngredientAllergens(mappings: readonly IngredientAllergenMapping[]): Array<{
    readonly allergen_code: string;
    readonly containment: string;
    readonly verification_status?: string;
    readonly evidence?: string | null;
}> {
    return mappings.map((mapping) => {
        const verification = wireAllergenVerification(mapping.verification);
        return {
            allergen_code: String(mapping.allergenCode),
            containment: mapping.containment,
            ...(verification === undefined ? {} : { verification_status: verification }),
            ...(mapping.sourceNote === undefined ? {} : { evidence: mapping.sourceNote }),
        };
    });
}

/**
 * Which of the organisation's channel rows one contract channel names, or
 * `null` when it names none.
 *
 * A `SalesChannel` is the frontend contract's flattening of two server
 * concepts: `channel_kind` is a closed platform vocabulary, while a *channel*
 * is a row an organisation owns. An organisation that has never opened a
 * counter has no `pos` row, and there is nothing for "sold over the counter"
 * to point at. This used to fall back to `channels[0]`, which did not fail —
 * it wrote the decision against a different channel entirely, and, when that
 * channel was already in the submitted set, made the same pair appear twice
 * and took the whole replacement down with it (`channels.N` "stated twice").
 */
function salesChannelIdFor(
    channel: SetChannelAvailabilityRequest['availability'][number]['channel'],
    channels: readonly AdminSalesChannel[],
): string | null {
    const match = channels.find((row) => {
        switch (channel) {
            case 'b2c':
                return row.channel_kind === 'b2c_web';
            case 'b2b':
                return row.channel_kind === 'b2b';
            case 'pos':
                return row.channel_kind === 'pos';
            case 'marketplace':
                return row.channel_kind === 'marketplace';
            case 'corporate':
                return row.channel_kind === 'corporate';
            default:
                return row.code === channel;
        }
    });
    return match?.id ?? null;
}

export function createApiKitchenAdminWrites(transport: Transport): ApiKitchenAdminWrites {
    const reads = createApiKitchenAdminReads(transport);
    const units = new MeasurementUnitLookup();

    let categoryLookup: CategoryLookup | null = null;

    async function loadCategoryLookup(): Promise<CategoryLookup> {
        if (categoryLookup !== null) return categoryLookup;
        const categories = await transport.request<IngredientCategory[]>({
            method: 'GET',
            path: '/catalogue/ingredient-categories',
        });
        categoryLookup = buildCategoryLookup(categories);
        return categoryLookup;
    }

    async function loadSalesChannels(): Promise<readonly AdminSalesChannel[]> {
        return transport.request<AdminSalesChannel[]>({
            method: 'GET',
            path: '/catalogue/sales-channels',
        });
    }

    async function fetchCatalogueItemShow(itemId: string): Promise<{
        readonly item: AdminCatalogueItem;
        readonly variants: AdminCatalogueItemVariant[];
    }> {
        const envelope = await transport.requestEnvelope<{
            readonly item: AdminCatalogueItem;
            readonly variants: AdminCatalogueItemVariant[];
        }>({
            method: 'GET',
            path: `/catalogue/items/${encodeURIComponent(itemId)}`,
        });
        return envelope.data;
    }

    async function versionContext(recipeId: string): Promise<{
        readonly versionNumber: number;
        readonly lockVersion: number;
    }> {
        const envelope = await transport.requestEnvelope<{
            readonly versions: AdminRecipeVersion[];
        }>({
            method: 'GET',
            path: `/catalogue/recipes/${encodeURIComponent(recipeId)}`,
        });

        const current = pickCurrentRecipeVersion(envelope.data.versions);
        if (current === null) {
            return { versionNumber: 1, lockVersion: 1 };
        }

        return {
            versionNumber: current.version_number,
            lockVersion: current.lock_version,
        };
    }

    async function wirePriceListEntry(entry: PriceListEntry): Promise<{
        readonly catalogue_item_id: string;
        readonly catalogue_item_variant_id?: string | null;
        readonly price_status: string;
        readonly unit_amount_minor?: number | null;
    }> {
        const ref = entry.item;
        let itemId: string;
        let variantId: string | null = null;

        switch (ref.kind) {
            case 'product':
                itemId = String(ref.productId);
                if (ref.packCode !== null) {
                    const show = await fetchCatalogueItemShow(itemId);
                    const variant = show.variants.find((row) => row.code === ref.packCode);
                    variantId = variant?.id ?? null;
                }
                break;
            case 'meal':
                itemId = String(ref.mealId);
                break;
            case 'plan':
                itemId = String(ref.planId);
                if (ref.variantId !== null) {
                    variantId = String(ref.variantId);
                }
                break;
        }

        return {
            catalogue_item_id: itemId,
            catalogue_item_variant_id: variantId,
            price_status: entry.priceStatus,
            unit_amount_minor: entry.amountMinor,
        };
    }

    /**
     * The contract's packs as the variant set-replacement body.
     *
     * `pack_unit_id` is required — a pack quantity with no unit is not a size —
     * and it is *not* derivable from `ProductPackVariant.netUnit` for a pack
     * that already exists. `netUnit` is a `MeasureUnit`, the ten-value nutrition
     * vocabulary, and the platform's `measurement_units` table is wider than it:
     * the demo catalogue alone quotes packs in `gallon`, `bag`, `can` and
     * `bunch`, none of which that union can name. So the unit a stored pack
     * already carries is echoed back by code, and only a pack the submission
     * *adds* has its `netUnit` resolved — which keeps a rename-free save from
     * silently restating a kilogram pack in grams.
     *
     * @param existing the item's stored variants, keyed by code — empty when the
     *   item is being created and there is nothing to preserve.
     */
    async function wireProductVariants(
        packs: CreateProductRequest['packVariants'] | UpdateProductRequest['packVariants'],
        existing: ReadonlyMap<string, AdminCatalogueItemVariant> = new Map(),
    ): Promise<
        Array<{
            readonly code: string;
            readonly name_en?: string;
            readonly name_ar?: string;
            readonly pack?: {
                readonly pack_quantity: number;
                readonly pack_unit_id?: string;
                readonly pack_piece_count: number;
            };
        }>
    > {
        if (packs === undefined) return [];

        const wired = [];

        for (const pack of packs) {
            const stored = existing.get(pack.code)?.pack?.pack_unit_id;
            const unitId = stored ?? (await units.resolve(transport, pack.netUnit));

            wired.push({
                code: pack.code,
                name_en: pack.label.en,
                name_ar: pack.label.ar,
                pack: {
                    pack_quantity: pack.netQuantity,
                    ...(unitId === null ? {} : { pack_unit_id: unitId }),
                    pack_piece_count: pack.unitsPerPack,
                },
            });
        }

        return wired;
    }

    /** The item's stored variants by code, for a submission that has to preserve them. */
    async function storedVariantsByCode(
        itemId: string,
    ): Promise<ReadonlyMap<string, AdminCatalogueItemVariant>> {
        const show = await fetchCatalogueItemShow(itemId);
        return new Map(show.variants.map((variant) => [variant.code, variant]));
    }

    /**
     * Each accepted write bumps the item's `lock_version`, so the version a
     * later call in the same save has to send is the one the previous call
     * answered with — not the one the editor opened on. Returning it is what
     * lets a caller chain them without guessing.
     */
    async function patchCatalogueItem(
        itemId: string,
        lockVersion: number,
        body: Record<string, unknown>,
    ): Promise<number> {
        const data = await transport.request<{ readonly item: AdminCatalogueItem }>({
            method: 'PATCH',
            path: `/catalogue/items/${encodeURIComponent(itemId)}`,
            headers: ifMatch(lockVersion),
            body,
        });

        return data.item.lock_version;
    }

    async function replaceItemVariants(
        itemId: string,
        lockVersion: number,
        variants: Awaited<ReturnType<typeof wireProductVariants>>,
    ): Promise<number> {
        if (variants.length === 0) return lockVersion;
        const data = await transport.request<{ readonly item: AdminCatalogueItem }>({
            method: 'PUT',
            path: `/catalogue/items/${encodeURIComponent(itemId)}/variants`,
            headers: ifMatch(lockVersion),
            body: { variants },
        });

        return data.item.lock_version;
    }

    async function replaceDietClassifications(
        itemId: string,
        lockVersion: number,
        codes: readonly string[],
    ): Promise<void> {
        await transport.request({
            method: 'PUT',
            path: `/catalogue/items/${encodeURIComponent(itemId)}/diet-classifications`,
            headers: ifMatch(lockVersion),
            body: { diet_classifications: codes },
        });
    }

    return {
        async createIngredient(request: CreateIngredientRequest): Promise<IngredientAdmin> {
            const lookup = await loadCategoryLookup();
            const categoryId = lookup.codeToId.get(request.categoryCode);
            const unitId = await units.resolve(transport, request.measurementUnit);

            const envelope = await transport.requestEnvelope<{
                readonly ingredient: AdminIngredient;
            }>({
                method: 'POST',
                path: '/catalogue/ingredients',
                body: {
                    name_en: request.name.en,
                    ...(request.name.ar === undefined ? {} : { name_ar: request.name.ar }),
                    ...(categoryId === undefined ? {} : { ingredient_category_id: categoryId }),
                    ...(unitId === null ? {} : { default_unit_id: unitId }),
                    ...(request.notes === undefined ? {} : { notes: request.notes }),
                },
            });

            const ingredientId = envelope.data.ingredient.id;
            if (request.aliases !== undefined) {
                for (const alias of request.aliases) {
                    await transport.request({
                        method: 'POST',
                        path: `/catalogue/ingredients/${encodeURIComponent(ingredientId)}/aliases`,
                        body: { alias },
                    });
                }
            }

            return reads.getIngredient(IngredientId.unsafe(ingredientId));
        },

        async updateIngredient(
            ingredientId: IngredientId,
            request: UpdateIngredientRequest,
        ): Promise<IngredientAdmin> {
            const lookup = await loadCategoryLookup();
            const body: Record<string, unknown> = {};

            if (request.name !== undefined) {
                body.name_en = request.name.en;
                body.name_ar = request.name.ar;
            }
            if (request.categoryCode !== undefined) {
                const categoryId = lookup.codeToId.get(request.categoryCode);
                if (categoryId !== undefined) body.ingredient_category_id = categoryId;
            }
            if (request.measurementUnit !== undefined) {
                const unitId = await units.resolve(transport, request.measurementUnit);
                if (unitId !== null) body.default_unit_id = unitId;
            }
            if (request.notes !== undefined) body.notes = request.notes;

            await transport.request({
                method: 'PATCH',
                path: `/catalogue/ingredients/${encodeURIComponent(String(ingredientId))}`,
                headers: ifMatch(request.lockVersion),
                body,
            });

            if (request.aliases !== undefined) {
                const current = await reads.getIngredient(ingredientId);
                const currentAliases = new Set(current.aliases);
                const nextAliases = new Set(request.aliases);
                for (const alias of request.aliases) {
                    if (!currentAliases.has(alias)) {
                        await transport.request({
                            method: 'POST',
                            path: `/catalogue/ingredients/${encodeURIComponent(String(ingredientId))}/aliases`,
                            body: { alias },
                        });
                    }
                }
                for (const alias of current.aliases) {
                    if (!nextAliases.has(alias)) {
                        await transport.requestVoid({
                            method: 'DELETE',
                            path: `/catalogue/ingredients/${encodeURIComponent(String(ingredientId))}/aliases/${encodeURIComponent(alias)}`,
                        });
                    }
                }
            }

            return reads.getIngredient(ingredientId);
        },

        async archiveIngredient(
            ingredientId: IngredientId,
            request: LockedRequest,
        ): Promise<IngredientAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/ingredients/${encodeURIComponent(String(ingredientId))}/archive`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getIngredient(ingredientId);
        },

        async setIngredientAllergens(
            ingredientId: IngredientId,
            request: SetIngredientAllergensRequest,
        ): Promise<IngredientAdmin> {
            await transport.request({
                method: 'PUT',
                path: `/catalogue/ingredients/${encodeURIComponent(String(ingredientId))}/allergens`,
                headers: ifMatch(request.lockVersion),
                body: { mappings: wireIngredientAllergens(request.mappings) },
            });
            return reads.getIngredient(ingredientId);
        },

        async createRecipe(request: CreateRecipeRequest): Promise<RecipeAdmin> {
            const envelope = await transport.requestEnvelope<{
                readonly recipe: { readonly id: string };
                readonly version: AdminRecipeVersion;
            }>({
                method: 'POST',
                path: '/catalogue/recipes',
                body: {
                    name_en: request.name.en,
                    ...(request.name.ar === undefined ? {} : { name_ar: request.name.ar }),
                    notes: request.description.en,
                },
            });

            const recipeId = envelope.data.recipe.id;
            const yieldUnitId = await units.resolve(transport, request.yieldUnit);

            await transport.request({
                method: 'PATCH',
                path: `/catalogue/recipes/${encodeURIComponent(recipeId)}/versions/${encodeURIComponent(String(envelope.data.version.version_number))}`,
                headers: ifMatch(envelope.data.version.lock_version),
                body: {
                    yield_quantity: request.yieldQuantity,
                    ...(yieldUnitId === null ? {} : { yield_unit_id: yieldUnitId }),
                    ...(request.yieldPieces === undefined
                        ? {}
                        : { yield_piece_count: request.yieldPieces }),
                    ...(request.wastePercent === undefined
                        ? {}
                        : { waste_coefficient_percent: request.wastePercent }),
                },
            });

            return reads.getRecipe(RecipeId.unsafe(recipeId));
        },

        async updateRecipe(recipeId: RecipeId, request: UpdateRecipeRequest): Promise<RecipeAdmin> {
            const id = String(recipeId);
            const body: Record<string, unknown> = {};

            if (request.name !== undefined) {
                body.name_en = request.name.en;
                body.name_ar = request.name.ar;
            }
            if (request.description !== undefined) body.notes = request.description.en;

            if (Object.keys(body).length > 0) {
                await transport.request({
                    method: 'PATCH',
                    path: `/catalogue/recipes/${encodeURIComponent(id)}`,
                    headers: ifMatch(request.lockVersion),
                    body,
                });
            }

            const versionBody: Record<string, unknown> = {};
            if (request.yieldQuantity !== undefined)
                versionBody.yield_quantity = request.yieldQuantity;
            if (request.yieldUnit !== undefined) {
                const unitId = await units.resolve(transport, request.yieldUnit);
                if (unitId !== null) versionBody.yield_unit_id = unitId;
            }
            if (request.yieldPieces !== undefined)
                versionBody.yield_piece_count = request.yieldPieces;
            if (request.wastePercent !== undefined) {
                versionBody.waste_coefficient_percent = request.wastePercent;
            }

            if (Object.keys(versionBody).length > 0) {
                const ctx = await versionContext(id);
                await transport.request({
                    method: 'PATCH',
                    path: `/catalogue/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(ctx.versionNumber))}`,
                    headers: ifMatch(ctx.lockVersion),
                    body: versionBody,
                });
            }

            return reads.getRecipe(recipeId);
        },

        async setRecipeLines(
            recipeId: RecipeId,
            request: SetRecipeLinesRequest,
        ): Promise<RecipeAdmin> {
            const id = String(recipeId);
            const ctx = await versionContext(id);

            const lines = await Promise.all(
                request.lines.map(async (line) => {
                    const unitId = await units.resolve(transport, line.unit);
                    return {
                        ingredient_id: String(line.ingredientId),
                        quantity: line.quantity,
                        ...(unitId === null ? {} : { unit_id: unitId }),
                        ...(line.sourceDesignation === undefined
                            ? {}
                            : { source_designation: line.sourceDesignation }),
                    };
                }),
            );

            await transport.request({
                method: 'PUT',
                path: `/catalogue/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(ctx.versionNumber))}/lines`,
                headers: ifMatch(ctx.lockVersion),
                body: { lines },
            });

            return reads.getRecipe(recipeId);
        },

        async setRecipeSteps(
            recipeId: RecipeId,
            request: SetRecipeStepsRequest,
        ): Promise<RecipeAdmin> {
            const id = String(recipeId);
            const ctx = await versionContext(id);

            await transport.request({
                method: 'PUT',
                path: `/catalogue/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(ctx.versionNumber))}/steps`,
                headers: ifMatch(ctx.lockVersion),
                body: {
                    steps: request.steps.map((step) => ({
                        instruction_en: step.instruction.en,
                        instruction_ar: step.instruction.ar,
                        minutes: step.minutes ?? null,
                    })),
                },
            });

            return reads.getRecipe(recipeId);
        },

        async setRecipeOutputs(
            recipeId: RecipeId,
            request: SetRecipeOutputsRequest,
        ): Promise<RecipeAdmin> {
            const id = String(recipeId);
            const ctx = await versionContext(id);

            const outputs = await Promise.all(
                request.outputs.map(async (output) => {
                    const unitId = await units.resolve(transport, output.unit);
                    return {
                        ingredient_id: String(output.ingredientId),
                        output_quantity: output.quantity,
                        unit_id: unitId ?? undefined,
                        is_primary: output.isPrimary ?? false,
                    };
                }),
            );

            await transport.request({
                method: 'PUT',
                path: `/catalogue/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(ctx.versionNumber))}/outputs`,
                headers: ifMatch(ctx.lockVersion),
                body: { outputs },
            });

            return reads.getRecipe(recipeId);
        },

        async publishRecipe(recipeId: RecipeId, _request: LockedRequest): Promise<RecipeAdmin> {
            const id = String(recipeId);
            const ctx = await versionContext(id);

            await transport.request({
                method: 'POST',
                path: `/catalogue/recipes/${encodeURIComponent(id)}/versions/${encodeURIComponent(String(ctx.versionNumber))}/publish`,
                headers: ifMatch(ctx.lockVersion),
            });

            return reads.getRecipe(recipeId);
        },

        async retireRecipe(recipeId: RecipeId, request: LockedRequest): Promise<RecipeAdmin> {
            const id = String(recipeId);
            await transport.request({
                method: 'POST',
                path: `/catalogue/recipes/${encodeURIComponent(id)}/archive`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getRecipe(recipeId);
        },

        async createProduct(request: CreateProductRequest): Promise<ProductAdmin> {
            const envelope = await transport.requestEnvelope<{ readonly item: AdminCatalogueItem }>(
                {
                    method: 'POST',
                    path: '/catalogue/items',
                    body: {
                        item_type: 'product',
                        name_en: request.name.en,
                        ...(request.name.ar === undefined ? {} : { name_ar: request.name.ar }),
                        ...descriptionWire(request.description),
                        ...(isUuid(request.categoryCode)
                            ? { product_category_id: request.categoryCode }
                            : {}),
                        ...(request.recipeId === undefined
                            ? {}
                            : { recipe_id: String(request.recipeId) }),
                        ...(request.isMarketPriced === undefined
                            ? {}
                            : { is_market_priced: request.isMarketPriced }),
                        ...(request.isAssorted === undefined
                            ? {}
                            : { is_assorted: request.isAssorted }),
                    },
                },
            );

            const itemId = envelope.data.item.id;
            let lockVersion = envelope.data.item.lock_version;

            const variants = await wireProductVariants(request.packVariants);
            if (variants.length > 0) {
                lockVersion = await replaceItemVariants(itemId, lockVersion, variants);
            }

            if (
                request.dietClassifications !== undefined &&
                request.dietClassifications.length > 0
            ) {
                await replaceDietClassifications(itemId, lockVersion, request.dietClassifications);
            }

            return reads.getProduct(ProductId.unsafe(itemId));
        },

        async updateProduct(
            productId: ProductId,
            request: UpdateProductRequest,
        ): Promise<ProductAdmin> {
            const id = String(productId);
            const body: Record<string, unknown> = {};

            if (request.name !== undefined) {
                body.name_en = request.name.en;
                body.name_ar = request.name.ar;
            }
            if (request.description !== undefined)
                Object.assign(body, descriptionWire(request.description));
            if (request.categoryCode !== undefined && isUuid(request.categoryCode)) {
                body.product_category_id = request.categoryCode;
            }
            if (request.recipeId !== undefined) {
                body.recipe_id = request.recipeId === null ? null : String(request.recipeId);
            }
            if (request.isMarketPriced !== undefined)
                body.is_market_priced = request.isMarketPriced;
            if (request.isAssorted !== undefined) body.is_assorted = request.isAssorted;

            // One editor save, up to three lock-versioned writes. Each accepted
            // one bumps the item, so the second and third have to carry what the
            // one before them answered with — sending the version the editor
            // opened on made every save with both a renamed field and a pack
            // list a lost race against itself.
            let lockVersion = request.lockVersion;

            if (Object.keys(body).length > 0) {
                lockVersion = await patchCatalogueItem(id, lockVersion, body);
            }

            const variants = await wireProductVariants(
                request.packVariants,
                request.packVariants === undefined ? new Map() : await storedVariantsByCode(id),
            );
            if (variants.length > 0) {
                lockVersion = await replaceItemVariants(id, lockVersion, variants);
            }

            if (request.dietClassifications !== undefined) {
                await replaceDietClassifications(id, lockVersion, request.dietClassifications);
            }

            return reads.getProduct(productId);
        },

        async archiveProduct(productId: ProductId, request: LockedRequest): Promise<ProductAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/items/${encodeURIComponent(String(productId))}/retire`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getProduct(productId);
        },

        async setProductChannelAvailability(
            productId: ProductId,
            request: SetChannelAvailabilityRequest,
        ): Promise<ProductAdmin> {
            const channels = await loadSalesChannels();

            // A row naming a channel this organisation does not run is left
            // out rather than pointed at some other channel: the set is a
            // replacement, and a guess would both mis-state the offering and
            // collide with the row that channel legitimately holds.
            const assignments = request.availability.flatMap((row) => {
                const salesChannelId = salesChannelIdFor(row.channel, channels);
                if (salesChannelId === null) return [];

                return [
                    {
                        sales_channel_id: salesChannelId,
                        is_available: row.isAvailable,
                        available_from: row.availableFrom,
                        available_to: row.availableUntil,
                    },
                ];
            });

            await transport.request({
                method: 'PUT',
                path: `/catalogue/items/${encodeURIComponent(String(productId))}/channels`,
                headers: ifMatch(request.lockVersion),
                body: { channels: assignments },
            });

            return reads.getProduct(productId);
        },

        async setPriceListEntries(
            priceListId: PriceListId,
            request: SetPriceListEntriesRequest,
        ): Promise<PriceListAdmin> {
            const entries = await Promise.all(
                request.entries.map((entry) => wirePriceListEntry(entry)),
            );

            await transport.request({
                method: 'PUT',
                path: `/catalogue/price-lists/${encodeURIComponent(String(priceListId))}/entries`,
                headers: ifMatch(request.lockVersion),
                body: { entries },
            });

            return reads.getPriceList(priceListId);
        },

        async publishPriceList(
            priceListId: PriceListId,
            request: LockedRequest,
        ): Promise<PriceListAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/price-lists/${encodeURIComponent(String(priceListId))}/publish`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getPriceList(priceListId);
        },

        async createMeal(request: CreateMealRequest): Promise<MealAdmin> {
            const envelope = await transport.requestEnvelope<{ readonly item: AdminCatalogueItem }>(
                {
                    method: 'POST',
                    path: '/catalogue/items',
                    body: {
                        item_type: 'meal',
                        name_en: request.name.en,
                        ...(request.name.ar === undefined ? {} : { name_ar: request.name.ar }),
                        ...descriptionWire(request.description),
                        ...(request.recipeId === undefined
                            ? {}
                            : { recipe_id: String(request.recipeId) }),
                    },
                },
            );

            const itemId = envelope.data.item.id;
            const lockVersion = envelope.data.item.lock_version;

            if (
                request.dietClassifications !== undefined &&
                request.dietClassifications.length > 0
            ) {
                await replaceDietClassifications(itemId, lockVersion, request.dietClassifications);
            }

            return reads.getMeal(MealId.unsafe(itemId));
        },

        async updateMeal(mealId: MealId, request: UpdateMealRequest): Promise<MealAdmin> {
            const id = String(mealId);
            const body: Record<string, unknown> = {};

            if (request.name !== undefined) {
                body.name_en = request.name.en;
                body.name_ar = request.name.ar;
            }
            if (request.description !== undefined)
                Object.assign(body, descriptionWire(request.description));
            if (request.recipeId !== undefined) {
                body.recipe_id = request.recipeId === null ? null : String(request.recipeId);
            }

            if (Object.keys(body).length > 0) {
                await patchCatalogueItem(id, request.lockVersion, body);
            }

            if (request.dietClassifications !== undefined) {
                await replaceDietClassifications(
                    id,
                    request.lockVersion,
                    request.dietClassifications,
                );
            }

            return reads.getMeal(mealId);
        },

        async publishMeal(mealId: MealId, request: LockedRequest): Promise<MealAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/items/${encodeURIComponent(String(mealId))}/publish`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getMeal(mealId);
        },

        async retireMeal(mealId: MealId, request: LockedRequest): Promise<MealAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/items/${encodeURIComponent(String(mealId))}/retire`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getMeal(mealId);
        },

        async createPlan(request: CreatePlanRequest): Promise<PlanAdmin> {
            const envelope = await transport.requestEnvelope<{ readonly item: AdminCatalogueItem }>(
                {
                    method: 'POST',
                    path: '/catalogue/items',
                    body: {
                        item_type: 'subscription_plan',
                        name_en: request.name.en,
                        ...(request.name.ar === undefined ? {} : { name_ar: request.name.ar }),
                        description_en: request.description.en,
                        ...(request.description.ar === undefined
                            ? {}
                            : { description_ar: request.description.ar }),
                    },
                },
            );

            const itemId = envelope.data.item.id;
            const lockVersion = envelope.data.item.lock_version;

            await transport.request({
                method: 'PUT',
                path: `/catalogue/plans/${encodeURIComponent(itemId)}/profile`,
                headers: ifMatch(lockVersion),
                body: {
                    summary_en: request.summary.en,
                    ...(request.summary.ar === undefined ? {} : { summary_ar: request.summary.ar }),
                    ...(request.changeCutOffHours === undefined
                        ? {}
                        : { change_cutoff_hours: request.changeCutOffHours }),
                },
            });

            if (
                request.dietClassifications !== undefined &&
                request.dietClassifications.length > 0
            ) {
                await replaceDietClassifications(
                    itemId,
                    lockVersion + 1,
                    request.dietClassifications,
                );
            }

            return reads.getPlan(SubscriptionPlanId.unsafe(itemId));
        },

        async updatePlan(
            planId: SubscriptionPlanId,
            request: UpdatePlanRequest,
        ): Promise<PlanAdmin> {
            const id = String(planId);
            const body: Record<string, unknown> = {};

            if (request.name !== undefined) {
                body.name_en = request.name.en;
                body.name_ar = request.name.ar;
            }
            if (request.description !== undefined)
                Object.assign(body, descriptionWire(request.description));

            if (Object.keys(body).length > 0) {
                await patchCatalogueItem(id, request.lockVersion, body);
            }

            const profile: Record<string, unknown> = {};
            if (request.summary !== undefined) {
                profile.summary_en = request.summary.en;
                profile.summary_ar = request.summary.ar;
            }
            if (request.changeCutOffHours !== undefined) {
                profile.change_cutoff_hours = request.changeCutOffHours;
            }

            if (Object.keys(profile).length > 0) {
                await transport.request({
                    method: 'PUT',
                    path: `/catalogue/plans/${encodeURIComponent(id)}/profile`,
                    headers: ifMatch(request.lockVersion),
                    body: profile,
                });
            }

            if (request.dietClassifications !== undefined) {
                await replaceDietClassifications(
                    id,
                    request.lockVersion,
                    request.dietClassifications,
                );
            }

            return reads.getPlan(planId);
        },

        async publishPlan(planId: SubscriptionPlanId, request: LockedRequest): Promise<PlanAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/items/${encodeURIComponent(String(planId))}/publish`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getPlan(planId);
        },

        async retirePlan(planId: SubscriptionPlanId, request: LockedRequest): Promise<PlanAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/items/${encodeURIComponent(String(planId))}/retire`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getPlan(planId);
        },

        async setPlanVariants(
            planId: SubscriptionPlanId,
            request: SetPlanVariantsRequest,
        ): Promise<PlanAdmin> {
            const id = String(planId);
            const combinations = await transport.request<MealCombinationOption[]>({
                method: 'GET',
                path: '/catalogue/plan-vocabulary/combinations',
            });
            const bands = await transport.request<EnergyBand[]>({
                method: 'GET',
                path: '/catalogue/plan-vocabulary/energy-bands',
            });

            const cells = request.variants.flatMap((variant) => {
                const combination = combinations.find(
                    (row) => row.meals_per_day === variant.mealsPerDay,
                );
                if (combination === undefined) return [];

                const band = bands.find(
                    (row) =>
                        row.min_kcal === variant.energyBand.min &&
                        row.max_kcal === variant.energyBand.max,
                );

                return [
                    {
                        meal_combination_option_id: combination.id,
                        energy_band_id: band?.id ?? null,
                        meals_per_day: variant.mealsPerDay,
                        snacks_per_day: variant.snacksPerDay,
                        includes_snacks: variant.snacksPerDay > 0,
                        name_en: variant.name.en,
                        name_ar: variant.name.ar,
                        status: variant.isActive === false ? 'archived' : 'active',
                        ...(variant.id === null ? {} : { id: String(variant.id) }),
                    },
                ];
            });

            await transport.request({
                method: 'PUT',
                path: `/catalogue/plans/${encodeURIComponent(id)}/variants`,
                headers: ifMatch(request.lockVersion),
                body: { cells },
            });

            return reads.getPlan(planId);
        },

        async setPlanDurations(
            planId: SubscriptionPlanId,
            request: SetPlanDurationsRequest,
        ): Promise<PlanAdmin> {
            const id = String(planId);
            let durations = await transport.request<PlanDurationOption[]>({
                method: 'GET',
                path: '/catalogue/plan-vocabulary/durations',
            });

            for (const duration of request.durations) {
                const existing = durations.find(
                    (row) =>
                        row.duration_kind === duration.kind && row.duration_days === duration.days,
                );
                if (existing !== undefined) continue;

                const created = await transport.requestEnvelope<{
                    readonly duration: PlanDurationOption;
                }>({
                    method: 'POST',
                    path: '/catalogue/plan-vocabulary/durations',
                    body: {
                        code: slugifyCode(
                            duration.kind === 'one_off' ? 'one-off' : `${duration.days}-days`,
                        ),
                        duration_kind: duration.kind,
                        duration_days: duration.days,
                        name_en: duration.kind === 'one_off' ? 'One-off' : `${duration.days} days`,
                    },
                });
                durations = [...durations, created.data.duration];
            }

            const variantsEnvelope = await transport.requestEnvelope<{
                readonly cells: PlanVariantCell[];
            }>({
                method: 'GET',
                path: `/catalogue/plans/${encodeURIComponent(id)}/variants`,
            });

            const assignments: Array<Record<string, unknown>> = [];
            for (const variant of variantsEnvelope.data.cells) {
                for (const duration of request.durations) {
                    const option = durations.find(
                        (row) =>
                            row.duration_kind === duration.kind &&
                            row.duration_days === duration.days,
                    );
                    if (option === undefined) continue;

                    assignments.push({
                        catalogue_item_variant_id: variant.catalogue_item_variant_id,
                        plan_duration_id: option.id,
                        discount_percent: duration.discountPercent,
                    });
                }
            }

            await transport.request({
                method: 'PUT',
                path: `/catalogue/plans/${encodeURIComponent(id)}/variant-durations`,
                headers: ifMatch(request.lockVersion),
                body: { assignments },
            });

            return reads.getPlan(planId);
        },

        /**
         * Org-scoped meal combinations, not plan-scoped. The contract keys the
         * write by plan so the editor can round-trip; the vocabulary itself is
         * shared across the kitchen's plans (same as durations).
         */
        async setPlanCombinations(
            planId: SubscriptionPlanId,
            request: SetPlanCombinationsRequest,
        ): Promise<PlanAdmin> {
            let combinations = await transport.request<MealCombinationOption[]>({
                method: 'GET',
                path: '/catalogue/plan-vocabulary/combinations',
            });

            const requestedCodes = new Set(request.combinations.map((row) => row.code));

            for (const combination of request.combinations) {
                const sittings = sittingsForMealsPerDay(combination.mealsPerDay);
                const existing = combinations.find((row) => row.code === combination.code);

                if (existing === undefined) {
                    const created = await transport.requestEnvelope<{
                        readonly combination: MealCombinationOption;
                    }>({
                        method: 'POST',
                        path: '/catalogue/plan-vocabulary/combinations',
                        body: {
                            code: combination.code,
                            name_en: combination.label.en,
                            ...(combination.label.ar === undefined || combination.label.ar === ''
                                ? {}
                                : { name_ar: combination.label.ar }),
                            meals_per_day: combination.mealsPerDay,
                            ...sittings,
                        },
                    });
                    combinations = [...combinations, created.data.combination];
                    continue;
                }

                const updated = await transport.requestEnvelope<{
                    readonly combination: MealCombinationOption;
                }>({
                    method: 'PATCH',
                    path: `/catalogue/plan-vocabulary/combinations/${encodeURIComponent(existing.id)}`,
                    body: {
                        name_en: combination.label.en,
                        ...(combination.label.ar === undefined
                            ? {}
                            : { name_ar: combination.label.ar }),
                        meals_per_day: combination.mealsPerDay,
                        is_active: combination.isAvailable,
                        ...sittings,
                    },
                });
                combinations = combinations.map((row) =>
                    row.id === existing.id ? updated.data.combination : row,
                );
            }

            for (const existing of combinations) {
                if (requestedCodes.has(existing.code) || !existing.is_active) continue;

                await transport.request({
                    method: 'PATCH',
                    path: `/catalogue/plan-vocabulary/combinations/${encodeURIComponent(existing.id)}`,
                    body: { is_active: false },
                });
            }

            return reads.getPlan(planId);
        },

        async createZone(request: CreateDeliveryZoneRequest): Promise<DeliveryZoneAdmin> {
            const envelope = await transport.requestEnvelope<{
                readonly delivery_zone: { readonly id: string };
            }>({
                method: 'POST',
                path: '/catalogue/delivery-zones',
                body: {
                    code: slugifyCode(request.name.en),
                    name_en: request.name.en,
                    ...(request.name.ar === undefined ? {} : { name_ar: request.name.ar }),
                    currency_code: request.currency,
                    ...(request.deliveryFeeMinor === undefined
                        ? {}
                        : { delivery_fee_minor: request.deliveryFeeMinor }),
                    ...(request.minimumOrderMinor === undefined
                        ? {}
                        : { minimum_order_minor: request.minimumOrderMinor }),
                    ...(request.estimatedMinutes === undefined
                        ? {}
                        : { estimated_minutes: request.estimatedMinutes }),
                    ...(request.branchIds !== undefined && request.branchIds.length > 0
                        ? { branch_id: String(request.branchIds[0]!) }
                        : {}),
                },
            });

            return reads.getZone(DeliveryZoneId.unsafe(envelope.data.delivery_zone.id));
        },

        async updateZone(
            zoneId: DeliveryZoneId,
            request: UpdateDeliveryZoneRequest,
        ): Promise<DeliveryZoneAdmin> {
            const body: Record<string, unknown> = {};

            if (request.name !== undefined) {
                body.name_en = request.name.en;
                body.name_ar = request.name.ar;
            }
            if (request.deliveryFeeMinor !== undefined) {
                body.delivery_fee_minor = request.deliveryFeeMinor;
            }
            if (request.minimumOrderMinor !== undefined) {
                body.minimum_order_minor = request.minimumOrderMinor;
            }
            if (request.estimatedMinutes !== undefined) {
                body.estimated_minutes = request.estimatedMinutes;
            }
            if (request.branchIds !== undefined) {
                body.branch_id =
                    request.branchIds.length > 0 ? String(request.branchIds[0]!) : null;
            }

            await transport.request({
                method: 'PATCH',
                path: `/catalogue/delivery-zones/${encodeURIComponent(String(zoneId))}`,
                headers: ifMatch(request.lockVersion),
                body,
            });

            return reads.getZone(zoneId);
        },

        async archiveZone(
            zoneId: DeliveryZoneId,
            request: LockedRequest,
        ): Promise<DeliveryZoneAdmin> {
            await transport.request({
                method: 'POST',
                path: `/catalogue/delivery-zones/${encodeURIComponent(String(zoneId))}/archive`,
                headers: ifMatch(request.lockVersion),
            });
            return reads.getZone(zoneId);
        },

        async setZoneAreas(
            zoneId: DeliveryZoneId,
            request: SetZoneAreasRequest,
        ): Promise<DeliveryZoneAdmin> {
            await transport.request({
                method: 'PUT',
                path: `/catalogue/delivery-zones/${encodeURIComponent(String(zoneId))}/areas`,
                headers: ifMatch(request.lockVersion),
                body: {
                    service_area_ids: request.serviceAreaIds.map((areaId) => String(areaId)),
                },
            });
            return reads.getZone(zoneId);
        },

        /**
         * Org-scoped delivery windows. The contract keys the write by zone so
         * the zone editor can own the form; windows themselves are kitchen
         * vocabulary (no zone FK on the wire today).
         */
        async setDeliveryWindows(
            zoneId: DeliveryZoneId,
            request: SetDeliveryWindowsRequest,
        ): Promise<DeliveryZoneAdmin> {
            let windows = await transport.request<WireDeliveryWindow[]>({
                method: 'GET',
                path: '/catalogue/delivery-windows',
            });

            const keptIds = new Set<string>();

            for (const window of request.windows) {
                const body = {
                    name_en: window.label.en,
                    ...(window.label.ar === undefined || window.label.ar === ''
                        ? {}
                        : { name_ar: window.label.ar }),
                    weekdays: [...window.weekdays],
                    starts_at: window.startsAt,
                    ends_at: window.endsAt,
                    is_active: window.isActive ?? true,
                };

                if (window.id === null) {
                    const created = await transport.requestEnvelope<{
                        readonly delivery_window: WireDeliveryWindow;
                    }>({
                        method: 'POST',
                        path: '/catalogue/delivery-windows',
                        body: {
                            code: slugifyCode(window.label.en),
                            ...body,
                        },
                    });
                    windows = [...windows, created.data.delivery_window];
                    keptIds.add(created.data.delivery_window.id);
                    continue;
                }

                const id = String(window.id);
                keptIds.add(id);
                const updated = await transport.requestEnvelope<{
                    readonly delivery_window: WireDeliveryWindow;
                }>({
                    method: 'PATCH',
                    path: `/catalogue/delivery-windows/${encodeURIComponent(id)}`,
                    body,
                });
                windows = windows.map((row) =>
                    row.id === id ? updated.data.delivery_window : row,
                );
            }

            for (const existing of windows) {
                if (keptIds.has(existing.id) || !existing.is_active) continue;

                await transport.request({
                    method: 'PATCH',
                    path: `/catalogue/delivery-windows/${encodeURIComponent(existing.id)}`,
                    body: { is_active: false },
                });
            }

            return reads.getZone(zoneId);
        },

        async setMealAvailability(
            mealId: MealId,
            request: SetMealAvailabilityRequest,
        ): Promise<MealAdmin> {
            await transport.request({
                method: 'PUT',
                path: `/catalogue/items/${encodeURIComponent(String(mealId))}/availability`,
                headers: ifMatch(request.lockVersion),
                body: {
                    days: request.days.map((day) => ({
                        date: day.date,
                        is_available: day.isAvailable,
                        remaining: day.remaining,
                        order_cut_off_at: day.orderCutOffAt,
                    })),
                },
            });

            return reads.getMeal(mealId);
        },

        async previewRecipeRollup(draft: RecipeRollupDraft): Promise<RecipeRollupPreview> {
            const lines = await Promise.all(
                draft.lines.map(async (line) => {
                    const unitId = await units.resolve(transport, line.unit);
                    return {
                        ingredient_id: String(line.ingredientId),
                        quantity: line.quantity,
                        ...(unitId === null ? {} : { unit_id: unitId }),
                    };
                }),
            );

            const envelope = await transport.requestEnvelope<{
                readonly per_recipe: null;
                readonly per_serving: null;
                readonly per_100g: null;
                readonly allergen_sources: ReadonlyArray<{
                    readonly allergen_code: string;
                    readonly containment: string;
                    readonly ingredient_ids: readonly string[];
                }>;
                readonly estimated_cost: {
                    readonly amount: string;
                    readonly currency: string;
                } | null;
                readonly warnings: ReadonlyArray<{
                    readonly code: string;
                    readonly message: string;
                    readonly ingredient_ids?: readonly string[];
                }>;
            }>({
                method: 'POST',
                path: '/catalogue/recipes/roll-up-preview',
                body: {
                    recipe_id: draft.recipeId === null ? null : String(draft.recipeId),
                    servings: draft.servings,
                    ...(draft.wastePercent === undefined
                        ? {}
                        : { waste_percent: draft.wastePercent }),
                    lines,
                },
            });

            return mapRecipeRollupPreview(envelope.data);
        },

        async setBranchOperating(
            branchId: KitchenBranchId,
            request: SetBranchOperatingRequest,
        ): Promise<BranchOperating> {
            await transport.request({
                method: 'PUT',
                path: '/kitchen/branch-operating',
                body: {
                    days: request.days.map((day) => ({
                        weekday: day.weekday,
                        opens_at: day.opensAt,
                        closes_at: day.closesAt,
                        order_cut_off_at: day.orderCutOffAt,
                    })),
                },
            });

            return reads.getBranchOperating(branchId);
        },
    };
}
