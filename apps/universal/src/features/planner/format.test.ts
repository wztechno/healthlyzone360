import type {
    GroceryListItem,
    MealPlanEntry,
    MealPlanWeek,
    Recipe,
} from '@healthy360/api-client/contracts';
import { createMockRepositories } from '@healthy360/api-client/mock';
import { AllergenCode } from '@healthy360/domain-types';
import type { Money } from '@healthy360/domain-types';

import {
    ALLERGEN_WARNING_CODE,
    PLANNER_MEAL_TYPES,
    addDays,
    allergenDifference,
    applyClientRanges,
    badgesFor,
    compareEntries,
    dateInstant,
    detailHrefFor,
    entriesForSlot,
    groupByAisle,
    hasSafetyWarning,
    isPlannerDate,
    isoWeekday,
    majorUnits,
    mealCandidates,
    mondayOf,
    moneyDifference,
    nutrientDifference,
    nutritionDifference,
    nutritionWarnings,
    preparationMinutes,
    recipeCandidates,
    replacementCompatibility,
    safetyWarnings,
    summaryReadings,
    toMealType,
    totalCost,
    unpricedCount,
    weekDates,
} from './format.ts';

/**
 * The planner's arithmetic, tested as arithmetic.
 *
 * Everything in `format.ts` is a place where a plausible-looking mistake survives review and shows a
 * wrong number to somebody planning what to eat: a difference computed from unrounded values that
 * disagrees with the two figures beside it, a cost total that treats an unknown price as zero, a
 * week that starts on the wrong Monday east of Greenwich.
 *
 * The entries come from the **real fixture world** through the mock repositories rather than from
 * hand-written literals, so a nutrition figure in a test is a figure the screens will actually
 * receive. Only the deliberately awkward cases — a missing price, a mismatched currency — are
 * synthesised, by spreading a real entry.
 */

const scratch = createMockRepositories({ scenario: 'consumer-prototype', latencyMs: 0 });

let week: MealPlanWeek;
let entries: readonly MealPlanEntry[];
let recipes: readonly Recipe[];

beforeAll(async () => {
    const plan = await scratch.planner.getCurrentPlan();
    if (plan === null) throw new Error('The prototype world has no current plan.');
    week = await scratch.planner.getWeek(plan.planId, plan.weekStart);
    entries = week.days.flatMap((day) => day.entries);
    recipes = (await scratch.foods.listRecipes({ limit: 5 })).items;
});

/** An allergen code, through the codec, so a typo in a test is a failure rather than a cast. */
function code(value: string) {
    return AllergenCode.parse(value);
}

function entryOfKind(kind: MealPlanEntry['kind']): MealPlanEntry {
    const found = entries.find((entry) => entry.kind === kind);
    if (found === undefined) throw new Error(`The fixture week has no ${kind} entry.`);
    return found;
}

/* ── calendar ────────────────────────────────────────────────────────────────────────────────── */

describe('planner dates', () => {
    it('accepts a well-formed date', () => {
        expect(isPlannerDate('2026-07-27')).toBe(true);
    });

    it('rejects a wrongly shaped string', () => {
        expect(isPlannerDate('27-07-2026')).toBe(false);
    });

    it('rejects a date that does not exist', () => {
        expect(isPlannerDate('2026-02-31')).toBe(false);
    });

    it('rejects an absent parameter', () => {
        expect(isPlannerDate(undefined)).toBe(false);
    });

    it('adds days across a month boundary', () => {
        expect(addDays('2026-07-30', 3)).toBe('2026-08-02');
    });

    it('subtracts days across a year boundary', () => {
        expect(addDays('2027-01-02', -3)).toBe('2026-12-30');
    });

    it('numbers Monday as 1 and Sunday as 7', () => {
        expect(isoWeekday('2026-07-27')).toBe(1);
        expect(isoWeekday('2026-08-02')).toBe(7);
    });

    it('leaves a Monday alone', () => {
        expect(mondayOf('2026-07-27')).toBe('2026-07-27');
    });

    it('normalises a mid-week date to its Monday', () => {
        expect(mondayOf('2026-07-30')).toBe('2026-07-27');
    });

    it('normalises a Sunday to the Monday that began its week', () => {
        expect(mondayOf('2026-08-02')).toBe('2026-07-27');
    });

    it('produces seven consecutive dates for a week', () => {
        const dates = weekDates('2026-07-27');
        expect(dates).toHaveLength(7);
        expect(dates[0]).toBe('2026-07-27');
        expect(dates[6]).toBe('2026-08-02');
    });

    it('renders a date as midday so no timezone can move it', () => {
        expect(dateInstant('2026-07-27')).toBe('2026-07-27T12:00:00.000Z');
    });
});

