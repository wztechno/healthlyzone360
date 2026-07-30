import { DietitianId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import type { MacroNutrientId, MacroTarget } from '../facts/model.ts';
import type {
    NutritionConstraint,
    NutritionTargetRequest,
    ProfessionalOverride,
} from './contract.ts';
import {
    ACTIVITY_MULTIPLIERS,
    ENERGY_ADJUSTMENT_PERCENT,
    ENERGY_FLOOR_KCAL,
    FAT_ENERGY_FRACTION,
    MockNutritionTargetEngine,
    NutritionTargetError,
    PROTEIN_GRAMS_PER_KILOGRAM,
    PROTOTYPE_CALCULATED_AT,
    TARGET_DISCLAIMER,
    createMockNutritionTargetEngine,
    katchMcArdleBmr,
    mifflinStJeorBmr,
} from './engine.ts';

const engine = new MockNutritionTargetEngine();

function request(overrides: Partial<NutritionTargetRequest> = {}): NutritionTargetRequest {
    return {
        measurementSystem: 'metric',
        ageYears: 30,
        sexForCalculation: 'female',
        heightCentimetres: 165,
        weightKilograms: 62,
        activityLevel: 'moderately_active',
        goal: 'lose_weight',
        pace: 'standard',
        ...overrides,
    };
}

function macro(macros: readonly MacroTarget[], id: MacroNutrientId): MacroTarget {
    const found = macros.find((entry) => entry.nutrientId === id);
    if (found === undefined) throw new Error(`missing macro ${id}`);
    return found;
}

describe('published constants', () => {
    it('uses the standard activity factors', () => {
        expect(ACTIVITY_MULTIPLIERS).toEqual({
            sedentary: 1.2,
            lightly_active: 1.375,
            moderately_active: 1.55,
            very_active: 1.725,
            extra_active: 1.9,
        });
    });

    it('bounds every goal and pace adjustment to −20 %…+15 %', () => {
        for (const byPace of Object.values(ENERGY_ADJUSTMENT_PERCENT)) {
            for (const percent of Object.values(byPace)) {
                expect(percent).toBeGreaterThanOrEqual(-20);
                expect(percent).toBeLessThanOrEqual(15);
            }
        }
    });

    it('keeps every fat share inside the published 20–35 % range', () => {
        for (const fraction of Object.values(FAT_ENERGY_FRACTION)) {
            expect(fraction).toBeGreaterThanOrEqual(0.2);
            expect(fraction).toBeLessThanOrEqual(0.35);
        }
    });

    it('keeps the muscle-gain protein figure inside the cited 1.6–2.2 g/kg band', () => {
        expect(PROTEIN_GRAMS_PER_KILOGRAM.gain_muscle).toBeGreaterThanOrEqual(1.6);
        expect(PROTEIN_GRAMS_PER_KILOGRAM.gain_muscle).toBeLessThanOrEqual(2.2);
    });

    it('states the guard floors as 1200 and 1500 kcal', () => {
        expect(ENERGY_FLOOR_KCAL).toEqual({ female: 1200, male: 1500 });
    });
});

describe('published equations', () => {
    it('Mifflin–St Jeor matches the paper for both constants', () => {
        // 10 × 62 + 6.25 × 165 − 5 × 30 − 161
        expect(mifflinStJeorBmr(62, 165, 30, 'female')).toBeCloseTo(1340.25, 10);
        // 10 × 80 + 6.25 × 180 − 5 × 28 + 5
        expect(mifflinStJeorBmr(80, 180, 28, 'male')).toBeCloseTo(1790, 10);
    });

    it('Katch–McArdle works from fat-free mass', () => {
        // 370 + 21.6 × (80 × 0.85)
        expect(katchMcArdleBmr(80, 15)).toBeCloseTo(1838.8, 10);
    });
});

describe('known input → known output: Mifflin–St Jeor, weight loss', () => {
    const result = engine.calculate(request());

    it('reports the resting rate and maintenance energy', () => {
        expect(result.method).toBe('mifflin_st_jeor');
        expect(result.basalMetabolicRate).toBe(1340);
        expect(result.maintenanceEnergy).toBe(2077);
    });

    it('applies the −15 % standard-pace adjustment', () => {
        expect(result.targetEnergy).toBe(1765);
        expect(result.energyTolerance).toEqual({ min: 1677, max: 1853 });
    });

    it('splits the macros from body mass, the fat share and the remainder', () => {
        expect(macro(result.macros, 'protein').grams).toBe(112);
        expect(macro(result.macros, 'fat').grams).toBe(59);
        expect(macro(result.macros, 'carbohydrate').grams).toBe(197);
    });

    it('reports macro percentages and per-kilogram figures', () => {
        expect(macro(result.macros, 'protein').percentageOfEnergy).toBe(25.4);
        expect(macro(result.macros, 'carbohydrate').percentageOfEnergy).toBe(44.6);
        expect(macro(result.macros, 'fat').percentageOfEnergy).toBe(30.1);
        expect(macro(result.macros, 'protein').gramsPerKilogram).toBe(1.8);
        expect(macro(result.macros, 'carbohydrate').gramsPerKilogram).toBeNull();
    });

    it('gives every macro a ±10 % tolerance band', () => {
        expect(macro(result.macros, 'protein').tolerance).toEqual({ min: 101, max: 123 });
    });

    it('sets fibre from the 14 g per 1,000 kcal guideline', () => {
        const fibre = result.nutrients.find((nutrient) => nutrient.nutrientId === 'fibre');
        expect(fibre?.value).toBe(25);
        expect(fibre?.direction).toBe('at_least');
        expect(fibre?.basis).toBe('per_day');
    });

    it('needs no professional review for an unremarkable adult', () => {
        expect(result.requiresProfessionalReview).toBe(false);
        expect(result.reviewReasons).toEqual([]);
    });
});

describe('known input → known output: Katch–McArdle, muscle gain', () => {
    const result = engine.calculate(
        request({
            sexForCalculation: 'male',
            ageYears: 28,
            heightCentimetres: 180,
            weightKilograms: 80,
            bodyFatPercentage: 15,
            activityLevel: 'very_active',
            goal: 'gain_muscle',
            pace: 'standard',
        }),
    );

    it('switches method as soon as a body-fat percentage is supplied', () => {
        expect(result.method).toBe('katch_mcardle');
        expect(result.basalMetabolicRate).toBe(1839);
        expect(result.maintenanceEnergy).toBe(3172);
    });

    it('applies the +10 % surplus', () => {
        expect(result.targetEnergy).toBe(3489);
    });

    it('uses the muscle-gain protein and fat figures', () => {
        expect(macro(result.macros, 'protein').grams).toBe(160);
        expect(macro(result.macros, 'fat').grams).toBe(97);
        expect(macro(result.macros, 'carbohydrate').grams).toBe(494);
    });

    it('explains the body-composition step and cites Katch–McArdle', () => {
        const step = result.explanation.steps.find((entry) => entry.id === 'bmr');
        expect(step?.formula).toContain('370');
        expect(step?.citation).toContain('Katch');
        expect(step?.inputs.fatFreeMassKilograms).toBe(68);
    });
});

describe('the safety floor', () => {
    const result = engine.calculate(
        request({
            ageYears: 22,
            heightCentimetres: 150,
            weightKilograms: 45,
            activityLevel: 'sedentary',
            goal: 'lose_weight',
            pace: 'ambitious',
        }),
    );

    it('clamps the target to the floor rather than showing the computed figure', () => {
        expect(result.targetEnergy).toBe(1200);
    });

    it('flags the result for professional review and says why', () => {
        expect(result.requiresProfessionalReview).toBe(true);
        expect([...result.reviewReasons].sort()).toEqual([
            'aggressive_deficit',
            'energy_floor_applied',
        ]);
    });

    it('records the clamp as an explanation step, framed as an interface guard', () => {
        const step = result.explanation.steps.find((entry) => entry.id === 'energy_floor');
        expect(step).toBeDefined();
        expect(step?.detail).toContain('not a clinical recommendation');
        expect(step?.output).toBe(1200);
    });

    it('recomputes the macros from the clamped target', () => {
        expect(macro(result.macros, 'protein').grams).toBe(81);
        expect(macro(result.macros, 'fat').grams).toBe(40);
        expect(macro(result.macros, 'carbohydrate').grams).toBe(129);
    });

    it('does not clamp when the computed figure is above the floor', () => {
        const comfortable = engine.calculate(request());
        expect(comfortable.explanation.steps.some((step) => step.id === 'energy_floor')).toBe(
            false,
        );
    });
});

describe('review flags', () => {
    it.each([
        ['under_eighteen', request({ ageYears: 16 })],
        ['over_seventy_five', request({ ageYears: 80 })],
        ['very_low_body_mass_index', request({ weightKilograms: 40, heightCentimetres: 175 })],
        ['very_high_body_mass_index', request({ weightKilograms: 130, heightCentimetres: 165 })],
        ['high_body_fat_percentage', request({ bodyFatPercentage: 50 })],
        ['aggressive_deficit', request({ goal: 'lose_weight', pace: 'ambitious' })],
    ])('raises %s', (reason, input) => {
        const result = engine.calculate(input);
        expect(result.reviewReasons).toContain(reason);
        expect(result.requiresProfessionalReview).toBe(true);
    });

    it('raises a single flag for any safety-critical restriction', () => {
        const constraints: readonly NutritionConstraint[] = [
            {
                kind: 'allergy',
                code: 'peanut',
                label: 'Peanut',
                severity: 'critical',
                source: 'user',
                note: null,
            },
            {
                kind: 'dietitian_enforced',
                code: 'low_potassium',
                label: 'Low potassium',
                severity: 'strict',
                source: 'dietitian',
                note: null,
            },
        ];
        const result = engine.calculate(request({ constraints }));
        expect(
            result.reviewReasons.filter((reason) => reason === 'safety_critical_restriction'),
        ).toHaveLength(1);
    });

    it('ignores a plain preference', () => {
        const result = engine.calculate(
            request({
                constraints: [
                    {
                        kind: 'dislike',
                        code: 'olives',
                        label: 'Olives',
                        severity: 'advisory',
                        source: 'user',
                        note: null,
                    },
                ],
            }),
        );
        expect(result.reviewReasons).toEqual([]);
    });
});

describe('professional override', () => {
    const override: ProfessionalOverride = {
        dietitianId: DietitianId.unsafe('01935f6d-0000-7000-8000-0000000000d1'),
        reason: 'Adjusted for a clinical protocol.',
        approvedAt: '2026-02-01T10:00:00.000Z',
        energyKilocalories: 1900,
        macros: null,
    };

    it('reports the override method and the dietitian’s energy figure', () => {
        const result = engine.calculate(request({ professionalOverride: override }));
        expect(result.method).toBe('professional_override');
        expect(result.targetEnergy).toBe(1900);
        expect(result.override).toEqual(override);
    });

    it('recomputes the split against the overridden energy', () => {
        const result = engine.calculate(request({ professionalOverride: override }));
        expect(macro(result.macros, 'protein').grams).toBe(112);
        expect(macro(result.macros, 'fat').grams).toBe(63);
        expect(macro(result.macros, 'carbohydrate').grams).toBe(221);
        expect(result.nutrients[0]!.value).toBe(27);
    });

    it('passes an overridden macro split straight through', () => {
        const macros: readonly MacroTarget[] = [
            {
                nutrientId: 'protein',
                grams: 150,
                kilocalories: 600,
                percentageOfEnergy: 31.6,
                gramsPerKilogram: null,
                tolerance: { min: 140, max: 160 },
            },
        ];
        const result = engine.calculate(request({ professionalOverride: { ...override, macros } }));
        expect(result.macros).toEqual(macros);
    });

    it('keeps the computed energy when the override does not replace it', () => {
        const result = engine.calculate(
            request({ professionalOverride: { ...override, energyKilocalories: null } }),
        );
        expect(result.targetEnergy).toBe(1765);
    });

    it('clears the review flag — a dietitian’s decision is the review', () => {
        const result = engine.calculate(
            request({ goal: 'lose_weight', pace: 'ambitious', professionalOverride: override }),
        );
        expect(result.requiresProfessionalReview).toBe(false);
        expect(result.reviewReasons).toEqual([]);
    });

    it('records the override as a visible explanation step', () => {
        const result = engine.calculate(request({ professionalOverride: override }));
        const step = result.explanation.steps.find((entry) => entry.id === 'professional_override');
        expect(step?.inputs.energyOverridden).toBe('yes');
        expect(step?.inputs.macrosOverridden).toBe('no');
    });
});

describe('method selection', () => {
    it('prefers Mifflin–St Jeor when no body fat is known', () => {
        expect(engine.calculate(request()).method).toBe('mifflin_st_jeor');
    });

    it('honours an explicit Mifflin request even when body fat is available', () => {
        const result = engine.calculate(
            request({ bodyFatPercentage: 20, method: 'mifflin_st_jeor' }),
        );
        expect(result.method).toBe('mifflin_st_jeor');
        expect(result.basalMetabolicRate).toBe(1340);
    });

    it('refuses Katch–McArdle without a body-fat percentage', () => {
        expect(() => engine.calculate(request({ method: 'katch_mcardle' }))).toThrow(
            NutritionTargetError,
        );
    });
});

describe('validation', () => {
    it.each([
        ['ageYears', request({ ageYears: 0 })],
        ['heightCentimetres', request({ heightCentimetres: 10 })],
        ['weightKilograms', request({ weightKilograms: 1000 })],
        ['bodyFatPercentage', request({ bodyFatPercentage: 90 })],
        ['mealsPerDay', request({ mealsPerDay: 0 })],
    ])('rejects an out-of-range %s', (field, input) => {
        expect(() => engine.calculate(input)).toThrow(NutritionTargetError);
        try {
            engine.calculate(input);
        } catch (error) {
            expect((error as NutritionTargetError).field).toBe(field);
        }
    });
});

describe('result contract', () => {
    const result = engine.calculate(request());

    it('marks itself as a prototype and echoes its inputs', () => {
        expect(result.prototype).toBe(true);
        expect(result.request).toEqual(request());
        expect(result.id).toBeNull();
    });

    it('stamps a fixed timestamp so results are reproducible', () => {
        expect(result.calculatedAt).toBe(PROTOTYPE_CALCULATED_AT);
        expect(
            new MockNutritionTargetEngine({ now: '2030-01-01T00:00:00.000Z' }).calculate(request())
                .calculatedAt,
        ).toBe('2030-01-01T00:00:00.000Z');
    });

    it('is deterministic — the same request twice gives an identical result', () => {
        expect(engine.calculate(request())).toEqual(engine.calculate(request()));
        expect(createMockNutritionTargetEngine().calculate(request())).toEqual(result);
    });

    it('carries an explanation with a citation for every arithmetic step', () => {
        const summarised = result.explanation.steps.map((step) => step.id);
        expect(summarised).toEqual([
            'bmr',
            'maintenance',
            'goal_adjustment',
            'protein',
            'fat',
            'carbohydrate',
            'fibre',
        ]);
        for (const step of result.explanation.steps) {
            expect(step.title.length, step.id).toBeGreaterThan(0);
            expect(step.detail.length, step.id).toBeGreaterThan(0);
        }
        expect(result.explanation.citations.length).toBeGreaterThanOrEqual(4);
        expect(result.explanation.citations.join(' ')).toContain('Mifflin');
    });

    it('always carries the disclaimer and never claims to be medical advice', () => {
        expect(result.explanation.disclaimer).toBe(TARGET_DISCLAIMER);
        expect(result.explanation.disclaimer).toContain('not medical advice');
    });

    it('records the assumptions it had to make', () => {
        expect(result.explanation.assumptions.length).toBeGreaterThan(0);
        expect(result.explanation.assumptions.join(' ')).toContain('body-fat percentage');
    });

    it('names itself, so a screen can say which engine produced a figure', () => {
        expect(engine.name).toBe('MockNutritionTargetEngine');
    });
});

describe('coverage of every goal and pace', () => {
    it('produces a usable target for all twelve combinations', () => {
        for (const goal of ['lose_weight', 'maintain', 'gain_muscle', 'recomposition'] as const) {
            for (const pace of ['gentle', 'standard', 'ambitious'] as const) {
                const result = engine.calculate(request({ goal, pace }));
                expect(result.targetEnergy, `${goal}/${pace}`).toBeGreaterThanOrEqual(1200);
                expect(macro(result.macros, 'carbohydrate').grams).toBeGreaterThanOrEqual(0);
                expect(result.macros).toHaveLength(3);
            }
        }
    });

    it('never lets the macro energy exceed the target by more than rounding', () => {
        for (const goal of ['lose_weight', 'maintain', 'gain_muscle', 'recomposition'] as const) {
            const result = engine.calculate(request({ goal }));
            const macroEnergy = result.macros.reduce(
                (total, entry) => total + entry.kilocalories,
                0,
            );
            expect(Math.abs(macroEnergy - result.targetEnergy), goal).toBeLessThanOrEqual(6);
        }
    });
});
