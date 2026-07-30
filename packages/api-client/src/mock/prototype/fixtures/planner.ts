import {
    amountValue,
    mealNutritionFromServing,
    scaleFacts,
    summariseDay,
    summariseWeek,
} from '@healthy360/nutrition';
import type {
    DailyNutritionSummary,
    MealNutrition,
    NutrientTarget,
    NutritionFacts,
} from '@healthy360/nutrition';
import type {
    AllergenCode,
    DietitianId,
    IngredientId,
    IsoDateTime,
    KitchenId,
    MealId,
    MealPlanEntryId,
    MealPlanId,
    MealType,
    Money,
    RecipeId,
    UserId,
} from '@healthy360/domain-types';

import type { GroceryList, GroceryListItem, Pantry } from '../../../contracts/foods.ts';
import type {
    MealPlanDay,
    MealPlanEntry,
    MealPlanState,
    MealPlanWeek,
    PlanEntryKind,
} from '../../../contracts/planner.ts';
import {
    PROTOTYPE_NOW,
    PROTOTYPE_WEEK_START,
    addDays,
    aed,
    atOrThrow,
    weekDates,
} from '../constants.ts';
import { groceryListIdAt, mealPlanEntryIdAt, mealPlanIdAt } from '../ids.ts';
import {
    PROTOTYPE_CONSTRAINTS,
    PROTOTYPE_CUSTOMER_ID,
    PROTOTYPE_DAILY_TARGET_FACTS,
    PROTOTYPE_NUTRIENT_TARGETS,
    PROTOTYPE_WEEKLY_TARGET_FACTS,
} from './customer.ts';
import { dietitianByKey } from './dietitians.ts';
import { ingredientByKey, ingredientById, ingredientCost } from './ingredients.ts';
import { mealById, mealByKey } from './meals.ts';
import { makeFacts, makeServing } from './nutrients.ts';
import { recipeById, recipeByKey } from './recipes.ts';

/**
 * The generated week, and the projection that turns entries into days and a week.
 *
 * The entries are the *only* stored state. Everything a screen reads about a day or a week — the
 * planned totals, the daily average, the cost, the warnings — is computed from them on the way out.
 * That is what makes the mutations honest: locking an entry, regenerating a day or dragging a
 * portion slider changes one entry, and the totals move because they were never stored separately.
 *
 * Warnings are derived too. An entry that contains a declared allergen carries
 * `planner.allergen_conflict` because of what is in it, not because a fixture said so; an entry
 * above half the day's energy target carries `planner.energy_out_of_range` for the same reason.
 * Intolerances and dislikes deliberately do **not** raise a per-entry warning — they are handled by
 * ranking and by the replacement filters, which is precisely what separates them from an allergy.
 */

export const PROTOTYPE_PLAN_IDS = {
    /** The active week the planner opens on. */
    week: mealPlanIdAt(0),
    /** The draft the Virtual Dietitian generates. */
    draft: mealPlanIdAt(1),
    /** A saved template, so "save as template" has something to have produced. */
    template: mealPlanIdAt(2),
} as const;

/** Constraint codes that block outright. Only these raise a per-entry allergen warning. */
const BLOCKING_ALLERGEN_CODES: readonly string[] = PROTOTYPE_CONSTRAINTS.filter(
    (constraint) => constraint.kind === 'allergy',
).map((constraint) => constraint.code);

/** Share of the day's energy target above which a single entry is flagged. */
export const ENTRY_ENERGY_WARNING_SHARE = 0.5;

export const ALLERGEN_WARNING_CODE = 'planner.allergen_conflict';
export const ENERGY_WARNING_CODE = 'planner.energy_out_of_range';

/** The warnings an entry earns from its own contents. */
export function deriveEntryWarnings(
    allergens: readonly AllergenCode[],
    nutrition: NutritionFacts,
    targets: readonly NutrientTarget[],
): readonly string[] {
    const warnings: string[] = [];
    if (allergens.some((code) => BLOCKING_ALLERGEN_CODES.includes(code))) {
        warnings.push(ALLERGEN_WARNING_CODE);
    }
    const energyTarget = targets.find((target) => target.nutrientId === 'energy');
    if (
        energyTarget !== undefined &&
        energyTarget.value > 0 &&
        amountValue(nutrition, 'energy') > energyTarget.value * ENTRY_ENERGY_WARNING_SHARE
    ) {
        warnings.push(ENERGY_WARNING_CODE);
    }
    return warnings;
}