/* ── ordering ────────────────────────────────────────────────────────────────────────────────── */

describe('entry ordering', () => {
    it('reads a day as breakfast, lunch, snack, dinner', () => {
        expect([...PLANNER_MEAL_TYPES]).toEqual(['breakfast', 'lunch', 'snack', 'dinner']);
    });

    it('sorts by meal type before position', () => {
        const breakfast = entryOfKind('recipe');
        const dinner: MealPlanEntry = { ...breakfast, mealType: 'dinner', position: 0 };
        const snack: MealPlanEntry = { ...breakfast, mealType: 'snack', position: 9 };
        expect(compareEntries(snack, dinner)).toBeLessThan(0);
    });

    it('sorts by position within one meal type', () => {
        const first = entryOfKind('food');
        const second: MealPlanEntry = { ...first, position: first.position + 1 };
        expect(compareEntries(first, second)).toBeLessThan(0);
    });

    it('falls back to the identifier when type and position tie', () => {
        const entry = entryOfKind('food');
        const twin: MealPlanEntry = { ...entry, id: `${String(entry.id)}-z` as typeof entry.id };
        expect(compareEntries(entry, twin)).toBeLessThan(0);
    });

    it('selects only the entries in one slot', () => {
        const sample = entries[0];
        if (sample === undefined) throw new Error('The fixture week is empty.');
        const slot = entriesForSlot(entries, sample.date, sample.mealType);
        expect(slot.length).toBeGreaterThan(0);
        expect(slot.every((entry) => entry.date === sample.date)).toBe(true);
        expect(slot.every((entry) => entry.mealType === sample.mealType)).toBe(true);
    });

    it('guards a route parameter into a meal type', () => {
        expect(toMealType('lunch')).toBe('lunch');
        expect(toMealType('brunch')).toBeNull();
        expect(toMealType(undefined)).toBeNull();
    });
});

/* ── warnings ────────────────────────────────────────────────────────────────────────────────── */

describe('warning classification', () => {
    it('finds the allergen conflict the fixture week deliberately carries', () => {
        const flagged = entries.filter((entry) => entry.warnings.includes(ALLERGEN_WARNING_CODE));
        expect(flagged.length).toBeGreaterThan(0);
    });

    it('separates a safety warning from a nutrition warning', () => {
        const entry = entries.find((candidate) =>
            candidate.warnings.includes(ALLERGEN_WARNING_CODE),
        );
        if (entry === undefined) throw new Error('No allergen-flagged entry in the fixture week.');
        const mixed: MealPlanEntry = {
            ...entry,
            warnings: [ALLERGEN_WARNING_CODE, 'planner.energy_out_of_range'],
        };
        expect(safetyWarnings(mixed)).toEqual([ALLERGEN_WARNING_CODE]);
        expect(nutritionWarnings(mixed)).toEqual(['planner.energy_out_of_range']);
        expect(hasSafetyWarning(mixed)).toBe(true);
    });

    it('does not treat a nutrition warning as a safety warning', () => {
        const entry = entryOfKind('recipe');
        const nutrition: MealPlanEntry = {
            ...entry,
            warnings: ['planner.energy_out_of_range'],
        };
        expect(hasSafetyWarning(nutrition)).toBe(false);
    });

    it('finds the nutrition warning the fixture week deliberately carries', () => {
        const flagged = entries.filter((entry) =>
            entry.warnings.includes('planner.energy_out_of_range'),
        );
        expect(flagged.length).toBeGreaterThan(0);
    });
});

/* ── badges ──────────────────────────────────────────────────────────────────────────────────── */

