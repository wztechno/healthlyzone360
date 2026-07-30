import { addMoney } from '@healthy360/domain-types';
import type { IsoDateTime, MealType, Money, RecipeId } from '@healthy360/domain-types';

import {
    coreNutrientDefinition,
    type DailyNutritionSummary,
    type IngredientQuantity,
    type IsoDate,
    type MealNutrition,
    type NutrientAmount,
    type NutritionBasis,
    type NutritionCalculation,
    type NutritionFacts,
    type NutritionSource,
    type NutritionSourceKind,
    type NutritionValueKind,
    type RecipeNutrition,
    type Serving,
    type ToleranceRange,
    type WeeklyNutritionSummary,
} from './model.ts';

/**
 * Scaling and roll-up: ingredient → recipe → meal → day → week.
 *
 * ## Rounding
 *
 * Every function here holds values at full double precision through *all* intermediate steps and
 * rounds exactly once, at the point a figure becomes a displayed number, using
 * {@link roundTo} — half away from zero at the nutrient's declared display precision.
 *
 * Rounding early is the usual cause of a weekly total that disagrees with the sum of its days by a
 * gram or two; rounding half *up* (plain `Math.round`) is asymmetric about zero and makes results
 * depend on sign. Neither is acceptable in figures a person may be told to eat to, so both are
 * ruled out here rather than left to each caller.
 *
 * `roundTo` also nudges away the binary representation error before deciding a tie, so
 * `roundTo(1.005, 2)` is `1.01` rather than `1` — deterministic across engines and platforms.
 */

export const ROUNDING_POLICY =
    'Held at full precision through every intermediate step, then rounded once — half away from ' +
    'zero — at each nutrient’s declared display precision.';

/** Display precision used for a nutrient with no entry in the core catalogue. */
export const DEFAULT_NUTRIENT_PRECISION = 1;

export class NutrientUnitMismatchError extends Error {
    readonly nutrientId: string;
    readonly left: string;
    readonly right: string;

    constructor(nutrientId: string, left: string, right: string) {
        super(
            `Cannot combine ${nutrientId} expressed in ${left} with the same nutrient in ${right}. ` +
                'Convert to a single unit before aggregating.',
        );
        this.name = 'NutrientUnitMismatchError';
        this.nutrientId = nutrientId;
        this.left = left;
        this.right = right;
    }
}

export class NutritionAggregationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NutritionAggregationError';
    }
}

/**
 * Rounds half away from zero at `decimals` places, correcting binary representation error first.
 *
 * Deterministic: the same inputs give the same output on every engine, which is what makes the
 * engine's known-input/known-output tests meaningful.
 */
export function roundTo(value: number, decimals: number): number {
    if (!Number.isFinite(value)) return value;
    const factor = 10 ** decimals;
    const scaled = value * factor;
    // Four epsilons of headroom: enough to absorb the representation error of a single multiply,
    // far too little to move a value that is genuinely below the tie.
    const nudged = scaled + Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON * 4;
    const rounded = nudged >= 0 ? Math.floor(nudged + 0.5) : Math.ceil(nudged - 0.5);
    // `+ 0` normalises -0 to 0 so equality assertions behave.
    return rounded / factor + 0;
}

/** The display precision for a nutrient, from the core catalogue or the default. */
export function precisionFor(nutrientId: string): number {
    return coreNutrientDefinition(nutrientId)?.precision ?? DEFAULT_NUTRIENT_PRECISION;
}

function scaleTolerance(tolerance: ToleranceRange | null, factor: number): ToleranceRange | null {
    if (tolerance === null) return null;
    const min = tolerance.min * factor;
    const max = tolerance.max * factor;
    // A negative factor would invert the band; the package never produces one, but ordering the
    // pair here means the invariant `min <= max` holds unconditionally.
    return min <= max ? { min, max } : { min: max, max: min };
}

/* ------------------------------------------------------------------------------------------------
 * Source and calculation provenance
 * ---------------------------------------------------------------------------------------------- */

