import { PLAN_DURATION_WEEKS } from '@healthy360/domain-types';

import { usePlansQuery } from '../../../data/catalogue-hooks.ts';

/** The best run discount any listed plan publishes. */
export interface PlanOffer {
    /** Whole percent off the weekly price. */
    readonly percent: number;
    /** The shortest run that earns it. */
    readonly weeks: number;
}

/**
 * The design's offer band, bound to the one offer this product actually publishes.
 *
 * The design's is a priced bundle ending on a day. There is no offers endpoint, and a hardcoded
 * price on a storefront is the one placeholder that reads as a promise. Plans, though, publish a
 * discount per run length (`PlanDurationOption.discountPercent`), so the band names the best of
 * those across the first page of the plan catalogue, and the shortest run that earns it. `null`
 * while the plans load, when none offers a discount, or when the read fails — the band then pitches
 * plans without a figure.
 */
export function usePlanOffer(): PlanOffer | null {
    const plans = usePlansQuery({ limit: 50 });

    let best: PlanOffer | null = null;
    for (const plan of plans.data?.items ?? []) {
        for (const option of plan.durations) {
            if (option.discountPercent <= 0) continue;
            const weeks = PLAN_DURATION_WEEKS[option.duration];
            if (
                best === null ||
                option.discountPercent > best.percent ||
                (option.discountPercent === best.percent && weeks < best.weeks)
            ) {
                best = { percent: option.discountPercent, weeks };
            }
        }
    }
    return best;
}
