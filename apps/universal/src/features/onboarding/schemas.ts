import type { Translate } from '@healthy360/validation';
import { z } from 'zod';

import { BOUNDS } from './vocabularies.ts';
import type { OnboardingStepSlug } from './steps.ts';
import type { OnboardingAnswers } from './state.ts';

/**
 * Per-step validation.
 *
 * ## Why these are here rather than in `@healthy360/validation`
 *
 * That package holds the schemas the **API contracts** are shaped by — login, registration, context
 * selection — where the client mirrors a rule the server enforces. Nothing here has a server side
 * yet: these are interface rules over a local reducer, and adding them to a shared package would
 * make a wizard's field bounds part of three other workstreams' dependency surface for no benefit.
 * The `makeX(t)` shape and the `Translate` seam are borrowed exactly, so moving one later is a file
 * move rather than a rewrite.
 *
 * ## Why the messages are keys and not sentences
 *
 * Same reason as the shared package: a schema built once at module load would freeze the language
 * the person happened to be using when the module was first imported. Every schema is a factory
 * over `t`, and the screen rebuilds it when the language changes.
 *
 * ## What a schema is *not* responsible for
 *
 * Navigation. `isStepComplete` in `./state.ts` decides whether a deep link may land on a step;
 * these decide what a person is told when they press Next with something wrong in the field. The
 * two are intentionally separate — one produces a redirect, the other a sentence under a control —
 * and a single rule serving both ends up either redirecting people for a typo or letting a bad
 * value through to the engine.
 */

const KEYS = {
    required: 'onboarding:validation.required',
    range: 'onboarding:validation.range',
    integer: 'onboarding:validation.integer',
    chooseOne: 'onboarding:validation.chooseOne',
    acknowledge: 'onboarding:validation.acknowledge',
    bodyFatNeeded: 'onboarding:validation.bodyFatNeeded',
    mealTimesOrder: 'onboarding:validation.mealTimesOrder',
} as const;

function boundedNumber(
    t: Translate,
    bounds: { readonly min: number; readonly max: number },
    options: { readonly integer?: boolean } = {},
) {
    const message = t(KEYS.range, { min: bounds.min, max: bounds.max });
    let schema = z
        .number({ error: t(KEYS.required) })
        .min(bounds.min, { error: message })
        .max(bounds.max, { error: message });
    if (options.integer === true) {
        schema = schema.int({ error: t(KEYS.integer) });
    }
    return schema;
}

/** A required single choice from a closed set. */
function choice<T extends string>(t: Translate, values: readonly T[]) {
    return z.enum(values as unknown as [T, ...T[]], { error: t(KEYS.chooseOne) });
}

/** A consent box: `boolean` refined to `true`, so an unticked default stays typeable. */
function acknowledgement(t: Translate) {
    return z.boolean().refine((value) => value === true, { error: t(KEYS.acknowledge) });
}

/* ------------------------------------------------------------------------------------------------
 * The step schemas
 * ---------------------------------------------------------------------------------------------- */

export function makeIntroductionSchema(t: Translate) {
    return z.object({ introductionAcknowledged: acknowledgement(t) });
}

export function makeUnitsSchema(t: Translate) {
    return z.object({ measurementSystem: choice(t, ['metric', 'imperial'] as const) });
}

export function makeAgeSchema(t: Translate) {
    return z.object({ ageYears: boundedNumber(t, BOUNDS.ageYears, { integer: true }) });
}

/**
 * The calculation basis, and the constant it may need.
 *
 * The conditional is the whole point of the step: `sexForCalculation` is required when — and only
 * when — the chosen equation reads it. Modelling that as a `superRefine` rather than as two
 * schemas keeps "which fields does this step validate?" answerable from one object.
 */
export function makeCalculationBasisSchema(t: Translate) {
    return z
        .object({
            calculationBasis: choice(t, ['measurements', 'body_composition'] as const),
            sexForCalculation: z.enum(['female', 'male'] as const).nullable(),
        })
        .superRefine((value, context) => {
            if (value.calculationBasis === 'measurements' && value.sexForCalculation === null) {
                context.addIssue({
                    code: 'custom',
                    path: ['sexForCalculation'],
                    message: t(KEYS.chooseOne),
                });
            }
        });
}

