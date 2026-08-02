import { OrganisationId, minorUnitExponent, money } from '@healthy360/domain-types';
import type {
    AllergenCode,
    DeliveryZoneId,
    IngredientId,
    KitchenBranchId,
    KitchenId,
    MealId,
    PriceListId,
    ProductId,
    RecipeId,
    SubscriptionPlanId,
} from '@healthy360/domain-types';
import { recipeNutritionFromIngredients, scaleFacts } from '@healthy360/nutrition';
import type { Serving } from '@healthy360/nutrition';

import { conflictFailure, throwFailure, validationFailure } from '../../contracts/failure.ts';
import { apiFailure } from '../../contracts/failure.ts';
import type { Recipe } from '../../contracts/foods.ts';
import type {
    AllergenClass,
    AllergenSource,
    BranchOperating,
    CreateDeliveryZoneRequest,
    CreateIngredientRequest,
    CreateMealRequest,
    CreatePlanRequest,
    CreateProductRequest,
    CreateRecipeRequest,
    DeliveryZoneAdmin,
    IngredientAdmin,
    LockedRequest,
    MealAdmin,
    PlanAdmin,
    PlanVariantAdmin,
    PriceListAdmin,
    ProductAdmin,
    PublishableStatus,
    RecipeAdmin,
    RecipeAdminSummary,
    RecipeLineInput,
    RecipeRollupDraft,
    RecipeRollupPreview,
    RollupWarning,
    ServiceArea,
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
} from '../../contracts/kitchen-admin.ts';
import { isPlanDurationConsistent, isPriceEntryConsistent } from '../../contracts/kitchen-admin.ts';
import type {
    DeliveryZone,
    Kitchen,
    MarketplaceMeal,
    PlanVariant,
    SubscriptionPlan,
} from '../../contracts/marketplace.ts';
import { PROTOTYPE_NOW } from './constants.ts';
import { buildCatalogueSeed } from './catalogue-seed.ts';
import {
    costAmount,
    gramsFor,
    projectAvailability,
    projectOpeningHours,
    projectZone,
    quantitiesFrom,
    roundCost,
    sumCostAmounts,
    untranslated,
    withBranch,
} from './catalogue-model.ts';
import type {
    StoredBranchOperating,
    StoredIngredient,
    StoredMeal,
    StoredPlan,
    StoredPriceList,
    StoredProduct,
    StoredRecipe,
    StoredRecipeVersion,
    StoredZone,
} from './catalogue-model.ts';
import { unionAllergens } from './fixtures/index.ts';
import type { PrototypeIngredient } from './fixtures/index.ts';
import {
    PROTOTYPE_RUNTIME_ORDINAL_START,
    deliveryWindowIdAt,
    deliveryZoneIdAt,
    ingredientIdAt,
    mealIdAt,
    planVariantIdAt,
    productIdAt,
    recipeIdAt,
    recipeVersionIdAt,
    subscriptionPlanIdAt,
} from './ids.ts';

/**
 * The mutable kitchen catalogue.
 *
 * ## Why this exists at all
 *
 * Before K1 the fixture world was a set of frozen constants and the consumer repositories read them
 * directly. That was honest for a browse-only prototype and stops being honest the moment a kitchen
 * screen claims to *edit* the catalogue: an admin surface writing into a world the consumer surfaces
 * cannot see is a demonstration of a product that does not exist. So the collections became
 * mutable, the seed became the fixtures rather than the state, and **both sides read the same
 * store** — publish a meal here and it appears in the marketplace listing; retire it and it goes.
 *
 * ## Two rules this class keeps
 *
 * 1. **Every write is lock-versioned.** A stale `lockVersion` is rejected with `resource.conflict`
 *    carrying the version the store holds, which is what the editor's reload-vs-keep dialog needs.
 *    Nothing here accepts a write without one, because the contract has no shape for one.
 * 2. **Nothing is random and nothing reads the clock.** Every timestamp is `PROTOTYPE_NOW`, every
 *    identifier comes from a band, and the runtime bands start at
 *    {@link PROTOTYPE_RUNTIME_ORDINAL_START} — so an identifier in a failing assertion says whether
 *    the row was seeded or created by the interaction under test.
 */

/** Whoever the mock says is signing the edits. One name, so `updatedByName` is assertable. */
export const PROTOTYPE_KITCHEN_MANAGER_NAME = 'Rana Khoury';

/**
 * The recipe identifier a roll-up preview is computed against while the recipe does not exist yet.
 *
 * `recipeNutritionFromIngredients` requires one, and the preview only ever reads the *facts* off its
 * result. Taking the top of the recipe band — far above both the twenty fixtures and the runtime
 * start — means it can never be mistaken for a row.
 */
const DRAFT_RECIPE_ID = recipeIdAt(0xff);

const DRAFT_SERVING: Serving = {
    label: '1 portion',
    quantity: 1,
    unit: 'portion',
    grams: null,
    millilitres: null,
    householdMeasure: null,
};

function notFound(what: string, id: string): never {
    return throwFailure(
        apiFailure('resource.not_found', {
            message: `No ${what} ${id} exists in this world.`,
        }),
    );
}

/** Money (minor units) from a cost in major units. */
function moneyFromCost(amount: number, currency: Parameters<typeof money>[1]) {
    return money(Math.round(amount * 10 ** minorUnitExponent(currency)), currency);
}

export class KitchenCatalogueStore {
    readonly #allergenClasses: readonly AllergenClass[];
    readonly #serviceAreas = new Map<string, ServiceArea>();
    readonly #ingredients = new Map<string, StoredIngredient>();
    readonly #recipes = new Map<string, StoredRecipe>();
    readonly #products = new Map<string, StoredProduct>();
    readonly #priceLists = new Map<string, StoredPriceList>();
    readonly #meals = new Map<string, StoredMeal>();
    readonly #plans = new Map<string, StoredPlan>();
    readonly #zones = new Map<string, StoredZone>();
    readonly #branchOperating = new Map<string, StoredBranchOperating>();
    #kitchens: Kitchen[];

    #nextIngredientOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextRecipeOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextRecipeVersionOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextProductOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextMealOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextPlanOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;
    #nextWindowOrdinal = PROTOTYPE_RUNTIME_ORDINAL_START;

    constructor() {
        const seed = buildCatalogueSeed();
        this.#allergenClasses = seed.allergenClasses;
        for (const area of seed.serviceAreas) this.#serviceAreas.set(String(area.id), area);
        for (const row of seed.ingredients) this.#ingredients.set(String(row.id), row);
        for (const row of seed.recipes) this.#recipes.set(String(row.id), row);
        for (const row of seed.products) this.#products.set(String(row.id), row);
        for (const row of seed.priceLists) this.#priceLists.set(String(row.id), row);
        for (const row of seed.meals) this.#meals.set(String(row.id), row);
        for (const row of seed.plans) this.#plans.set(String(row.id), row);
        for (const row of seed.zones) this.#zones.set(String(row.id), row);
        for (const row of seed.branchOperating) {
            this.#branchOperating.set(String(row.branchId), row);
        }
        this.#kitchens = [...seed.kitchens];
    }

    /* ── locking ───────────────────────────────────────────────────────────────────────────── */

