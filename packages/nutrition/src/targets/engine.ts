import type { ActivityLevel, HealthGoal, IsoDateTime, TargetPace } from '@healthy360/domain-types';
import { isSafetyCriticalRestriction } from '@healthy360/domain-types';

import { roundTo } from '../facts/aggregate.ts';
import { ENERGY_PER_GRAM } from '../facts/model.ts';
import type { MacroNutrientId, MacroTarget, NutrientTarget } from '../facts/model.ts';
import type {
    CalculationSex,
    NutritionCalculationMethod,
    NutritionTargetEngine,
    NutritionTargetExplanationStep,
    NutritionTargetRequest,
    NutritionTargetResult,
} from './contract.ts';

/**
 * `MockNutritionTargetEngine` — a deterministic prototype engine built from **published** equations.
 *
 * The prompt is explicit that no competitor formula was discovered and none may be claimed. What
 * follows is therefore the standard, citable dietetics arithmetic that any textbook contains, with
 * every constant attributed in the code and repeated in the explanation the UI renders. Its output
 * is marked `prototype: true` everywhere it can be.
 *
 * **This is not medical advice.** The floors, caps and review flags below exist so that the product
 * can refuse to show a person a number that ought to come from a qualified dietitian.
 */

/** Fixed clock for the prototype, so a result is reproducible from its inputs alone. */
export const PROTOTYPE_CALCULATED_AT: IsoDateTime = '2026-01-15T09:30:00.000Z';

export const TARGET_DISCLAIMER =
    'These figures are produced by a prototype calculator from published general-population ' +
    'equations. They are an estimate, not medical advice, and they do not account for medical ' +
    'conditions, medication or pregnancy. Speak to a qualified dietitian or doctor before acting ' +
    'on them.';

export class NutritionTargetError extends Error {
    readonly field: string;

    constructor(field: string, message: string) {
        super(message);
        this.name = 'NutritionTargetError';
        this.field = field;
    }
}

/* ------------------------------------------------------------------------------------------------
 * Published constants
 * ---------------------------------------------------------------------------------------------- */

export const CITATIONS = {
    mifflin:
        'Mifflin MD, St Jeor ST, Hill LA, Scott BJ, Daugherty SA, Koh YO. “A new predictive ' +
        'equation for resting energy expenditure in healthy individuals.” American Journal of ' +
        'Clinical Nutrition, 1990;51(2):241–247.',
    katch:
        'Katch FI, McArdle WD, Katch VL. Exercise Physiology: Nutrition, Energy, and Human ' +
        'Performance. The resting-rate form BMR = 370 + 21.6 × fat-free mass (kg) is commonly ' +
        'attributed to Katch and McArdle and is reproduced throughout the dietetics literature.',
    activity:
        'Activity factors of 1.2 to 1.9 applied to a predicted resting rate are standard practice ' +
        'in dietetics and correspond to the physical-activity-level (PAL) bands in FAO/WHO/UNU, ' +
        'Human Energy Requirements, FAO Food and Nutrition Paper 1, 2004.',
    protein:
        'Morton RW et al. “A systematic review, meta-analysis and meta-regression of the effect of ' +
        'protein supplementation on resistance training-induced gains in muscle mass and strength ' +
        'in healthy adults.” British Journal of Sports Medicine, 2018;52:376–384; and Jäger R et ' +
        'al. “International Society of Sports Nutrition position stand: protein and exercise.” ' +
        'Journal of the International Society of Sports Nutrition, 2017;14:20. Both place intakes ' +
        'of roughly 1.6–2.2 g per kg of body mass per day in the range associated with gains in ' +
        'lean mass under resistance training.',
    fat:
        'Institute of Medicine. Dietary Reference Intakes for Energy, Carbohydrate, Fibre, Fat, ' +
        'Fatty Acids, Cholesterol, Protein and Amino Acids. National Academies Press, 2005. The ' +
        'acceptable macronutrient distribution range for fat is 20–35 % of energy for adults.',
    atwater:
        'Atwater general factors (4 kcal/g protein and carbohydrate, 9 kcal/g fat), as used in ' +
        'FAO, Food Energy — Methods of Analysis and Conversion Factors, FAO Food and Nutrition ' +
        'Paper 77, 2003.',
    fibre:
        'Institute of Medicine, Dietary Reference Intakes (2005): an adequate intake for total ' +
        'fibre of 14 g per 1,000 kcal of energy intake.',
    floors:
        'The 1,200 kcal (female) and 1,500 kcal (male) figures are the minimum-intake guard values ' +
        'in common use across consumer nutrition tools. They are used here only as a floor that ' +
        'triggers a professional-review flag; they are not a recommendation and not medical advice.',
} as const;

