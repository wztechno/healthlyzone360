import type {
    AllergenCode,
    IngredientId,
    IsoDateTime,
    MealId,
    MealType,
    Money,
    RecipeId,
} from '@healthy360/domain-types';

/**
 * The nutrition-facts contracts (Prompt 2, "Nutrition facts model").
 *
 * Thirteen shapes, all of them ours. Nothing here is derived from a reference product's data model:
 * the vocabulary comes from published nutrition labelling practice (energy plus macronutrients per
 * a declared basis, with a source and a calculation timestamp), which is the same reason every
 * label in every supermarket looks alike.
 *
 * Two conventions the whole package obeys:
 *
 * - **Models use `T | null`.** An absent value is a *recorded* absence, so a screen can say
 *   "no laboratory analysis on file" rather than silently rendering nothing.
 * - **Requests use `?: T | undefined`.** `exactOptionalPropertyTypes` is on, so an optional
 *   request field genuinely means "the caller did not say".
 *
 * Nothing here performs arithmetic; see `../facts/aggregate.ts`.
 */

/** A calendar date, `YYYY-MM-DD`. Distinct from `IsoDateTime` so a day is never a moment. */
export type IsoDate = string;

/**
 * What a set of amounts is measured *per*.
 *
 * `per_100g` is the comparison basis (it is what makes two ingredients comparable at all);
 * `per_serving` is the consumption basis; the remaining four are roll-up levels in the planner.
 */
export const NUTRITION_BASES = [
    'per_serving',
    'per_100g',
    'per_recipe',
    'per_meal',
    'per_day',
    'per_week',
] as const;
export type NutritionBasis = (typeof NUTRITION_BASES)[number];

/**
 * Whether a number is what the plan *intends*, what the person *did*, or what they are *aiming at*.
 * Mixing the three in one field is how a planner ends up claiming a person ate a meal they skipped.
 */
export const NUTRITION_VALUE_KINDS = ['planned', 'actual', 'target'] as const;
export type NutritionValueKind = (typeof NUTRITION_VALUE_KINDS)[number];

/** Units nutrient amounts are expressed in. */
export const NUTRIENT_UNITS = ['kcal', 'kJ', 'g', 'mg', 'ug', 'ml', 'IU'] as const;
export type NutrientUnit = (typeof NUTRIENT_UNITS)[number];

/** Units a quantity of food may be measured in before it is converted to grams. */
export const MEASURE_UNITS = [
    'g',
    'kg',
    'ml',
    'l',
    'piece',
    'slice',
    'portion',
    'cup',
    'tbsp',
    'tsp',
] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

export const NUTRIENT_GROUPS = [
    'energy',
    'macronutrient',
    'carbohydrate_detail',
    'fat_detail',
    'mineral',
    'vitamin',
    'other',
] as const;
export type NutrientGroup = (typeof NUTRIENT_GROUPS)[number];

/** The three macronutrients an energy target is split across. */
export const MACRO_NUTRIENT_IDS = ['protein', 'carbohydrate', 'fat'] as const;
export type MacroNutrientId = (typeof MACRO_NUTRIENT_IDS)[number];

/**
 * Where a set of facts came from.
 *
 * `synthetic_prototype` is the honest label for everything in this prototype: the numbers are
 * plausible and internally consistent, and they describe no real product. It is contractual rather
 * than cosmetic — the facts panel reads this field to render its provenance line, so a synthetic
 * figure cannot be displayed as though it were a laboratory result.
 */
export const NUTRITION_SOURCE_KINDS = [
    'synthetic_prototype',
    'ingredient_derived',
    'laboratory',
    'manufacturer',
    'professional_entry',
] as const;
export type NutritionSourceKind = (typeof NUTRITION_SOURCE_KINDS)[number];

/** How a nutrient target is meant to be met. Drives the five-stop level mapping. */
export const TARGET_DIRECTIONS = ['hit', 'at_least', 'at_most'] as const;
export type TargetDirection = (typeof TARGET_DIRECTIONS)[number];

function memberOf<T extends readonly string[]>(values: T) {
    const set: ReadonlySet<string> = new Set<string>(values);
    return (value: unknown): value is T[number] => typeof value === 'string' && set.has(value);
}