export interface DerivationOptions {
    /** Identifier of the routine, recorded in `NutritionCalculation.method`. */
    readonly method?: string | undefined;
    /** Overrides the merged source. Supply one when the caller knows better than the inputs do. */
    readonly source?: NutritionSource | undefined;
    readonly calculatedAt?: IsoDateTime | undefined;
    readonly prototype?: boolean | undefined;
    readonly notes?: readonly string[] | undefined;
}

/**
 * Combines the provenance of several inputs into one.
 *
 * Rule: if every input agrees on a source kind, the result keeps it — a recipe built entirely from
 * synthetic prototype ingredients is still synthetic prototype data, and must keep saying so.
 * Mixed inputs collapse to `ingredient_derived`, which is the only claim that stays true.
 */
export function mergeSources(sources: readonly NutritionSource[]): NutritionSource {
    if (sources.length === 0) {
        throw new NutritionAggregationError('Cannot merge provenance with no sources.');
    }
    const first = sources[0]!;
    const kinds = new Set<NutritionSourceKind>(sources.map((source) => source.kind));
    const labels = [...new Set(sources.map((source) => source.label))];
    const versions = [...new Set(sources.map((source) => source.version))];
    const calculatedAt = sources
        .map((source) => source.calculatedAt)
        .reduce((latest, current) => (current > latest ? current : latest), first.calculatedAt);

    return {
        kind: kinds.size === 1 ? first.kind : 'ingredient_derived',
        label: labels.length === 1 ? labels[0]! : `Derived from ${labels.length} sources`,
        version: versions.length === 1 ? versions[0]! : 'mixed',
        calculatedAt,
    };
}

function calculationFor(
    basis: NutritionBasis,
    inputs: readonly NutritionCalculation[],
    options: DerivationOptions,
    fallbackMethod: string,
): NutritionCalculation {
    const calculatedAt =
        options.calculatedAt ??
        inputs
            .map((calculation) => calculation.calculatedAt)
            .reduce<string | null>(
                (latest, current) => (latest === null || current > latest ? current : latest),
                null,
            ) ??
        '1970-01-01T00:00:00.000Z';

    return {
        method: options.method ?? fallbackMethod,
        basis,
        calculatedAt,
        prototype: options.prototype ?? inputs.some((calculation) => calculation.prototype),
        rounding: ROUNDING_POLICY,
        notes: options.notes ?? [],
    };
}

/* ------------------------------------------------------------------------------------------------
 * Scaling
 * ---------------------------------------------------------------------------------------------- */

export interface ScaleOptions extends DerivationOptions {
    /** The basis the scaled figures describe. Defaults to the input's basis. */
    readonly basis?: NutritionBasis | undefined;
    readonly kind?: NutritionValueKind | undefined;
    readonly serving?: Serving | null | undefined;
}

/**
 * Multiplies every amount (and every tolerance band) by `factor`.
 *
 * This is the one primitive the rest of the module is built from: a portion adjustment, a serving
 * split and a per-100 g normalisation are all the same operation with a different factor.
 */
export function scaleFacts(
    facts: NutritionFacts,
    factor: number,
    options: ScaleOptions = {},
): NutritionFacts {
    if (!Number.isFinite(factor) || factor < 0) {
        throw new NutritionAggregationError(
            `Scale factor must be a finite non-negative number, received ${String(factor)}.`,
        );
    }

    const basis = options.basis ?? facts.basis;
    const amounts: readonly NutrientAmount[] = facts.amounts.map((amount) => ({
        nutrientId: amount.nutrientId,
        unit: amount.unit,
        value: amount.value * factor,
        kind: options.kind ?? amount.kind,
        tolerance: scaleTolerance(amount.tolerance, factor),
    }));

    return {
        basis,
        kind: options.kind ?? facts.kind,
        serving: options.serving === undefined ? facts.serving : options.serving,
        totalGrams: facts.totalGrams === null ? null : facts.totalGrams * factor,
        amounts,
        source: options.source ?? facts.source,
        calculation: calculationFor(basis, [facts.calculation], options, 'aggregate.scale'),
    };
}

