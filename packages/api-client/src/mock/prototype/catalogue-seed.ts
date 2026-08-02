import { PLAN_DURATION_WEEKS, SALES_CHANNELS } from '@healthy360/domain-types';
import type { AllergenCode, KitchenId, SalesChannel } from '@healthy360/domain-types';

import type {
    AllergenClass,
    ChannelAvailability,
    PlanCombination,
    PriceListEntry,
    ServiceArea,
} from '../../contracts/kitchen-admin.ts';
import type { Kitchen } from '../../contracts/marketplace.ts';
import { DEFAULT_CURRENCY, PROTOTYPE_NOW, PROTOTYPE_WEEK_START } from './constants.ts';
import {
    availabilityDaysFrom,
    costFromMoney,
    operatingDaysFrom,
    untranslated,
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
import {
    MEAL_RECIPE_INDEX,
    PROTOTYPE_ALLERGENS,
    PROTOTYPE_DELIVERY_ZONES,
    PROTOTYPE_INGREDIENTS,
    PROTOTYPE_KITCHENS,
    PROTOTYPE_KITCHEN_BRANCHES,
    PROTOTYPE_MEALS,
    PROTOTYPE_PLANS,
    PROTOTYPE_RECIPES,
    deliveryWeekdaysFor,
    recipeByKey,
} from './fixtures/index.ts';
import {
    deliveryWindowIdAt,
    priceListIdAt,
    productIdAt,
    recipeVersionIdAt,
    serviceAreaIdAt,
} from './ids.ts';

/**
 * The initial state of the mutable catalogue world, built from the fixture modules.
 *
 * **The fixtures stay the source of truth for what exists; this file decides what it looks like to a
 * manager.** Every consumer-facing object is carried through verbatim, so a seeded world answers a
 * marketplace read with exactly the bytes it answered before this refactor existed. Everything a
 * manager additionally sees — costs, allergen provenance, publication state, lock versions — is
 * derived here, deterministically, from the same rows.
 *
 * Called fresh per store, so two stores never share a record and one test cannot see another's
 * mutations.
 *
 * ## What is *not* seeded, and why
 *
 * - **No recipe outputs.** Not one fixture recipe produces an intermediate ingredient — they all
 *   produce a dish that is sold as a meal. Under the `recipe_version_outputs` model (plan §4.2) an
 *   ingredient nobody makes simply has no output row, so seeding an empty list is the accurate
 *   answer rather than a gap. `setRecipeOutputs` is what puts one there.
 * - **No quarantined rows.** Every seeded record is `published`, which is what keeps the consumer
 *   surfaces byte-identical. `review_required` is reachable — an allergen mapping that contradicts
 *   a published recipe puts a row there — but nothing starts in it.
 * - **No confirmed retail prices.** The synthetic products below have never been priced by anybody,
 *   so their entries are placeholders with `null` amounts, which is precisely the state the imported
 *   GreenLife product list will arrive in.
 */

const SEED_META = {
    lockVersion: 1,
    status: 'published',
    updatedAt: PROTOTYPE_NOW,
    updatedByName: null,
} as const;

const SEED_RECORD_META = {
    lockVersion: 1,
    updatedAt: PROTOTYPE_NOW,
    updatedByName: null,
} as const;

/** Waste allowance the source technical sheets apply. */
const SEED_WASTE_PERCENT = 3;

/** The cut-off rule the source plan structure states. */
const SEED_CHANGE_CUTOFF_HOURS = 24;

export interface CatalogueSeed {
    readonly allergenClasses: readonly AllergenClass[];
    readonly serviceAreas: readonly ServiceArea[];
    readonly ingredients: readonly StoredIngredient[];
    readonly recipes: readonly StoredRecipe[];
    readonly products: readonly StoredProduct[];
    readonly priceLists: readonly StoredPriceList[];
    readonly meals: readonly StoredMeal[];
    readonly plans: readonly StoredPlan[];
    readonly zones: readonly StoredZone[];
    readonly branchOperating: readonly StoredBranchOperating[];
    readonly kitchens: readonly Kitchen[];
}

/* ------------------------------------------------------------------------------------------------
 * Platform reference
 * ---------------------------------------------------------------------------------------------- */

/**
 * The nine groups the United States requires as major food allergens. The other five of the EU
 * fourteen are not US-declarable, which is exactly the sort of market difference `marketScope`
 * exists to express — and the reason a mapping cannot simply be a boolean.
 */
const US_MAJOR_ALLERGENS: readonly string[] = [
    'milk',
    'egg',
    'fish',
    'crustaceans',
    'tree_nut',
    'peanut',
    'gluten',
    'soy',
    'sesame',
];

function buildAllergenClasses(): readonly AllergenClass[] {
    return PROTOTYPE_ALLERGENS.map((allergen) => ({
        code: allergen.code,
        name: untranslated(allergen.displayName),
        description: untranslated(allergen.description),
        markets: US_MAJOR_ALLERGENS.includes(allergen.code) ? ['EU', 'GCC', 'US'] : ['EU', 'GCC'],
        // The only class the regime states a threshold for.
        declarationThreshold: allergen.code === 'sulphites' ? { value: 10, unit: 'mg/kg' } : null,
        regulatoryReference: 'Regulation (EU) No 1169/2011, Annex II',
        severeByDefault: allergen.severeByDefault,
        isActive: true,
    }));
}

/** Every emirate in this world bar Sharjah, which is its own. */
function parentFor(area: string): ServiceArea['parentName'] {
    return area === 'Sharjah' ? null : untranslated('Dubai');
}

function buildServiceAreas(): readonly ServiceArea[] {
    const names: string[] = [];
    for (const zone of PROTOTYPE_DELIVERY_ZONES) {
        if (!names.includes(zone.area)) names.push(zone.area);
    }
    for (const branch of PROTOTYPE_KITCHEN_BRANCHES) {
        if (!names.includes(branch.area)) names.push(branch.area);
    }

    return names.map((name, index) => ({
        id: serviceAreaIdAt(index),
        name: untranslated(name),
        // Every area in this fixture world is in the United Arab Emirates.
        countryCode: 'AE',
        parentName: parentFor(name),
        isActive: true,
    }));
}

/* ------------------------------------------------------------------------------------------------
 * Ingredients
 * ---------------------------------------------------------------------------------------------- */

function categoryCodeFor(label: string): string {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function buildIngredients(): readonly StoredIngredient[] {
    return PROTOTYPE_INGREDIENTS.map((ingredient, index) => ({
        id: ingredient.id,
        meta: { ...SEED_META },
        name: untranslated(ingredient.name),
        reference: `IG-${String(index + 1).padStart(3, '0')}`,
        categoryCode: categoryCodeFor(ingredient.aisle),
        measurementUnit: 'g' as const,
        costPer100g: costFromMoney(ingredient.costPer100g),
        allergens: ingredient.allergens.map((code) => ({
            allergenCode: code,
            containment: 'contains' as const,
            marketScope: [],
            // The fixture facts came from a supplier-style specification, not a laboratory.
            verification: 'supplier_declared' as const,
            sourceNote: null,
        })),
        aliases: [],
        notes: null,
        // Every seeded row is the shared platform library; a kitchen owns only what it creates or
        // forks, which is the distinction the `ownedOnly` filter reads.
        organisationId: null,
        consumer: ingredient,
    }));
}

/* ------------------------------------------------------------------------------------------------
 * Recipes
 * ---------------------------------------------------------------------------------------------- */

function buildRecipes(): readonly StoredRecipe[] {
    return PROTOTYPE_RECIPES.map((recipe, index) => {
        const versionId = recipeVersionIdAt(index);

        const lines = recipe.ingredients.map((line) => ({
            ingredientId: line.ingredientId,
            ingredientName: untranslated(line.name),
            quantity: line.quantity,
            unit: line.unit,
            sourceDesignation: null,
            isOptional: line.optional,
            lineCost: line.estimatedCost === null ? null : costFromMoney(line.estimatedCost),
        }));

        // Every seeded allergen is derived: it is on the label because a line put it there, and the
        // lines that did are named so the editor can point at them rather than just listing a code.
        const allergens = recipe.allergens.map((code: AllergenCode) => ({
            allergenCode: code,
            containment: 'contains' as const,
            origin: 'derived' as const,
            sourceIngredientIds: recipe.ingredients
                .filter((line) => line.allergens.includes(code))
                .map((line) => line.ingredientId),
        }));

        const version: StoredRecipeVersion = {
            id: versionId,
            versionNumber: 1,
            status: 'published',
            yieldQuantity: recipe.servings,
            yieldUnit: 'portion',
            yieldPieces: null,
            wastePercent: SEED_WASTE_PERCENT,
            lines,
            outputs: [],
            steps: recipe.steps.map((step) => ({
                index: step.index,
                instruction: untranslated(step.instruction),
                minutes: step.minutes,
            })),
            allergens,
            estimatedCost:
                recipe.estimatedCost === null ? null : costFromMoney(recipe.estimatedCost),
            derivationStale: false,
            publishedAt: PROTOTYPE_NOW,
            consumer: recipe,
        };

        return {
            id: recipe.id,
            meta: { ...SEED_META },
            name: untranslated(recipe.name),
            slug: recipe.slug,
            description: untranslated(recipe.description),
            kitchenId: recipe.kitchenId,
            versions: [version],
            currentVersionId: versionId,
        };
    });
}

/* ------------------------------------------------------------------------------------------------
 * Products
 * ---------------------------------------------------------------------------------------------- */

/** Groups whose price genuinely moves with the day's market. */
const MARKET_PRICED_ALLERGENS: readonly string[] = ['fish', 'crustaceans', 'mollusc'];

function channelAvailabilityFor(kitchen: Kitchen | undefined): ChannelAvailability[] {
    return SALES_CHANNELS.filter((channel) => kitchen?.channels[channel] === true).map(
        (channel) => ({
            channel,
            isAvailable: true,
            availableFrom: null,
            availableUntil: null,
        }),
    );
}

/**
 * One retail pack per recipe a kitchen owns.
 *
 * The source material's product list is confidential and arrives only through the private importer,
 * so this world cannot contain it. What it *can* contain honestly is the shape: a kitchen that cooks
 * something also sells it in a pack, at a price nobody has confirmed yet.
 */
function buildProducts(kitchensById: ReadonlyMap<string, Kitchen>): readonly StoredProduct[] {
    const products: StoredProduct[] = [];
    let ordinal = 0;

    for (const recipe of PROTOTYPE_RECIPES) {
        const kitchenId = recipe.kitchenId;
        if (kitchenId === null) continue;

        const portionGrams = recipe.serving.grams ?? 250;
        products.push({
            id: productIdAt(ordinal),
            meta: { ...SEED_META },
            name: untranslated(recipe.name),
            description: untranslated(recipe.description),
            categoryCode: 'prepared-food',
            kitchenId,
            isMarketPriced: recipe.allergens.some((code) => MARKET_PRICED_ALLERGENS.includes(code)),
            isAssorted: false,
            packVariants: [
                {
                    code: 'SINGLE',
                    label: untranslated('Single portion'),
                    netQuantity: portionGrams,
                    netUnit: 'g',
                    unitsPerPack: 1,
                },
                {
                    code: 'TRAY6',
                    label: untranslated('Tray of six'),
                    netQuantity: portionGrams * 6,
                    netUnit: 'g',
                    unitsPerPack: 6,
                },
            ],
            channelAvailability: channelAvailabilityFor(kitchensById.get(kitchenId)),
            recipeId: recipe.id,
            dataQualityFlags: [],
        });
        ordinal += 1;
    }

    return products;
}

/* ------------------------------------------------------------------------------------------------
 * Price lists
 * ---------------------------------------------------------------------------------------------- */

function channelsFor(
    kitchen: Kitchen | undefined,
    wanted: readonly SalesChannel[],
): SalesChannel[] {
    return wanted.filter((channel) => kitchen?.channels[channel] === true);
}

function buildPriceLists(
    kitchensById: ReadonlyMap<string, Kitchen>,
    products: readonly StoredProduct[],
): readonly StoredPriceList[] {
    const lists: StoredPriceList[] = [];
    let ordinal = 0;

    for (const kitchen of PROTOTYPE_KITCHENS) {
        const meals = PROTOTYPE_MEALS.filter((meal) => meal.kitchenId === kitchen.id);
        const plans = PROTOTYPE_PLANS.filter((plan) => plan.kitchenId === kitchen.id);
        const kitchenProducts = products.filter((product) => product.kitchenId === kitchen.id);

        if (meals.length > 0) {
            const entries: PriceListEntry[] = meals.map((meal) => ({
                item: { kind: 'meal', mealId: meal.id },
                priceStatus: 'confirmed',
                amountMinor: meal.price.amount,
                effectiveFrom: PROTOTYPE_WEEK_START,
                effectiveUntil: null,
                note: null,
            }));
            lists.push({
                id: priceListIdAt(ordinal),
                meta: { ...SEED_META },
                name: untranslated(`${kitchen.name} — consumer menu`),
                currency: DEFAULT_CURRENCY,
                kitchenId: kitchen.id,
                channels: channelsFor(kitchensById.get(kitchen.id), [
                    'b2c',
                    'marketplace',
                    'delivery',
                    'pickup',
                    'pos',
                ]),
                entries,
            });
            ordinal += 1;
        }

        if (plans.length > 0) {
            const entries: PriceListEntry[] = plans.flatMap((plan) =>
                plan.variants.map((variant) => ({
                    item: { kind: 'plan' as const, planId: plan.id, variantId: variant.id },
                    priceStatus: 'confirmed' as const,
                    amountMinor: variant.pricePerWeek.amount,
                    effectiveFrom: PROTOTYPE_WEEK_START,
                    effectiveUntil: null,
                    note: null,
                })),
            );
            lists.push({
                id: priceListIdAt(ordinal),
                meta: { ...SEED_META },
                name: untranslated(`${kitchen.name} — subscription plans`),
                currency: DEFAULT_CURRENCY,
                kitchenId: kitchen.id,
                channels: channelsFor(kitchensById.get(kitchen.id), ['subscription', 'b2c']),
                entries,
            });
            ordinal += 1;
        }

        if (kitchenProducts.length > 0) {
            const entries: PriceListEntry[] = kitchenProducts.map((product) => ({
                item: { kind: 'product', productId: product.id, packCode: 'SINGLE' },
                priceStatus: product.isMarketPriced ? 'market_priced' : 'placeholder',
                amountMinor: null,
                effectiveFrom: PROTOTYPE_WEEK_START,
                effectiveUntil: null,
                note: product.isMarketPriced
                    ? 'Priced at the day’s market rate.'
                    : 'No price has been confirmed for this pack yet.',
            }));
            lists.push({
                id: priceListIdAt(ordinal),
                // Draft, and it stays draft: not one entry carries a confirmed amount, so there is
                // nothing here a customer could be charged.
                meta: { ...SEED_META, status: 'draft' },
                name: untranslated(`${kitchen.name} — retail packs`),
                currency: DEFAULT_CURRENCY,
                kitchenId: kitchen.id,
                channels: channelsFor(kitchensById.get(kitchen.id), ['b2b', 'pos', 'pickup']),
                entries,
            });
            ordinal += 1;
        }
    }

    return lists;
}

/* ------------------------------------------------------------------------------------------------
 * Meals
 * ---------------------------------------------------------------------------------------------- */

function buildMeals(recipes: readonly StoredRecipe[]): readonly StoredMeal[] {
    const recipesById = new Map(recipes.map((recipe) => [String(recipe.id), recipe]));

    return PROTOTYPE_MEALS.map((meal) => {
        const link = MEAL_RECIPE_INDEX.get(meal.id);
        const recipe = link === undefined ? null : recipeByKey(link.recipeKey);
        const stored = recipe === null ? undefined : recipesById.get(String(recipe.id));

        const recipeServingGrams = recipe?.serving.grams ?? null;
        const mealServingGrams = meal.serving.grams;
        const portionFactor =
            recipeServingGrams === null || mealServingGrams === null || recipeServingGrams === 0
                ? 1
                : Math.round((mealServingGrams / recipeServingGrams) * 100) / 100;

        return {
            id: meal.id,
            meta: { ...SEED_META },
            name: untranslated(meal.name),
            description: untranslated(meal.description),
            kitchenId: meal.kitchenId,
            recipeId: recipe?.id ?? null,
            recipeVersionId: stored?.currentVersionId ?? null,
            portionFactor,
            channelAvailability: SALES_CHANNELS.filter((channel) => meal.channels[channel]).map(
                (channel) => ({
                    channel,
                    isAvailable: true,
                    availableFrom: null,
                    availableUntil: null,
                }),
            ),
            availability: availabilityDaysFrom(meal.availability),
            marginPercent: marginFor(meal.price.amount, recipe, portionFactor),
            consumer: meal,
        };
    });
}

/** Gross margin over the recipe's cost per serving. `null` the moment either side is unknown. */
function marginFor(
    priceMinor: number,
    recipe: {
        readonly estimatedCost: { readonly amount: number } | null;
        readonly servings: number;
    } | null,
    portionFactor: number,
): number | null {
    if (recipe === null || recipe.estimatedCost === null || recipe.servings <= 0) return null;
    const costMinor = (recipe.estimatedCost.amount / recipe.servings) * portionFactor;
    if (priceMinor <= 0) return null;
    return Math.round(((priceMinor - costMinor) / priceMinor) * 100);
}

/* ------------------------------------------------------------------------------------------------
 * Plans
 * ---------------------------------------------------------------------------------------------- */

function buildPlans(): readonly StoredPlan[] {
    return PROTOTYPE_PLANS.map((plan) => {
        const combinations: PlanCombination[] = [];
        for (const variant of plan.variants) {
            const code = `M${String(variant.mealsPerDay)}S${String(variant.snacksPerDay)}`;
            if (combinations.some((combination) => combination.code === code)) continue;
            combinations.push({
                code,
                label: untranslated(
                    `${String(variant.mealsPerDay)} meals, ${String(variant.snacksPerDay)} snacks`,
                ),
                mealsPerDay: variant.mealsPerDay,
                snacksPerDay: variant.snacksPerDay,
                isAvailable: true,
            });
        }

        return {
            id: plan.id,
            meta: { ...SEED_META },
            name: untranslated(plan.name),
            summary: untranslated(plan.summary),
            description: untranslated(plan.description),
            kitchenId: plan.kitchenId,
            variants: plan.variants.map((variant) => ({
                id: variant.id,
                name: untranslated(variant.name),
                energyBand: variant.energyRange,
                mealsPerDay: variant.mealsPerDay,
                snacksPerDay: variant.snacksPerDay,
                isActive: true,
            })),
            // The consumer union's four weekly options become day counts (plan §4.3). Nothing is
            // lost — `1w` *is* seven days — and the model can now hold the source material's 5-, 20-,
            // 40- and 60-day commitments, which the union could not express at all.
            durations: plan.durations.map((option) => ({
                kind: 'fixed_days' as const,
                days: PLAN_DURATION_WEEKS[option.duration] * 7,
                discountPercent: option.discountPercent,
            })),
            combinations,
            changeCutOffHours: SEED_CHANGE_CUTOFF_HOURS,
            deliveryWeekdays: [...deliveryWeekdaysFor(plan.id)],
            consumer: plan,
        };
    });
}

/* ------------------------------------------------------------------------------------------------
 * Delivery zones, windows and branch operating data
 * ---------------------------------------------------------------------------------------------- */

/** The three windows every zone offers, mirroring the commerce contract's delivery slots. */
const WINDOW_ROWS: readonly (readonly [label: string, startsAt: string, endsAt: string])[] = [
    ['Morning', '07:00', '10:00'],
    ['Midday', '11:00', '14:00'],
    ['Evening', '17:00', '21:00'],
];

const EVERY_WEEKDAY: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

function buildZones(areas: readonly ServiceArea[]): readonly StoredZone[] {
    const areaByName = new Map(areas.map((area) => [area.name.en, area]));

    return PROTOTYPE_DELIVERY_ZONES.map((zone, index) => {
        const branches = PROTOTYPE_KITCHEN_BRANCHES.filter((branch) =>
            branch.deliveryZones.some((candidate) => candidate.id === zone.id),
        );
        const area = areaByName.get(zone.area);

        return {
            id: zone.id,
            meta: { ...SEED_META },
            name: untranslated(zone.name),
            // The fixture zones are shared by several kitchens, which the owned model does not
            // allow. The first branch that reaches the zone names its owner; every branch that
            // delivers into it is still listed, which is the closest honest reading of a fixture
            // set authored before zones were owned by anybody.
            kitchenId: (branches[0]?.kitchenId ?? PROTOTYPE_KITCHENS[0]?.id) as KitchenId,
            branchIds: branches.map((branch) => branch.id),
            areaIds: area === undefined ? [] : [String(area.id)],
            deliveryFeeMinor: zone.deliveryFee?.amount ?? null,
            minimumOrderMinor: zone.minimumOrder?.amount ?? null,
            currency: DEFAULT_CURRENCY,
            estimatedMinutes: zone.estimatedMinutes,
            deliveryWindows: WINDOW_ROWS.map(([label, startsAt, endsAt], slot) => ({
                id: deliveryWindowIdAt(index * WINDOW_ROWS.length + slot),
                label: untranslated(label),
                weekdays: [...EVERY_WEEKDAY],
                startsAt,
                endsAt,
                capacity: null,
                isActive: true,
            })),
            consumer: zone,
        };
    });
}

function buildBranchOperating(): readonly StoredBranchOperating[] {
    return PROTOTYPE_KITCHEN_BRANCHES.map((branch) => ({
        branchId: branch.id,
        meta: { ...SEED_RECORD_META },
        timeZone: branch.timeZone,
        days: operatingDaysFrom(branch.openingHours),
    }));
}

/* ------------------------------------------------------------------------------------------------
 * The seed
 * ---------------------------------------------------------------------------------------------- */

export function buildCatalogueSeed(): CatalogueSeed {
    const kitchens: readonly Kitchen[] = PROTOTYPE_KITCHENS.map((kitchen) => ({ ...kitchen }));
    const kitchensById = new Map(kitchens.map((kitchen) => [String(kitchen.id), kitchen]));

    const serviceAreas = buildServiceAreas();
    const recipes = buildRecipes();
    const products = buildProducts(kitchensById);

    return {
        allergenClasses: buildAllergenClasses(),
        serviceAreas,
        ingredients: buildIngredients(),
        recipes,
        products,
        priceLists: buildPriceLists(kitchensById, products),
        meals: buildMeals(recipes),
        plans: buildPlans(),
        zones: buildZones(serviceAreas),
        branchOperating: buildBranchOperating(),
        kitchens,
    };
}