describe('entry badges', () => {
    it('marks a kitchen meal as coming from a kitchen', () => {
        expect(badgesFor(entryOfKind('kitchen_meal'))).toContain('kitchen');
    });

    it('marks a recipe as home-prepared', () => {
        expect(badgesFor(entryOfKind('recipe'))).toContain('home_prepared');
    });

    it('marks a planned restaurant meal as eating out', () => {
        expect(badgesFor(entryOfKind('restaurant'))).toContain('restaurant');
    });

    it('marks a single food', () => {
        expect(badgesFor(entryOfKind('food'))).toContain('food');
    });

    it('marks the dietitian-approved entry the fixture week carries', () => {
        const approved = entries.find((entry) => entry.approvedBy !== null);
        if (approved === undefined) throw new Error('No approved entry in the fixture week.');
        expect(badgesFor(approved)).toContain('dietitian_approved');
    });

    it('marks the leftover the fixture week carries', () => {
        const leftover = entries.find((entry) => entry.isLeftover);
        if (leftover === undefined) throw new Error('No leftover in the fixture week.');
        expect(badgesFor(leftover)).toContain('leftover');
    });

    it('marks the kept entry the fixture week carries', () => {
        const locked = entries.find((entry) => entry.locked);
        if (locked === undefined) throw new Error('No locked entry in the fixture week.');
        expect(badgesFor(locked)).toContain('locked');
    });

    it('puts the source badge first and the planning state last', () => {
        const locked = entries.find((entry) => entry.locked);
        if (locked === undefined) throw new Error('No locked entry in the fixture week.');
        const badges = badgesFor(locked);
        expect(badges[0]).toBe('home_prepared');
        expect(badges[badges.length - 1]).toBe('locked');
    });
});

/* ── detail links ────────────────────────────────────────────────────────────────────────────── */

describe('the record behind an entry', () => {
    it('sends a recipe entry to the home-prepared recipe screen', () => {
        const entry = entryOfKind('recipe');
        expect(detailHrefFor(entry)).toBe(`/customer/recipes/${String(entry.recipeId)}`);
    });

    it('sends a kitchen meal to the marketplace meal record', () => {
        const entry = entryOfKind('kitchen_meal');
        expect(detailHrefFor(entry)).toBe(`/meals/${String(entry.mealId)}`);
    });

    it('offers nothing for a single food, which has no record screen', () => {
        expect(detailHrefFor(entryOfKind('food'))).toBeNull();
    });

    it('offers nothing for a planned restaurant meal, which has no record at all', () => {
        expect(detailHrefFor(entryOfKind('restaurant'))).toBeNull();
    });
});

/* ── differences ─────────────────────────────────────────────────────────────────────────────── */

describe('nutrition differences', () => {
    it('reports a rise with a positive delta and an up sign', () => {
        const light = entryOfKind('food');
        const heavy = entryOfKind('restaurant');
        const difference = nutrientDifference(light.nutrition, heavy.nutrition, 'energy');
        expect(difference.delta).toBeGreaterThan(0);
        expect(difference.sign).toBe('up');
    });

    it('reports a fall with a negative delta and a down sign', () => {
        const light = entryOfKind('food');
        const heavy = entryOfKind('restaurant');
        const difference = nutrientDifference(heavy.nutrition, light.nutrition, 'energy');
        expect(difference.delta).toBeLessThan(0);
        expect(difference.sign).toBe('down');
    });

    it('reports no change when the two sides are the same facts', () => {
        const entry = entryOfKind('recipe');
        const difference = nutrientDifference(entry.nutrition, entry.nutrition, 'energy');
        expect(difference.delta).toBe(0);
        expect(difference.sign).toBe('same');
    });

    it('rounds before subtracting so the delta agrees with the two figures shown', () => {
        const entry = entryOfKind('recipe');
        const other = entryOfKind('kitchen_meal');
        const difference = nutrientDifference(entry.nutrition, other.nutrition, 'protein');
        expect(difference.delta).toBe(difference.after - difference.before);
        expect(Number.isInteger(difference.delta)).toBe(true);
    });

    it('compares energy and the three macronutrients by default', () => {
        const entry = entryOfKind('recipe');
        const other = entryOfKind('kitchen_meal');
        expect(
            nutritionDifference(entry.nutrition, other.nutrition).map((d) => d.nutrientId),
        ).toEqual(['energy', 'protein', 'carbohydrate', 'fat']);
    });
});

