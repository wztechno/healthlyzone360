import type {
    ActivityLevel,
    DietClassification,
    HealthGoal,
    MealType,
    MeasurementSystem,
    Money,
    TargetPace,
} from '@healthy360/domain-types';
import type { CalculationSex, NutritionTargetRequest } from '@healthy360/nutrition';
import type { PreparationMode } from '@healthy360/api-client/contracts';

import { buildConstraints } from './constraints.ts';
import { ONBOARDING_STEP_SLUGS } from './steps.ts';
import type { OnboardingStepSlug } from './steps.ts';
import {
    BOUNDS,
    CUISINE_VALUES,
    DEFAULT_MEAL_TIMES,
    DEFAULT_MEAL_TYPES,
    DEFAULT_SNACK_TIMES,
} from './vocabularies.ts';
import type { CalculationBasis, CookingSkill, CuisineCode } from './vocabularies.ts';

/**
 * The wizard's answer set, its reducer, and the completeness rules the router redirects on.
 *
 * ## Why this is a local reducer rather than a repository
 *
 * **The proposed contracts publish no way to store an onboarding answer.** `NutritionRepository`
 * offers `calculateTargets`, `getCurrentTargets`, `updateCurrentTargets` and `requestReview`
 * (`contracts/nutrition.ts`); the first is a pure calculation and the third stores a
 * `NutritionTargetRequest` — that is, the *calculation* inputs. Nothing anywhere accepts a weekly
 * budget, a cuisine preference, a cooking-time budget, a meal layout or a preparation mode as a
 * stored profile: those appear only as per-request parameters on `GeneratePlanRequest` and
 * `CreateVdSessionRequest`, which belong to other waves and are not a place to persist an answer.
 *
 * Inventing a `saveOnboarding` method would have been the fastest way to make this screen look
 * finished and the surest way to make the API repository impossible to write later, so the answers
 * live here until the end and then go into the one contract that does accept them. Everything the
 * engine consumes is persisted through `updateCurrentTargets`; everything else is held for the
 * session and recorded as a contract gap in the wave report.
 *
 * ## Why `null` rather than a default
 *
 * Every numeric answer starts `null`, which means "not answered". A default would be an answer
 * nobody gave — and for height, weight and body fat, an answer nobody gave that feeds a
 * medical-adjacent calculation. Zero is not available as a sentinel either: a weekly budget of zero
 * is a real thing to say.
 */

export interface OnboardingMealSlot {
    /** Stable within a session, so a list of controls does not remount when a sibling changes. */
    readonly key: string;
    readonly mealType: MealType;
    /** `HH:mm`, the person's local time. */
    readonly time: string;
    readonly isSnack: boolean;
}

export interface OnboardingAnswers {
    /** 1 */
    readonly introductionAcknowledged: boolean;
    /** 2 */
    readonly measurementSystem: MeasurementSystem;
    /** 3 — years, not a birth date. See `age` in the step notes. */
    readonly ageYears: number | null;
    /** 4a — which published equation the resting-energy estimate comes from. */
    readonly calculationBasis: CalculationBasis;
    /** 4b — the constant the Mifflin–St Jeor equation selects. Not an identity field. */
    readonly sexForCalculation: CalculationSex | null;
    /** 5 — always stored in centimetres; the measurement system only changes the controls. */
    readonly heightCentimetres: number | null;
    /** 6 — always stored in kilograms. */
    readonly weightKilograms: number | null;
    /** 7 — optional unless the calculation basis is body composition. */
    readonly bodyFatPercentage: number | null;
    readonly bodyFatSkipped: boolean;
    /** 8 */
    readonly activityLevel: ActivityLevel | null;
    /** 9 */
    readonly goal: HealthGoal | null;
    /** 10 */
    readonly pace: TargetPace | null;
    /** 11a — a pattern the person prefers. A `preference` constraint; it excludes nothing. */
    readonly diet: DietClassification | null;
    /** 11b — observance. A `religious` constraint, honoured as a filter. */
    readonly observances: readonly string[];
    /** 12a — allergen codes. `allergy` constraints; nothing lifts them. */
    readonly allergies: readonly string[];
    /** 12b — `intolerance` constraints; dose-dependent, confirmable case by case. */
    readonly intolerances: readonly string[];
    /** 13a — `self_declared_medical` constraints. Recorded, flagged, never acted on clinically. */
    readonly selfDeclaredMedical: readonly string[];
    /** 14 — `dislike` constraints. Ranked down, never excluded. */
    readonly dislikedIngredients: readonly string[];
    /** 15 */
    readonly preferredCuisines: readonly CuisineCode[];
    /** 16 — major units of the display currency; converted to `Money` on submission. */
    readonly weeklyBudgetMajor: number | null;
    /** 17 */
    readonly cookingMinutesPerDay: number | null;
    readonly cookingSkill: CookingSkill | null;
    /** 18 */
    readonly mealsPerDay: number | null;
    readonly snacksPerDay: number | null;
    /** 19 — one row per meal and per snack, resized as the counts change. */
    readonly mealSlots: readonly OnboardingMealSlot[];
    /** 20 */
    readonly preparationMode: PreparationMode | null;
    /** 21 */
    readonly summaryAcknowledged: boolean;
    /** 22 */
    readonly professionalReviewAcknowledged: boolean;
}