    #assertVersion(current: number, supplied: number, what: string): void {
        if (current === supplied) return;
        throwFailure(
            conflictFailure({
                currentLockVersion: current,
                message:
                    `This ${what} has changed since it was loaded (version ${String(current)}, ` +
                    `you sent ${String(supplied)}). Reload it before saving.`,
            }),
        );
    }

    #bump<T extends { lockVersion: number; updatedAt: string; updatedByName: string | null }>(
        meta: T,
    ): T {
        return {
            ...meta,
            lockVersion: meta.lockVersion + 1,
            updatedAt: PROTOTYPE_NOW,
            updatedByName: PROTOTYPE_KITCHEN_MANAGER_NAME,
        };
    }

    /**
     * The quarantine gate.
     *
     * A `review_required` row is not "not ready yet" — it is a row whose allergen determination
     * contradicts itself, and the whole point of the state is that no amount of clicking publish
     * gets past it (plan §4.7). The failure is a validation failure on `status`, so the editor
     * renders it beside the publish button rather than as a page-level error.
     */
    #requirePublishable(status: PublishableStatus, what: string): void {
        if (status !== 'review_required') return;
        throwFailure(
            validationFailure({
                status: [
                    `This ${what} is quarantined for review because its allergen information ` +
                        'contradicts a published recipe. Resolve the conflict before publishing it.',
                ],
            }),
        );
    }

    /* ── platform reference ────────────────────────────────────────────────────────────────── */

    allergenClasses(): readonly AllergenClass[] {
        return this.#allergenClasses;
    }

    serviceAreas(): readonly ServiceArea[] {
        return [...this.#serviceAreas.values()];
    }

    /* ── consumer reads ────────────────────────────────────────────────────────────────────── */

    /** Kitchens as the marketplace sees them. Their branches carry the current hours and zones. */
    kitchens(): readonly Kitchen[] {
        return this.#kitchens;
    }

    kitchenById(kitchenId: KitchenId): Kitchen | null {
        return this.#kitchens.find((kitchen) => kitchen.id === kitchenId) ?? null;
    }

    /** Published meals only — a draft or retired meal is invisible outside the kitchen. */
    consumerMeals(): readonly MarketplaceMeal[] {
        return [...this.#meals.values()]
            .filter((meal) => meal.meta.status === 'published')
            .map((meal) => meal.consumer);
    }

    consumerMealById(mealId: MealId): MarketplaceMeal | null {
        const stored = this.#meals.get(String(mealId));
        return stored === undefined || stored.meta.status !== 'published' ? null : stored.consumer;
    }

    consumerPlans(): readonly SubscriptionPlan[] {
        return [...this.#plans.values()]
            .filter((plan) => plan.meta.status === 'published')
            .map((plan) => plan.consumer);
    }

    consumerPlanById(planId: SubscriptionPlanId): SubscriptionPlan | null {
        const stored = this.#plans.get(String(planId));
        return stored === undefined || stored.meta.status !== 'published' ? null : stored.consumer;
    }

    consumerPlanVariantById(variantId: string): PlanVariant | null {
        for (const plan of this.consumerPlans()) {
            const variant = plan.variants.find((candidate) => candidate.id === variantId);
            if (variant !== undefined) return variant;
        }
        return null;
    }

    /** The weekdays a plan delivers on, from the stored record rather than a frozen map. */
    deliveryWeekdaysFor(planId: SubscriptionPlanId): readonly number[] {
        const stored = this.#plans.get(String(planId));
        return stored === undefined || stored.deliveryWeekdays.length === 0
            ? [1, 2, 3, 4, 5, 6, 7]
            : stored.deliveryWeekdays;
    }

    /** The ingredient library, for the food search. Published rows only. */
    consumerIngredients(): readonly PrototypeIngredient[] {
        return [...this.#ingredients.values()]
            .filter((ingredient) => ingredient.meta.status === 'published')
            .map((ingredient) => ingredient.consumer);
    }

    /** Published recipes, each at its newest *published* version. */
    consumerRecipes(): readonly Recipe[] {
        const recipes: Recipe[] = [];
        for (const stored of this.#recipes.values()) {
            if (stored.meta.status !== 'published') continue;
            const version = this.#newestPublishedVersion(stored);
            if (version !== null) recipes.push(version.consumer);
        }
        return recipes;
    }

    consumerRecipeById(recipeId: RecipeId): Recipe | null {
        const stored = this.#recipes.get(String(recipeId));
        if (stored === undefined || stored.meta.status !== 'published') return null;
        return this.#newestPublishedVersion(stored)?.consumer ?? null;
    }

    #newestPublishedVersion(recipe: StoredRecipe): StoredRecipeVersion | null {
        let newest: StoredRecipeVersion | null = null;
        for (const version of recipe.versions) {
            if (version.status !== 'published') continue;
            if (newest === null || version.versionNumber > newest.versionNumber) newest = version;
        }
        return newest;
    }

    /* ── ingredients ───────────────────────────────────────────────────────────────────────── */

    #ingredient(ingredientId: IngredientId): StoredIngredient {
        return (
            this.#ingredients.get(String(ingredientId)) ??
            notFound('ingredient', String(ingredientId))
        );
    }

    listIngredients(): readonly IngredientAdmin[] {
        return [...this.#ingredients.values()].map((row) => this.#ingredientAdmin(row));
    }

    getIngredient(ingredientId: IngredientId): IngredientAdmin {
        return this.#ingredientAdmin(this.#ingredient(ingredientId));
    }

    #ingredientAdmin(row: StoredIngredient): IngredientAdmin {
        return {
            id: row.id,
            meta: row.meta,
            name: row.name,
            reference: row.reference,
            categoryCode: row.categoryCode,
            measurementUnit: row.measurementUnit,
            costPer100g: row.costPer100g,
            per100g: row.consumer.per100g,
            allergens: row.allergens,
            dietClassifications: row.consumer.dietClassifications,
            aliases: row.aliases,
            organisationId: row.organisationId,
            notes: row.notes,
        };
    }

    createIngredient(request: CreateIngredientRequest): IngredientAdmin {
        this.#nextIngredientOrdinal += 1;
        const id = ingredientIdAt(this.#nextIngredientOrdinal);
        const currency = request.costPer100g?.currency ?? 'AED';

        const row: StoredIngredient = {
            id,
            // Created in `draft`: a new ingredient has no allergen determination yet, and a
            // catalogue that published one the moment it was typed would be the opposite of the
            // publication safety this phase exists to build.
            meta: {
                lockVersion: 1,
                status: 'draft',
                updatedAt: PROTOTYPE_NOW,
                updatedByName: PROTOTYPE_KITCHEN_MANAGER_NAME,
            },
            name: request.name,
            reference: request.reference ?? null,
            categoryCode: request.categoryCode,
            measurementUnit: request.measurementUnit,
            costPer100g: request.costPer100g ?? null,
            allergens: [],
            aliases: [...(request.aliases ?? [])],
            notes: request.notes ?? null,
            // A row a kitchen typed belongs to that kitchen, not to the shared library.
            organisationId: OrganisationId.unsafe(String(this.#kitchens[0]?.id ?? '')),
            consumer: {
                id,
                key: `runtime-${String(this.#nextIngredientOrdinal)}`,
                name: request.name.en,
                suitability: 'omnivore',
                aisle: request.categoryCode,
                // No facts have been entered, and none is invented. `foods` will not list it until
                // it is published, and a publish with no facts is a K1.8 readiness concern.
                per100g: this.#blankFacts(),
                allergens: [],
                dietClassifications: [...(request.dietClassifications ?? [])],
                servings: [],
                costPer100g: moneyFromCost(request.costPer100g?.amount ?? 0, currency),
            },
        };

        this.#ingredients.set(String(id), row);
        return this.#ingredientAdmin(row);
    }

    #blankFacts(): PrototypeIngredient['per100g'] {
        // Borrowed from an existing row so the shape (source, calculation, units) stays exactly the
        // one the nutrition package produces; every amount is then zeroed rather than invented.
        const [first] = this.#ingredients.values();
        const reference = first?.consumer.per100g;
        if (reference === undefined) {
            throwFailure(apiFailure('server', { message: 'The ingredient library is empty.' }));
        }
        return {
            ...reference,
            amounts: reference.amounts.map((amount) => ({ ...amount, value: 0 })),
        };
    }

    updateIngredient(
        ingredientId: IngredientId,
        request: UpdateIngredientRequest,
    ): IngredientAdmin {
        const row = this.#ingredient(ingredientId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'ingredient');

        if (request.name !== undefined) row.name = request.name;
        if (request.categoryCode !== undefined) row.categoryCode = request.categoryCode;
        if (request.measurementUnit !== undefined) row.measurementUnit = request.measurementUnit;
        if (request.reference !== undefined) row.reference = request.reference;
        if (request.costPer100g !== undefined) row.costPer100g = request.costPer100g;
        if (request.aliases !== undefined) row.aliases = [...request.aliases];
        if (request.notes !== undefined) row.notes = request.notes;

        row.consumer = {
            ...row.consumer,
            name: row.name.en,
            ...(request.dietClassifications === undefined
                ? {}
                : { dietClassifications: [...request.dietClassifications] }),
            ...(row.costPer100g === null
                ? {}
                : {
                      costPer100g: moneyFromCost(row.costPer100g.amount, row.costPer100g.currency),
                  }),
        };
        row.meta = this.#bump(row.meta);
        return this.#ingredientAdmin(row);
    }

    archiveIngredient(ingredientId: IngredientId, request: LockedRequest): IngredientAdmin {
        const row = this.#ingredient(ingredientId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'ingredient');
        row.meta = { ...this.#bump(row.meta), status: 'retired' };
        return this.#ingredientAdmin(row);
    }

    /**
     * The allergen mapping editor, and the one safety event this store models.
     *
     * Dropping an allergen that a **published** recipe currently derives from this ingredient is
     * exactly the contradiction the source data contains (a burghul row tagged "no allergens" by a
     * sheet whose own key says it contains gluten). It is treated as a quarantine, not a warning:
     * the ingredient and every published recipe that relied on it move to `review_required`, and
     * publication is refused from there until a person resolves it.
     */
    setIngredientAllergens(
        ingredientId: IngredientId,
        request: SetIngredientAllergensRequest,
    ): IngredientAdmin {
        const row = this.#ingredient(ingredientId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'ingredient');

        const next = new Set(request.mappings.map((mapping) => String(mapping.allergenCode)));
        const dropped = row.allergens
            .map((mapping) => mapping.allergenCode)
            .filter((code) => !next.has(String(code)));

        row.allergens = [...request.mappings];
        row.consumer = {
            ...row.consumer,
            allergens: request.mappings
                .filter((mapping) => mapping.containment === 'contains')
                .map((mapping) => mapping.allergenCode),
        };
        row.meta = this.#bump(row.meta);

        const conflicted = dropped.length === 0 ? [] : this.#quarantineFor(row.id, dropped);
        if (conflicted.length > 0) row.meta = { ...row.meta, status: 'review_required' };

        return this.#ingredientAdmin(row);
    }

    /** Every published recipe whose label would now contradict the ingredient. Quarantines them. */
    #quarantineFor(
        ingredientId: IngredientId,
        dropped: readonly AllergenCode[],
    ): readonly StoredRecipe[] {
        const affected: StoredRecipe[] = [];
        for (const recipe of this.#recipes.values()) {
            const version = this.#newestPublishedVersion(recipe);
            if (version === null) continue;
            const contradicts = version.allergens.some(
                (declaration) =>
                    dropped.includes(declaration.allergenCode) &&
                    declaration.sourceIngredientIds.includes(ingredientId),
            );
            if (!contradicts) continue;
            recipe.meta = { ...this.#bump(recipe.meta), status: 'review_required' };
            affected.push(recipe);
        }
        return affected;
    }

    /* ── recipes ───────────────────────────────────────────────────────────────────────────── */

    #recipe(recipeId: RecipeId): StoredRecipe {
        return this.#recipes.get(String(recipeId)) ?? notFound('recipe', String(recipeId));
    }

    #version(recipe: StoredRecipe): StoredRecipeVersion {
        const current = recipe.versions.find((version) => version.id === recipe.currentVersionId);
        if (current === undefined) {
            throwFailure(
                apiFailure('server', {
                    message: `Recipe ${String(recipe.id)} has no current version.`,
                }),
            );
        }
        return current;
    }

    /**
     * The version an edit lands on.
     *
     * A published version is immutable (plan §4.7), so editing one opens a draft copy and makes it
     * current. Consumers keep reading the published version until the draft is published in turn,
     * which is the whole reason the two are separate rows.
     */
    #editableVersion(recipe: StoredRecipe): StoredRecipeVersion {
        const current = this.#version(recipe);
        if (current.status === 'draft' || current.status === 'review_required') return current;

        this.#nextRecipeVersionOrdinal += 1;
        const draft: StoredRecipeVersion = {
            ...current,
            id: recipeVersionIdAt(this.#nextRecipeVersionOrdinal),
            versionNumber: current.versionNumber + 1,
            status: 'draft',
            publishedAt: null,
            lines: [...current.lines],
            outputs: [...current.outputs],
            steps: [...current.steps],
            allergens: [...current.allergens],
        };
        recipe.versions = [...recipe.versions, draft];
        recipe.currentVersionId = draft.id;
        return draft;
    }

    listRecipes(): readonly RecipeAdminSummary[] {
        return [...this.#recipes.values()].map((recipe) => this.#recipeSummary(recipe));
    }

    /**
     * Whether a recipe's current version needs re-deriving.
     *
     * Exposed so `RecipeAdminFilter.staleOnly` can be honoured by the repository: `derivationStale`
     * lives on the *version* and `RecipeAdminSummary` carries no version detail, so a filter written
     * over the summary alone had nothing to read and silently matched everything.
     */
    isRecipeDerivationStale(recipeId: RecipeId): boolean {
        return this.#version(this.#recipe(recipeId)).derivationStale;
    }

    getRecipe(recipeId: RecipeId): RecipeAdmin {
        return this.#recipeAdmin(this.#recipe(recipeId));
    }

    #recipeSummary(recipe: StoredRecipe): RecipeAdminSummary {
        return {
            id: recipe.id,
            meta: recipe.meta,
            name: recipe.name,
            slug: recipe.slug,
            kitchenId: recipe.kitchenId as KitchenId,
            currentVersionNumber: this.#version(recipe).versionNumber,
            versionCount: recipe.versions.length,
        };
    }

    #recipeAdmin(recipe: StoredRecipe): RecipeAdmin {
        const current = this.#version(recipe);
        return {
            ...this.#recipeSummary(recipe),
            description: recipe.description,
            currentVersion: {
                id: current.id,
                recipeId: recipe.id,
                versionNumber: current.versionNumber,
                status: current.status,
                yieldQuantity: current.yieldQuantity,
                yieldUnit: current.yieldUnit,
                yieldPieces: current.yieldPieces,
                wastePercent: current.wastePercent,
                lines: current.lines,
                outputs: current.outputs,
                steps: current.steps,
                allergens: current.allergens,
                estimatedCost: current.estimatedCost,
                derivationStale: current.derivationStale,
                publishedAt: current.publishedAt,
            },
            versions: [...recipe.versions]
                .sort((left, right) => right.versionNumber - left.versionNumber)
                .map((version) => ({
                    id: version.id,
                    versionNumber: version.versionNumber,
                    status: version.status,
                    publishedAt: version.publishedAt,
                    updatedAt: recipe.meta.updatedAt,
                    isCurrent: version.id === recipe.currentVersionId,
                })),
        };
    }

    createRecipe(request: CreateRecipeRequest): RecipeAdmin {
        this.#nextRecipeOrdinal += 1;
        this.#nextRecipeVersionOrdinal += 1;
        const id = recipeIdAt(this.#nextRecipeOrdinal);
        const versionId = recipeVersionIdAt(this.#nextRecipeVersionOrdinal);
        const slug = request.name.en.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        const version: StoredRecipeVersion = {
            id: versionId,
            versionNumber: 1,
            status: 'draft',
            yieldQuantity: request.yieldQuantity,
            yieldUnit: request.yieldUnit,
            yieldPieces: request.yieldPieces ?? null,
            wastePercent: request.wastePercent ?? 0,
            lines: [],
            outputs: [],
            steps: [],
            allergens: [],
            estimatedCost: null,
            derivationStale: false,
            publishedAt: null,
            consumer: this.#blankRecipe(id, slug, request),
        };

        const recipe: StoredRecipe = {
            id,
            meta: {
                lockVersion: 1,
                status: 'draft',
                updatedAt: PROTOTYPE_NOW,
                updatedByName: PROTOTYPE_KITCHEN_MANAGER_NAME,
            },
            name: request.name,
            slug,
            description: request.description,
            // A recipe a kitchen typed belongs to that kitchen, exactly as `createProduct` and
            // `createMeal` already do. `RecipeAdminSummary.kitchenId` is non-nullable by contract,
            // so leaving it `null` here produced a summary row whose kitchen was a type lie — and
            // a recipe no kitchen filter could ever match.
            kitchenId: this.#kitchens[0]?.id ?? null,
            versions: [version],
            currentVersionId: versionId,
        };
        this.#recipes.set(String(id), recipe);
        return this.#recipeAdmin(recipe);
    }

    /** A consumer projection for a recipe with no lines yet: real shape, zeroed figures. */
    #blankRecipe(id: RecipeId, slug: string, request: CreateRecipeRequest): Recipe {
        const [reference] = this.#recipes.values();
        const template = reference === undefined ? null : this.#version(reference).consumer;
        if (template === null) {
            throwFailure(apiFailure('server', { message: 'The recipe library is empty.' }));
        }
        return {
            ...template,
            id,
            version: '1',
            name: request.name.en,
            slug,
            description: request.description.en,
            servings: request.yieldQuantity,
            ingredients: [],
            steps: [],
            allergens: [],
            estimatedCost: null,
            kitchenId: null,
            updatedAt: PROTOTYPE_NOW,
        };
    }

    updateRecipe(recipeId: RecipeId, request: UpdateRecipeRequest): RecipeAdmin {
        const recipe = this.#recipe(recipeId);
        this.#assertVersion(recipe.meta.lockVersion, request.lockVersion, 'recipe');
        const version = this.#editableVersion(recipe);

        if (request.name !== undefined) recipe.name = request.name;
        if (request.description !== undefined) recipe.description = request.description;
        if (request.yieldQuantity !== undefined) version.yieldQuantity = request.yieldQuantity;
        if (request.yieldUnit !== undefined) version.yieldUnit = request.yieldUnit;
        if (request.yieldPieces !== undefined) version.yieldPieces = request.yieldPieces;
        if (request.wastePercent !== undefined) version.wastePercent = request.wastePercent;

        version.consumer = {
            ...version.consumer,
            name: recipe.name.en,
            description: recipe.description.en,
            servings: version.yieldQuantity,
            version: String(version.versionNumber),
        };
        recipe.meta = this.#bump(recipe.meta);
        return this.#recipeAdmin(recipe);
    }

    setRecipeLines(recipeId: RecipeId, request: SetRecipeLinesRequest): RecipeAdmin {
        const recipe = this.#recipe(recipeId);
        this.#assertVersion(recipe.meta.lockVersion, request.lockVersion, 'recipe');
        const version = this.#editableVersion(recipe);

        version.lines = request.lines.map((line) => {
            const ingredient = this.#ingredient(line.ingredientId);
            const grams = gramsFor(ingredient.consumer, line.quantity, line.unit);
            return {
                ingredientId: line.ingredientId,
                ingredientName: ingredient.name,
                quantity: line.quantity,
                unit: line.unit,
                sourceDesignation: line.sourceDesignation ?? null,
                isOptional: line.isOptional ?? false,
                lineCost:
                    ingredient.costPer100g === null || grams === null
                        ? null
                        : costAmount(
                              (ingredient.costPer100g.amount * grams) / 100,
                              ingredient.costPer100g.currency,
                          ),
            };
        });

        version.allergens = this.#deriveDeclarations(
            version.lines.map((line) => line.ingredientId),
        );
        version.estimatedCost = this.#costOf(version);
        version.derivationStale = false;
        recipe.meta = this.#bump(recipe.meta);
        return this.#recipeAdmin(recipe);
    }

    /** Waste is a cost, not a nutrient: a kitchen buys more than it serves (source sheets, +3 %). */
    #costOf(version: StoredRecipeVersion): ReturnType<typeof sumCostAmounts> {
        const lines = sumCostAmounts(version.lines.map((line) => line.lineCost));
        if (lines === null) return null;
        return costAmount(
            roundCost(lines.amount * (1 + version.wastePercent / 100)),
            lines.currency,
        );
    }

    #deriveDeclarations(ingredientIds: readonly IngredientId[]) {
        const sources = new Map<AllergenCode, IngredientId[]>();
        for (const ingredientId of ingredientIds) {
            const ingredient = this.#ingredients.get(String(ingredientId));
            if (ingredient === undefined) continue;
            for (const mapping of ingredient.allergens) {
                const existing = sources.get(mapping.allergenCode) ?? [];
                if (!existing.includes(ingredientId)) existing.push(ingredientId);
                sources.set(mapping.allergenCode, existing);
            }
        }

        return unionAllergens([[...sources.keys()]]).map((code) => ({
            allergenCode: code,
            containment: 'contains' as const,
            origin: 'derived' as const,
            sourceIngredientIds: sources.get(code) ?? [],
        }));
    }

    setRecipeSteps(recipeId: RecipeId, request: SetRecipeStepsRequest): RecipeAdmin {
        const recipe = this.#recipe(recipeId);
        this.#assertVersion(recipe.meta.lockVersion, request.lockVersion, 'recipe');
        const version = this.#editableVersion(recipe);

        version.steps = request.steps.map((step, index) => ({
            index: index + 1,
            instruction: step.instruction,
            minutes: step.minutes ?? null,
        }));
        version.consumer = {
            ...version.consumer,
            steps: version.steps.map((step) => ({
                index: step.index,
                instruction: step.instruction.en,
                minutes: step.minutes,
            })),
        };
        recipe.meta = this.#bump(recipe.meta);
        return this.#recipeAdmin(recipe);
    }

    setRecipeOutputs(recipeId: RecipeId, request: SetRecipeOutputsRequest): RecipeAdmin {
        const recipe = this.#recipe(recipeId);
        this.#assertVersion(recipe.meta.lockVersion, request.lockVersion, 'recipe');

        const primaries = request.outputs.filter((output) => output.isPrimary === true);
        if (primaries.length > 1) {
            throwFailure(
                validationFailure({
                    outputs: ['Only one output of a version can be the primary one.'],
                }),
            );
        }

        const version = this.#editableVersion(recipe);
        version.outputs = request.outputs.map((output) => ({
            ingredientId: output.ingredientId,
            ingredientName: this.#ingredient(output.ingredientId).name,
            quantity: output.quantity,
            unit: output.unit,
            isPrimary: output.isPrimary ?? false,
        }));
        recipe.meta = this.#bump(recipe.meta);
        return this.#recipeAdmin(recipe);
    }

    publishRecipe(recipeId: RecipeId, request: LockedRequest): RecipeAdmin {
        const recipe = this.#recipe(recipeId);
        this.#assertVersion(recipe.meta.lockVersion, request.lockVersion, 'recipe');
        this.#requirePublishable(recipe.meta.status, 'recipe');

        const version = this.#version(recipe);
        if (version.lines.length === 0) {
            throwFailure(
                validationFailure({
                    lines: ['A recipe needs at least one line before it can be published.'],
                }),
            );
        }

        version.status = 'published';
        version.publishedAt = PROTOTYPE_NOW;
        recipe.meta = { ...this.#bump(recipe.meta), status: 'published' };
        return this.#recipeAdmin(recipe);
    }

    retireRecipe(recipeId: RecipeId, request: LockedRequest): RecipeAdmin {
        const recipe = this.#recipe(recipeId);
        this.#assertVersion(recipe.meta.lockVersion, request.lockVersion, 'recipe');
        recipe.meta = { ...this.#bump(recipe.meta), status: 'retired' };
        return this.#recipeAdmin(recipe);
    }

    /**
     * The roll-up preview — the real arithmetic, not an approximation of it.
     *
     * `recipeNutritionFromIngredients` and `unionAllergens` are the same functions the fixture
     * recipes were built with, so a draft that happens to match a seeded recipe produces the seeded
     * recipe's figures. A line the store cannot convert to grams, or one whose ingredient carries no
     * reference facts, is **excluded and reported** rather than counted as zero.
     */
    previewRecipeRollup(draft: RecipeRollupDraft): RecipeRollupPreview {
        if (!Number.isFinite(draft.servings) || draft.servings <= 0) {
            throwFailure(
                validationFailure({ servings: ['A recipe must yield at least one serving.'] }),
            );
        }

        const warnings: RollupWarning[] = [];
        const usable: RecipeLineInput[] = [];
        const costs: (ReturnType<typeof costAmount> | null)[] = [];
        const sources = new Map<string, IngredientId[]>();

        for (const line of draft.lines) {
            const ingredient = this.#ingredients.get(String(line.ingredientId));
            if (ingredient === undefined) {
                warnings.push({
                    code: 'rollup.unknown_ingredient',
                    message: 'This line points at an ingredient that is not in the library.',
                    ingredientIds: [line.ingredientId],
                });
                continue;
            }

            for (const mapping of ingredient.allergens) {
                const key = `${String(mapping.allergenCode)}|${mapping.containment}`;
                const existing = sources.get(key) ?? [];
                if (!existing.includes(line.ingredientId)) existing.push(line.ingredientId);
                sources.set(key, existing);
            }

            const grams = gramsFor(ingredient.consumer, line.quantity, line.unit);
            if (grams === null) {
                warnings.push({
                    code: 'rollup.unconvertible_unit',
                    message: `${ingredient.name.en} is measured in ${line.unit}, which cannot be converted to a mass here.`,
                    ingredientIds: [line.ingredientId],
                });
                continue;
            }

            costs.push(
                ingredient.costPer100g === null
                    ? null
                    : costAmount(
                          (ingredient.costPer100g.amount * grams) / 100,
                          ingredient.costPer100g.currency,
                      ),
            );
            usable.push(line);
        }

        if (usable.length === 0) {
            throwFailure(
                validationFailure({
                    lines: [
                        'None of these lines can be rolled up yet: add a line whose quantity can ' +
                            'be expressed as a mass.',
                    ],
                }),
            );
        }

        const quantities = quantitiesFrom(
            usable.map((line) => ({
                ingredientId: line.ingredientId,
                ingredientName: untranslated(''),
                quantity: line.quantity,
                unit: line.unit,
                sourceDesignation: null,
                isOptional: line.isOptional ?? false,
                lineCost: null,
            })),
            (id) => this.#ingredients.get(String(id))?.consumer ?? null,
        );

        const rollup = recipeNutritionFromIngredients({
            recipeId: draft.recipeId ?? DRAFT_RECIPE_ID,
            recipeVersion: 'draft',
            servings: draft.servings,
            serving: draft.serving ?? DRAFT_SERVING,
            ingredients: quantities,
            derivation: {
                notes: ['Preview of an unsaved draft; nothing was stored.'],
            },
        });

        const wastePercent = draft.wastePercent ?? 0;
        const lineTotal = sumCostAmounts(costs);
        const estimatedCost =
            lineTotal === null
                ? null
                : costAmount(lineTotal.amount * (1 + wastePercent / 100), lineTotal.currency);
        if (lineTotal === null && costs.length > 0) {
            warnings.push({
                code: 'rollup.missing_cost',
                message: 'At least one ingredient has no recorded cost, so no total is shown.',
                ingredientIds: [],
            });
        }

        return {
            perRecipe: rollup.perRecipe,
            perServing: rollup.perServing,
            per100g: rollup.per100g,
            allergenSources: this.#allergenSources(sources),
            estimatedCost,
            warnings,
        };
    }

    /** Groups the collected mappings into one entry per code, in the canonical code order. */
    #allergenSources(sources: ReadonlyMap<string, readonly IngredientId[]>): AllergenSource[] {
        const codes = unionAllergens([
            [...sources.keys()].map((key) => key.split('|')[0] as AllergenCode),
        ]);

        const entries: AllergenSource[] = [];
        for (const code of codes) {
            for (const containment of ['contains', 'may_contain'] as const) {
                const ingredientIds = sources.get(`${String(code)}|${containment}`);
                if (ingredientIds === undefined || ingredientIds.length === 0) continue;
                entries.push({ allergenCode: code, containment, ingredientIds });
            }
        }
        return entries;
    }

    /* ── products ──────────────────────────────────────────────────────────────────────────── */

    #product(productId: ProductId): StoredProduct {
        return this.#products.get(String(productId)) ?? notFound('product', String(productId));
    }

    listProducts(): readonly ProductAdmin[] {
        return [...this.#products.values()].map((row) => this.#productAdmin(row));
    }

    getProduct(productId: ProductId): ProductAdmin {
        return this.#productAdmin(this.#product(productId));
    }

    #productAdmin(row: StoredProduct): ProductAdmin {
        const recipe = row.recipeId === null ? null : this.#recipes.get(String(row.recipeId));
        const version = recipe === undefined || recipe === null ? null : this.#version(recipe);
        return {
            id: row.id,
            meta: row.meta,
            name: row.name,
            description: row.description,
            categoryCode: row.categoryCode,
            kitchenId: row.kitchenId,
            isMarketPriced: row.isMarketPriced,
            isAssorted: row.isAssorted,
            packVariants: row.packVariants,
            channelAvailability: row.channelAvailability,
            recipeId: row.recipeId,
            dietClassifications: version?.consumer.dietClassifications ?? [],
            dataQualityFlags: row.dataQualityFlags,
        };
    }

    createProduct(request: CreateProductRequest): ProductAdmin {
        this.#nextProductOrdinal += 1;
        const id = productIdAt(this.#nextProductOrdinal);
        const kitchenId = this.#kitchens[0]?.id;
        if (kitchenId === undefined) {
            throwFailure(apiFailure('server', { message: 'This world has no kitchens.' }));
        }

        const row: StoredProduct = {
            id,
            meta: {
                lockVersion: 1,
                status: 'draft',
                updatedAt: PROTOTYPE_NOW,
                updatedByName: PROTOTYPE_KITCHEN_MANAGER_NAME,
            },
            name: request.name,
            description: request.description,
            categoryCode: request.categoryCode,
            kitchenId,
            isMarketPriced: request.isMarketPriced ?? false,
            isAssorted: request.isAssorted ?? false,
            packVariants: [...(request.packVariants ?? [])],
            channelAvailability: [],
            recipeId: request.recipeId ?? null,
            dataQualityFlags: [],
        };
        this.#products.set(String(id), row);
        return this.#productAdmin(row);
    }

    updateProduct(productId: ProductId, request: UpdateProductRequest): ProductAdmin {
        const row = this.#product(productId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'product');

        if (request.name !== undefined) row.name = request.name;
        if (request.description !== undefined) row.description = request.description;
        if (request.categoryCode !== undefined) row.categoryCode = request.categoryCode;
        if (request.recipeId !== undefined) row.recipeId = request.recipeId;
        if (request.isMarketPriced !== undefined) row.isMarketPriced = request.isMarketPriced;
        if (request.isAssorted !== undefined) row.isAssorted = request.isAssorted;
        if (request.packVariants !== undefined) row.packVariants = [...request.packVariants];

        row.meta = this.#bump(row.meta);
        return this.#productAdmin(row);
    }

    archiveProduct(productId: ProductId, request: LockedRequest): ProductAdmin {
        const row = this.#product(productId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'product');
        row.meta = { ...this.#bump(row.meta), status: 'retired' };
        return this.#productAdmin(row);
    }

    setProductChannelAvailability(
        productId: ProductId,
        request: SetChannelAvailabilityRequest,
    ): ProductAdmin {
        const row = this.#product(productId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'product');
        row.channelAvailability = [...request.availability];
        row.meta = this.#bump(row.meta);
        return this.#productAdmin(row);
    }

    /* ── price lists ───────────────────────────────────────────────────────────────────────── */

    #priceList(priceListId: PriceListId): StoredPriceList {
        return (
            this.#priceLists.get(String(priceListId)) ?? notFound('price list', String(priceListId))
        );
    }

    listPriceLists(): readonly PriceListAdmin[] {
        return [...this.#priceLists.values()].map((row) => this.#priceListAdmin(row));
    }

    getPriceList(priceListId: PriceListId): PriceListAdmin {
        return this.#priceListAdmin(this.#priceList(priceListId));
    }

    #priceListAdmin(row: StoredPriceList): PriceListAdmin {
        return {
            id: row.id,
            meta: row.meta,
            name: row.name,
            currency: row.currency,
            kitchenId: row.kitchenId,
            channels: row.channels,
            entries: row.entries,
        };
    }

    setPriceListEntries(
        priceListId: PriceListId,
        request: SetPriceListEntriesRequest,
    ): PriceListAdmin {
        const row = this.#priceList(priceListId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'price list');

        const inconsistent = request.entries.filter((entry) => !isPriceEntryConsistent(entry));
        if (inconsistent.length > 0) {
            throwFailure(
                validationFailure({
                    entries: [
                        'A confirmed price needs an amount, and a placeholder or market-priced ' +
                            'entry must not carry one.',
                    ],
                }),
            );
        }

        row.entries = [...request.entries];
        row.meta = this.#bump(row.meta);
        return this.#priceListAdmin(row);
    }

    publishPriceList(priceListId: PriceListId, request: LockedRequest): PriceListAdmin {
        const row = this.#priceList(priceListId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'price list');
        this.#requirePublishable(row.meta.status, 'price list');

        const inconsistent = row.entries.filter((entry) => !isPriceEntryConsistent(entry));
        if (inconsistent.length > 0) {
            throwFailure(
                validationFailure({
                    entries: [
                        `${String(inconsistent.length)} entries disagree with their price status ` +
                            'and would publish a price nobody confirmed.',
                    ],
                }),
            );
        }

        row.meta = { ...this.#bump(row.meta), status: 'published' };
        return this.#priceListAdmin(row);
    }

    /* ── meals ─────────────────────────────────────────────────────────────────────────────── */

    #meal(mealId: MealId): StoredMeal {
        return this.#meals.get(String(mealId)) ?? notFound('meal', String(mealId));
    }

    listMeals(): readonly MealAdmin[] {
        return [...this.#meals.values()].map((row) => this.#mealAdmin(row));
    }

    getMeal(mealId: MealId): MealAdmin {
        return this.#mealAdmin(this.#meal(mealId));
    }

    #mealAdmin(row: StoredMeal): MealAdmin {
        return {
            id: row.id,
            meta: row.meta,
            name: row.name,
            description: row.description,
            kitchenId: row.kitchenId,
            recipeId: row.recipeId,
            recipeVersionId: row.recipeVersionId,
            portionFactor: row.portionFactor,
            mealTypes: row.consumer.mealTypes,
            dietClassifications: row.consumer.dietClassifications,
            allergens: row.consumer.allergens,
            channelAvailability: row.channelAvailability,
            availability: row.availability,
            imagePlaceholderId: row.consumer.imagePlaceholderId,
            marginPercent: row.marginPercent,
        };
    }

    createMeal(request: CreateMealRequest): MealAdmin {
        this.#nextMealOrdinal += 1;
        const id = mealIdAt(this.#nextMealOrdinal);
        const template = [...this.#meals.values()][0];
        if (template === undefined) {
            throwFailure(apiFailure('server', { message: 'This world has no meals to model.' }));
        }

        /*
         * A new meal's allergen label is its *own* — derived from the recipe it is built from, or
         * empty when it is built from none. The template is a shape to copy, and copying another
         * dish's declaration onto a new one would publish a food-safety claim nobody made about it.
         * `recipeVersionId` is recorded for the same reason: it is the provenance the admin editor
         * renders beside the label, and a permanent `null` would make that line always say "nothing
         * has been derived" while the codes beside it said otherwise.
         *
         * The rest of the projection — nutrition, price, serving, image, channels — is still the
         * template's, and is honest only in the weak sense that this is a synthetic demo world.
         * Those fields are non-nullable on `MarketplaceMeal`, so making them the new meal's own
         * needs the derivation the fixture builder does at seed time, not a patch here.
         */
        const linkedRecipe =
            request.recipeId === undefined
                ? null
                : (this.#recipes.get(String(request.recipeId)) ?? null);
        const linkedVersion = linkedRecipe === null ? null : this.#version(linkedRecipe);

        const row: StoredMeal = {
            id,
            meta: {
                lockVersion: 1,
                status: 'draft',
                updatedAt: PROTOTYPE_NOW,
                updatedByName: PROTOTYPE_KITCHEN_MANAGER_NAME,
            },
            name: request.name,
            description: request.description,
            kitchenId: template.kitchenId,
            recipeId: request.recipeId ?? null,
            recipeVersionId: linkedVersion?.id ?? null,
            portionFactor: request.portionFactor ?? 1,
            channelAvailability: [],
            availability: [],
            marginPercent: null,
            consumer: {
                ...template.consumer,
                id,
                name: request.name.en,
                slug: request.name.en.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                description: request.description.en,
                mealTypes: request.mealTypes ?? template.consumer.mealTypes,
                dietClassifications:
                    request.dietClassifications ?? template.consumer.dietClassifications,
                allergens:
                    linkedVersion === null
                        ? []
                        : [
                              ...new Set(
                                  linkedVersion.allergens.map(
                                      (declaration) => declaration.allergenCode,
                                  ),
                              ),
                          ],
                availability: [],
                rating: null,
                ratingCount: 0,
            },
        };
        this.#meals.set(String(id), row);
        return this.#mealAdmin(row);
    }

    updateMeal(mealId: MealId, request: UpdateMealRequest): MealAdmin {
        const row = this.#meal(mealId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'meal');

        if (request.name !== undefined) row.name = request.name;
        if (request.description !== undefined) row.description = request.description;
        if (request.recipeId !== undefined) row.recipeId = request.recipeId;
        if (request.portionFactor !== undefined) row.portionFactor = request.portionFactor;

        row.consumer = {
            ...row.consumer,
            name: row.name.en,
            description: row.description.en,
            ...(request.mealTypes === undefined ? {} : { mealTypes: request.mealTypes }),
            ...(request.dietClassifications === undefined
                ? {}
                : { dietClassifications: request.dietClassifications }),
        };

        // A portion change is a nutrition change: the meal's facts are its recipe's per-serving
        // facts scaled by the portion the kitchen sells, exactly as the fixture builder derived
        // them. Leaving the old figures on screen would be the worst possible kind of stale.
        if (request.portionFactor !== undefined && row.recipeId !== null) {
            const recipe = this.#recipes.get(String(row.recipeId));
            const version = recipe === undefined ? null : this.#newestPublishedVersion(recipe);
            if (version !== null) {
                row.consumer = {
                    ...row.consumer,
                    nutrition: scaleFacts(
                        version.consumer.nutrition.perServing,
                        row.portionFactor,
                        {
                            basis: 'per_serving',
                            serving: row.consumer.serving,
                            method: 'catalogue.meal_portion_changed',
                        },
                    ),
                };
            }
        }

        row.meta = this.#bump(row.meta);
        return this.#mealAdmin(row);
    }

    publishMeal(mealId: MealId, request: LockedRequest): MealAdmin {
        const row = this.#meal(mealId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'meal');
        this.#requirePublishable(row.meta.status, 'meal');
        row.meta = { ...this.#bump(row.meta), status: 'published' };
        return this.#mealAdmin(row);
    }

    retireMeal(mealId: MealId, request: LockedRequest): MealAdmin {
        const row = this.#meal(mealId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'meal');
        row.meta = { ...this.#bump(row.meta), status: 'retired' };
        return this.#mealAdmin(row);
    }

    setMealAvailability(mealId: MealId, request: SetMealAvailabilityRequest): MealAdmin {
        const row = this.#meal(mealId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'meal');
        row.availability = [...request.days];
        row.consumer = { ...row.consumer, availability: projectAvailability(row.availability) };
        row.meta = this.#bump(row.meta);
        return this.#mealAdmin(row);
    }

    /* ── plans ─────────────────────────────────────────────────────────────────────────────── */

    #plan(planId: SubscriptionPlanId): StoredPlan {
        return this.#plans.get(String(planId)) ?? notFound('plan', String(planId));
    }

    listPlans(): readonly PlanAdmin[] {
        return [...this.#plans.values()].map((row) => this.#planAdmin(row));
    }

    getPlan(planId: SubscriptionPlanId): PlanAdmin {
        return this.#planAdmin(this.#plan(planId));
    }

    #planAdmin(row: StoredPlan): PlanAdmin {
        return {
            id: row.id,
            meta: row.meta,
            name: row.name,
            summary: row.summary,
            description: row.description,
            kitchenId: row.kitchenId,
            categorySlugs: row.consumer.categorySlugs,
            dietClassifications: row.consumer.dietClassifications,
            variants: row.variants,
            durations: row.durations,
            combinations: row.combinations,
            changeCutOffHours: row.changeCutOffHours,
            deliveryWeekdays: row.deliveryWeekdays,
        };
    }

    createPlan(request: CreatePlanRequest): PlanAdmin {
        this.#nextPlanOrdinal += 1;
        const id = subscriptionPlanIdAt(this.#nextPlanOrdinal);
        const template = [...this.#plans.values()][0];
        if (template === undefined) {
            throwFailure(apiFailure('server', { message: 'This world has no plans to model.' }));
        }

        const row: StoredPlan = {
            id,
            meta: {
                lockVersion: 1,
                status: 'draft',
                updatedAt: PROTOTYPE_NOW,
                updatedByName: PROTOTYPE_KITCHEN_MANAGER_NAME,
            },
            name: request.name,
            summary: request.summary,
            description: request.description,
            kitchenId: template.kitchenId,
            variants: [],
            durations: [],
            combinations: [],
            changeCutOffHours: request.changeCutOffHours ?? 24,
            deliveryWeekdays: [...(request.deliveryWeekdays ?? [1, 2, 3, 4, 5])],
            consumer: {
                ...template.consumer,
                id,
                name: request.name.en,
                slug: request.name.en.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                summary: request.summary.en,
                description: request.description.en,
                categorySlugs: [...(request.categorySlugs ?? [])],
                dietClassifications: [...(request.dietClassifications ?? [])],
                variants: [],
                durations: [],
                sampleMealIds: [],
                rating: null,
                ratingCount: 0,
            },
        };
        this.#plans.set(String(id), row);
        return this.#planAdmin(row);
    }

    updatePlan(planId: SubscriptionPlanId, request: UpdatePlanRequest): PlanAdmin {
        const row = this.#plan(planId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'plan');

        if (request.name !== undefined) row.name = request.name;
        if (request.summary !== undefined) row.summary = request.summary;
        if (request.description !== undefined) row.description = request.description;
        if (request.changeCutOffHours !== undefined) {
            row.changeCutOffHours = request.changeCutOffHours;
        }
        if (request.deliveryWeekdays !== undefined) {
            row.deliveryWeekdays = [...request.deliveryWeekdays];
        }

        row.consumer = {
            ...row.consumer,
            name: row.name.en,
            summary: row.summary.en,
            description: row.description.en,
            ...(request.categorySlugs === undefined
                ? {}
                : { categorySlugs: [...request.categorySlugs] }),
            ...(request.dietClassifications === undefined
                ? {}
                : { dietClassifications: [...request.dietClassifications] }),
        };
        row.meta = this.#bump(row.meta);
        return this.#planAdmin(row);
    }

    publishPlan(planId: SubscriptionPlanId, request: LockedRequest): PlanAdmin {
        const row = this.#plan(planId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'plan');
        this.#requirePublishable(row.meta.status, 'plan');

        // Plan §3 #15: a plan whose prices are placeholders must not reach a public surface. The
        // imported GreenLife plans have no numbers at all, and this is the gate that keeps them off
        // the marketplace until somebody supplies real ones.
        if (!this.#hasConfirmedPrice(planId)) {
            throwFailure(
                validationFailure({
                    price: [
                        'No confirmed price exists for this plan, so publishing it would advertise ' +
                            'a placeholder. Confirm a price first.',
                    ],
                }),
            );
        }

        row.meta = { ...this.#bump(row.meta), status: 'published' };
        return this.#planAdmin(row);
    }

    #hasConfirmedPrice(planId: SubscriptionPlanId): boolean {
        for (const list of this.#priceLists.values()) {
            for (const entry of list.entries) {
                if (entry.item.kind !== 'plan') continue;
                if (entry.item.planId !== planId) continue;
                if (entry.priceStatus === 'confirmed' && entry.amountMinor !== null) return true;
            }
        }
        return false;
    }

    retirePlan(planId: SubscriptionPlanId, request: LockedRequest): PlanAdmin {
        const row = this.#plan(planId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'plan');
        row.meta = { ...this.#bump(row.meta), status: 'retired' };
        return this.#planAdmin(row);
    }

    setPlanVariants(planId: SubscriptionPlanId, request: SetPlanVariantsRequest): PlanAdmin {
        const row = this.#plan(planId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'plan');

        const existing = new Map(row.consumer.variants.map((variant) => [variant.id, variant]));
        const variants: PlanVariantAdmin[] = [];
        const consumerVariants: PlanVariant[] = [];

        for (const input of request.variants) {
            const id = input.id ?? this.#mintVariantId();
            variants.push({
                id,
                name: input.name,
                energyBand: input.energyBand,
                mealsPerDay: input.mealsPerDay,
                snacksPerDay: input.snacksPerDay,
                isActive: input.isActive ?? true,
            });

            const previous = existing.get(id);
            if (previous !== undefined) {
                consumerVariants.push({
                    ...previous,
                    name: input.name.en,
                    energyRange: input.energyBand,
                    mealsPerDay: input.mealsPerDay,
                    snacksPerDay: input.snacksPerDay,
                });
            }
        }

        row.variants = variants;
        row.consumer = { ...row.consumer, variants: consumerVariants };
        row.meta = this.#bump(row.meta);
        return this.#planAdmin(row);
    }

    /**
     * A variant identifier for a variant a person just added.
     *
     * Plan variants share one band across every plan (the seed fills it densely, three per plan), so
     * a new one takes the next ordinal above the highest already in use, starting at the runtime
     * boundary. Deterministic, and it cannot collide with a seeded variant.
     */
    #mintVariantId(): PlanVariantAdmin['id'] {
        let highest = PROTOTYPE_RUNTIME_ORDINAL_START - 1;
        for (const plan of this.#plans.values()) {
            for (const variant of plan.variants) {
                const ordinal = Number.parseInt(String(variant.id).slice(-2), 16);
                if (Number.isFinite(ordinal) && ordinal > highest) highest = ordinal;
            }
        }
        return planVariantIdAt(highest + 1);
    }

    setPlanDurations(planId: SubscriptionPlanId, request: SetPlanDurationsRequest): PlanAdmin {
        const row = this.#plan(planId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'plan');

        const invalid = request.durations.filter((duration) => !isPlanDurationConsistent(duration));
        if (invalid.length > 0) {
            throwFailure(
                validationFailure({
                    durations: [
                        'A one-off duration carries no day count, and a fixed-days duration needs ' +
                            'a positive one.',
                    ],
                }),
            );
        }

        row.durations = [...request.durations];
        row.meta = this.#bump(row.meta);
        return this.#planAdmin(row);
    }

    setPlanCombinations(
        planId: SubscriptionPlanId,
        request: SetPlanCombinationsRequest,
    ): PlanAdmin {
        const row = this.#plan(planId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'plan');
        row.combinations = [...request.combinations];
        row.meta = this.#bump(row.meta);
        return this.#planAdmin(row);
    }

    /* ── zones, windows and branch operating data ──────────────────────────────────────────── */

    #zone(zoneId: DeliveryZoneId): StoredZone {
        return this.#zones.get(String(zoneId)) ?? notFound('delivery zone', String(zoneId));
    }

    listZones(): readonly DeliveryZoneAdmin[] {
        return [...this.#zones.values()].map((row) => this.#zoneAdmin(row));
    }

    getZone(zoneId: DeliveryZoneId): DeliveryZoneAdmin {
        return this.#zoneAdmin(this.#zone(zoneId));
    }

    #zoneAdmin(row: StoredZone): DeliveryZoneAdmin {
        return {
            id: row.id,
            meta: row.meta,
            name: row.name,
            kitchenId: row.kitchenId,
            branchIds: row.branchIds,
            areas: row.areaIds
                .map((areaId) => this.#serviceAreas.get(areaId))
                .filter((area): area is ServiceArea => area !== undefined),
            deliveryFeeMinor: row.deliveryFeeMinor,
            minimumOrderMinor: row.minimumOrderMinor,
            currency: row.currency,
            estimatedMinutes: row.estimatedMinutes,
            deliveryWindows: row.deliveryWindows,
        };
    }

    createZone(request: CreateDeliveryZoneRequest): DeliveryZoneAdmin {
        const kitchenId = this.#kitchens[0]?.id;
        if (kitchenId === undefined) {
            throwFailure(apiFailure('server', { message: 'This world has no kitchens.' }));
        }

        // Zones take the next free ordinal above the eight seeds rather than a runtime band of
        // their own: `deliveryZone` is a small, dense band and a gap in it would be misleading.
        const id = this.#mintZoneId();
        const row: StoredZone = {
            id,
            meta: {
                lockVersion: 1,
                status: 'draft',
                updatedAt: PROTOTYPE_NOW,
                updatedByName: PROTOTYPE_KITCHEN_MANAGER_NAME,
            },
            name: request.name,
            kitchenId,
            branchIds: [...(request.branchIds ?? [])],
            areaIds: [],
            deliveryFeeMinor: request.deliveryFeeMinor ?? null,
            minimumOrderMinor: request.minimumOrderMinor ?? null,
            currency: request.currency,
            estimatedMinutes: request.estimatedMinutes ?? null,
            deliveryWindows: [],
            consumer: {
                id,
                name: request.name.en,
                area: '',
                countryCode: 'AE',
                deliveryFee: null,
                minimumOrder: null,
                estimatedMinutes: request.estimatedMinutes ?? null,
            },
        };
        this.#zones.set(String(id), row);
        return this.#zoneAdmin(row);
    }

    #mintZoneId(): DeliveryZoneId {
        let highest = PROTOTYPE_RUNTIME_ORDINAL_START - 1;
        for (const zone of this.#zones.values()) {
            const ordinal = Number.parseInt(String(zone.id).slice(-2), 16);
            if (Number.isFinite(ordinal) && ordinal > highest) highest = ordinal;
        }
        return deliveryZoneIdAt(highest + 1);
    }

    updateZone(zoneId: DeliveryZoneId, request: UpdateDeliveryZoneRequest): DeliveryZoneAdmin {
        const row = this.#zone(zoneId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'delivery zone');

        if (request.name !== undefined) row.name = request.name;
        if (request.branchIds !== undefined) row.branchIds = [...request.branchIds];
        if (request.deliveryFeeMinor !== undefined) row.deliveryFeeMinor = request.deliveryFeeMinor;
        if (request.minimumOrderMinor !== undefined) {
            row.minimumOrderMinor = request.minimumOrderMinor;
        }
        if (request.estimatedMinutes !== undefined) row.estimatedMinutes = request.estimatedMinutes;

        this.#refreshZone(row);
        row.meta = this.#bump(row.meta);
        return this.#zoneAdmin(row);
    }

    archiveZone(zoneId: DeliveryZoneId, request: LockedRequest): DeliveryZoneAdmin {
        const row = this.#zone(zoneId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'delivery zone');
        row.meta = { ...this.#bump(row.meta), status: 'retired' };
        this.#refreshBranchesFor(row);
        return this.#zoneAdmin(row);
    }

    setZoneAreas(zoneId: DeliveryZoneId, request: SetZoneAreasRequest): DeliveryZoneAdmin {
        const row = this.#zone(zoneId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'delivery zone');

        for (const areaId of request.serviceAreaIds) {
            if (!this.#serviceAreas.has(String(areaId))) {
                notFound('service area', String(areaId));
            }
        }
        row.areaIds = request.serviceAreaIds.map((areaId) => String(areaId));
        this.#refreshZone(row);
        row.meta = this.#bump(row.meta);
        return this.#zoneAdmin(row);
    }

    setDeliveryWindows(
        zoneId: DeliveryZoneId,
        request: SetDeliveryWindowsRequest,
    ): DeliveryZoneAdmin {
        const row = this.#zone(zoneId);
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'delivery zone');

        row.deliveryWindows = request.windows.map((window) => {
            if (window.id !== null) {
                return {
                    id: window.id,
                    label: window.label,
                    weekdays: [...window.weekdays],
                    startsAt: window.startsAt,
                    endsAt: window.endsAt,
                    capacity: window.capacity ?? null,
                    isActive: window.isActive ?? true,
                };
            }
            this.#nextWindowOrdinal += 1;
            return {
                id: deliveryWindowIdAt(this.#nextWindowOrdinal),
                label: window.label,
                weekdays: [...window.weekdays],
                startsAt: window.startsAt,
                endsAt: window.endsAt,
                capacity: window.capacity ?? null,
                isActive: window.isActive ?? true,
            };
        });

        row.meta = this.#bump(row.meta);
        return this.#zoneAdmin(row);
    }

    /** Rebuilds the consumer projection of a zone and the branches that publish it. */
    #refreshZone(row: StoredZone): void {
        row.consumer = projectZone(row, this.#serviceAreas);
        this.#refreshBranchesFor(row);
    }

    #refreshBranchesFor(row: StoredZone): void {
        const branchIds = new Set(row.branchIds.map(String));
        this.#kitchens = this.#kitchens.map((kitchen) => ({
            ...kitchen,
            branches: kitchen.branches.map((branch) =>
                branchIds.has(String(branch.id))
                    ? withBranch(branch, { deliveryZones: this.#zonesForBranch(branch.id) })
                    : branch,
            ),
        }));
    }

    /** A branch publishes the zones that name it — and only the ones that are published. */
    #zonesForBranch(branchId: KitchenBranchId): readonly DeliveryZone[] {
        const zones: DeliveryZone[] = [];
        for (const zone of this.#zones.values()) {
            if (zone.meta.status !== 'published') continue;
            if (!zone.branchIds.some((candidate) => String(candidate) === String(branchId))) {
                continue;
            }
            zones.push(zone.consumer);
        }
        return zones;
    }

    getBranchOperating(branchId: KitchenBranchId): BranchOperating {
        const row =
            this.#branchOperating.get(String(branchId)) ?? notFound('branch', String(branchId));
        return {
            branchId: row.branchId,
            meta: row.meta,
            timeZone: row.timeZone,
            days: row.days,
        };
    }

    setBranchOperating(
        branchId: KitchenBranchId,
        request: SetBranchOperatingRequest,
    ): BranchOperating {
        const row =
            this.#branchOperating.get(String(branchId)) ?? notFound('branch', String(branchId));
        this.#assertVersion(row.meta.lockVersion, request.lockVersion, 'branch');

        const weekdays = request.days.map((day) => day.weekday).sort((left, right) => left - right);
        if (weekdays.length !== 7 || weekdays.some((weekday, index) => weekday !== index + 1)) {
            throwFailure(
                validationFailure({
                    days: [
                        'A trading week needs exactly seven rows, Monday to Sunday. A closed day ' +
                            'is a row with no times, not a missing one.',
                    ],
                }),
            );
        }

        row.days = [...request.days].sort((left, right) => left.weekday - right.weekday);
        if (request.timeZone !== undefined) row.timeZone = request.timeZone;
        row.meta = this.#bump(row.meta);

        const hours = projectOpeningHours(row);
        this.#kitchens = this.#kitchens.map((kitchen) => ({
            ...kitchen,
            branches: kitchen.branches.map((branch) =>
                String(branch.id) === String(branchId)
                    ? withBranch(branch, { openingHours: hours })
                    : branch,
            ),
        }));

        return { branchId: row.branchId, meta: row.meta, timeZone: row.timeZone, days: row.days };
    }
}
