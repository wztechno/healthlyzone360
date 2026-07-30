import { ACTIVITY_LEVELS, DIET_CLASSIFICATIONS, MEAL_TYPES } from '@healthy360/domain-types';
import type { ActivityLevel, DietClassification, MealType } from '@healthy360/domain-types';

/**
 * The closed option sets the wizard offers, and nothing else.
 *
 * ## Why these are here and not read from a repository
 *
 * Two different kinds of list get confused with one another, so this module keeps them apart.
 *
 * * A **vocabulary** is a fixed set of codes the product and the backend both agree on — the
 *   fourteen declared allergen groups, the five activity bands, the diet classifications. It is not
 *   data; it is part of the contract. `@healthy360/domain-types` owns most of them and they are
 *   re-exported below so a screen imports one module.
 * * **Data** is what a repository answers with — kitchens, meals, a person's stored constraints. It
 *   is never hard-coded, and this module contains none of it.
 *
 * The allergen codes are the only borderline case. They live in the fixture package as well, which
 * a screen may not import (plan §5), and they are also the published labelling vocabulary of the
 * EU, UK and GCC regimes rather than anybody's product decision. They are restated here as the
 * fourteen codes only — no descriptions, no severities, no fixture shape — so the wizard and the
 * fixtures agree on the literal strings a constraint carries. A `GET /api/v1/reference/allergens`
 * would replace this list with a query and change nothing else; it is recorded as a contract gap.
 */

export { ACTIVITY_LEVELS, DIET_CLASSIFICATIONS, MEAL_TYPES };
export type { ActivityLevel, DietClassification, MealType };

/** The fourteen allergen groups food-labelling regimes require to be declared. */
export const ALLERGEN_CODES = [
    'gluten',
    'crustaceans',
    'egg',
    'fish',
    'peanut',
    'soy',
    'milk',
    'tree_nut',
    'celery',
    'mustard',
    'sesame',
    'sulphites',
    'lupin',
    'mollusc',
] as const;
export type AllergenOptionCode = (typeof ALLERGEN_CODES)[number];

/**
 * Intolerances, kept apart from allergies on purpose.
 *
 * An intolerance is a dose-dependent, non-immune reaction: a splash of milk in a sauce is usually
 * fine and a milk-led dish is not. Modelling it as a weak allergy would either over-restrict a
 * person's whole plan or teach them to dismiss allergy warnings — and the second failure is the
 * dangerous one. So the codes are separate, the copy is separate, and the constraint they produce
 * carries `kind: 'intolerance'`, which the planner honours as a filter a person may knowingly
 * confirm past (`@healthy360/domain-types`, `isSafetyCriticalRestriction`).
 */
export const INTOLERANCE_CODES = [
    'lactose',
    'gluten_sensitivity',
    'fructose',
    'histamine',
    'caffeine',
    'fodmap',
] as const;
export type IntoleranceCode = (typeof INTOLERANCE_CODES)[number];

/**
 * Observance patterns.
 *
 * These are recorded as `religious` restrictions rather than folded into the diet classification,
 * because they are not a preference and they are not a medical fact. A person who does not eat pork
 * as a matter of observance is not expressing a taste that a generator may trade off against
 * variety, and telling them "we found something similar" is not an acceptable answer.
 *
 * The list is deliberately short and about *food*, never about belief: the product never asks a
 * person what they believe, only what they do not eat.
 */
export const OBSERVANCE_CODES = [
    'no_pork',
    'no_alcohol',
    'halal_only',
    'kosher_only',
    'no_beef',
    'no_shellfish_observed',
    'fasting_periods',
] as const;
export type ObservanceCode = (typeof OBSERVANCE_CODES)[number];

/**
 * Self-declared medical topics.
 *
 * Every one of these is something a person may reasonably know about their own eating without a
 * clinician in the room — "I have been told to watch salt" — and none of them is a diagnosis. The
 * interface records them, flags the result for professional review, and refuses to act on any of
 * them as a clinical instruction. That refusal is the point: a prototype that quietly turned "I
 * have been told to watch salt" into a sodium ceiling would be practising dietetics.
 */
export const MEDICAL_TOPIC_CODES = [
    'sodium',
    'added_sugar',
    'saturated_fat',
    'potassium',
    'purines',
    'caffeine_limit',
    'fluid_balance',
] as const;
export type MedicalTopicCode = (typeof MEDICAL_TOPIC_CODES)[number];

/** Ingredients commonly disliked. A starting set; the step also accepts anything typed in. */
export const DISLIKE_CODES = [
    'aubergine',
    'coriander',
    'olives',
    'blue_cheese',
    'liver',
    'okra',
    'beetroot',
    'anchovy',
    'mushroom',
    'chilli',
] as const;
export type DislikeCode = (typeof DISLIKE_CODES)[number];

/**
 * Cuisines offered as preferences.
 *
 * The same six the kitchen directory filters on, so a person's stated preference and the catalogue's
 * facets are the same vocabulary rather than two lists that nearly match.
 */