/**
 * Re-expresses a set of facts per 100 grams, the only basis on which two foods can be compared.
 *
 * Requires a known total mass. A drink described only in millilitres has none, so the function
 * refuses rather than inventing a density.
 */
export function normaliseToPer100g(
    facts: NutritionFacts,
    options: DerivationOptions = {},
): NutritionFacts {
    const totalGrams = facts.totalGrams;
    if (totalGrams === null || totalGrams <= 0) {
        throw new NutritionAggregationError(
            'Cannot normalise to per-100 g without a positive total mass.',
        );
    }
    return scaleFacts(facts, 100 / totalGrams, {
        ...options,
        basis: 'per_100g',
        serving: null,
        method: options.method ?? 'aggregate.normalise_per_100g',
    });
}

/** Rounds every amount to its nutrient's display precision. Call this at the display boundary. */
export function roundFacts(facts: NutritionFacts): NutritionFacts {
    return {
        ...facts,
        amounts: facts.amounts.map((amount) => {
            const decimals = precisionFor(amount.nutrientId);
            return {
                ...amount,
                value: roundTo(amount.value, decimals),
                tolerance:
                    amount.tolerance === null
                        ? null
                        : {
                              min: roundTo(amount.tolerance.min, decimals),
                              max: roundTo(amount.tolerance.max, decimals),
                          },
            };
        }),
    };
}

/* ------------------------------------------------------------------------------------------------
 * Summation
 * ---------------------------------------------------------------------------------------------- */

export interface SumOptions extends DerivationOptions {
    readonly basis: NutritionBasis;
    readonly kind?: NutritionValueKind | undefined;
    readonly serving?: Serving | null | undefined;
}

/**
 * Adds several sets of facts together, nutrient by nutrient.
 *
 * A nutrient present in one input and absent from another is treated as zero in the second: a
 * recipe that does not declare sodium contributes no sodium, which is the only reading that keeps
 * a total meaningful. Two inputs stating the same nutrient in *different units* is a data defect
 * rather than an edge case, so it throws.
 */
export function sumFacts(inputs: readonly NutritionFacts[], options: SumOptions): NutritionFacts {
    if (inputs.length === 0) {
        throw new NutritionAggregationError('Cannot sum an empty list of nutrition facts.');
    }

    const totals = new Map<
        string,
        { unit: string; value: number; tolerance: ToleranceRange | null }
    >();

    for (const facts of inputs) {
        for (const amount of facts.amounts) {
            const existing = totals.get(amount.nutrientId);
            if (existing === undefined) {
                totals.set(amount.nutrientId, {
                    unit: amount.unit,
                    value: amount.value,
                    tolerance: amount.tolerance === null ? null : { ...amount.tolerance },
                });
                continue;
            }
            if (existing.unit !== amount.unit) {
                throw new NutrientUnitMismatchError(amount.nutrientId, existing.unit, amount.unit);
            }
            existing.value += amount.value;
            if (amount.tolerance !== null) {
                existing.tolerance =
                    existing.tolerance === null
                        ? { ...amount.tolerance }
                        : {
                              min: existing.tolerance.min + amount.tolerance.min,
                              max: existing.tolerance.max + amount.tolerance.max,
                          };
            }
        }
    }

    const kind = options.kind ?? inputs[0]!.kind;
    const knownMasses = inputs.map((facts) => facts.totalGrams);
    const totalGrams = knownMasses.some((grams) => grams === null)
        ? null
        : knownMasses.reduce<number>((sum, grams) => sum + (grams ?? 0), 0);

    return {
        basis: options.basis,
        kind,
        serving: options.serving ?? null,
        totalGrams,
        // Insertion order is the order nutrients were first seen, which keeps output deterministic.
        amounts: [...totals].map(([nutrientId, total]) => ({
            nutrientId,
            unit: total.unit as NutrientAmount['unit'],
            value: total.value,
            kind,
            tolerance: total.tolerance,
        })),
        source: options.source ?? mergeSources(inputs.map((facts) => facts.source)),
        calculation: calculationFor(
            options.basis,
            inputs.map((facts) => facts.calculation),
            options,
            'aggregate.sum',
        ),
    };
}