export const isNutritionBasis = memberOf(NUTRITION_BASES);
export const isNutritionValueKind = memberOf(NUTRITION_VALUE_KINDS);
export const isNutrientUnit = memberOf(NUTRIENT_UNITS);
export const isMeasureUnit = memberOf(MEASURE_UNITS);
export const isNutrientGroup = memberOf(NUTRIENT_GROUPS);
export const isMacroNutrientId = memberOf(MACRO_NUTRIENT_IDS);
export const isNutritionSourceKind = memberOf(NUTRITION_SOURCE_KINDS);
export const isTargetDirection = memberOf(TARGET_DIRECTIONS);

/** An inclusive band. `min <= max` is an invariant every producer in this package upholds. */
export interface ToleranceRange {
    readonly min: number;
    readonly max: number;
}

/* -- 1 -------------------------------------------------------------------------------------- */

/**
 * The catalogue entry for a nutrient: its unit, how it is grouped on a label, and how precisely it
 * is worth stating. `precision` is the *display* precision; aggregation never rounds intermediates.
 */
export interface NutrientDefinition {
    /** Stable slug, e.g. `energy`, `protein`, `saturated_fat`, `sodium`. */
    readonly id: string;
    readonly group: NutrientGroup;
    readonly unit: NutrientUnit;
    /** British-English display name. Localised copy lives in `@healthy360/i18n`, keyed by `id`. */
    readonly displayName: string;
    /** Decimal places used when the value is rendered. */
    readonly precision: number;
    /** True for the nutrients the compact facts panel always shows. */
    readonly isCore: boolean;
    /** How a target for this nutrient is normally expressed. */
    readonly targetDirection: TargetDirection;
}

/* -- 2 -------------------------------------------------------------------------------------- */

/** One nutrient's quantity within a `NutritionFacts` set. */
export interface NutrientAmount {
    readonly nutrientId: string;
    readonly unit: NutrientUnit;
    readonly value: number;
    readonly kind: NutritionValueKind;
    /** Present when the figure is a range rather than a point (targets, estimated portions). */
    readonly tolerance: ToleranceRange | null;
}

/* -- 3 -------------------------------------------------------------------------------------- */

export interface NutritionSource {
    readonly kind: NutritionSourceKind;
    /** Human-readable provenance, e.g. `Healthy360 synthetic prototype data set`. */
    readonly label: string;
    /** Version of the source data set, so a cached figure can be invalidated deliberately. */
    readonly version: string;
    readonly calculatedAt: IsoDateTime;
}

/* -- 4 -------------------------------------------------------------------------------------- */

/**
 * How a set of facts was produced. Kept beside the numbers rather than in a sidecar table because
 * the facts panel is required to show the method and the timestamp next to the values.
 */
export interface NutritionCalculation {
    /** Identifier of the routine that produced the values, e.g. `aggregate.recipe_from_ingredients`. */
    readonly method: string;
    readonly basis: NutritionBasis;
    readonly calculatedAt: IsoDateTime;
    /** True while the figures come from the prototype engine rather than a production service. */
    readonly prototype: boolean;
    /** Human-readable description of the rounding applied, for the provenance line. */
    readonly rounding: string;
    /** Free-form notes surfaced in the "how was this worked out?" panel. */
    readonly notes: readonly string[];
}

/* -- 5 -------------------------------------------------------------------------------------- */

export interface Serving {
    /** What a person would call it: `1 bowl`, `250 g portion`. */
    readonly label: string;
    readonly quantity: number;
    readonly unit: MeasureUnit;
    /** Mass of one serving. `null` when the item is not weighable (a drink measured in ml). */
    readonly grams: number | null;
    /** Volume of one serving in millilitres, when that is the natural measure. */
    readonly millilitres: number | null;
    /** Optional household equivalent, e.g. `about 2 cups`. */
    readonly householdMeasure: string | null;
}

/* -- 6 -------------------------------------------------------------------------------------- */

/**
 * A complete set of amounts on one basis. This is the unit of exchange for the whole package: an
 * ingredient, a recipe, a meal, a day and a week are all described by one of these.
 */