/* ------------------------------------------------------------------------------------------------
 * Entry builder
 * ---------------------------------------------------------------------------------------------- */

/** A planned restaurant meal has no recipe behind it, so its figures are a stated estimate. */
export const RESTAURANT_ESTIMATE: Readonly<Record<string, number>> = {
    energy: 1150,
    protein: 45,
    carbohydrate: 110,
    fat: 55,
    fibre: 8,
    sugars: 18,
    saturated_fat: 18,
    sodium: 1800,
};

export interface MakeEntryOptions {
    readonly id: MealPlanEntryId;
    readonly planId: MealPlanId;
    readonly date: string;
    readonly mealType: MealType;
    readonly kind: PlanEntryKind;
    readonly position?: number | undefined;
    readonly mealId?: MealId | null | undefined;
    readonly recipeId?: RecipeId | null | undefined;
    /** For a `food` entry: the ingredient identifier and the quantity in grams. */
    readonly foodId?: string | undefined;
    readonly grams?: number | undefined;
    readonly restaurantName?: string | null | undefined;
    readonly label?: string | undefined;
    readonly portionFactor?: number | undefined;
    readonly locked?: boolean | undefined;
    readonly isLeftover?: boolean | undefined;
    readonly leftoverOfEntryId?: MealPlanEntryId | null | undefined;
    readonly approvedBy?: DietitianId | null | undefined;
    readonly targets?: readonly NutrientTarget[] | undefined;
    /** Warnings the caller confirmed and the entry should therefore not repeat. */
    readonly suppressWarnings?: readonly string[] | undefined;
}

interface EntrySource {
    readonly label: string;
    readonly facts: NutritionFacts;
    readonly allergens: readonly AllergenCode[];
    readonly estimatedCost: Money | null;
    readonly preparationMinutes: number | null;
    readonly kitchenId: KitchenId | null;
}

function resolveSource(options: MakeEntryOptions): EntrySource {
    const portionFactor = options.portionFactor ?? 1;

    if (options.kind === 'kitchen_meal') {
        const meal = options.mealId == null ? null : mealById(options.mealId);
        if (meal === null) {
            throw new Error(`No marketplace meal behind planner entry ${String(options.id)}.`);
        }
        const occasion = mealNutritionFromServing(meal.nutrition, {
            mealType: options.mealType,
            label: meal.name,
            portionFactor,
            mealId: meal.id,
            allergens: meal.allergens,
            costPerServing: meal.price,
            derivation: { method: 'planner.entry_from_kitchen_meal' },
        });
        return {
            label: meal.name,
            facts: occasion.facts,
            allergens: meal.allergens,
            estimatedCost: occasion.estimatedCost,
            preparationMinutes: meal.preparationMinutes,
            kitchenId: meal.kitchenId,
        };
    }

    if (options.kind === 'recipe') {
        const recipe = options.recipeId == null ? null : recipeById(options.recipeId);
        if (recipe === null) {
            throw new Error(`No recipe behind planner entry ${String(options.id)}.`);
        }
        const costPerServing =
            recipe.estimatedCost === null
                ? null
                : aed(Math.round(recipe.estimatedCost.amount / recipe.servings));
        const occasion = mealNutritionFromServing(recipe.nutrition.perServing, {
            mealType: options.mealType,
            label: recipe.name,
            portionFactor,
            recipeId: recipe.id,
            allergens: recipe.allergens,
            costPerServing,
            derivation: { method: 'planner.entry_from_recipe' },
        });
        return {
            label: recipe.name,
            facts: occasion.facts,
            allergens: recipe.allergens,
            estimatedCost: occasion.estimatedCost,
            preparationMinutes: recipe.preparationMinutes + recipe.cookingMinutes,
            kitchenId: recipe.kitchenId,
        };
    }

    if (options.kind === 'food') {
        const ingredient = options.foodId === undefined ? null : ingredientById(options.foodId);
        if (ingredient === null) {
            throw new Error(`No food behind planner entry ${String(options.id)}.`);
        }
        const grams = options.grams ?? 100;
        const facts = scaleFacts(ingredient.per100g, (grams * portionFactor) / 100, {
            basis: 'per_meal',
            serving: makeServing({
                label: `${String(grams)} g`,
                quantity: grams,
                unit: 'g',
                grams,
            }),
            method: 'planner.entry_from_food',
        });
        return {
            // The mass lives on the serving, not in the label: a portion adjustment then changes
            // the figures without leaving a stale number in the text beside them.
            label: ingredient.name,
            facts,
            allergens: ingredient.allergens,
            estimatedCost: ingredientCost(ingredient, grams * portionFactor),
            preparationMinutes: null,
            kitchenId: null,
        };
    }

    const name = options.restaurantName ?? 'Planned meal out';
    return {
        label: options.label ?? name,
        facts: makeFacts(RESTAURANT_ESTIMATE, {
            basis: 'per_meal',
            method: 'planner.entry_from_restaurant_estimate',
            notes: [
                'A stated estimate for a meal eaten out. No menu was consulted and no venue database is implied.',
            ],
        }),
        allergens: [],
        estimatedCost: null,
        preparationMinutes: null,
        kitchenId: null,
    };
}

