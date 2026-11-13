import type { PlanVariant, SubscriptionPlan } from '@healthy360/api-client/contracts';

import { balanceDaysFor } from './plan-balance.ts';

/**
 * The plans page's finder — the accepted board's three questions over the plans actually on sale:
 * how many meals a day, how long, and how much to eat a day — and the plan that answers them best.
 *
 * Every option is read off the catalogue, never assumed: the meals a day its configurations serve,
 * the balances it is sold in, and its calorie bands split into thirds ("Light", "Balanced",
 * "Active") by where each band starts. A plan scores 3 for the meals, 2 for the length and 2 for
 * the calories, on its best configuration; the highest score is the match, the earlier plan on a
 * tie. Nothing is stored: the answers are the page's, and the plan's own page and setup take over.
 */
export const CALORIE_LEVELS = ['light', 'balanced', 'active'] as const;
export type CalorieLevel = (typeof CALORIE_LEVELS)[number];

export interface FinderAnswers {
    readonly meals: number | null;
    readonly days: number | null;
    readonly level: CalorieLevel | null;
}

export interface FinderOptions {
    readonly meals: readonly number[];
    readonly days: readonly number[];
    /** The calorie levels with at least one configuration in them. */
    readonly levels: readonly CalorieLevel[];
}

function distinct(values: readonly number[]): readonly number[] {
    return [...new Set(values)].sort((a, b) => a - b);
}

/** Where each band starts, low to high — the thirds are cut from this. */
function bandStarts(plans: readonly SubscriptionPlan[]): readonly number[] {
    return distinct(
        plans.flatMap((plan) => plan.variants.map((variant) => variant.energyRange.min)),
    );
}

/** A configuration's calorie level: which third of the catalogue's band starts it falls in. */
export function levelOf(variant: PlanVariant, starts: readonly number[]): CalorieLevel {
    if (starts.length <= 1) return 'balanced';
    const index = starts.indexOf(variant.energyRange.min);
    const share = index / (starts.length - 1);
    return share < 1 / 3 ? 'light' : share > 2 / 3 ? 'active' : 'balanced';
}

export function finderOptions(plans: readonly SubscriptionPlan[]): FinderOptions {
    const starts = bandStarts(plans);
    const levels = new Set(
        plans.flatMap((plan) => plan.variants.map((variant) => levelOf(variant, starts))),
    );
    return {
        meals: distinct(
            plans.flatMap((plan) => plan.variants.map((variant) => variant.mealsPerDay)),
        ),
        days: distinct(
            plans.flatMap((plan) =>
                plan.durations.map((option) => balanceDaysFor(option.duration)),
            ),
        ),
        levels: CALORIE_LEVELS.filter((level) => levels.has(level)),
    };
}

/** The middle of each question, until the person answers — the board opens on an answer. */
export function defaultAnswers(options: FinderOptions): FinderAnswers {
    const middle = <T>(list: readonly T[]): T | null =>
        list.length === 0 ? null : (list[Math.floor((list.length - 1) / 2)] ?? null);
    return {
        meals: middle(options.meals),
        days: middle(options.days),
        level: middle(options.levels),
    };
}

export interface PlanMatch {
    readonly plan: SubscriptionPlan;
    /** The configuration that answers best. */
    readonly variant: PlanVariant;
    readonly score: number;
}

/** Every plan's best-answering configuration and its score, in the catalogue's order. */
export function matchPlans(
    plans: readonly SubscriptionPlan[],
    answers: FinderAnswers,
): readonly PlanMatch[] {
    const starts = bandStarts(plans);
    return plans.flatMap((plan) => {
        const sold = plan.durations.map((option) => balanceDaysFor(option.duration));
        const lengthScore = answers.days !== null && sold.includes(answers.days) ? 2 : 0;
        let best: PlanMatch | null = null;
        for (const variant of plan.variants) {
            const score =
                (answers.meals !== null && variant.mealsPerDay === answers.meals ? 3 : 0) +
                lengthScore +
                (answers.level !== null && levelOf(variant, starts) === answers.level ? 2 : 0);
            if (best === null || score > best.score) best = { plan, variant, score };
        }
        return best === null ? [] : [best];
    });
}

/** The best match: the highest score, the earlier plan on a tie. */
export function bestMatch(matches: readonly PlanMatch[]): PlanMatch | null {
    return matches.reduce<PlanMatch | null>(
        (best, candidate) => (best === null || candidate.score > best.score ? candidate : best),
        null,
    );
}