export interface NutritionFacts {
    readonly basis: NutritionBasis;
    readonly kind: NutritionValueKind;
    /** The serving the amounts refer to. Always present for `per_serving`; `null` otherwise. */
    readonly serving: Serving | null;
    /** Total mass the amounts describe, when known — required to normalise to `per_100g`. */
    readonly totalGrams: number | null;
    readonly amounts: readonly NutrientAmount[];
    readonly source: NutritionSource;
    readonly calculation: NutritionCalculation;
}

/* -- 7 -------------------------------------------------------------------------------------- */

/** How much of an ingredient a recipe uses, and the reference facts for that ingredient. */
export interface IngredientQuantity {
    readonly ingredientId: IngredientId;
    readonly name: string;
    readonly quantity: number;
    readonly unit: MeasureUnit;
    /** The quantity converted to grams. `null` when the ingredient is measured by volume only. */
    readonly grams: number | null;
    /** The ingredient's reference facts, always on the `per_100g` basis. */
    readonly per100g: NutritionFacts;
    readonly allergens: readonly AllergenCode[];
    /** Optional ingredients are excluded from the default roll-up. */
    readonly optional: boolean;
    /** Estimated cost of this quantity, when the kitchen publishes one. */
    readonly estimatedCost: Money | null;
}

/* -- 8 -------------------------------------------------------------------------------------- */

export interface RecipeNutrition {
    readonly recipeId: RecipeId;
    /** The recipe version the figures were computed from; a recipe edit invalidates them. */
    readonly recipeVersion: string;
    readonly servings: number;
    readonly serving: Serving;
    readonly ingredients: readonly IngredientQuantity[];
    readonly perRecipe: NutritionFacts;
    readonly perServing: NutritionFacts;
    /** `null` when the total mass is unknown, so a per-100 g comparison cannot be made honestly. */
    readonly per100g: NutritionFacts | null;
}

/* -- 9 -------------------------------------------------------------------------------------- */

/** One eating occasion in a plan: a recipe, a marketplace meal or a planned restaurant meal. */
export interface MealNutrition {
    /** Set when the occasion is a marketplace meal. */
    readonly mealId: MealId | null;
    /** Set when the occasion is a home-prepared recipe. */
    readonly recipeId: RecipeId | null;
    readonly mealType: MealType;
    readonly label: string;
    /** Portion multiplier applied to the underlying per-serving facts. `1` is one serving. */
    readonly portionFactor: number;
    readonly facts: NutritionFacts;
    readonly allergens: readonly AllergenCode[];
    readonly estimatedCost: Money | null;
}

/* -- 10 ------------------------------------------------------------------------------------- */

export interface DailyNutritionSummary {
    readonly date: IsoDate;
    readonly meals: readonly MealNutrition[];
    /** What the plan intends for the day. */
    readonly planned: NutritionFacts;
    /** What was logged. `null` until the person records something. */
    readonly actual: NutritionFacts | null;
    /** The day's target, projected from the person's nutrition targets. */
    readonly target: NutritionFacts | null;
    readonly estimatedCost: Money | null;
}

/* -- 11 ------------------------------------------------------------------------------------- */

export interface WeeklyNutritionSummary {
    /** Monday of the week, `YYYY-MM-DD`. */
    readonly weekStart: IsoDate;
    readonly days: readonly DailyNutritionSummary[];
    /** The week's totals. */
    readonly planned: NutritionFacts;
    /**
     * The week's totals divided by the number of days. Weekly averages are how a plan is judged —
     * one heavy day inside an on-target week is not a failure, and the UI must be able to say so.
     */
    readonly dailyAverage: NutritionFacts;
    readonly target: NutritionFacts | null;
    readonly estimatedCost: Money | null;
}

/* -- 12 ------------------------------------------------------------------------------------- */

/** One macronutrient's share of an energy target. */
export interface MacroTarget {
    readonly nutrientId: MacroNutrientId;
    readonly grams: number;
    readonly kilocalories: number;
    /** Share of the energy target, 0–100, rounded to one decimal place. */
    readonly percentageOfEnergy: number;
    /** Grams per kilogram of body mass, when the split was derived that way. */
    readonly gramsPerKilogram: number | null;
    readonly tolerance: ToleranceRange;
}