describe('cost differences', () => {
    const aed = (amount: number): Money => ({ amount, currency: 'AED' });

    it('subtracts two prices in the same currency', () => {
        const difference = moneyDifference(aed(3000), aed(4500));
        expect(difference.delta).toEqual(aed(1500));
        expect(difference.sign).toBe('up');
        expect(difference.incomparable).toBe(false);
    });

    it('reports a saving as a negative delta', () => {
        expect(moneyDifference(aed(4500), aed(3000)).sign).toBe('down');
    });

    it('refuses to compare when one side has no price', () => {
        const difference = moneyDifference(null, aed(3000));
        expect(difference.delta).toBeNull();
        expect(difference.incomparable).toBe(true);
    });

    it('refuses to compare across currencies', () => {
        const difference = moneyDifference(aed(3000), { amount: 3000, currency: 'SAR' });
        expect(difference.delta).toBeNull();
        expect(difference.incomparable).toBe(true);
    });

    it('reports two absent prices as comparable and unchanged', () => {
        const difference = moneyDifference(null, null);
        expect(difference.incomparable).toBe(false);
        expect(difference.sign).toBe('same');
    });

    it('converts minor units to the major unit for display', () => {
        expect(majorUnits(aed(4550))).toBeCloseTo(45.5);
    });
});

describe('allergen differences', () => {
    it('reports what a candidate introduces', () => {
        const difference = allergenDifference([code('milk')], [code('milk'), code('tree_nut')]);
        expect(difference.introduced).toEqual([code('tree_nut')]);
        expect(difference.unchanged).toEqual([code('milk')]);
        expect(difference.removed).toEqual([]);
    });

    it('reports what a candidate removes', () => {
        const difference = allergenDifference([code('milk'), code('gluten')], [code('milk')]);
        expect(difference.removed).toEqual([code('gluten')]);
        expect(difference.introduced).toEqual([]);
    });

    it('reports no change when the sets match', () => {
        const difference = allergenDifference([code('milk')], [code('milk')]);
        expect(difference.introduced).toEqual([]);
        expect(difference.removed).toEqual([]);
    });
});

/* ── compatibility ───────────────────────────────────────────────────────────────────────────── */

describe('replacement compatibility', () => {
    it('fits when the candidate matches the slot and brings nothing new in', () => {
        const entry = entryOfKind('kitchen_meal');
        const result = replacementCompatibility({
            entry,
            candidateFacts: entry.nutrition,
            candidateAllergens: entry.allergens,
            candidateMealTypes: [entry.mealType],
        });
        expect(result.level).toBe('fits');
        expect(result.reasons).toEqual([]);
    });

    it('conflicts when the candidate introduces an allergen', () => {
        const entry = entryOfKind('kitchen_meal');
        const result = replacementCompatibility({
            entry,
            candidateFacts: entry.nutrition,
            candidateAllergens: [...entry.allergens, code('peanut')],
            candidateMealTypes: [entry.mealType],
        });
        expect(result.level).toBe('conflict');
        expect(result.reasons).toContain('newAllergens');
    });

    it('asks for a check when the candidate is not offered for the slot', () => {
        const entry = entryOfKind('kitchen_meal');
        const result = replacementCompatibility({
            entry,
            candidateFacts: entry.nutrition,
            candidateAllergens: entry.allergens,
            candidateMealTypes: [entry.mealType === 'breakfast' ? 'dinner' : 'breakfast'],
        });
        expect(result.level).toBe('check');
        expect(result.reasons).toContain('otherMealType');
    });

    it('says nothing about the day when the caller does not pass one', () => {
        const entry = entryOfKind('kitchen_meal');
        const result = replacementCompatibility({
            entry,
            candidateFacts: entry.nutrition,
            candidateAllergens: entry.allergens,
            candidateMealTypes: [entry.mealType],
            targets: week.targets,
        });
        expect(result.reasons).not.toContain('dayEnergyOutOfRange');
    });

    it('asks for a check when the swap would push the day past its energy tolerance', () => {
        const entry = entryOfKind('food');
        const heavy = entryOfKind('restaurant');
        const day = week.days.find((candidate) => candidate.date === entry.date);
        if (day === undefined) throw new Error('The entry belongs to no day.');
        const result = replacementCompatibility({
            entry,
            candidateFacts: heavy.nutrition,
            candidateAllergens: entry.allergens,
            candidateMealTypes: [entry.mealType],
            dayPlanned: day.summary.planned,
            targets: week.targets,
        });
        expect(result.reasons).toContain('dayEnergyOutOfRange');
    });

    it('keeps an allergen conflict as the worst finding even with other reasons', () => {
        const entry = entryOfKind('kitchen_meal');
        const result = replacementCompatibility({
            entry,
            candidateFacts: entry.nutrition,
            candidateAllergens: [code('peanut')],
            candidateMealTypes: [entry.mealType === 'breakfast' ? 'dinner' : 'breakfast'],
        });
        expect(result.level).toBe('conflict');
    });
});