/** One planner entry, with every field decided here rather than at thirty call sites. */
export function makeEntry(options: MakeEntryOptions): MealPlanEntry {
    const source = resolveSource(options);
    const targets = options.targets ?? PROTOTYPE_NUTRIENT_TARGETS;
    const suppressed = new Set(options.suppressWarnings ?? []);
    const warnings = deriveEntryWarnings(source.allergens, source.facts, targets).filter(
        (code) => !suppressed.has(code),
    );

    return {
        id: options.id,
        planId: options.planId,
        date: options.date,
        mealType: options.mealType,
        position: options.position ?? 0,
        kind: options.kind,
        label: options.label ?? source.label,
        recipeId: options.recipeId ?? null,
        mealId: options.mealId ?? null,
        kitchenId: source.kitchenId,
        restaurantName: options.restaurantName ?? null,
        portionFactor: options.portionFactor ?? 1,
        nutrition: source.facts,
        allergens: source.allergens,
        estimatedCost: source.estimatedCost,
        preparationMinutes: source.preparationMinutes,
        locked: options.locked ?? false,
        isLeftover: options.isLeftover ?? false,
        leftoverOfEntryId: options.leftoverOfEntryId ?? null,
        approvedBy: options.approvedBy ?? null,
        warnings,
    };
}

/* ------------------------------------------------------------------------------------------------
 * The generated week
 * ---------------------------------------------------------------------------------------------- */

type EntryRow = readonly [
    dayOffset: number,
    mealType: MealType,
    kind: PlanEntryKind,
    /** Meal key, recipe key, ingredient key or restaurant name, depending on `kind`. */
    sourceKey: string,
    portionFactor: number,
    /** Grams, for a `food` entry. */
    grams: number | null,
    flags: readonly ('locked' | 'leftover' | 'approved')[],
];

