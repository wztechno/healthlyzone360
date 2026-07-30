import { MockNutritionTargetEngine } from '@healthy360/nutrition';
import type {
    NutrientTarget,
    NutritionConstraint,
    NutritionFacts,
    NutritionTargetRequest,
    NutritionTargetResult,
} from '@healthy360/nutrition';
import type {
    ActivityLevel,
    DietClassification,
    HealthGoal,
    MealType,
    MeasurementSystem,
    Money,
    RestrictionKind,
    TargetPace,
    UserId,
} from '@healthy360/domain-types';

import type { StoredNutritionTarget } from '../../../contracts/nutrition.ts';
import type { PreparationMode } from '../../../contracts/planner.ts';
import { MOCK_USER_IDS } from '../../ids.ts';
import { PROTOTYPE_NOW, aed } from '../constants.ts';
import { nutritionTargetIdAt } from '../ids.ts';
import { makeFacts } from './nutrients.ts';

/**
 * The person the prototype is about: **Nour Saleh**, the consumer account the mock store already
 * signs in (`MOCK_USER_IDS.consumer`). Reusing that identity rather than inventing a seventh one is
 * what lets a Playwright journey sign in with the existing credentials and land in a planner that
 * already has a week in it.
 *
 * Two things here are load-bearing rather than decorative.
 *
 * **The seven restriction kinds are all present, and they are all different.** An allergy, an
 * intolerance, a religious restriction, a dietitian-enforced restriction, a self-declared medical
 * restriction, a preference and a dislike are seven different facts with seven different override
 * policies, and the product refuses to collapse them. The set below exercises every one, so a screen
 * that renders them identically is visibly wrong rather than subtly wrong.
 *
 * **The nutrition target is produced by `MockNutritionTargetEngine`, not typed.** Every figure the
 * nutrition page shows — maintenance energy, target energy, the macro split, the fibre floor, the
 * tolerance bands, the explanation steps and their citations — is what the engine computes from the
 * onboarding answers below. Nothing is asserted twice.
 */

export const PROTOTYPE_CUSTOMER_ID: UserId = MOCK_USER_IDS.consumer;
export const PROTOTYPE_CUSTOMER_NAME = 'Nour Saleh';

/* ------------------------------------------------------------------------------------------------
 * Onboarding
 * ---------------------------------------------------------------------------------------------- */

/** A meal slot the person asked for, with the time they intend to eat it. */
export interface OnboardingMealSlot {
    readonly mealType: MealType;
    /** `HH:mm`, the person's local time. */
    readonly time: string;
}

/**
 * The twenty-two onboarding steps, as data.
 *
 * The wizard is a sequence of screens; this is the answer set it produces. Keeping them in one
 * shape means the summary step, the nutrition-target request and the planner's constraints are all
 * reading the same record rather than three parallel ones that drift.
 */
export interface PrototypeOnboardingAnswers {
    /** 1 — the person acknowledged what the account is for. */
    readonly introductionAcknowledged: boolean;
    /** 2 */
    readonly measurementSystem: MeasurementSystem;
    /** 3 */
    readonly ageYears: number;
    /** 4 — selects a constant in a published equation; it is not a gender identity field. */
    readonly sexForCalculation: 'female' | 'male';
    /** 5 */
    readonly heightCentimetres: number;
    /** 6 */
    readonly weightKilograms: number;
    /** 7 — optional; its presence switches the engine to Katch–McArdle. */
    readonly bodyFatPercentage: number | null;
    /** 8 */
    readonly activityLevel: ActivityLevel;
    /** 9 */
    readonly goal: HealthGoal;
    /** 10 */
    readonly pace: TargetPace;
    /** 11 */
    readonly diet: DietClassification;
    /** 12 — allergen codes. */
    readonly allergies: readonly string[];
    /** 13 — self-declared medical and dietitian-enforced restrictions, kept apart. */
    readonly selfDeclaredMedical: readonly string[];
    readonly dietitianEnforced: readonly string[];
    /** 14 */
    readonly dislikedIngredients: readonly string[];
    /** 15 */
    readonly preferredCuisines: readonly string[];
    /** 16 — weekly ceiling. */
    readonly weeklyBudget: Money;
    /** 17 — minutes the person is willing to cook, by ISO weekday. */
    readonly cookingMinutesByWeekday: Readonly<Record<number, number>>;
    /** 18 */
    readonly mealsPerDay: number;
    readonly snacksPerDay: number;
    /** 19 */
    readonly mealSlots: readonly OnboardingMealSlot[];
    /** 20 */
    readonly preparationMode: PreparationMode;
    /** 21 */
    readonly summaryAcknowledged: boolean;
    /** 22 — shown because the answers raise a professional-review flag. */
    readonly professionalReviewAcknowledged: boolean;
}

export const PROTOTYPE_ONBOARDING_STEP_COUNT = 22;

