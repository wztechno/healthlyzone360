import { IngredientId, RecipeId, money } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import {
    NutrientUnitMismatchError,
    NutritionAggregationError,
    ingredientContribution,
    mealNutritionFromServing,
    mergeSources,
    normaliseToPer100g,
    recipeNutritionFromIngredients,
    roundFacts,
    roundTo,
    scaleFacts,
    sumCosts,
    sumFacts,
    summariseDay,
    summariseWeek,
} from './aggregate.ts';
import { amountValue, findAmount } from './model.ts';
import type { IngredientQuantity, NutritionFacts, NutritionSource, Serving } from './model.ts';

const CALCULATED_AT = '2026-01-15T09:30:00.000Z';

const SYNTHETIC_SOURCE: NutritionSource = {
    kind: 'synthetic_prototype',
    label: 'Healthy360 synthetic prototype data set',
    version: '1.0.0',
    calculatedAt: CALCULATED_AT,
};

function per100g(
    values: Readonly<Record<string, number>>,
    source: NutritionSource = SYNTHETIC_SOURCE,
): NutritionFacts {
    return {
        basis: 'per_100g',
        kind: 'planned',
        serving: null,
        totalGrams: 100,
        amounts: Object.entries(values).map(([nutrientId, value]) => ({
            nutrientId,
            unit: nutrientId === 'energy' ? ('kcal' as const) : ('g' as const),
            value,
            kind: 'planned' as const,
            tolerance: null,
        })),
        source,
        calculation: {
            method: 'fixture',
            basis: 'per_100g',
            calculatedAt: CALCULATED_AT,
            prototype: true,
            rounding: 'none',
            notes: [],
        },
    };
}

function ingredient(
    name: string,
    grams: number,
    values: Readonly<Record<string, number>>,
    overrides: Partial<IngredientQuantity> = {},
): IngredientQuantity {
    return {
        ingredientId: IngredientId.unsafe(`ingredient-${name}`),
        name,
        quantity: grams,
        unit: 'g',
        grams,
        per100g: per100g(values),
        allergens: [],
        optional: false,
        estimatedCost: null,
        ...overrides,
    };
}

const SERVING: Serving = {
    label: '1 bowl',
    quantity: 1,
    unit: 'portion',
    grams: 250,
    millilitres: null,
    householdMeasure: null,
};

const CHICKEN = { energy: 165, protein: 31, carbohydrate: 0, fat: 3.6 };
const RICE = { energy: 130, protein: 2.7, carbohydrate: 28, fat: 0.3 };

describe('roundTo', () => {
    it.each([
        [0.5, 0, 1],
        [1.5, 0, 2],
        [2.5, 0, 3],
        [-0.5, 0, -1],
        [-2.5, 0, -3],
        [0, 0, 0],
        [-0, 0, 0],
    ])('rounds %s half away from zero to %s decimals → %s', (value, decimals, expected) => {
        expect(roundTo(value, decimals)).toBe(expected);
    });

    it.each([
        [1.005, 2, 1.01],
        [2.675, 2, 2.68],
        [1.0049, 2, 1],
        [24.71, 0, 25],
        [196.5, 0, 197],
    ])(
        'corrects binary representation error: roundTo(%s, %s) === %s',
        (value, decimals, expected) => {
            expect(roundTo(value, decimals)).toBe(expected);
        },
    );

    it('passes non-finite values through unchanged', () => {
        expect(roundTo(Number.NaN, 2)).toBeNaN();
        expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(Number.POSITIVE_INFINITY);
    });

    it('is deterministic across repeated calls', () => {
        for (let index = 0; index < 100; index += 1) {
            expect(roundTo(1 / 3, 4)).toBe(0.3333);
        }
    });
});

describe('scaleFacts', () => {
    const base = per100g(CHICKEN);

    it('multiplies every amount by the factor', () => {
        const doubled = scaleFacts(base, 2);
        expect(amountValue(doubled, 'energy')).toBe(330);
        expect(amountValue(doubled, 'protein')).toBe(62);
        expect(doubled.totalGrams).toBe(200);
    });

    it('scales tolerance bands with the amounts', () => {
        const withTolerance: NutritionFacts = {
            ...base,
            amounts: [
                {
                    nutrientId: 'energy',
                    unit: 'kcal',
                    value: 100,
                    kind: 'target',
                    tolerance: { min: 90, max: 110 },
                },
            ],
        };
        const scaled = scaleFacts(withTolerance, 3);
        expect(findAmount(scaled, 'energy')?.tolerance).toEqual({ min: 270, max: 330 });
    });

    it('records the requested basis and keeps the source', () => {
        const scaled = scaleFacts(base, 0.5, { basis: 'per_serving', serving: SERVING });
        expect(scaled.basis).toBe('per_serving');
        expect(scaled.calculation.basis).toBe('per_serving');
        expect(scaled.serving).toBe(SERVING);
        expect(scaled.source).toBe(base.source);
    });

    it('rejects a negative or non-finite factor', () => {
        expect(() => scaleFacts(base, -1)).toThrow(NutritionAggregationError);
        expect(() => scaleFacts(base, Number.NaN)).toThrow(NutritionAggregationError);
    });
});