/** The currency the budget step collects in. AED, as the launch markets' anchor currency. */
export const BUDGET_CURRENCY = 'USD' as const;

export const INITIAL_ANSWERS: OnboardingAnswers = {
    introductionAcknowledged: false,
    measurementSystem: 'metric',
    ageYears: null,
    calculationBasis: 'measurements',
    sexForCalculation: null,
    heightCentimetres: null,
    weightKilograms: null,
    bodyFatPercentage: null,
    bodyFatSkipped: false,
    activityLevel: null,
    goal: null,
    pace: null,
    diet: null,
    observances: [],
    allergies: [],
    intolerances: [],
    selfDeclaredMedical: [],
    dislikedIngredients: [],
    preferredCuisines: [],
    weeklyBudgetMajor: null,
    cookingMinutesPerDay: null,
    cookingSkill: null,
    mealsPerDay: null,
    snacksPerDay: null,
    mealSlots: [],
    preparationMode: null,
    summaryAcknowledged: false,
    professionalReviewAcknowledged: false,
};

/* ------------------------------------------------------------------------------------------------
 * Meal slots
 * ---------------------------------------------------------------------------------------------- */

/**
 * Rebuilds the slot list for a meal and snack count, keeping every answer the person already gave.
 *
 * Reducing the count from four meals to three and back must not lose the time somebody set on the
 * first two, so existing rows are matched by position and only the surplus is dropped.
 */
export function resizeMealSlots(
    existing: readonly OnboardingMealSlot[],
    mealsPerDay: number,
    snacksPerDay: number,
): readonly OnboardingMealSlot[] {
    const meals = existing.filter((slot) => !slot.isSnack);
    const snacks = existing.filter((slot) => slot.isSnack);

    const nextMeals = Array.from({ length: Math.max(0, mealsPerDay) }, (_, index) => {
        const kept = meals[index];
        if (kept !== undefined) return kept;
        return {
            key: `meal-${String(index + 1)}`,
            mealType: DEFAULT_MEAL_TYPES[index] ?? 'lunch',
            time: DEFAULT_MEAL_TIMES[index] ?? '12:00',
            isSnack: false,
        } satisfies OnboardingMealSlot;
    });

    const nextSnacks = Array.from({ length: Math.max(0, snacksPerDay) }, (_, index) => {
        const kept = snacks[index];
        if (kept !== undefined) return kept;
        return {
            key: `snack-${String(index + 1)}`,
            mealType: 'snack' as MealType,
            time: DEFAULT_SNACK_TIMES[index] ?? '16:00',
            isSnack: true,
        } satisfies OnboardingMealSlot;
    });

    return [...nextMeals, ...nextSnacks];
}

/* ------------------------------------------------------------------------------------------------
 * Actions
 * ---------------------------------------------------------------------------------------------- */

export type OnboardingAction =
    | { readonly type: 'set'; readonly patch: Partial<OnboardingAnswers> }
    | {
          readonly type: 'toggle';
          readonly field:
              | 'observances'
              | 'allergies'
              | 'intolerances'
              | 'selfDeclaredMedical'
              | 'dislikedIngredients';
          readonly code: string;
      }
    | { readonly type: 'toggleCuisine'; readonly code: CuisineCode }
    | { readonly type: 'setMealCounts'; readonly meals: number; readonly snacks: number }
    | {
          readonly type: 'setMealSlot';
          readonly key: string;
          readonly patch: Partial<Pick<OnboardingMealSlot, 'mealType' | 'time'>>;
      }
    | { readonly type: 'reset' };

function toggleCode(list: readonly string[], code: string): readonly string[] {
    return list.includes(code) ? list.filter((value) => value !== code) : [...list, code];
}