/**
 * Total-energy multipliers applied to the resting rate. Published values, cited above; a product
 * that invented its own would be unable to explain them to a dietitian.
 */
export const ACTIVITY_MULTIPLIERS: Readonly<Record<ActivityLevel, number>> = {
    sedentary: 1.2,
    lightly_active: 1.375,
    moderately_active: 1.55,
    very_active: 1.725,
    extra_active: 1.9,
};

/**
 * Percentage adjustment to maintenance energy, by goal and pace.
 *
 * Bounded on purpose. The largest deficit here is 20 %, which for a typical maintenance figure is
 * a rate of loss in the range general guidance describes as sustainable; the largest surplus is
 * 15 %, beyond which the literature reports the additional energy going mostly to fat mass.
 */
export const ENERGY_ADJUSTMENT_PERCENT: Readonly<Record<HealthGoal, Record<TargetPace, number>>> = {
    lose_weight: { gentle: -10, standard: -15, ambitious: -20 },
    maintain: { gentle: 0, standard: 0, ambitious: 0 },
    gain_muscle: { gentle: 5, standard: 10, ambitious: 15 },
    recomposition: { gentle: 0, standard: -5, ambitious: -10 },
};

/**
 * Protein grams per kilogram of body mass, by goal. Inside the 1.6–2.2 g/kg band the cited reviews
 * associate with lean-mass gain; the maintenance figure sits just below it, where the same reviews
 * find no further benefit.
 */
export const PROTEIN_GRAMS_PER_KILOGRAM: Readonly<Record<HealthGoal, number>> = {
    lose_weight: 1.8,
    maintain: 1.4,
    gain_muscle: 2.0,
    recomposition: 1.9,
};

/** Share of energy from fat, by goal. Every value sits inside the published 20–35 % AMDR. */
export const FAT_ENERGY_FRACTION: Readonly<Record<HealthGoal, number>> = {
    lose_weight: 0.3,
    maintain: 0.3,
    gain_muscle: 0.25,
    recomposition: 0.28,
};

/** UI guard figures, not recommendations. Hitting one raises a professional-review flag. */
export const ENERGY_FLOOR_KCAL: Readonly<Record<CalculationSex, number>> = {
    female: 1200,
    male: 1500,
};

/** Fibre adequate intake, grams per 1,000 kcal. */
export const FIBRE_GRAMS_PER_1000_KCAL = 14;

/** Tolerance bands, as a fraction of the target. */
export const ENERGY_TOLERANCE_FRACTION = 0.05;
export const MACRO_TOLERANCE_FRACTION = 0.1;

/* ------------------------------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------------------------------- */

function requireFiniteInRange(
    field: string,
    value: number,
    minimum: number,
    maximum: number,
): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new NutritionTargetError(
            field,
            `${field} must be a finite number between ${minimum} and ${maximum}, received ${String(value)}.`,
        );
    }
    return value;
}

function validate(request: NutritionTargetRequest): void {
    requireFiniteInRange('ageYears', request.ageYears, 1, 120);
    requireFiniteInRange('heightCentimetres', request.heightCentimetres, 50, 260);
    requireFiniteInRange('weightKilograms', request.weightKilograms, 20, 400);
    if (request.bodyFatPercentage !== undefined) {
        requireFiniteInRange('bodyFatPercentage', request.bodyFatPercentage, 1, 75);
    }
    if (request.mealsPerDay !== undefined) {
        requireFiniteInRange('mealsPerDay', request.mealsPerDay, 1, 8);
    }
}

