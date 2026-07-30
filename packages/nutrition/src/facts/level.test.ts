import { describe, expect, it } from 'vitest';

import {
    NUTRITION_LEVELS,
    nutritionLevelForAmount,
    nutritionLevelForRatio,
    nutritionLevelRank,
    readNutritionLevels,
    worstNutritionLevel,
} from './level.ts';
import type { NutrientTarget, NutritionFacts } from './model.ts';

const FACTS: NutritionFacts = {
    basis: 'per_day',
    kind: 'planned',
    serving: null,
    totalGrams: null,
    amounts: [
        { nutrientId: 'energy', unit: 'kcal', value: 1800, kind: 'planned', tolerance: null },
        { nutrientId: 'protein', unit: 'g', value: 90, kind: 'planned', tolerance: null },
        { nutrientId: 'sodium', unit: 'mg', value: 3000, kind: 'planned', tolerance: null },
    ],
    source: {
        kind: 'synthetic_prototype',
        label: 'Healthy360 synthetic prototype data set',
        version: '1.0.0',
        calculatedAt: '2026-01-15T09:30:00.000Z',
    },
    calculation: {
        method: 'fixture',
        basis: 'per_day',
        calculatedAt: '2026-01-15T09:30:00.000Z',
        prototype: true,
        rounding: 'none',
        notes: [],
    },
};

function target(overrides: Partial<NutrientTarget> = {}): NutrientTarget {
    return {
        nutrientId: 'energy',
        unit: 'kcal',
        value: 2000,
        tolerance: { min: 1800, max: 2200 },
        basis: 'per_day',
        direction: 'hit',
        rationale: null,
        ...overrides,
    };
}

describe('the five stops', () => {
    it('are exactly the design-token scale, in worsening order', () => {
        expect([...NUTRITION_LEVELS]).toEqual(['optimal', 'good', 'moderate', 'high', 'excessive']);
    });

    it('rank from zero upwards', () => {
        expect(NUTRITION_LEVELS.map(nutritionLevelRank)).toEqual([0, 1, 2, 3, 4]);
    });

    it('worstNutritionLevel picks the highest rank, and optimal for an empty set', () => {
        expect(worstNutritionLevel(['optimal', 'moderate', 'good'])).toBe('moderate');
        expect(worstNutritionLevel(['excessive', 'optimal'])).toBe('excessive');
        expect(worstNutritionLevel([])).toBe('optimal');
    });
});

describe('nutritionLevelForRatio — hit', () => {
    it.each([
        [1, 'optimal'],
        [0.9, 'optimal'],
        [1.1, 'optimal'],
        [0.89, 'good'],
        [1.2, 'good'],
        [1.21, 'moderate'],
        [0.7, 'moderate'],
        [1.31, 'high'],
        [0.6, 'high'],
        [1.41, 'excessive'],
        [0.59, 'excessive'],
        [0, 'excessive'],
    ] as const)('ratio %s → %s', (ratio, expected) => {
        expect(nutritionLevelForRatio(ratio)).toBe(expected);
    });

    it('treats the band edge as belonging to the better stop', () => {
        expect(nutritionLevelForRatio(1.1)).toBe('optimal');
        expect(nutritionLevelForRatio(1.1000001)).toBe('good');
    });
});

describe('nutritionLevelForRatio — at_least', () => {
    it.each([
        [1.5, 'optimal'],
        [1, 'optimal'],
        [0.95, 'good'],
        [0.9, 'good'],
        [0.85, 'moderate'],
        [0.8, 'moderate'],
        [0.75, 'high'],
        [0.7, 'high'],
        [0.69, 'excessive'],
    ] as const)('ratio %s → %s', (ratio, expected) => {
        expect(nutritionLevelForRatio(ratio, { direction: 'at_least' })).toBe(expected);
    });

    it('never penalises an overshoot', () => {
        expect(nutritionLevelForRatio(3, { direction: 'at_least' })).toBe('optimal');
    });
});