describe('normaliseToPer100g', () => {
    it('re-expresses facts per 100 grams', () => {
        const perRecipe: NutritionFacts = {
            ...per100g({ energy: 720, protein: 70 }),
            basis: 'per_recipe',
            totalGrams: 500,
        };
        const normalised = normaliseToPer100g(perRecipe);
        expect(normalised.basis).toBe('per_100g');
        expect(normalised.totalGrams).toBe(100);
        expect(amountValue(normalised, 'energy')).toBe(144);
        expect(amountValue(normalised, 'protein')).toBe(14);
    });

    it('refuses when the total mass is unknown, rather than inventing a density', () => {
        const noMass: NutritionFacts = { ...per100g({ energy: 100 }), totalGrams: null };
        expect(() => normaliseToPer100g(noMass)).toThrow(NutritionAggregationError);
    });
});

describe('sumFacts', () => {
    it('adds nutrient by nutrient, treating an absent nutrient as zero', () => {
        const a = per100g({ energy: 100, protein: 10 });
        const b = per100g({ energy: 50 });
        const total = sumFacts([a, b], { basis: 'per_day' });
        expect(amountValue(total, 'energy')).toBe(150);
        expect(amountValue(total, 'protein')).toBe(10);
        expect(total.basis).toBe('per_day');
    });

    it('adds known masses and gives up on the total when one is unknown', () => {
        const known = per100g({ energy: 100 });
        const unknown: NutritionFacts = { ...per100g({ energy: 100 }), totalGrams: null };
        expect(sumFacts([known, known], { basis: 'per_day' }).totalGrams).toBe(200);
        expect(sumFacts([known, unknown], { basis: 'per_day' }).totalGrams).toBeNull();
    });

    it('throws when the same nutrient arrives in two different units', () => {
        const grams = per100g({ sodium: 1 });
        const milligrams: NutritionFacts = {
            ...grams,
            amounts: [
                {
                    nutrientId: 'sodium',
                    unit: 'mg',
                    value: 1000,
                    kind: 'planned',
                    tolerance: null,
                },
            ],
        };
        expect(() => sumFacts([grams, milligrams], { basis: 'per_day' })).toThrow(
            NutrientUnitMismatchError,
        );
    });

    it('refuses an empty list', () => {
        expect(() => sumFacts([], { basis: 'per_day' })).toThrow(NutritionAggregationError);
    });

    it('produces amounts in first-seen order, so output is deterministic', () => {
        const a = per100g({ protein: 1, energy: 2 });
        const b = per100g({ fat: 3 });
        const total = sumFacts([a, b], { basis: 'per_day' });
        expect(total.amounts.map((amount) => amount.nutrientId)).toEqual([
            'protein',
            'energy',
            'fat',
        ]);
    });
});

describe('mergeSources', () => {
    it('keeps a shared kind — synthetic ingredients make a synthetic recipe', () => {
        expect(mergeSources([SYNTHETIC_SOURCE, SYNTHETIC_SOURCE]).kind).toBe('synthetic_prototype');
    });

    it('collapses mixed kinds to ingredient_derived, the only claim still true', () => {
        const laboratory: NutritionSource = {
            kind: 'laboratory',
            label: 'Lab panel',
            version: '2.0.0',
            calculatedAt: '2026-02-01T00:00:00.000Z',
        };
        const merged = mergeSources([SYNTHETIC_SOURCE, laboratory]);
        expect(merged.kind).toBe('ingredient_derived');
        expect(merged.version).toBe('mixed');
        expect(merged.calculatedAt).toBe('2026-02-01T00:00:00.000Z');
        expect(merged.label).toBe('Derived from 2 sources');
    });

    it('refuses to merge nothing', () => {
        expect(() => mergeSources([])).toThrow(NutritionAggregationError);
    });
});