/* ------------------------------------------------------------------------------------------------
 * Equations
 * ---------------------------------------------------------------------------------------------- */

/**
 * Mifflin–St Jeor (1990): `BMR = 10 × kg + 6.25 × cm − 5 × age + s`, where `s` is +5 for men and
 * −161 for women. See {@link CITATIONS.mifflin}.
 */
export function mifflinStJeorBmr(
    weightKilograms: number,
    heightCentimetres: number,
    ageYears: number,
    sex: CalculationSex,
): number {
    const sexConstant = sex === 'male' ? 5 : -161;
    return 10 * weightKilograms + 6.25 * heightCentimetres - 5 * ageYears + sexConstant;
}

/**
 * Katch–McArdle: `BMR = 370 + 21.6 × fat-free mass (kg)`. Uses body composition rather than sex
 * and height, so it is preferred whenever a body-fat percentage is supplied.
 * See {@link CITATIONS.katch}.
 */
export function katchMcArdleBmr(weightKilograms: number, bodyFatPercentage: number): number {
    const fatFreeMass = weightKilograms * (1 - bodyFatPercentage / 100);
    return 370 + 21.6 * fatFreeMass;
}

function selectMethod(request: NutritionTargetRequest): NutritionCalculationMethod {
    if (request.professionalOverride !== undefined) return 'professional_override';
    if (request.method === 'katch_mcardle' && request.bodyFatPercentage === undefined) {
        throw new NutritionTargetError(
            'bodyFatPercentage',
            'Katch–McArdle needs a body-fat percentage; none was supplied.',
        );
    }
    if (request.method === 'mifflin_st_jeor' || request.method === 'katch_mcardle') {
        return request.method;
    }
    return request.bodyFatPercentage === undefined ? 'mifflin_st_jeor' : 'katch_mcardle';
}

function macroTarget(
    nutrientId: MacroNutrientId,
    grams: number,
    targetEnergy: number,
    gramsPerKilogram: number | null,
): MacroTarget {
    const kilocalories = grams * ENERGY_PER_GRAM[nutrientId];
    return {
        nutrientId,
        grams,
        kilocalories,
        percentageOfEnergy: targetEnergy > 0 ? roundTo((kilocalories / targetEnergy) * 100, 1) : 0,
        gramsPerKilogram,
        tolerance: {
            min: roundTo(grams * (1 - MACRO_TOLERANCE_FRACTION), 0),
            max: roundTo(grams * (1 + MACRO_TOLERANCE_FRACTION), 0),
        },
    };
}

/* ------------------------------------------------------------------------------------------------
 * The engine
 * ---------------------------------------------------------------------------------------------- */

export interface MockNutritionTargetEngineOptions {
    /** The timestamp stamped on every result. Fixed by default so results are reproducible. */
    readonly now?: IsoDateTime | undefined;
}

export class MockNutritionTargetEngine implements NutritionTargetEngine {
    readonly name = 'MockNutritionTargetEngine';

    private readonly now: IsoDateTime;

    constructor(options: MockNutritionTargetEngineOptions = {}) {
        this.now = options.now ?? PROTOTYPE_CALCULATED_AT;
    }