export function makeHeightSchema(t: Translate) {
    return z.object({
        heightCentimetres: boundedNumber(t, BOUNDS.heightCentimetres),
    });
}

export function makeWeightSchema(t: Translate) {
    return z.object({
        weightKilograms: boundedNumber(t, BOUNDS.weightKilograms),
    });
}

/**
 * Body fat: optional, unless the person asked for the equation that needs it.
 *
 * There is no coarse-band alternative here, and that is a considered divergence from the reference
 * research (doc 17, ONB-04, which suggests accepting "low / medium / high"). A band has to become a
 * number before Katch–McArdle can use it, and the number would be one nobody measured, fed into a
 * medical-adjacent estimate, indistinguishable in the result from a real measurement. Skipping is
 * offered instead: it is honest, it costs the person nothing, and the estimate simply falls back to
 * the equation that does not need body composition.
 */
export function makeBodyFatSchema(t: Translate) {
    return z
        .object({
            calculationBasis: z.enum(['measurements', 'body_composition'] as const),
            bodyFatPercentage: boundedNumber(t, BOUNDS.bodyFatPercentage).nullable(),
            bodyFatSkipped: z.boolean(),
        })
        .superRefine((value, context) => {
            if (value.calculationBasis === 'body_composition' && value.bodyFatPercentage === null) {
                context.addIssue({
                    code: 'custom',
                    path: ['bodyFatPercentage'],
                    message: t(KEYS.bodyFatNeeded),
                });
                return;
            }
            if (
                value.calculationBasis === 'measurements' &&
                !value.bodyFatSkipped &&
                value.bodyFatPercentage === null
            ) {
                context.addIssue({
                    code: 'custom',
                    path: ['bodyFatPercentage'],
                    message: t(KEYS.required),
                });
            }
        });
}

export function makeActivitySchema(t: Translate) {
    return z.object({
        activityLevel: choice(t, [
            'sedentary',
            'lightly_active',
            'moderately_active',
            'very_active',
            'extra_active',
        ] as const),
    });
}

export function makeGoalSchema(t: Translate) {
    return z.object({
        goal: choice(t, ['lose_weight', 'maintain', 'gain_muscle', 'recomposition'] as const),
    });
}

export function makePaceSchema(t: Translate) {
    return z.object({ pace: choice(t, ['gentle', 'standard', 'ambitious'] as const) });
}

export function makeDietSchema(t: Translate) {
    return z.object({
        diet: choice(t, [
            'omnivore',
            'vegetarian',
            'vegan',
            'pescatarian',
            'keto',
            'low_carb',
            'high_protein',
            'mediterranean',
            'halal_friendly',
            'gluten_free',
            'dairy_free',
            'nut_free',
        ] as const),
        observances: z.array(z.string()),
    });
}

/** Allergies and intolerances. Both may be empty: "none" is an answer, and a common one. */
export function makeAllergiesSchema(_t: Translate) {
    return z.object({
        allergies: z.array(z.string()),
        intolerances: z.array(z.string()),
    });
}

export function makeRestrictionsSchema(_t: Translate) {
    return z.object({ selfDeclaredMedical: z.array(z.string()) });
}

export function makeDislikesSchema(_t: Translate) {
    return z.object({ dislikedIngredients: z.array(z.string()) });
}

export function makeCuisinesSchema(_t: Translate) {
    return z.object({ preferredCuisines: z.array(z.string()) });
}

/** A budget ceiling, or none. `null` is "no ceiling"; zero is "nothing", and they differ. */
export function makeBudgetSchema(t: Translate) {
    return z.object({
        weeklyBudgetMajor: boundedNumber(t, BOUNDS.weeklyBudget).nullable(),
    });
}

export function makeCookingSchema(t: Translate) {
    return z.object({
        cookingMinutesPerDay: boundedNumber(t, BOUNDS.cookingMinutesPerDay, { integer: true }),
        cookingSkill: choice(t, ['beginner', 'confident', 'experienced'] as const),
    });
}

export function makeMealsSchema(t: Translate) {
    return z.object({
        mealsPerDay: boundedNumber(t, BOUNDS.mealsPerDay, { integer: true }),
        snacksPerDay: boundedNumber(t, BOUNDS.snacksPerDay, { integer: true }),
    });
}

