import type {
    ActivityLevel,
    DietClassification,
    DietitianId,
    HealthGoal,
    IsoDateTime,
    MeasurementSystem,
    NutritionCalculationMethod,
    NutritionTargetId,
    RestrictionKind,
    TargetPace,
} from '@healthy360/domain-types';

import type { MacroTarget, NutrientTarget, NutrientUnit, ToleranceRange } from '../facts/model.ts';

/**
 * The nutrition-target contract (Prompt 2, "Nutrition-target page").
 *
 * The prototype's engine implements published, citable equations and says so. It does not attempt
 * to reproduce any reference product's targets: those are not observable from a public interface,
 * and pretending otherwise would be a fabrication. Every result therefore carries
 * `prototype: true`, the method it used, an echo of its inputs, and a step-by-step explanation
 * with citations — so that a reviewer can check the arithmetic rather than trust it.
 *
 * Nothing here is medical advice. `requiresProfessionalReview` and `reviewReasons` exist so that
 * the UI can route a person to a qualified dietitian instead of pretending the number is safe.
 */

/** Re-exported so a caller can depend on this module alone for the whole contract. */
export type { NutritionCalculationMethod };

/**
 * The calculation input the published BMR equations need. It is *not* a gender identity field: it
 * selects a constant in an equation, which is why it is named for the calculation and why the
 * onboarding step that collects it is worded as "used only to select the calculation".
 */
export const CALCULATION_SEXES = ['female', 'male'] as const;
export type CalculationSex = (typeof CALCULATION_SEXES)[number];

export const CONSTRAINT_SEVERITIES = ['advisory', 'strict', 'critical'] as const;
export type ConstraintSeverity = (typeof CONSTRAINT_SEVERITIES)[number];

export const CONSTRAINT_SOURCES = ['user', 'dietitian', 'system'] as const;
export type ConstraintSource = (typeof CONSTRAINT_SOURCES)[number];

/**
 * Something that must be honoured when targets or meals are produced.
 *
 * `kind` carries the seven-way distinction the product refuses to collapse (a dislike and an
 * allergy are not the same fact); `severity` carries how hard the constraint bites; `source`
 * carries who may lift it.
 */
export interface NutritionConstraint {
    readonly kind: RestrictionKind;
    /** Stable code: an allergen code, an ingredient slug or a diet classification. */
    readonly code: string;
    readonly label: string;
    readonly severity: ConstraintSeverity;
    readonly source: ConstraintSource;
    readonly note: string | null;
}

/** A qualified dietitian's replacement for a computed figure. */
export interface ProfessionalOverride {
    readonly dietitianId: DietitianId;
    readonly reason: string;
    readonly approvedAt: IsoDateTime;
    /** Overrides the computed energy target. `null` keeps the computed figure. */
    readonly energyKilocalories: number | null;
    /** Overrides the computed macro split entirely. `null` keeps the computed split. */
    readonly macros: readonly MacroTarget[] | null;
}

export interface NutritionTargetRequest {
    readonly measurementSystem: MeasurementSystem;
    readonly ageYears: number;
    readonly sexForCalculation: CalculationSex;
    readonly heightCentimetres: number;
    readonly weightKilograms: number;
    /** Enables Katch–McArdle, which uses lean mass rather than sex and height. */
    readonly bodyFatPercentage?: number | undefined;
    readonly activityLevel: ActivityLevel;
    readonly goal: HealthGoal;
    readonly pace: TargetPace;
    readonly diet?: DietClassification | undefined;
    readonly mealsPerDay?: number | undefined;
    readonly constraints?: readonly NutritionConstraint[] | undefined;
    readonly professionalOverride?: ProfessionalOverride | undefined;
    /** Forces a method. Omitted, the engine picks the best one the inputs support. */
    readonly method?: NutritionCalculationMethod | undefined;
}

/** One line of the "Why this target?" panel. */
export interface NutritionTargetExplanationStep {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    /** The formula as written in the cited source, or `null` for a non-arithmetic step. */
    readonly formula: string | null;
    readonly inputs: Readonly<Record<string, number | string>>;
    readonly output: number | null;
    readonly unit: NutrientUnit | null;
    /** Full reference for the published source this step follows. */
    readonly citation: string | null;
}

export interface NutritionTargetExplanation {
    readonly summary: string;
    readonly steps: readonly NutritionTargetExplanationStep[];
    /** Everything the calculation had to assume because it was not asked. */
    readonly assumptions: readonly string[];
    readonly citations: readonly string[];
    /** Fixed wording; the UI renders it beside every target. Never omitted. */
    readonly disclaimer: string;
}

export interface NutritionTargetResult {
    /** `null` until the target has been persisted by the backend. */
    readonly id: NutritionTargetId | null;
    /**
     * Always `true` for anything this package produces. Typed as the literal so a production engine
     * cannot be substituted without the compiler noticing the claim changed.
     */
    readonly prototype: true;
    readonly method: NutritionCalculationMethod;
    /** Echo of the inputs, so a stored result explains itself without a second lookup. */
    readonly request: NutritionTargetRequest;
    /** Basal metabolic rate, kcal/day. */
    readonly basalMetabolicRate: number;
    /** BMR × the activity multiplier, kcal/day — the "estimated maintenance calories" figure. */
    readonly maintenanceEnergy: number;
    /** The selected target, kcal/day, after the goal and pace adjustment and the safety floor. */
    readonly targetEnergy: number;
    readonly energyTolerance: ToleranceRange;
    readonly macros: readonly MacroTarget[];
    /** Non-macro targets — fibre today, micronutrients when the catalogue grows. */
    readonly nutrients: readonly NutrientTarget[];
    readonly explanation: NutritionTargetExplanation;
    /** True when a person should be routed to a qualified dietitian before acting on this. */
    readonly requiresProfessionalReview: boolean;
    readonly reviewReasons: readonly string[];
    /** The override that was applied, when one was. */
    readonly override: ProfessionalOverride | null;
    readonly calculatedAt: IsoDateTime;
}

/**
 * The seam a production service will slot into.
 *
 * Synchronous on purpose: the calculation is arithmetic over values the client already holds, and
 * making it a promise would push a loading state into every screen that recalculates as a person
 * drags a slider.
 */
export interface NutritionTargetEngine {
    readonly name: string;
    calculate(request: NutritionTargetRequest): NutritionTargetResult;
}
