import type { PlanFilter, SubscriptionPlan } from '@healthy360/api-client/contracts';
import type { KitchenId } from '@healthy360/domain-types';

/**
 * Pure derivations behind the `/plans` catalogue — the filter mapping, the client-side sort, and the
 * small facts a card reads off a plan. Kept out of the screen and the card so they can be unit-tested
 * the way `toMealFilter` is, and so the honesty rules they encode live in one auditable place:
 *
 * - **Every filter maps to a real `PlanFilter` field.** There is no sort in the repository contract
 *   (`contracts/marketplace.ts` gives `listPlans` no `sort`), so ordering is done here over the whole
 *   answer — which is correct precisely because the plan listing is not paginated
 *   (`data/catalogue-hooks.ts` says as much): the eight rows are all present, so sorting them client
 *   side reorders the entire result rather than one page of it.
 * - **The advertised price is the cheapest variant's**, never a mid variant dressed up as a floor.
 */

/** Days in a week — the divisor behind every "per day" figure, named rather than written inline. */
export const DAYS_PER_WEEK = 7;

/* ── the from-price ──────────────────────────────────────────────────────────────────────────── */

/**
 * The variant a plan is advertised from: the cheapest by weekly price. A catalogue that prices from
 * the cheapest band and then shows a dearer one is the oldest trick in the book (doc 17, SUB-09);
 * pricing and displaying the *same* variant is how this one refuses to play it.
 */
export function cheapestVariant(
    plan: SubscriptionPlan,
): SubscriptionPlan['variants'][number] | null {
    return plan.variants.reduce<SubscriptionPlan['variants'][number] | null>(
        (lowest, variant) =>
            lowest === null || variant.pricePerWeek.amount < lowest.pricePerWeek.amount
                ? variant
                : lowest,
        null,
    );
}

/** The advertised weekly price in minor units, or `null` for a plan with no variants. */
export function fromPriceAmount(plan: SubscriptionPlan): number | null {
    return cheapestVariant(plan)?.pricePerWeek.amount ?? null;
}

/* ── the calorie-band filter ─────────────────────────────────────────────────────────────────── */

/**
 * The calorie filter is offered as three bands rather than a slider because a plan carries several
 * variants spanning a wide range, so the honest question is "does this plan offer a day around this
 * size?", not "is this plan exactly N kcal". Each preset maps to a real {@link PlanFilter.energy}
 * range, and the repository matches a plan when *any* of its variants overlaps it.
 */
export interface CaloriePreset {
    readonly value: string;
    /** A real energy range in kcal/day; `min`/`max` omitted leaves that end open. */
    readonly energy: { readonly min?: number; readonly max?: number };
}

export const CALORIE_PRESETS: readonly CaloriePreset[] = [
    { value: 'lighter', energy: { max: 1600 } },
    { value: 'moderate', energy: { min: 1600, max: 2200 } },
    { value: 'higher', energy: { min: 2200 } },
];

/* ── the filter mapping ──────────────────────────────────────────────────────────────────────── */

export interface PlanFilterInputs {
    readonly query: string;
    /** `'all'` or a diet-category slug — the segmented category control's value. */
    readonly category: string;
    readonly kitchenIds: readonly string[];
    /** A {@link CALORIE_PRESETS} value, or `undefined` for no calorie constraint. */
    readonly calorie: string | undefined;
}

/**
 * Turns the URL-backed filter state into a `PlanFilter`.
 *
 * Every axis that says nothing is *omitted* rather than sent as an empty value, so the query key
 * stays stable and two states that filter identically share a cache entry — the same discipline
 * `toMealFilter` keeps for the meal catalogue.
 */
export function toPlanFilter(inputs: PlanFilterInputs): PlanFilter {
    const query = inputs.query.trim();
    const preset = CALORIE_PRESETS.find((candidate) => candidate.value === inputs.calorie);

    return {
        ...(query === '' ? {} : { query }),
        ...(inputs.category === 'all' ? {} : { categorySlug: inputs.category }),
        ...(inputs.kitchenIds.length === 0
            ? {}
            : { kitchenIds: inputs.kitchenIds as readonly KitchenId[] }),
        ...(preset === undefined ? {} : { energy: preset.energy }),
    };
}

/* ── the client-side sort ────────────────────────────────────────────────────────────────────── */

export const PLAN_SORTS = ['recommended', 'priceLowHigh', 'ratingHighLow'] as const;
export type PlanSort = (typeof PLAN_SORTS)[number];

export function isPlanSort(value: string | undefined): value is PlanSort {
    return value !== undefined && (PLAN_SORTS as readonly string[]).includes(value);
}

/**
 * Reorders the plans for the chosen sort, without mutating the input.
 *
 * `recommended` returns the repository's own order untouched — it is a real choice, not a no-op:
 * "recommended" *is* "however the catalogue chose to arrange itself", and pretending otherwise would
 * invent a ranking the data does not carry. The other two sort on fields every plan really has, and
 * a plan with no rating sorts last rather than being treated as a zero.
 */
export function sortPlans(
    plans: readonly SubscriptionPlan[],
    sort: PlanSort,
): readonly SubscriptionPlan[] {
    if (sort === 'recommended') return plans;

    const copy = [...plans];
    if (sort === 'priceLowHigh') {
        copy.sort((left, right) => (fromPriceAmount(left) ?? 0) - (fromPriceAmount(right) ?? 0));
    } else {
        copy.sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1));
    }
    return copy;
}

/* ── facets ──────────────────────────────────────────────────────────────────────────────────── */

/** The distinct kitchens that actually own a plan, in first-seen order. */
export function distinctKitchenIds(plans: readonly SubscriptionPlan[]): readonly KitchenId[] {
    const seen = new Set<string>();
    const result: KitchenId[] = [];
    for (const plan of plans) {
        if (!seen.has(plan.kitchenId)) {
            seen.add(plan.kitchenId);
            result.push(plan.kitchenId);
        }
    }
    return result;
}