const WEEK_ROWS: readonly EntryRow[] = [
    // Monday — the allergen warning lives here: the oats carry almonds, and tree nuts are declared.
    [0, 'breakfast', 'recipe', 'morning_oats_dates_almonds', 1, null, []],
    [0, 'lunch', 'kitchen_meal', 'verdant_herb_garden_bowl', 1, null, []],
    [0, 'snack', 'food', 'orange', 1, 150, []],
    [0, 'dinner', 'recipe', 'spiced_lentil_pumpkin_stew', 1, null, ['locked']],

    // Tuesday — lunch is Monday's stew again, marked as a leftover rather than re-shopped for.
    [1, 'breakfast', 'recipe', 'sunrise_labneh_sourdough', 1, null, []],
    [1, 'lunch', 'recipe', 'spiced_lentil_pumpkin_stew', 1, null, ['leftover']],
    [1, 'snack', 'food', 'greek_yoghurt', 1, 170, []],
    [1, 'dinner', 'kitchen_meal', 'riverstone_turkey_hash', 1, null, []],

    // Wednesday
    [2, 'breakfast', 'recipe', 'garden_omelette_spinach', 1, null, []],
    [2, 'lunch', 'kitchen_meal', 'verdant_cauliflower_wrap', 1, null, []],
    [2, 'snack', 'food', 'dates_medjool', 1, 48, []],
    [2, 'dinner', 'kitchen_meal', 'saffron_citrus_sea_bass', 1, null, []],

    // Thursday — the dietitian signed off the dinner after the review conversation.
    [3, 'breakfast', 'recipe', 'garden_omelette_spinach', 1, null, []],
    [3, 'lunch', 'kitchen_meal', 'daily_pot_bean_chilli', 1, null, []],
    [3, 'snack', 'food', 'orange', 1, 120, []],
    [3, 'dinner', 'recipe', 'citrus_sea_bass_green_beans', 1, null, ['approved']],

    // Friday — the nutrition warning lives here: a planned meal out, estimated well above its share.
    [4, 'breakfast', 'recipe', 'sunrise_labneh_sourdough', 1, null, []],
    [4, 'lunch', 'kitchen_meal', 'saffron_harbour_prawn_bowl', 1, null, []],
    [4, 'snack', 'food', 'greek_yoghurt', 1, 150, []],
    [4, 'dinner', 'restaurant', 'Dinner with family', 1, null, []],

    // Saturday — the aubergine is a *dislike*, planned deliberately. A dislike is not an exclusion.
    [5, 'breakfast', 'recipe', 'garden_omelette_spinach', 1, null, []],
    [5, 'lunch', 'recipe', 'charred_aubergine_chickpea', 1, null, []],
    [5, 'snack', 'food', 'orange', 1, 150, []],
    [5, 'dinner', 'recipe', 'red_bean_pepper_chilli', 1.2, null, []],

    // Sunday
    [6, 'breakfast', 'recipe', 'sunrise_labneh_sourdough', 1, null, []],
    [6, 'lunch', 'kitchen_meal', 'verdant_aubergine_chickpea_bowl', 1, null, []],
    [6, 'snack', 'food', 'dates_medjool', 1, 48, []],
    [6, 'dinner', 'recipe', 'slow_braised_lamb_bulgur', 1, null, []],
];

export interface MakeWeekEntriesOptions {
    readonly planId?: MealPlanId | undefined;
    readonly weekStart?: string | undefined;
    readonly ordinalBase?: number | undefined;
    readonly targets?: readonly NutrientTarget[] | undefined;
}

export function makeWeekEntries(options: MakeWeekEntriesOptions = {}): readonly MealPlanEntry[] {
    const planId = options.planId ?? PROTOTYPE_PLAN_IDS.week;
    const weekStart = options.weekStart ?? PROTOTYPE_WEEK_START;
    const base = options.ordinalBase ?? 0;
    const entries: MealPlanEntry[] = [];

    WEEK_ROWS.forEach((row, index) => {
        const [dayOffset, mealType, kind, sourceKey, portionFactor, grams, flags] = row;
        const id = mealPlanEntryIdAt(base + index);
        const date = addDays(weekStart, dayOffset);

        const source =
            kind === 'kitchen_meal'
                ? { mealId: mealByKey(sourceKey).id }
                : kind === 'recipe'
                  ? { recipeId: recipeByKey(sourceKey).id }
                  : kind === 'food'
                    ? { foodId: ingredientByKey(sourceKey).id, grams: grams ?? 100 }
                    : { restaurantName: sourceKey };

        const leftover = flags.includes('leftover');
        // A leftover points at the entry it came from: Tuesday's lunch is Monday's dinner.
        const leftoverOf = leftover ? mealPlanEntryIdAt(base + 3) : null;

        entries.push(
            makeEntry({
                id,
                planId,
                date,
                mealType,
                kind,
                position: 0,
                portionFactor,
                locked: flags.includes('locked'),
                isLeftover: leftover,
                leftoverOfEntryId: leftoverOf,
                approvedBy: flags.includes('approved') ? dietitianByKey('layla_haddad').id : null,
                ...(options.targets === undefined ? {} : { targets: options.targets }),
                ...source,
            }),
        );
    });

    return entries;
}

export const PROTOTYPE_WEEK_ENTRIES: readonly MealPlanEntry[] = makeWeekEntries();

/** How many entry ordinals the fixture week occupies, so the store can mint above them. */
export const PROTOTYPE_WEEK_ENTRY_COUNT = WEEK_ROWS.length;

/* ------------------------------------------------------------------------------------------------
 * Projection: entries → day → week
 * ---------------------------------------------------------------------------------------------- */

/** One planner entry as an eating occasion the nutrition package can roll up. */
export function entryOccasion(entry: MealPlanEntry): MealNutrition {
    return {
        mealId: entry.mealId,
        recipeId: entry.recipeId,
        mealType: entry.mealType,
        label: entry.label,
        portionFactor: entry.portionFactor,
        facts: entry.nutrition,
        allergens: entry.allergens,
        estimatedCost: entry.estimatedCost,
    };
}