/* ── summaries and totals ────────────────────────────────────────────────────────────────────── */

describe('summaries', () => {
    it('reads the planned facts against every target it has', () => {
        const day = week.days[0];
        if (day === undefined) throw new Error('The fixture week has no days.');
        const readings = summaryReadings(day.summary.planned, day.targets);
        expect(readings.length).toBeGreaterThan(0);
        expect(readings.every((reading) => reading.target > 0)).toBe(true);
    });

    it('skips a nutrient with no target rather than inventing one', () => {
        const day = week.days[0];
        if (day === undefined) throw new Error('The fixture week has no days.');
        expect(summaryReadings(day.summary.planned, [])).toEqual([]);
    });

    it('carries the tolerance band with each reading', () => {
        const day = week.days[0];
        if (day === undefined) throw new Error('The fixture week has no days.');
        const energy = summaryReadings(day.summary.planned, day.targets).find(
            (reading) => reading.nutrientId === 'energy',
        );
        expect(energy?.tolerance.max).toBeGreaterThan(energy?.tolerance.min ?? 0);
    });

    it('never reads the logged figures — the fixture week has none', () => {
        expect(week.days.every((day) => day.summary.actual === null)).toBe(true);
    });
});

describe('cost totals', () => {
    it('adds the entries that carry a price', () => {
        const day = week.days[0];
        if (day === undefined) throw new Error('The fixture week has no days.');
        const total = totalCost(day.entries);
        expect(total?.amount).toBeGreaterThan(0);
    });

    it('counts the entries with no estimate rather than treating them as free', () => {
        const restaurant = entryOfKind('restaurant');
        expect(unpricedCount([restaurant])).toBe(1);
        expect(totalCost([restaurant])).toBeNull();
    });

    it('reports the longest preparation time in a set', () => {
        const day = week.days[0];
        if (day === undefined) throw new Error('The fixture week has no days.');
        const longest = preparationMinutes(day.entries);
        expect(longest).not.toBeNull();
        expect(longest).toBeGreaterThan(0);
    });

    it('reports no preparation time when nothing declares one', () => {
        expect(preparationMinutes([entryOfKind('restaurant')])).toBeNull();
    });
});

/* ── replacement candidates ──────────────────────────────────────────────────────────────────── */