/* -- 13 ------------------------------------------------------------------------------------- */

/** A target for any nutrient, macro or otherwise (fibre, sodium, a micronutrient). */
export interface NutrientTarget {
    readonly nutrientId: string;
    readonly unit: NutrientUnit;
    readonly value: number;
    readonly tolerance: ToleranceRange;
    readonly basis: NutritionBasis;
    readonly direction: TargetDirection;
    /** Short British-English sentence explaining where the figure comes from. */
    readonly rationale: string | null;
}

/* ------------------------------------------------------------------------------------------- */

/**
 * The core nutrient catalogue.
 *
 * Deliberately small: energy, the three macronutrients, fibre and the four figures a label is
 * legally expected to carry in most markets. Micronutrients are added by the fixture world, not
 * hard-coded here, so the catalogue stays a *definition* rather than a data set.
 */
export const CORE_NUTRIENT_DEFINITIONS: readonly NutrientDefinition[] = [
    {
        id: 'energy',
        group: 'energy',
        unit: 'kcal',
        displayName: 'Energy',
        precision: 0,
        isCore: true,
        targetDirection: 'hit',
    },
    {
        id: 'protein',
        group: 'macronutrient',
        unit: 'g',
        displayName: 'Protein',
        precision: 1,
        isCore: true,
        targetDirection: 'at_least',
    },
    {
        id: 'carbohydrate',
        group: 'macronutrient',
        unit: 'g',
        displayName: 'Carbohydrate',
        precision: 1,
        isCore: true,
        targetDirection: 'hit',
    },
    {
        id: 'fat',
        group: 'macronutrient',
        unit: 'g',
        displayName: 'Fat',
        precision: 1,
        isCore: true,
        targetDirection: 'hit',
    },
    {
        id: 'fibre',
        group: 'carbohydrate_detail',
        unit: 'g',
        displayName: 'Fibre',
        precision: 1,
        isCore: true,
        targetDirection: 'at_least',
    },
    {
        id: 'sugars',
        group: 'carbohydrate_detail',
        unit: 'g',
        displayName: 'Sugars',
        precision: 1,
        isCore: false,
        targetDirection: 'at_most',
    },
    {
        id: 'saturated_fat',
        group: 'fat_detail',
        unit: 'g',
        displayName: 'Saturates',
        precision: 1,
        isCore: false,
        targetDirection: 'at_most',
    },
    {
        id: 'sodium',
        group: 'mineral',
        unit: 'mg',
        displayName: 'Sodium',
        precision: 0,
        isCore: false,
        targetDirection: 'at_most',
    },
];

const CORE_NUTRIENTS_BY_ID: ReadonlyMap<string, NutrientDefinition> = new Map(
    CORE_NUTRIENT_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function coreNutrientDefinition(nutrientId: string): NutrientDefinition | null {
    return CORE_NUTRIENTS_BY_ID.get(nutrientId) ?? null;
}

/**
 * Atwater general factors: the energy each gram of a macronutrient contributes.
 *
 * Published, standard and unattributable to any one product — Atwater, W.O. & Woods, C.D.,
 * *The Chemical Composition of American Food Materials* (US Office of Experiment Stations, 1896);
 * still the basis of FAO food-energy conversion guidance (FAO, *Food Energy — Methods of Analysis
 * and Conversion Factors*, FAO Food and Nutrition Paper 77, 2003).
 */
export const ENERGY_PER_GRAM: Readonly<Record<MacroNutrientId, number>> = {
    protein: 4,
    carbohydrate: 4,
    fat: 9,
};

/** 1 kcal = 4.184 kJ (thermochemical calorie), the factor food labelling uses. */
export const KILOJOULES_PER_KILOCALORIE = 4.184;

/** Finds one nutrient inside a facts set. Returns `null` rather than throwing: absence is normal. */
export function findAmount(facts: NutritionFacts, nutrientId: string): NutrientAmount | null {
    return facts.amounts.find((amount) => amount.nutrientId === nutrientId) ?? null;
}

/** The numeric value of one nutrient, or `0` when the set does not carry it. */
export function amountValue(facts: NutritionFacts, nutrientId: string): number {
    return findAmount(facts, nutrientId)?.value ?? 0;
}