export const CUISINE_CODES = [
    'levantine',
    'mediterranean',
    'coastal',
    'home_cooking',
    'contemporary',
    'grill',
] as const;
export type CuisineCode = (typeof CUISINE_CODES)[number];

/** Cuisine display values as the catalogue stores them, keyed by our code. */
export const CUISINE_VALUES: Readonly<Record<CuisineCode, string>> = {
    levantine: 'Levantine',
    mediterranean: 'Mediterranean',
    coastal: 'Coastal',
    home_cooking: 'Home cooking',
    contemporary: 'Contemporary',
    grill: 'Grill',
};

/** How confident a person is in the kitchen. Drives recipe complexity, never a hard filter. */
export const COOKING_SKILLS = ['beginner', 'confident', 'experienced'] as const;
export type CookingSkill = (typeof COOKING_SKILLS)[number];

/** Which equation the resting-energy estimate should come from. */
export const CALCULATION_BASES = ['measurements', 'body_composition'] as const;
export type CalculationBasis = (typeof CALCULATION_BASES)[number];

/**
 * Meal times offered, at half-hour resolution from 05:00 to 23:30.
 *
 * A `Select` rather than a platform time picker: the design system has no time control, and the
 * honest options were a free-text field that has to be parsed and validated in two scripts, or a
 * closed list. A closed list is keyboard-operable, needs no locale-specific parsing, reads correctly
 * to a screen reader in Arabic, and half an hour is finer than anybody plans a meal to anyway.
 * A `TimeField` is recorded as a design-system follow-up.
 */
export const MEAL_TIME_OPTIONS: readonly string[] = Array.from({ length: 38 }, (_, index) => {
    const minutes = 5 * 60 + index * 30;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
});

/** Default meal type for the nth main meal of the day. Defaults only; every slot is editable. */
export const DEFAULT_MEAL_TYPES: readonly MealType[] = [
    'breakfast',
    'lunch',
    'dinner',
    'lunch',
    'dinner',
    'breakfast',
];

/** Default clock times for the nth main meal, and for the nth snack. */
export const DEFAULT_MEAL_TIMES: readonly string[] = [
    '07:30',
    '13:00',
    '20:00',
    '10:30',
    '17:00',
    '22:00',
];
export const DEFAULT_SNACK_TIMES: readonly string[] = ['16:30', '11:00', '21:30'];

/* ------------------------------------------------------------------------------------------------
 * Bounds
 * ---------------------------------------------------------------------------------------------- */

/**
 * Input bounds.
 *
 * These mirror `MockNutritionTargetEngine`'s validation exactly. The duplication is deliberate and
 * one-directional: the engine is the enforcing side and rejects anything outside them, and these
 * exist so a person is told *before* pressing Next rather than being handed a calculation error.
 * A test pins them together.
 */
export const BOUNDS = {
    ageYears: { min: 16, max: 100 },
    heightCentimetres: { min: 120, max: 230 },
    heightFeet: { min: 3, max: 7 },
    heightInches: { min: 0, max: 11 },
    weightKilograms: { min: 35, max: 250 },
    weightPounds: { min: 77, max: 551 },
    bodyFatPercentage: { min: 3, max: 60 },
    weeklyBudget: { min: 0, max: 5000 },
    cookingMinutesPerDay: { min: 0, max: 240 },
    mealsPerDay: { min: 1, max: 6 },
    snacksPerDay: { min: 0, max: 3 },
} as const;

/** The engine's own hard limits, restated so the test that pins the two together has both sides. */
export const ENGINE_BOUNDS = {
    ageYears: { min: 1, max: 120 },
    heightCentimetres: { min: 50, max: 260 },
    weightKilograms: { min: 20, max: 400 },
    bodyFatPercentage: { min: 1, max: 75 },
    mealsPerDay: { min: 1, max: 8 },
} as const;

/* ------------------------------------------------------------------------------------------------
 * Unit conversion
 * ---------------------------------------------------------------------------------------------- */

const CENTIMETRES_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;
const KILOGRAMS_PER_POUND = 0.45359237;

export interface FeetAndInches {
    readonly feet: number;
    readonly inches: number;
}

/**
 * Centimetres to feet and inches.
 *
 * Rounds to the nearest whole inch and carries the overflow, so 182.9 cm becomes 6 ft 0 in rather
 * than 5 ft 12 in — the mistake every naive implementation of this makes.
 */
export function toFeetAndInches(centimetres: number): FeetAndInches {
    const totalInches = Math.round(centimetres / CENTIMETRES_PER_INCH);
    return {
        feet: Math.floor(totalInches / INCHES_PER_FOOT),
        inches: totalInches % INCHES_PER_FOOT,
    };
}

export function fromFeetAndInches(feet: number, inches: number): number {
    return Number(((feet * INCHES_PER_FOOT + inches) * CENTIMETRES_PER_INCH).toFixed(1));
}

export function toPounds(kilograms: number): number {
    return Number((kilograms / KILOGRAMS_PER_POUND).toFixed(1));
}

export function fromPounds(pounds: number): number {
    return Number((pounds * KILOGRAMS_PER_POUND).toFixed(1));
}