/**
 * Adds a list of costs. `null` when any element is unknown — a partial total is worse than none,
 * because a person reads it as the whole basket. Mixed currencies throw (`CurrencyMismatchError`).
 */
export function sumCosts(costs: readonly (Money | null)[]): Money | null {
    if (costs.length === 0) return null;
    if (costs.some((cost) => cost === null)) return null;
    const known = costs as readonly Money[];
    return known.slice(1).reduce<Money>((total, cost) => addMoney(total, cost), known[0]!);
}

/* ------------------------------------------------------------------------------------------------
 * Ingredient → recipe
 * ---------------------------------------------------------------------------------------------- */

/**
 * The contribution one ingredient quantity makes, scaled from its per-100 g reference facts.
 * Requires the quantity in grams; a volume-only ingredient has no defensible mass.
 */
export function ingredientContribution(
    ingredient: IngredientQuantity,
    options: DerivationOptions = {},
): NutritionFacts {
    if (ingredient.grams === null) {
        throw new NutritionAggregationError(
            `Ingredient ${ingredient.name} has no mass in grams, so its contribution cannot be scaled.`,
        );
    }
    if (ingredient.per100g.basis !== 'per_100g') {
        throw new NutritionAggregationError(
            `Ingredient ${ingredient.name} must carry per-100 g reference facts, received ${ingredient.per100g.basis}.`,
        );
    }
    return scaleFacts(ingredient.per100g, ingredient.grams / 100, {
        ...options,
        basis: 'per_recipe',
        serving: null,
        method: options.method ?? 'aggregate.ingredient_contribution',
    });
}

export interface RecipeNutritionInput {
    readonly recipeId: RecipeId;
    readonly recipeVersion: string;
    readonly servings: number;
    readonly serving: Serving;
    readonly ingredients: readonly IngredientQuantity[];
    /** Optional ingredients are excluded unless this is `true`. */
    readonly includeOptional?: boolean | undefined;
    readonly derivation?: DerivationOptions | undefined;
}

/** Rolls a recipe's ingredients up into per-recipe, per-serving and (where possible) per-100 g. */
export function recipeNutritionFromIngredients(input: RecipeNutritionInput): RecipeNutrition {
    if (!Number.isFinite(input.servings) || input.servings <= 0) {
        throw new NutritionAggregationError(
            `A recipe must yield a positive number of servings, received ${String(input.servings)}.`,
        );
    }

    const included = input.ingredients.filter(
        (ingredient) => input.includeOptional === true || !ingredient.optional,
    );
    if (included.length === 0) {
        throw new NutritionAggregationError(
            'A recipe needs at least one included ingredient to be aggregated.',
        );
    }

    const derivation = input.derivation ?? {};
    const contributions = included.map((ingredient) => ingredientContribution(ingredient));

    const perRecipe = sumFacts(contributions, {
        ...derivation,
        basis: 'per_recipe',
        kind: 'planned',
        method: derivation.method ?? 'aggregate.recipe_from_ingredients',
    });

    const perServing = scaleFacts(perRecipe, 1 / input.servings, {
        ...derivation,
        basis: 'per_serving',
        serving: input.serving,
        method: 'aggregate.recipe_per_serving',
    });

    const per100g =
        perRecipe.totalGrams !== null && perRecipe.totalGrams > 0
            ? normaliseToPer100g(perRecipe, derivation)
            : null;

    return {
        recipeId: input.recipeId,
        recipeVersion: input.recipeVersion,
        servings: input.servings,
        serving: input.serving,
        ingredients: input.ingredients,
        perRecipe,
        perServing,
        per100g,
    };
}

/* ------------------------------------------------------------------------------------------------
 * Recipe / meal → meal occasion
 * ---------------------------------------------------------------------------------------------- */

export interface MealNutritionInput {
    readonly mealType: MealType;
    readonly label: string;
    /** `1` is one serving. The planner's portion control writes this. */
    readonly portionFactor?: number | undefined;
    readonly mealId?: MealNutrition['mealId'] | undefined;
    readonly recipeId?: RecipeId | undefined;
    readonly allergens?: MealNutrition['allergens'] | undefined;
    /** Cost of one serving; scaled by the portion factor and rounded to whole minor units. */
    readonly costPerServing?: Money | null | undefined;
    readonly derivation?: DerivationOptions | undefined;
}