export interface MakeOnboardingOverrides {
    readonly weightKilograms?: number | undefined;
    readonly goal?: HealthGoal | undefined;
    readonly pace?: TargetPace | undefined;
    readonly bodyFatPercentage?: number | null | undefined;
    readonly allergies?: readonly string[] | undefined;
    readonly preparationMode?: PreparationMode | undefined;
}

export function makeOnboardingAnswers(
    overrides: MakeOnboardingOverrides = {},
): PrototypeOnboardingAnswers {
    return {
        introductionAcknowledged: true,
        measurementSystem: 'metric',
        ageYears: 34,
        sexForCalculation: 'female',
        heightCentimetres: 165,
        weightKilograms: overrides.weightKilograms ?? 68,
        bodyFatPercentage:
            overrides.bodyFatPercentage === undefined ? null : overrides.bodyFatPercentage,
        activityLevel: 'moderately_active',
        goal: overrides.goal ?? 'lose_weight',
        pace: overrides.pace ?? 'standard',
        diet: 'mediterranean',
        allergies: overrides.allergies ?? ['tree_nut'],
        selfDeclaredMedical: ['sodium'],
        dietitianEnforced: ['added_sugar'],
        dislikedIngredients: ['aubergine'],
        preferredCuisines: ['Levantine', 'Mediterranean', 'Coastal'],
        weeklyBudget: aed(45000),
        cookingMinutesByWeekday: { 1: 30, 2: 30, 3: 20, 4: 30, 5: 45, 6: 60, 7: 60 },
        mealsPerDay: 3,
        snacksPerDay: 1,
        mealSlots: [
            { mealType: 'breakfast', time: '07:30' },
            { mealType: 'lunch', time: '13:00' },
            { mealType: 'snack', time: '16:30' },
            { mealType: 'dinner', time: '20:00' },
        ],
        preparationMode: 'mixed',
        summaryAcknowledged: true,
        professionalReviewAcknowledged: true,
    };
}

export const PROTOTYPE_ONBOARDING: PrototypeOnboardingAnswers = makeOnboardingAnswers();

/* ------------------------------------------------------------------------------------------------
 * Constraints — all seven kinds
 * ---------------------------------------------------------------------------------------------- */

type ConstraintRow = readonly [
    kind: RestrictionKind,
    code: string,
    label: string,
    severity: NutritionConstraint['severity'],
    source: NutritionConstraint['source'],
    note: string | null,
];

const CONSTRAINT_ROWS: readonly ConstraintRow[] = [
    [
        'allergy',
        'tree_nut',
        'Tree nuts',
        'critical',
        'user',
        'Declared at onboarding. No plan may contain tree nuts, and no confirmation lifts it.',
    ],
    [
        'intolerance',
        'milk',
        'Lactose',
        'strict',
        'user',
        'Small amounts in cooking are tolerated; a milk-led dish is not. Can be confirmed case by case.',
    ],
    [
        'religious',
        'pork',
        'Pork and pork derivatives',
        'strict',
        'user',
        'Excluded as a matter of observance. Honoured as a filter, not as a preference.',
    ],
    [
        'self_declared_medical',
        'sodium',
        'Sodium ceiling',
        'strict',
        'user',
        'Recorded by the person after a blood-pressure reading. Flagged for professional review ' +
            'rather than acted on as a clinical instruction.',
    ],
    [
        'dietitian_enforced',
        'added_sugar',
        'Added sugar limit',
        'strict',
        'dietitian',
        'Set by Layla Haddad. Only the dietitian who set it may lift it.',
    ],
    [
        'preference',
        'mediterranean',
        'Mediterranean pattern',
        'advisory',
        'user',
        'A pattern the person prefers, not a restriction. Ranks candidates; excludes nothing.',
    ],
    [
        'dislike',
        'aubergine',
        'Aubergine',
        'advisory',
        'user',
        'Disliked rather than excluded — it is penalised in scoring and can be planned deliberately.',
    ],
];

export interface MakeConstraintOverrides {
    readonly severity?: NutritionConstraint['severity'] | undefined;
    readonly source?: NutritionConstraint['source'] | undefined;
    readonly note?: string | null | undefined;
}

export function makeConstraint(
    row: ConstraintRow,
    overrides: MakeConstraintOverrides = {},
): NutritionConstraint {
    const [kind, code, label, severity, source, note] = row;
    return {
        kind,
        code,
        label,
        severity: overrides.severity ?? severity,
        source: overrides.source ?? source,
        note: overrides.note === undefined ? note : overrides.note,
    };
}

/** All seven restriction kinds, exactly once each. `customer.test.ts` asserts the coverage. */
export const PROTOTYPE_CONSTRAINTS: readonly NutritionConstraint[] = CONSTRAINT_ROWS.map((row) =>
    makeConstraint(row),
);