export function onboardingReducer(
    state: OnboardingAnswers,
    action: OnboardingAction,
): OnboardingAnswers {
    switch (action.type) {
        case 'set': {
            const next = { ...state, ...action.patch };
            // Choosing body composition makes the body-fat step required rather than optional, and
            // retires the sex constant: Katch–McArdle uses neither sex nor height.
            if (next.calculationBasis === 'body_composition' && next.bodyFatSkipped) {
                return { ...next, bodyFatSkipped: false };
            }
            return next;
        }
        case 'toggle':
            return { ...state, [action.field]: toggleCode(state[action.field], action.code) };
        case 'toggleCuisine':
            return {
                ...state,
                preferredCuisines: toggleCode(
                    state.preferredCuisines,
                    action.code,
                ) as readonly CuisineCode[],
            };
        case 'setMealCounts':
            return {
                ...state,
                mealsPerDay: action.meals,
                snacksPerDay: action.snacks,
                mealSlots: resizeMealSlots(state.mealSlots, action.meals, action.snacks),
            };
        case 'setMealSlot':
            return {
                ...state,
                mealSlots: state.mealSlots.map((slot) =>
                    slot.key === action.key ? { ...slot, ...action.patch } : slot,
                ),
            };
        case 'reset':
            return INITIAL_ANSWERS;
        /* c8 ignore next 2 */
        default:
            return state;
    }
}

/* ------------------------------------------------------------------------------------------------
 * Completeness
 * ---------------------------------------------------------------------------------------------- */