/**
 * Meal times.
 *
 * Rejecting an out-of-order day is a judgement call, and the judgement is that it is a typo far
 * more often than it is a night shift. So the rule applies only to the *main* meals: snacks
 * legitimately land anywhere, and a person who eats at 22:00 and 06:00 is describing a rotation the
 * product should not argue with.
 */
export function makeMealTimesSchema(t: Translate) {
    return z
        .object({
            mealSlots: z
                .array(
                    z.object({
                        key: z.string(),
                        mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack'] as const),
                        time: z.string().regex(/^\d{2}:\d{2}$/, { error: t(KEYS.required) }),
                        isSnack: z.boolean(),
                    }),
                )
                .min(1, { error: t(KEYS.required) }),
        })
        .superRefine((value, context) => {
            const mainTimes = value.mealSlots
                .filter((slot) => !slot.isSnack)
                .map((slot) => slot.time);
            const sorted = [...mainTimes].sort();
            if (mainTimes.join('|') !== sorted.join('|')) {
                context.addIssue({
                    code: 'custom',
                    path: ['mealSlots'],
                    message: t(KEYS.mealTimesOrder),
                });
            }
        });
}

export function makePreparationSchema(t: Translate) {
    return z.object({
        preparationMode: choice(t, ['home_prepared', 'kitchen_prepared', 'mixed'] as const),
    });
}

export function makeSummarySchema(t: Translate) {
    return z.object({ summaryAcknowledged: acknowledgement(t) });
}

export function makeReviewSchema(t: Translate) {
    return z.object({ professionalReviewAcknowledged: acknowledgement(t) });
}

/* ------------------------------------------------------------------------------------------------
 * The step → schema table
 * ---------------------------------------------------------------------------------------------- */

/**
 * Validates the answers a step owns, returning the field errors it found.
 *
 * One entry point rather than twenty-two call sites, so the wizard shell can validate "the current
 * step" without knowing which step it is on. The returned map is keyed by the answer field, which
 * is what the step bodies label their controls with.
 */
export type StepErrors = Readonly<Record<string, string>>;

export function validateStep(
    slug: OnboardingStepSlug,
    answers: OnboardingAnswers,
    t: Translate,
): StepErrors {
    const schema = schemaFor(slug, t);
    if (schema === null) return {};

    const result = schema.safeParse(answers);
    if (result.success) return {};

    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
        const field = issue.path[0];
        const name = typeof field === 'string' ? field : '_';
        // First message wins: a person fixes one thing at a time, and stacking three sentences
        // under one control is how a field ends up taller than the step it is on.
        errors[name] ??= issue.message;
    }
    return errors;
}

function schemaFor(slug: OnboardingStepSlug, t: Translate): z.ZodType<unknown> | null {
    switch (slug) {
        case 'introduction':
            return makeIntroductionSchema(t);
        case 'units':
            return makeUnitsSchema(t);
        case 'age':
            return makeAgeSchema(t);
        case 'calculation-basis':
            return makeCalculationBasisSchema(t);
        case 'height':
            return makeHeightSchema(t);
        case 'weight':
            return makeWeightSchema(t);
        case 'body-fat':
            return makeBodyFatSchema(t);
        case 'activity':
            return makeActivitySchema(t);
        case 'goal':
            return makeGoalSchema(t);
        case 'pace':
            return makePaceSchema(t);
        case 'diet':
            return makeDietSchema(t);
        case 'allergies':
            return makeAllergiesSchema(t);
        case 'restrictions':
            return makeRestrictionsSchema(t);
        case 'dislikes':
            return makeDislikesSchema(t);
        case 'cuisines':
            return makeCuisinesSchema(t);
        case 'budget':
            return makeBudgetSchema(t);
        case 'cooking':
            return makeCookingSchema(t);
        case 'meals':
            return makeMealsSchema(t);
        case 'meal-times':
            return makeMealTimesSchema(t);
        case 'preparation':
            return makePreparationSchema(t);
        case 'summary':
            return makeSummarySchema(t);
        case 'review':
            return makeReviewSchema(t);
    }
}
