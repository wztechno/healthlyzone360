export { CALCULATION_SEXES, CONSTRAINT_SEVERITIES, CONSTRAINT_SOURCES } from './contract.ts';
export type {
    CalculationSex,
    ConstraintSeverity,
    ConstraintSource,
    NutritionCalculationMethod,
    NutritionConstraint,
    NutritionTargetEngine,
    NutritionTargetExplanation,
    NutritionTargetExplanationStep,
    NutritionTargetRequest,
    NutritionTargetResult,
    ProfessionalOverride,
} from './contract.ts';

export {
    ACTIVITY_MULTIPLIERS,
    CITATIONS,
    ENERGY_ADJUSTMENT_PERCENT,
    ENERGY_FLOOR_KCAL,
    ENERGY_TOLERANCE_FRACTION,
    FAT_ENERGY_FRACTION,
    FIBRE_GRAMS_PER_1000_KCAL,
    MACRO_TOLERANCE_FRACTION,
    MockNutritionTargetEngine,
    NutritionTargetError,
    PROTEIN_GRAMS_PER_KILOGRAM,
    PROTOTYPE_CALCULATED_AT,
    TARGET_DISCLAIMER,
    createMockNutritionTargetEngine,
    katchMcArdleBmr,
    mifflinStJeorBmr,
} from './engine.ts';
export type { MockNutritionTargetEngineOptions } from './engine.ts';