describe('ingredientContribution', () => {
    it('scales the per-100 g reference facts by the quantity', () => {
        const contribution = ingredientContribution(ingredient('chicken', 200, CHICKEN));
        expect(amountValue(contribution, 'energy')).toBe(330);
        expect(contribution.basis).toBe('per_recipe');
        expect(contribution.totalGrams).toBe(200);
    });

    it('refuses an ingredient with no mass', () => {
        expect(() =>
            ingredientContribution(ingredient('stock', 200, CHICKEN, { grams: null })),
        ).toThrow(NutritionAggregationError);
    });

    it('refuses reference facts that are not per-100 g', () => {
        const wrongBasis = ingredient('chicken', 200, CHICKEN, {
            per100g: { ...per100g(CHICKEN), basis: 'per_serving' },
        });
        expect(() => ingredientContribution(wrongBasis)).toThrow(NutritionAggregationError);
    });
});

describe('recipeNutritionFromIngredients', () => {
    const recipe = recipeNutritionFromIngredients({
        recipeId: RecipeId.unsafe('recipe-chicken-rice'),
        recipeVersion: '1',
        servings: 2,
        serving: SERVING,
        ingredients: [ingredient('chicken', 200, CHICKEN), ingredient('rice', 300, RICE)],
    });

    it('sums the ingredients into per-recipe totals', () => {
        expect(amountValue(recipe.perRecipe, 'energy')).toBe(720);
        expect(amountValue(recipe.perRecipe, 'carbohydrate')).toBe(84);
        expect(amountValue(recipe.perRecipe, 'protein')).toBeCloseTo(70.1, 10);
        expect(recipe.perRecipe.totalGrams).toBe(500);
    });

    it('divides by the yield for per-serving figures', () => {
        expect(recipe.perServing.basis).toBe('per_serving');
        expect(amountValue(recipe.perServing, 'energy')).toBe(360);
        expect(recipe.perServing.totalGrams).toBe(250);
        expect(recipe.perServing.serving).toBe(SERVING);
    });

    it('normalises to per 100 g for comparison', () => {
        expect(recipe.per100g).not.toBeNull();
        expect(amountValue(recipe.per100g!, 'energy')).toBe(144);
        expect(recipe.per100g!.totalGrams).toBe(100);
    });

    it('keeps synthetic provenance all the way up', () => {
        expect(recipe.perRecipe.source.kind).toBe('synthetic_prototype');
        expect(recipe.perServing.source.kind).toBe('synthetic_prototype');
    });

    it('excludes optional ingredients unless asked', () => {
        const withOptional = recipeNutritionFromIngredients({
            recipeId: RecipeId.unsafe('recipe-chicken-rice'),
            recipeVersion: '1',
            servings: 2,
            serving: SERVING,
            ingredients: [
                ingredient('chicken', 200, CHICKEN),
                ingredient('rice', 300, RICE),
                ingredient(
                    'oil',
                    10,
                    { energy: 884, protein: 0, carbohydrate: 0, fat: 100 },
                    {
                        optional: true,
                    },
                ),
            ],
        });
        expect(amountValue(withOptional.perRecipe, 'energy')).toBe(720);

        const including = recipeNutritionFromIngredients({
            recipeId: RecipeId.unsafe('recipe-chicken-rice'),
            recipeVersion: '1',
            servings: 2,
            serving: SERVING,
            includeOptional: true,
            ingredients: [
                ingredient('chicken', 200, CHICKEN),
                ingredient('rice', 300, RICE),
                ingredient(
                    'oil',
                    10,
                    { energy: 884, protein: 0, carbohydrate: 0, fat: 100 },
                    {
                        optional: true,
                    },
                ),
            ],
        });
        expect(amountValue(including.perRecipe, 'energy')).toBeCloseTo(808.4, 6);
    });

    it('rejects a non-positive yield and an empty ingredient list', () => {
        expect(() =>
            recipeNutritionFromIngredients({
                recipeId: RecipeId.unsafe('recipe-x'),
                recipeVersion: '1',
                servings: 0,
                serving: SERVING,
                ingredients: [ingredient('chicken', 200, CHICKEN)],
            }),
        ).toThrow(NutritionAggregationError);

        expect(() =>
            recipeNutritionFromIngredients({
                recipeId: RecipeId.unsafe('recipe-x'),
                recipeVersion: '1',
                servings: 2,
                serving: SERVING,
                ingredients: [],
            }),
        ).toThrow(NutritionAggregationError);
    });
});