describe('replacement candidates', () => {
    it('scales a recipe candidate to the portion the entry carries', async () => {
        const single = recipeCandidates(recipes, 1);
        const double = recipeCandidates(recipes, 2);
        const first = single[0];
        const doubled = double[0];
        if (first === undefined || doubled === undefined) throw new Error('No recipes.');
        expect(doubled.estimatedCost?.amount).toBe((first.estimatedCost?.amount ?? 0) * 2);
    });

    it('turns a marketplace meal into a candidate with its kitchen named', async () => {
        const meals = await scratch.marketplace.listMeals({ limit: 3 });
        const candidates = mealCandidates(meals.items, 1);
        expect(candidates[0]?.kitchenName).toBeTruthy();
        expect(candidates[0]?.source).toBe('kitchen_meal');
    });

    it('marks a recipe candidate as home-prepared by having no kitchen name', () => {
        expect(recipeCandidates(recipes, 1)[0]?.kitchenName).toBeNull();
    });

    it('filters candidates by a carbohydrate band the recipe filter cannot express', () => {
        const candidates = recipeCandidates(recipes, 1);
        const filtered = applyClientRanges(
            candidates,
            {
                energy: { min: null, max: null },
                protein: { min: null, max: null },
                carbohydrate: { min: 0, max: 1 },
                fat: { min: null, max: null },
                price: { min: null, max: null },
                preparationMinutes: { min: null, max: null },
            },
            100,
        );
        expect(filtered.length).toBeLessThan(candidates.length);
    });

    it('keeps every candidate when no client-side band is set', () => {
        const candidates = recipeCandidates(recipes, 1);
        const filtered = applyClientRanges(
            candidates,
            {
                energy: { min: null, max: null },
                protein: { min: null, max: null },
                carbohydrate: { min: null, max: null },
                fat: { min: null, max: null },
                price: { min: null, max: null },
                preparationMinutes: { min: null, max: null },
            },
            100,
        );
        expect(filtered).toHaveLength(candidates.length);
    });

    it('filters by preparation time', () => {
        const candidates = recipeCandidates(recipes, 1);
        const filtered = applyClientRanges(
            candidates,
            {
                energy: { min: null, max: null },
                protein: { min: null, max: null },
                carbohydrate: { min: null, max: null },
                fat: { min: null, max: null },
                price: { min: null, max: null },
                preparationMinutes: { min: 0, max: 1 },
            },
            100,
        );
        expect(filtered).toHaveLength(0);
    });
});

/* ── grocery grouping ────────────────────────────────────────────────────────────────────────── */

describe('grocery aggregation', () => {
    it('groups the week’s items by aisle', async () => {
        const list = await scratch.foods.getGroceryList(week.weekStart);
        const groups = groupByAisle(list.items, 'Everything else');
        expect(groups.length).toBeGreaterThan(1);
        expect(groups.flatMap((group) => group.items)).toHaveLength(list.items.length);
    });

    it('puts an item with no aisle into the fallback group', () => {
        const unshelved: GroceryListItem = {
            ingredientId: 'ingredient-x' as GroceryListItem['ingredientId'],
            name: 'Something',
            quantity: 1,
            unit: 'g',
            grams: 1,
            aisle: null,
            estimatedCost: null,
            inPantry: false,
            neededForRecipeIds: [],
        };
        const groups = groupByAisle([unshelved], 'Everything else');
        expect(groups[0]?.aisle).toBe('Everything else');
    });

    it('aggregates an ingredient used by two recipes into one line', async () => {
        const list = await scratch.foods.getGroceryList(week.weekStart);
        const shared = list.items.find((item) => item.neededForRecipeIds.length > 1);
        expect(shared).toBeDefined();
        expect(list.items.filter((item) => item.name === shared?.name)).toHaveLength(1);
    });

    it('never shops for a kitchen meal or a leftover', async () => {
        const list = await scratch.foods.getGroceryList(week.weekStart);
        const homePrepared = entries.filter(
            (entry) => entry.kind === 'recipe' && !entry.isLeftover,
        );
        const recipeIds = new Set(homePrepared.map((entry) => String(entry.recipeId)));
        for (const item of list.items) {
            for (const recipeId of item.neededForRecipeIds) {
                expect(recipeIds.has(String(recipeId))).toBe(true);
            }
        }
    });

    it('keeps a locked entry on the grocery list — keeping is not eating', async () => {
        const locked = entries.find((entry) => entry.locked && entry.kind === 'recipe');
        if (locked === undefined) throw new Error('No locked recipe entry in the fixture week.');
        const list = await scratch.foods.getGroceryList(week.weekStart);
        const forLocked = list.items.filter((item) =>
            item.neededForRecipeIds.some((id) => String(id) === String(locked.recipeId)),
        );
        expect(forLocked.length).toBeGreaterThan(0);
    });
});