export function constraintOfKind(kind: RestrictionKind): NutritionConstraint | null {
    return PROTOTYPE_CONSTRAINTS.find((constraint) => constraint.kind === kind) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Nutrition target — produced by the engine, never typed
 * ---------------------------------------------------------------------------------------------- */

/** The engine instance the prototype world calls. Fixed clock, so results are reproducible. */
export const PROTOTYPE_TARGET_ENGINE = new MockNutritionTargetEngine({ now: PROTOTYPE_NOW });

export function makeTargetRequest(
    answers: PrototypeOnboardingAnswers = PROTOTYPE_ONBOARDING,
    constraints: readonly NutritionConstraint[] = PROTOTYPE_CONSTRAINTS,
): NutritionTargetRequest {
    return {
        measurementSystem: answers.measurementSystem,
        ageYears: answers.ageYears,
        sexForCalculation: answers.sexForCalculation,
        heightCentimetres: answers.heightCentimetres,
        weightKilograms: answers.weightKilograms,
        ...(answers.bodyFatPercentage === null
            ? {}
            : { bodyFatPercentage: answers.bodyFatPercentage }),
        activityLevel: answers.activityLevel,
        goal: answers.goal,
        pace: answers.pace,
        diet: answers.diet,
        mealsPerDay: answers.mealsPerDay + answers.snacksPerDay,
        constraints,
    };
}

export const PROTOTYPE_TARGET_REQUEST: NutritionTargetRequest = makeTargetRequest();

export const PROTOTYPE_TARGET_RESULT: NutritionTargetResult =
    PROTOTYPE_TARGET_ENGINE.calculate(PROTOTYPE_TARGET_REQUEST);

export interface MakeStoredTargetOverrides {
    readonly result?: NutritionTargetResult | undefined;
    readonly professionallyApproved?: boolean | undefined;
    readonly approvedBy?: StoredNutritionTarget['approvedBy'] | undefined;
    readonly approvedAt?: StoredNutritionTarget['approvedAt'] | undefined;
}

export function makeStoredTarget(
    ordinal: number,
    overrides: MakeStoredTargetOverrides = {},
): StoredNutritionTarget {
    const id = nutritionTargetIdAt(ordinal);
    const result = overrides.result ?? PROTOTYPE_TARGET_RESULT;
    return {
        id,
        result: { ...result, id },
        professionallyApproved: overrides.professionallyApproved ?? false,
        approvedBy: overrides.approvedBy ?? null,
        approvedAt: overrides.approvedAt ?? null,
        createdAt: PROTOTYPE_NOW,
        updatedAt: PROTOTYPE_NOW,
    };
}

/** The stored target the planner and the nutrition page read. Awaiting review, deliberately. */
export const PROTOTYPE_STORED_TARGET: StoredNutritionTarget = makeStoredTarget(0);

/* ------------------------------------------------------------------------------------------------
 * Daily targets, as the planner consumes them
 * ---------------------------------------------------------------------------------------------- */

/** Energy, the three macros and fibre, as `NutrientTarget` rows the planner can read levels against. */
export function nutrientTargetsFor(
    result: NutritionTargetResult = PROTOTYPE_TARGET_RESULT,
): readonly NutrientTarget[] {
    const macros: readonly NutrientTarget[] = result.macros.map((macro) => ({
        nutrientId: macro.nutrientId,
        unit: 'g',
        value: macro.grams,
        tolerance: macro.tolerance,
        basis: 'per_day',
        direction: macro.nutrientId === 'protein' ? 'at_least' : 'hit',
        rationale:
            macro.gramsPerKilogram === null
                ? `${String(macro.percentageOfEnergy)} % of the energy target.`
                : `${String(macro.gramsPerKilogram)} g per kilogram of body mass.`,
    }));

    return [
        {
            nutrientId: 'energy',
            unit: 'kcal',
            value: result.targetEnergy,
            tolerance: result.energyTolerance,
            basis: 'per_day',
            direction: 'hit',
            rationale: 'Maintenance energy adjusted for the goal and pace.',
        },
        ...macros,
        ...result.nutrients,
    ];
}

export const PROTOTYPE_NUTRIENT_TARGETS: readonly NutrientTarget[] = nutrientTargetsFor();

/** The same figures as a facts set, so a day can be rendered as planned-against-target. */
export function targetFactsFor(
    targets: readonly NutrientTarget[] = PROTOTYPE_NUTRIENT_TARGETS,
    multiplier = 1,
): NutritionFacts {
    const values: Record<string, number> = {};
    for (const target of targets) values[target.nutrientId] = target.value * multiplier;
    return makeFacts(values, {
        basis: multiplier === 1 ? 'per_day' : 'per_week',
        kind: 'target',
        method: 'fixture.daily_target_from_engine',
        notes: [
            'Projected from the stored nutrition target produced by MockNutritionTargetEngine.',
        ],
    });
}

export const PROTOTYPE_DAILY_TARGET_FACTS: NutritionFacts = targetFactsFor();
export const PROTOTYPE_WEEKLY_TARGET_FACTS: NutritionFacts = targetFactsFor(
    PROTOTYPE_NUTRIENT_TARGETS,
    7,
);