describe('roundFacts', () => {
    it('rounds each nutrient to its declared display precision', () => {
        const facts = per100g({ energy: 164.6, protein: 30.94, sodium: 74.4 });
        const rounded = roundFacts(facts);
        expect(amountValue(rounded, 'energy')).toBe(165);
        expect(amountValue(rounded, 'protein')).toBe(30.9);
        expect(amountValue(rounded, 'sodium')).toBe(74);
    });

    it('rounds tolerance bands too', () => {
        const facts: NutritionFacts = {
            ...per100g({ energy: 100 }),
            amounts: [
                {
                    nutrientId: 'energy',
                    unit: 'kcal',
                    value: 100.4,
                    kind: 'target',
                    tolerance: { min: 90.4, max: 110.6 },
                },
            ],
        };
        expect(findAmount(roundFacts(facts), 'energy')?.tolerance).toEqual({ min: 90, max: 111 });
    });
});

describe('meal, day and week roll-up', () => {
    const recipe = recipeNutritionFromIngredients({
        recipeId: RecipeId.unsafe('recipe-chicken-rice'),
        recipeVersion: '1',
        servings: 2,
        serving: SERVING,
        ingredients: [ingredient('chicken', 200, CHICKEN), ingredient('rice', 300, RICE)],
    });

    const lunch = mealNutritionFromServing(recipe.perServing, {
        mealType: 'lunch',
        label: 'Chicken and rice bowl',
        recipeId: recipe.recipeId,
        costPerServing: money(1800, 'AED'),
    });

    it('applies the portion factor to nutrition and cost alike', () => {
        const large = mealNutritionFromServing(recipe.perServing, {
            mealType: 'dinner',
            label: 'Large bowl',
            portionFactor: 1.5,
            costPerServing: money(1800, 'AED'),
        });
        expect(large.facts.basis).toBe('per_meal');
        expect(amountValue(large.facts, 'energy')).toBe(540);
        expect(large.estimatedCost).toEqual({ amount: 2700, currency: 'USD' });
        expect(large.portionFactor).toBe(1.5);
    });

    it('defaults to one serving', () => {
        expect(lunch.portionFactor).toBe(1);
        expect(amountValue(lunch.facts, 'energy')).toBe(360);
        expect(lunch.estimatedCost).toEqual({ amount: 1800, currency: 'USD' });
    });

    it('refuses facts that are not per-serving', () => {
        expect(() =>
            mealNutritionFromServing(recipe.perRecipe, { mealType: 'lunch', label: 'x' }),
        ).toThrow(NutritionAggregationError);
    });

    it('sums a day from its meals', () => {
        const day = summariseDay({ date: '2026-03-02', meals: [lunch, lunch] });
        expect(day.planned.basis).toBe('per_day');
        expect(amountValue(day.planned, 'energy')).toBe(720);
        expect(day.estimatedCost).toEqual({ amount: 3600, currency: 'USD' });
        expect(day.actual).toBeNull();
        expect(day.target).toBeNull();
    });

    it('refuses to summarise a day with no meals', () => {
        expect(() => summariseDay({ date: '2026-03-02', meals: [] })).toThrow(
            NutritionAggregationError,
        );
    });

    it('sums a week and averages over the days present, not over seven', () => {
        const days = ['2026-03-02', '2026-03-03', '2026-03-04'].map((date) =>
            summariseDay({ date, meals: [lunch, lunch] }),
        );
        const week = summariseWeek({ weekStart: '2026-03-02', days });

        expect(week.planned.basis).toBe('per_week');
        expect(amountValue(week.planned, 'energy')).toBe(2160);
        expect(week.dailyAverage.basis).toBe('per_day');
        expect(amountValue(week.dailyAverage, 'energy')).toBe(720);
        expect(week.estimatedCost).toEqual({ amount: 10800, currency: 'USD' });
    });

    it('refuses to summarise a week with no days', () => {
        expect(() => summariseWeek({ weekStart: '2026-03-02', days: [] })).toThrow(
            NutritionAggregationError,
        );
    });
});

describe('sumCosts', () => {
    it('adds same-currency costs', () => {
        expect(sumCosts([money(100, 'AED'), money(250, 'AED')])).toEqual({
            amount: 350,
            currency: 'USD',
        });
    });

    it('returns null when any element is unknown, rather than a misleading partial total', () => {
        expect(sumCosts([money(100, 'AED'), null])).toBeNull();
        expect(sumCosts([])).toBeNull();
    });

    it('throws rather than summing across currencies', () => {
        expect(() => sumCosts([money(100, 'AED'), money(100, 'SAR')])).toThrow();
    });
});