/**
 * Turns per-serving facts into one planned eating occasion.
 *
 * The portion factor scales both the nutrition and the cost. Cost is rounded to whole minor units
 * once, here, because money is integral by construction (`@healthy360/domain-types`).
 */
export function mealNutritionFromServing(
    perServing: NutritionFacts,
    input: MealNutritionInput,
): MealNutrition {
    if (perServing.basis !== 'per_serving') {
        throw new NutritionAggregationError(
            `A meal occasion is built from per-serving facts, received ${perServing.basis}.`,
        );
    }
    const portionFactor = input.portionFactor ?? 1;
    const derivation = input.derivation ?? {};

    const facts = scaleFacts(perServing, portionFactor, {
        ...derivation,
        basis: 'per_meal',
        method: derivation.method ?? 'aggregate.meal_from_serving',
    });

    const cost = input.costPerServing ?? null;

    return {
        mealId: input.mealId ?? null,
        recipeId: input.recipeId ?? null,
        mealType: input.mealType,
        label: input.label,
        portionFactor,
        facts,
        allergens: input.allergens ?? [],
        estimatedCost:
            cost === null
                ? null
                : { amount: Math.round(cost.amount * portionFactor), currency: cost.currency },
    };
}

/* ------------------------------------------------------------------------------------------------
 * Meal → day → week
 * ---------------------------------------------------------------------------------------------- */

export interface DailySummaryInput {
    readonly date: IsoDate;
    readonly meals: readonly MealNutrition[];
    readonly actual?: NutritionFacts | null | undefined;
    readonly target?: NutritionFacts | null | undefined;
    readonly derivation?: DerivationOptions | undefined;
}

export function summariseDay(input: DailySummaryInput): DailyNutritionSummary {
    if (input.meals.length === 0) {
        throw new NutritionAggregationError(
            `Day ${input.date} has no meals, so it has no planned nutrition to summarise.`,
        );
    }
    const derivation = input.derivation ?? {};
    const planned = sumFacts(
        input.meals.map((meal) => meal.facts),
        {
            ...derivation,
            basis: 'per_day',
            kind: 'planned',
            method: derivation.method ?? 'aggregate.day_from_meals',
        },
    );

    return {
        date: input.date,
        meals: input.meals,
        planned,
        actual: input.actual ?? null,
        target: input.target ?? null,
        estimatedCost: sumCosts(input.meals.map((meal) => meal.estimatedCost)),
    };
}

export interface WeeklySummaryInput {
    readonly weekStart: IsoDate;
    readonly days: readonly DailyNutritionSummary[];
    readonly target?: NutritionFacts | null | undefined;
    readonly derivation?: DerivationOptions | undefined;
}

/**
 * Rolls days up into a week and its daily average.
 *
 * The average divides by the number of days *present*, not by seven: a partially planned week must
 * not read as though the unplanned days were fasted.
 */
export function summariseWeek(input: WeeklySummaryInput): WeeklyNutritionSummary {
    if (input.days.length === 0) {
        throw new NutritionAggregationError(
            `Week ${input.weekStart} has no days, so it has no nutrition to summarise.`,
        );
    }
    const derivation = input.derivation ?? {};
    const planned = sumFacts(
        input.days.map((day) => day.planned),
        {
            ...derivation,
            basis: 'per_week',
            kind: 'planned',
            method: derivation.method ?? 'aggregate.week_from_days',
        },
    );

    const dailyAverage = scaleFacts(planned, 1 / input.days.length, {
        ...derivation,
        basis: 'per_day',
        method: 'aggregate.week_daily_average',
    });

    return {
        weekStart: input.weekStart,
        days: input.days,
        planned,
        dailyAverage,
        target: input.target ?? null,
        estimatedCost: sumCosts(input.days.map((day) => day.estimatedCost)),
    };
}