/** An empty day still has a shape; `summariseDay` refuses to invent one, so this does it explicitly. */
function emptyDaySummary(date: string, target: NutritionFacts | null): DailyNutritionSummary {
    return {
        date,
        meals: [],
        planned: makeFacts(
            {},
            { basis: 'per_day', method: 'planner.empty_day', notes: ['No entries planned.'] },
        ),
        actual: null,
        target,
        estimatedCost: null,
    };
}

export interface BuildDayOptions {
    readonly targets?: readonly NutrientTarget[] | undefined;
    readonly targetFacts?: NutritionFacts | null | undefined;
}

export function buildDay(
    planId: MealPlanId,
    date: string,
    entries: readonly MealPlanEntry[],
    options: BuildDayOptions = {},
): MealPlanDay {
    const targets = options.targets ?? PROTOTYPE_NUTRIENT_TARGETS;
    const targetFacts =
        options.targetFacts === undefined ? PROTOTYPE_DAILY_TARGET_FACTS : options.targetFacts;
    const forDay = entries
        .filter((entry) => entry.date === date)
        .slice()
        .sort(compareEntries);

    const summary =
        forDay.length === 0
            ? emptyDaySummary(date, targetFacts)
            : summariseDay({
                  date,
                  meals: forDay.map(entryOccasion),
                  target: targetFacts,
                  derivation: { method: 'planner.day_from_entries' },
              });

    return { planId, date, entries: forDay, summary, targets };
}

const MEAL_TYPE_ORDER: Readonly<Record<MealType, number>> = {
    breakfast: 0,
    lunch: 1,
    snack: 2,
    dinner: 3,
};