function withinBounds(
    value: number | null,
    bounds: { readonly min: number; readonly max: number },
): boolean {
    return value !== null && Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

/**
 * Whether a step has an answer good enough to move past it.
 *
 * This is the *navigation* rule, and it is deliberately coarser than the zod schemas in
 * `./schemas.ts`. The schema produces the message a person reads when they press Next with a bad
 * value; this answers "may a deep link land here, or should it bounce to something earlier?". Two
 * rules rather than one because they fail differently: a schema failure is a sentence under a
 * field, and an incompleteness is a redirect.
 */
export function isStepComplete(slug: OnboardingStepSlug, answers: OnboardingAnswers): boolean {
    switch (slug) {
        case 'introduction':
            return answers.introductionAcknowledged;
        case 'units':
            return true;
        case 'age':
            return withinBounds(answers.ageYears, BOUNDS.ageYears);
        case 'calculation-basis':
            return (
                answers.calculationBasis === 'body_composition' ||
                answers.sexForCalculation !== null
            );
        case 'height':
            return withinBounds(answers.heightCentimetres, BOUNDS.heightCentimetres);
        case 'weight':
            return withinBounds(answers.weightKilograms, BOUNDS.weightKilograms);
        case 'body-fat':
            return answers.calculationBasis === 'body_composition'
                ? withinBounds(answers.bodyFatPercentage, BOUNDS.bodyFatPercentage)
                : answers.bodyFatSkipped ||
                      withinBounds(answers.bodyFatPercentage, BOUNDS.bodyFatPercentage);
        case 'activity':
            return answers.activityLevel !== null;
        case 'goal':
            return answers.goal !== null;
        case 'pace':
            return answers.pace !== null;
        case 'diet':
            return answers.diet !== null;
        case 'allergies':
        case 'restrictions':
        case 'dislikes':
        case 'cuisines':
        case 'budget':
            // Answering nothing is a real answer to each of these: no allergies, no restrictions,
            // no dislikes, no cuisine preference, no budget ceiling.
            return true;
        case 'cooking':
            return (
                withinBounds(answers.cookingMinutesPerDay, BOUNDS.cookingMinutesPerDay) &&
                answers.cookingSkill !== null
            );
        case 'meals':
            return (
                withinBounds(answers.mealsPerDay, BOUNDS.mealsPerDay) &&
                withinBounds(answers.snacksPerDay, BOUNDS.snacksPerDay)
            );
        case 'meal-times':
            return (
                answers.mealSlots.length > 0 && answers.mealSlots.every((slot) => slot.time !== '')
            );
        case 'preparation':
            return answers.preparationMode !== null;
        case 'summary':
            return answers.summaryAcknowledged;
        case 'review':
            return answers.professionalReviewAcknowledged;
    }
}

/**
 * The earliest step that has no answer yet.
 *
 * This is what a deep link to step 18 redirects to when step 5 was never answered, and what
 * `/customer/onboarding` itself resolves to. `null` means every step is answered and the wizard is
 * ready to submit.
 */
export function firstIncompleteStep(answers: OnboardingAnswers): OnboardingStepSlug | null {
    return (
        ONBOARDING_STEP_SLUGS.find((slug) => !isStepComplete(slug, answers)) ??
        /* c8 ignore next */ null
    );
}

/**
 * Whether `slug` may be shown, given the answers so far.
 *
 * A step is reachable when every step before it is complete. That is the whole prerequisite rule:
 * it is monotone, it needs no per-step dependency graph, and it makes "go back and change an
 * answer" free — everything before the step being edited is by definition already complete.
 */
export function isStepReachable(slug: OnboardingStepSlug, answers: OnboardingAnswers): boolean {
    const index = ONBOARDING_STEP_SLUGS.indexOf(slug);
    return ONBOARDING_STEP_SLUGS.slice(0, index).every((earlier) =>
        isStepComplete(earlier, answers),
    );
}

/** Steps 1 to 20 answered — enough to calculate. The summary and the warning come after. */
export function isReadyToCalculate(answers: OnboardingAnswers): boolean {
    return ONBOARDING_STEP_SLUGS.slice(0, ONBOARDING_STEP_SLUGS.indexOf('summary')).every((slug) =>
        isStepComplete(slug, answers),
    );
}

/* ------------------------------------------------------------------------------------------------
 * Submission
 * ---------------------------------------------------------------------------------------------- */

/** The weekly budget as `Money`, or `null` when the person set no ceiling. */
export function weeklyBudgetMoney(answers: OnboardingAnswers): Money | null {
    if (answers.weeklyBudgetMajor === null) return null;
    return {
        // `Money` is integer minor units; AED has two, so the major figure scales by a hundred.
        amount: Math.round(answers.weeklyBudgetMajor * 100),
        currency: BUDGET_CURRENCY,
    };
}

/**
 * The calculation request, built from the answers.
 *
 * ## `sexForCalculation` when nobody supplied one
 *
 * `NutritionTargetRequest.sexForCalculation` is **required**, and the engine uses it twice: once as
 * the Mifflin–St Jeor constant, and once to pick the minimum-intake guard (1,200 kcal against
 * 1,500). Katch–McArdle needs neither — but the guard still applies, so a person who declines to
 * answer cannot simply have the field omitted.
 *
 * Rather than pick the lower guard and quietly under-protect them, this sends the **higher** one.
 * The choice is stated in the step's copy before it is made, appears in the summary, and shows up
 * in the engine's own `energy_floor_applied` review reason when it binds. The alternative — a
 * nullable field on the contract, so an engine could apply the strictest guard itself — is recorded
 * as a contract gap.
 */
export const DECLINED_SEX_FALLBACK: CalculationSex = 'male';

export function toTargetRequest(answers: OnboardingAnswers): NutritionTargetRequest | null {
    if (!isReadyToCalculate(answers)) return null;
    if (
        answers.ageYears === null ||
        answers.heightCentimetres === null ||
        answers.weightKilograms === null ||
        answers.activityLevel === null ||
        answers.goal === null ||
        answers.pace === null ||
        answers.mealsPerDay === null ||
        answers.snacksPerDay === null
    ) {
        /* c8 ignore next */
        return null;
    }

    const usesBodyComposition = answers.calculationBasis === 'body_composition';
    const bodyFat =
        answers.bodyFatSkipped || answers.bodyFatPercentage === null
            ? undefined
            : answers.bodyFatPercentage;

    return {
        measurementSystem: answers.measurementSystem,
        ageYears: answers.ageYears,
        sexForCalculation: answers.sexForCalculation ?? DECLINED_SEX_FALLBACK,
        heightCentimetres: answers.heightCentimetres,
        weightKilograms: answers.weightKilograms,
        ...(bodyFat === undefined ? {} : { bodyFatPercentage: bodyFat }),
        activityLevel: answers.activityLevel,
        goal: answers.goal,
        pace: answers.pace,
        ...(answers.diet === null ? {} : { diet: answers.diet }),
        mealsPerDay: answers.mealsPerDay + answers.snacksPerDay,
        constraints: buildConstraints(answers),
        // Forcing the method makes the person's choice on step 4 authoritative. Left to itself the
        // engine would pick Katch–McArdle whenever a body-fat figure exists, which would silently
        // override somebody who supplied one *and* asked for the measurement-based estimate.
        ...(usesBodyComposition && bodyFat !== undefined
            ? ({ method: 'katch_mcardle' } as const)
            : ({ method: 'mifflin_st_jeor' } as const)),
    };
}

/** Cuisine preferences as the values the catalogue stores, for the plan request a later wave sends. */
export function preferredCuisineValues(answers: OnboardingAnswers): readonly string[] {
    return answers.preferredCuisines.map((code) => CUISINE_VALUES[code]);
}
