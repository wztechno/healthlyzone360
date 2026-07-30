import {
    amountValue,
    type NutrientTarget,
    type NutritionFacts,
    type TargetDirection,
} from './model.ts';

/**
 * Mapping an amount against its target onto the five-stop scale the design tokens carry
 * (`nutrition-optimal` … `nutrition-excessive`, each with a pattern so meaning is never conveyed by
 * colour alone).
 *
 * The mapping is *ours* and is stated in full below, because a nutrition meter that turns amber for
 * unexplained reasons is worse than no meter. It is also direction-aware: 90 % of a protein target
 * and 90 % of a sodium ceiling are opposite outcomes, and a scale that cannot express that is
 * actively misleading.
 */

export const NUTRITION_LEVELS = ['optimal', 'good', 'moderate', 'high', 'excessive'] as const;
export type NutritionLevel = (typeof NUTRITION_LEVELS)[number];

const LEVEL_RANK: Readonly<Record<NutritionLevel, number>> = {
    optimal: 0,
    good: 1,
    moderate: 2,
    high: 3,
    excessive: 4,
};

/** Ordinal severity, `0` for `optimal` through `4` for `excessive`. Useful for `Math.max` roll-ups. */
export function nutritionLevelRank(level: NutritionLevel): number {
    return LEVEL_RANK[level];
}

/** The worst level in a set — how a day's badge is derived from its nutrients. */
export function worstNutritionLevel(levels: readonly NutritionLevel[]): NutritionLevel {
    return levels.reduce<NutritionLevel>(
        (worst, level) => (nutritionLevelRank(level) > nutritionLevelRank(worst) ? level : worst),
        'optimal',
    );
}

/**
 * The band width, as a fraction of the target, that separates one stop from the next.
 *
 * 10 % is deliberate: it is roughly the precision a household portion can actually be measured to,
 * so a tighter band would report noise as a deviation.
 */
export const DEFAULT_LEVEL_BAND = 0.1;

/**
 * Slack on every boundary comparison.
 *
 * `1.1 - 1` is `0.10000000000000009` in binary floating point, so a person who lands exactly on the
 * edge of a 10 % band would otherwise be told they missed it. A nanoscale tolerance is far below
 * anything a portion can be measured to and removes the artefact entirely.
 */
const COMPARISON_EPSILON = 1e-9;

function atLeast(value: number, limit: number): boolean {
    return value >= limit - COMPARISON_EPSILON;
}

function atMost(value: number, limit: number): boolean {
    return value <= limit + COMPARISON_EPSILON;
}

export interface LevelOptions {
    /** Fraction of the target that one stop spans. Defaults to {@link DEFAULT_LEVEL_BAND}. */
    readonly band?: number | undefined;
    /**
     * How the target should be met. Defaults to `hit`. `at_least` treats any overshoot as optimal
     * (more protein than the floor is not a problem); `at_most` treats any undershoot as optimal.
     */
    readonly direction?: TargetDirection | undefined;
}

/**
 * Maps a value/target ratio onto the five-stop scale.
 *
 * With the default 10 % band:
 *
 * | direction  | optimal        | good            | moderate        | high            | excessive |
 * |------------|----------------|-----------------|-----------------|-----------------|-----------|
 * | `hit`      | 0.90 – 1.10    | 0.80 – 1.20     | 0.70 – 1.30     | 0.60 – 1.40     | outside   |
 * | `at_least` | ≥ 1.00         | ≥ 0.90          | ≥ 0.80          | ≥ 0.70          | < 0.70    |
 * | `at_most`  | ≤ 1.00         | ≤ 1.10          | ≤ 1.20          | ≤ 1.30          | > 1.30    |
 *
 * Boundaries are inclusive of the better stop, so a ratio of exactly 1.10 against a `hit` target is
 * `optimal`, not `good` — a person who hits the edge of the band has met the target.
 */
export function nutritionLevelForRatio(ratio: number, options: LevelOptions = {}): NutritionLevel {
    const band = options.band ?? DEFAULT_LEVEL_BAND;
    const direction = options.direction ?? 'hit';

    if (!Number.isFinite(ratio) || !Number.isFinite(band) || band <= 0) return 'excessive';

    if (direction === 'at_least') {
        if (atLeast(ratio, 1)) return 'optimal';
        if (atLeast(ratio, 1 - band)) return 'good';
        if (atLeast(ratio, 1 - 2 * band)) return 'moderate';
        if (atLeast(ratio, 1 - 3 * band)) return 'high';
        return 'excessive';
    }

    if (direction === 'at_most') {
        if (atMost(ratio, 1)) return 'optimal';
        if (atMost(ratio, 1 + band)) return 'good';
        if (atMost(ratio, 1 + 2 * band)) return 'moderate';
        if (atMost(ratio, 1 + 3 * band)) return 'high';
        return 'excessive';
    }

    const deviation = Math.abs(ratio - 1);
    if (atMost(deviation, band)) return 'optimal';
    if (atMost(deviation, 2 * band)) return 'good';
    if (atMost(deviation, 3 * band)) return 'moderate';
    if (atMost(deviation, 4 * band)) return 'high';
    return 'excessive';
}

/**
 * Maps an absolute amount against a {@link NutrientTarget}.
 *
 * When the target carries a tolerance band, that band defines the `optimal` stop and the remaining
 * stops are multiples of it; otherwise the default band applies. A zero or negative target has no
 * meaningful ratio, so the result is `optimal` when nothing was consumed and `excessive` otherwise.
 */
export function nutritionLevelForAmount(
    value: number,
    target: NutrientTarget,
    options: LevelOptions = {},
): NutritionLevel {
    if (target.value <= 0) return value <= 0 ? 'optimal' : 'excessive';

    const impliedBand =
        options.band ??
        (target.tolerance.max > target.tolerance.min
            ? (target.tolerance.max - target.tolerance.min) / (2 * target.value)
            : DEFAULT_LEVEL_BAND);

    return nutritionLevelForRatio(value / target.value, {
        band: impliedBand,
        direction: options.direction ?? target.direction,
    });
}

export interface NutrientLevelReading {
    readonly nutrientId: string;
    readonly value: number;
    readonly target: number;
    readonly ratio: number;
    readonly level: NutritionLevel;
    readonly direction: TargetDirection;
}

/** Reads a facts set against a list of targets, one reading per target. */
export function readNutritionLevels(
    facts: NutritionFacts,
    targets: readonly NutrientTarget[],
    options: LevelOptions = {},
): readonly NutrientLevelReading[] {
    return targets.map((target) => {
        const value = amountValue(facts, target.nutrientId);
        return {
            nutrientId: target.nutrientId,
            value,
            target: target.value,
            ratio: target.value > 0 ? value / target.value : 0,
            level: nutritionLevelForAmount(value, target, options),
            direction: options.direction ?? target.direction,
        };
    });
}