/** Stable order within a day: meal type first, then position, then identifier. */
export function compareEntries(left: MealPlanEntry, right: MealPlanEntry): number {
    const byType = MEAL_TYPE_ORDER[left.mealType] - MEAL_TYPE_ORDER[right.mealType];
    if (byType !== 0) return byType;
    if (left.position !== right.position) return left.position - right.position;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export interface BuildWeekOptions extends BuildDayOptions {
    readonly userId?: UserId | undefined;
    readonly state?: MealPlanState | undefined;
    readonly generatedAt?: IsoDateTime | null | undefined;
    readonly updatedAt?: IsoDateTime | undefined;
    readonly weeklyTargetFacts?: NutritionFacts | null | undefined;
}

export function buildWeek(
    planId: MealPlanId,
    weekStart: string,
    entries: readonly MealPlanEntry[],
    options: BuildWeekOptions = {},
): MealPlanWeek {
    const days = weekDates(weekStart).map((date) => buildDay(planId, date, entries, options));
    const summarised = days.filter((day) => day.entries.length > 0);

    const summary =
        summarised.length === 0
            ? {
                  weekStart,
                  days: days.map((day) => day.summary),
                  planned: makeFacts(
                      {},
                      {
                          basis: 'per_week',
                          method: 'planner.empty_week',
                          notes: ['Nothing planned.'],
                      },
                  ),
                  dailyAverage: makeFacts(
                      {},
                      {
                          basis: 'per_day',
                          method: 'planner.empty_week',
                          notes: ['Nothing planned.'],
                      },
                  ),
                  target: options.weeklyTargetFacts ?? PROTOTYPE_WEEKLY_TARGET_FACTS,
                  estimatedCost: null,
              }
            : summariseWeek({
                  weekStart,
                  days: summarised.map((day) => day.summary),
                  target:
                      options.weeklyTargetFacts === undefined
                          ? PROTOTYPE_WEEKLY_TARGET_FACTS
                          : options.weeklyTargetFacts,
                  derivation: { method: 'planner.week_from_days' },
              });

    return {
        planId,
        userId: options.userId ?? PROTOTYPE_CUSTOMER_ID,
        state: options.state ?? 'active',
        weekStart,
        days,
        summary,
        targets: options.targets ?? PROTOTYPE_NUTRIENT_TARGETS,
        generatedAt: options.generatedAt === undefined ? PROTOTYPE_NOW : options.generatedAt,
        updatedAt: options.updatedAt ?? PROTOTYPE_NOW,
    };
}

/* ------------------------------------------------------------------------------------------------
 * Grocery list and pantry
 * ---------------------------------------------------------------------------------------------- */

type PantryRow = readonly [ingredientKey: string, grams: number, bestBefore: string | null];

const PANTRY_ROWS: readonly PantryRow[] = [
    ['olive_oil', 500, null],
    ['garlic', 120, '2026-09-15'],
    ['rolled_oats', 750, '2027-01-31'],
    ['honey', 340, null],
    ['basmati_rice', 900, '2027-06-30'],
];

export function makePantry(rows: readonly PantryRow[] = PANTRY_ROWS): Pantry {
    return {
        items: rows.map(([key, grams, bestBefore]) => {
            const ingredient = ingredientByKey(key);
            return {
                ingredientId: ingredient.id,
                name: ingredient.name,
                quantity: grams,
                unit: 'g' as const,
                grams,
                bestBefore,
                updatedAt: PROTOTYPE_NOW,
            };
        }),
        updatedAt: PROTOTYPE_NOW,
    };
}

export const PROTOTYPE_PANTRY: Pantry = makePantry();

/**
 * The grocery list for a week.
 *
 * Built from the **home-prepared** entries only. A kitchen meal arrives cooked, so it buys nothing;
 * a leftover is a portion of an earlier entry's yield, so it buys nothing either — shopping for it
 * twice is exactly the defect a leftover flag exists to prevent.
 */
export function buildGroceryList(
    entries: readonly MealPlanEntry[],
    weekStart: string,
    pantry: Pantry = PROTOTYPE_PANTRY,
    ordinal = 0,
): GroceryList {
    const needed = new Map<
        IngredientId,
        { grams: number; recipeIds: RecipeId[]; ingredientKey: string }
    >();

    for (const entry of entries) {
        if (entry.kind !== 'recipe' || entry.isLeftover || entry.recipeId === null) continue;
        const recipe = recipeById(entry.recipeId);
        if (recipe === null) continue;

        for (const line of recipe.ingredients) {
            if (line.optional || line.grams === null) continue;
            const grams = (line.grams * entry.portionFactor) / recipe.servings;
            const existing = needed.get(line.ingredientId);
            if (existing === undefined) {
                const ingredient = ingredientById(line.ingredientId);
                needed.set(line.ingredientId, {
                    grams,
                    recipeIds: [recipe.id],
                    ingredientKey: ingredient?.key ?? line.name,
                });
                continue;
            }
            existing.grams += grams;
            if (!existing.recipeIds.includes(recipe.id)) existing.recipeIds.push(recipe.id);
        }
    }

    const pantryGrams = new Map(pantry.items.map((item) => [item.ingredientId, item.grams ?? 0]));

    const items: GroceryListItem[] = [...needed.entries()]
        .map(([ingredientId, entry]) => {
            const ingredient = ingredientById(ingredientId);
            const grams = Math.round(entry.grams);
            const covered = pantryGrams.get(ingredientId) ?? 0;
            return {
                ingredientId,
                name: ingredient?.name ?? entry.ingredientKey,
                quantity: grams,
                unit: 'g' as const,
                grams,
                aisle: ingredient?.aisle ?? null,
                estimatedCost: ingredient === null ? null : ingredientCost(ingredient, grams),
                inPantry: covered >= grams,
                neededForRecipeIds: entry.recipeIds,
            };
        })
        .sort((left, right) => {
            const byAisle = (left.aisle ?? '').localeCompare(right.aisle ?? '');
            return byAisle !== 0 ? byAisle : left.name.localeCompare(right.name);
        });

    const outstanding = items.filter((item) => !item.inPantry);

    return {
        id: groceryListIdAt(ordinal),
        weekStart,
        items,
        estimatedTotal: aed(
            outstanding.reduce<number>((sum, item) => sum + (item.estimatedCost?.amount ?? 0), 0),
        ),
        generatedAt: PROTOTYPE_NOW,
    };
}

export const PROTOTYPE_GROCERY_LIST: GroceryList = buildGroceryList(
    PROTOTYPE_WEEK_ENTRIES,
    PROTOTYPE_WEEK_START,
);

/** The entries of the fixture week, indexed for the tests and the store's seeding. */
export function weekEntryAt(index: number): MealPlanEntry {
    return atOrThrow(PROTOTYPE_WEEK_ENTRIES, index, 'planner entry');
}