describe('nutritionLevelForRatio — at_most', () => {
    it.each([
        [0.2, 'optimal'],
        [1, 'optimal'],
        [1.05, 'good'],
        [1.1, 'good'],
        [1.15, 'moderate'],
        [1.2, 'moderate'],
        [1.25, 'high'],
        [1.3, 'high'],
        [1.31, 'excessive'],
    ] as const)('ratio %s → %s', (ratio, expected) => {
        expect(nutritionLevelForRatio(ratio, { direction: 'at_most' })).toBe(expected);
    });

    it('never penalises an undershoot', () => {
        expect(nutritionLevelForRatio(0, { direction: 'at_most' })).toBe('optimal');
    });
});

describe('band width', () => {
    it('a tighter band moves the boundaries in', () => {
        expect(nutritionLevelForRatio(1.04, { band: 0.05 })).toBe('optimal');
        expect(nutritionLevelForRatio(1.06, { band: 0.05 })).toBe('good');
    });

    it('an invalid band or ratio degrades to the worst stop rather than silently passing', () => {
        expect(nutritionLevelForRatio(Number.NaN)).toBe('excessive');
        expect(nutritionLevelForRatio(1, { band: 0 })).toBe('excessive');
        expect(nutritionLevelForRatio(1, { band: -0.1 })).toBe('excessive');
    });
});

describe('nutritionLevelForAmount', () => {
    it('derives the band from the target tolerance when one is present', () => {
        // 1800–2200 around 2000 is a ±10 % band, so 2200 is still optimal and 2260 is not.
        expect(nutritionLevelForAmount(2200, target())).toBe('optimal');
        expect(nutritionLevelForAmount(2300, target())).toBe('good');
    });

    it('honours the target direction', () => {
        const protein = target({
            nutrientId: 'protein',
            unit: 'g',
            value: 120,
            tolerance: { min: 108, max: 132 },
            direction: 'at_least',
        });
        expect(nutritionLevelForAmount(200, protein)).toBe('optimal');
        expect(nutritionLevelForAmount(100, protein)).toBe('moderate');
    });

    it('handles a zero target without dividing by it', () => {
        const zero = target({ value: 0, tolerance: { min: 0, max: 0 } });
        expect(nutritionLevelForAmount(0, zero)).toBe('optimal');
        expect(nutritionLevelForAmount(1, zero)).toBe('excessive');
    });

    it('falls back to the default band when the tolerance is a point', () => {
        const point = target({ tolerance: { min: 2000, max: 2000 } });
        expect(nutritionLevelForAmount(2200, point)).toBe('optimal');
        expect(nutritionLevelForAmount(2400, point)).toBe('good');
    });
});

describe('readNutritionLevels', () => {
    const targets: readonly NutrientTarget[] = [
        target({ value: 1800, tolerance: { min: 1710, max: 1890 } }),
        target({
            nutrientId: 'protein',
            unit: 'g',
            value: 120,
            tolerance: { min: 108, max: 132 },
            direction: 'at_least',
        }),
        target({
            nutrientId: 'sodium',
            unit: 'mg',
            value: 2000,
            tolerance: { min: 1800, max: 2200 },
            direction: 'at_most',
        }),
    ];

    it('produces one reading per target, in order', () => {
        const readings = readNutritionLevels(FACTS, targets);
        expect(readings.map((reading) => reading.nutrientId)).toEqual([
            'energy',
            'protein',
            'sodium',
        ]);
        expect(readings[0]!.level).toBe('optimal');
        // 90 g against a 120 g protein floor is 75 % of the target: three bands short.
        expect(readings[1]!.level).toBe('high');
        expect(readings[2]!.level).toBe('excessive');
    });

    it('reports a missing nutrient as zero rather than omitting it', () => {
        const readings = readNutritionLevels(FACTS, [
            target({
                nutrientId: 'fibre',
                unit: 'g',
                value: 30,
                tolerance: { min: 27, max: 33 },
                direction: 'at_least',
            }),
        ]);
        expect(readings[0]!.value).toBe(0);
        expect(readings[0]!.level).toBe('excessive');
    });

    it('carries the raw ratio so a meter can render a partial bar', () => {
        const readings = readNutritionLevels(FACTS, targets);
        expect(readings[0]!.ratio).toBe(1);
        expect(readings[1]!.ratio).toBe(0.75);
    });
});