    calculate(request: NutritionTargetRequest): NutritionTargetResult {
        validate(request);

        const method = selectMethod(request);
        const steps: NutritionTargetExplanationStep[] = [];
        const assumptions: string[] = [];
        const reviewReasons: string[] = [];

        /* 1 — resting rate ------------------------------------------------------------------- */

        const usesKatch =
            request.bodyFatPercentage !== undefined && request.method !== 'mifflin_st_jeor';

        const rawBmr = usesKatch
            ? katchMcArdleBmr(request.weightKilograms, request.bodyFatPercentage!)
            : mifflinStJeorBmr(
                  request.weightKilograms,
                  request.heightCentimetres,
                  request.ageYears,
                  request.sexForCalculation,
              );
        const basalMetabolicRate = roundTo(rawBmr, 0);

        steps.push(
            usesKatch
                ? {
                      id: 'bmr',
                      title: 'Resting energy from body composition',
                      detail:
                          'Because a body-fat percentage was supplied, the Katch–McArdle equation ' +
                          'is used: it works from fat-free mass and needs neither height nor sex.',
                      formula: 'BMR = 370 + 21.6 × fat-free mass (kg)',
                      inputs: {
                          weightKilograms: request.weightKilograms,
                          bodyFatPercentage: request.bodyFatPercentage!,
                          fatFreeMassKilograms: roundTo(
                              request.weightKilograms * (1 - request.bodyFatPercentage! / 100),
                              2,
                          ),
                      },
                      output: basalMetabolicRate,
                      unit: 'kcal',
                      citation: CITATIONS.katch,
                  }
                : {
                      id: 'bmr',
                      title: 'Resting energy',
                      detail:
                          'The Mifflin–St Jeor equation estimates resting energy expenditure from ' +
                          'weight, height and age, with a constant selected by the calculation input.',
                      formula: 'BMR = 10 × kg + 6.25 × cm − 5 × age + (male +5, female −161)',
                      inputs: {
                          weightKilograms: request.weightKilograms,
                          heightCentimetres: request.heightCentimetres,
                          ageYears: request.ageYears,
                          sexForCalculation: request.sexForCalculation,
                      },
                      output: basalMetabolicRate,
                      unit: 'kcal',
                      citation: CITATIONS.mifflin,
                  },
        );

        /* 2 — maintenance -------------------------------------------------------------------- */

        const multiplier = ACTIVITY_MULTIPLIERS[request.activityLevel];
        const maintenanceEnergy = roundTo(basalMetabolicRate * multiplier, 0);

        steps.push({
            id: 'maintenance',
            title: 'Estimated maintenance energy',
            detail:
                'The resting rate is multiplied by an activity factor for the stated habitual ' +
                'activity level. This is the figure a person would eat to hold their weight steady.',
            formula: 'Maintenance = BMR × activity factor',
            inputs: { basalMetabolicRate, activityLevel: request.activityLevel, multiplier },
            output: maintenanceEnergy,
            unit: 'kcal',
            citation: CITATIONS.activity,
        });

        /* 3 — goal and pace ------------------------------------------------------------------ */

        const adjustmentPercent = ENERGY_ADJUSTMENT_PERCENT[request.goal][request.pace];
        const adjustedEnergy = roundTo(maintenanceEnergy * (1 + adjustmentPercent / 100), 0);

        steps.push({
            id: 'goal_adjustment',
            title: 'Adjustment for the goal and pace',
            detail:
                'The goal and the chosen pace shift the target away from maintenance by a bounded ' +
                'percentage. The bounds are deliberate: a larger deficit does not make the result ' +
                'safer or faster in any durable sense.',
            formula: 'Target = maintenance × (1 + adjustment)',
            inputs: {
                maintenanceEnergy,
                goal: request.goal,
                pace: request.pace,
                adjustmentPercent,
            },
            output: adjustedEnergy,
            unit: 'kcal',
            citation: null,
        });

        /* 4 — safety floor ------------------------------------------------------------------- */

        const floor = ENERGY_FLOOR_KCAL[request.sexForCalculation];
        const computedEnergy = Math.max(adjustedEnergy, floor);

        if (computedEnergy > adjustedEnergy) {
            reviewReasons.push('energy_floor_applied');
            steps.push({
                id: 'energy_floor',
                title: 'Minimum-intake guard applied',
                detail:
                    `The adjusted figure fell below the ${floor} kcal guard this prototype uses, so ` +
                    'the target was raised to it and the result flagged for professional review. ' +
                    'The guard is an interface safeguard, not a clinical recommendation.',
                formula: 'Target = max(adjusted target, floor)',
                inputs: { adjustedEnergy, floor },
                output: computedEnergy,
                unit: 'kcal',
                citation: CITATIONS.floors,
            });
        }

        /* 5 — macronutrient split ------------------------------------------------------------ */

        const override = request.professionalOverride ?? null;
        const targetEnergy =
            override?.energyKilocalories !== undefined && override?.energyKilocalories !== null
                ? override.energyKilocalories
                : computedEnergy;

        const proteinPerKilogram = PROTEIN_GRAMS_PER_KILOGRAM[request.goal];
        const proteinGrams = roundTo(request.weightKilograms * proteinPerKilogram, 0);

        const fatFraction = FAT_ENERGY_FRACTION[request.goal];
        const fatGrams = roundTo((targetEnergy * fatFraction) / ENERGY_PER_GRAM.fat, 0);

        const carbohydrateEnergy =
            targetEnergy - proteinGrams * ENERGY_PER_GRAM.protein - fatGrams * ENERGY_PER_GRAM.fat;
        const carbohydrateGrams = Math.max(
            0,
            roundTo(carbohydrateEnergy / ENERGY_PER_GRAM.carbohydrate, 0),
        );

        const computedMacros: readonly MacroTarget[] = [
            macroTarget('protein', proteinGrams, targetEnergy, proteinPerKilogram),
            macroTarget('carbohydrate', carbohydrateGrams, targetEnergy, null),
            macroTarget('fat', fatGrams, targetEnergy, null),
        ];

        steps.push({
            id: 'protein',
            title: 'Protein',
            detail:
                'Protein is set per kilogram of body mass rather than as a share of energy, because ' +
                'that is how the evidence is reported and because it keeps the figure stable when ' +
                'the energy target changes.',
            formula: 'Protein (g) = body mass (kg) × grams per kilogram',
            inputs: { weightKilograms: request.weightKilograms, proteinPerKilogram },
            output: proteinGrams,
            unit: 'g',
            citation: CITATIONS.protein,
        });

        steps.push({
            id: 'fat',
            title: 'Fat',
            detail:
                'Fat takes a share of the energy target inside the published acceptable range, then ' +
                'converts to grams at 9 kcal per gram.',
            formula: 'Fat (g) = target energy × fat share ÷ 9',
            inputs: { targetEnergy, fatFraction },
            output: fatGrams,
            unit: 'g',
            citation: CITATIONS.fat,
        });

        steps.push({
            id: 'carbohydrate',
            title: 'Carbohydrate',
            detail:
                'Carbohydrate takes whatever energy is left once protein and fat are set, at ' +
                '4 kcal per gram. Because each figure is rounded to a whole gram, the three ' +
                'percentages may not add to exactly 100 %.',
            formula: 'Carbohydrate (g) = (target energy − protein kcal − fat kcal) ÷ 4',
            inputs: {
                targetEnergy,
                proteinKilocalories: proteinGrams * ENERGY_PER_GRAM.protein,
                fatKilocalories: fatGrams * ENERGY_PER_GRAM.fat,
            },
            output: carbohydrateGrams,
            unit: 'g',
            citation: CITATIONS.atwater,
        });

        /* 6 — fibre -------------------------------------------------------------------------- */

        const fibreGrams = roundTo((FIBRE_GRAMS_PER_1000_KCAL * targetEnergy) / 1000, 0);

        steps.push({
            id: 'fibre',
            title: 'Fibre',
            detail: 'Fibre scales with energy intake at the published adequate-intake rate.',
            formula: 'Fibre (g) = 14 × target energy ÷ 1,000',
            inputs: { targetEnergy, gramsPer1000Kcal: FIBRE_GRAMS_PER_1000_KCAL },
            output: fibreGrams,
            unit: 'g',
            citation: CITATIONS.fibre,
        });

        /* 7 — professional override ---------------------------------------------------------- */

        const macros = override?.macros != null ? override.macros : computedMacros;

        if (override !== null) {
            steps.push({
                id: 'professional_override',
                title: 'Replaced by a dietitian',
                detail:
                    'A qualified dietitian replaced part of this calculation. The steps above are ' +
                    'kept so the change is visible, but the figures shown are the dietitian’s.',
                formula: null,
                inputs: {
                    dietitianId: override.dietitianId,
                    approvedAt: override.approvedAt,
                    reason: override.reason,
                    energyOverridden: override.energyKilocalories === null ? 'no' : 'yes',
                    macrosOverridden: override.macros === null ? 'no' : 'yes',
                },
                output: targetEnergy,
                unit: 'kcal',
                citation: null,
            });
        }

        /* 8 — review flags ------------------------------------------------------------------- */

        if (request.ageYears < 18) reviewReasons.push('under_eighteen');
        if (request.ageYears > 75) reviewReasons.push('over_seventy_five');

        const heightMetres = request.heightCentimetres / 100;
        const bodyMassIndex = request.weightKilograms / (heightMetres * heightMetres);
        if (bodyMassIndex < 16) reviewReasons.push('very_low_body_mass_index');
        if (bodyMassIndex > 40) reviewReasons.push('very_high_body_mass_index');

        if (request.bodyFatPercentage !== undefined && request.bodyFatPercentage > 45) {
            reviewReasons.push('high_body_fat_percentage');
        }
        if (request.goal === 'lose_weight' && request.pace === 'ambitious') {
            reviewReasons.push('aggressive_deficit');
        }
        for (const constraint of request.constraints ?? []) {
            if (isSafetyCriticalRestriction(constraint.kind)) {
                reviewReasons.push('safety_critical_restriction');
                break;
            }
        }

        /* 9 — assumptions -------------------------------------------------------------------- */

        assumptions.push(
            'Height and weight are read in centimetres and kilograms; the measurement system only ' +
                'changes how they are displayed.',
        );
        if (!usesKatch) {
            assumptions.push(
                'No body-fat percentage was supplied, so resting energy is estimated from weight, ' +
                    'height and age rather than from body composition.',
            );
        }
        assumptions.push(
            'The activity factor describes habitual activity, not a single day, and is ' +
                'self-reported.',
        );
        if (request.mealsPerDay === undefined) {
            assumptions.push(
                'No meal count was supplied, so the day is not split into meals here.',
            );
        }

        const nutrients: readonly NutrientTarget[] = [
            {
                nutrientId: 'fibre',
                unit: 'g',
                value: fibreGrams,
                tolerance: { min: fibreGrams, max: roundTo(fibreGrams * 1.5, 0) },
                basis: 'per_day',
                direction: 'at_least',
                rationale: 'Scaled from the target energy at 14 g per 1,000 kcal.',
            },
        ];

        // A dietitian's decision *is* the professional review, so applying one clears the flag.
        const professionallyReviewed = override !== null;

        return {
            id: null,
            prototype: true,
            method,
            request,
            basalMetabolicRate,
            maintenanceEnergy,
            targetEnergy,
            energyTolerance: {
                min: roundTo(targetEnergy * (1 - ENERGY_TOLERANCE_FRACTION), 0),
                max: roundTo(targetEnergy * (1 + ENERGY_TOLERANCE_FRACTION), 0),
            },
            macros,
            nutrients,
            explanation: {
                summary:
                    `Estimated maintenance is ${maintenanceEnergy} kcal a day. The ` +
                    `${request.goal.replace(/_/g, ' ')} goal at a ${request.pace} pace moves the ` +
                    `target to ${targetEnergy} kcal.`,
                steps,
                assumptions,
                citations: [...new Set(steps.map((step) => step.citation).filter(isString))],
                disclaimer: TARGET_DISCLAIMER,
            },
            requiresProfessionalReview: !professionallyReviewed && reviewReasons.length > 0,
            reviewReasons: professionallyReviewed ? [] : [...new Set(reviewReasons)],
            override,
            calculatedAt: this.now,
        };
    }
}

function isString(value: string | null): value is string {
    return value !== null;
}

/** Convenience factory, mirroring the repository factories elsewhere in the workspace. */
export function createMockNutritionTargetEngine(
    options: MockNutritionTargetEngineOptions = {},
): NutritionTargetEngine {
    return new MockNutritionTargetEngine(options);
}
