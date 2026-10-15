import type { Kitchen } from '@healthy360/api-client/contracts';
import { DIET_CLASSIFICATIONS } from '@healthy360/domain-types';
import type { DietClassification } from '@healthy360/domain-types';

import { deliveryTerms, fastestDeliveryMinutes, hoursToday } from './storefront-facts.ts';

/**
 * The pure half of the `/kitchens` finder — ordering and narrowing.
 *
 * Kept out of the screen for the reason `storefront-facts.ts` gives: each function is a small,
 * arguable reading of the `Kitchen` contract, and a reading that can only be exercised by rendering
 * a screen is one nobody re-reads.
 *
 * ## "Best match" is a count, never a percentage
 *
 * HealthZone ranks kitchens by a match score against the shopper's profile (`kMatch`) and prints it
 * as a percentage on every card. Nothing in `MarketplaceRepository` computes one, and a percentage
 * made up on the client would be the most confident-looking number on the page with nothing behind
 * it. What *is* real is the overlap between two closed vocabularies the API does answer: the diets
 * a signed-in shopper declared (`DietaryProfile.dietCategoryCode`) and the diets a kitchen cooks
 * for (`Kitchen.dietClassifications`). Both are `DIET_CLASSIFICATIONS` codes. So "best match" here
 * is "cooks for the most of your diets", and it is only offered to someone who has declared a diet.
 */

export const KITCHEN_SORTS = ['match', 'fastest', 'rating', 'fee', 'name'] as const;
export type KitchenSort = (typeof KITCHEN_SORTS)[number];

/** The order a visitor lands on: best match when there is a profile to match, else rating. */
export function defaultKitchenSort(profileDiets: readonly DietClassification[]): KitchenSort {
    return profileDiets.length > 0 ? 'match' : 'rating';
}

/** The orders this visitor can choose — "best match" only when there is something to match. */
export function availableKitchenSorts(
    profileDiets: readonly DietClassification[],
): readonly KitchenSort[] {
    return profileDiets.length > 0 ? KITCHEN_SORTS : KITCHEN_SORTS.filter((s) => s !== 'match');
}

export function parseKitchenSort(
    raw: string | undefined,
    profileDiets: readonly DietClassification[] = [],
): KitchenSort {
    return (availableKitchenSorts(profileDiets) as readonly string[]).includes(raw ?? '')
        ? (raw as KitchenSort)
        : defaultKitchenSort(profileDiets);
}

/** A profile's diet codes narrowed to the vocabulary kitchens are classified in. */
export function profileDietsOf(code: string | null | undefined): readonly DietClassification[] {
    if (code === null || code === undefined) return [];
    return DIET_CLASSIFICATIONS.filter((diet) => diet === code);
}

/** The shopper's declared diets this kitchen cooks for, in the vocabulary's canonical order. */
export function matchedDiets(
    kitchen: Kitchen,
    profileDiets: readonly DietClassification[],
): readonly DietClassification[] {
    return profileDiets.filter((diet) => kitchen.dietClassifications.includes(diet));
}

/** Ascending, with an absent figure after every present one whichever way the list runs. */
function compareNullable(a: number | null, b: number | null): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
}

function byRating(a: Kitchen, b: Kitchen): number {
    // Descending, so the comparison is flipped — but an unrated kitchen still sinks to the end.
    if (a.rating === null || b.rating === null) return compareNullable(a.rating, b.rating);
    return b.rating - a.rating || b.ratingCount - a.ratingCount;
}

/**
 * A copy of `kitchens` in the order `sort` names.
 *
 * `Array.prototype.sort` is stable, so kitchens the order cannot tell apart — two unrated kitchens,
 * two with no published zone — keep the order the directory returned them in rather than shuffling
 * between two loads of the same page.
 */
export function sortKitchens(
    kitchens: readonly Kitchen[],
    sort: KitchenSort,
    profileDiets: readonly DietClassification[] = [],
): readonly Kitchen[] {
    const sorted = [...kitchens];
    switch (sort) {
        case 'match':
            // Most of your diets first; a tie is broken by rating, the next thing a person asks.
            return sorted.sort(
                (a, b) =>
                    matchedDiets(b, profileDiets).length - matchedDiets(a, profileDiets).length ||
                    byRating(a, b),
            );
        case 'rating':
            return sorted.sort(byRating);
        case 'fastest':
            return sorted.sort((a, b) =>
                compareNullable(fastestDeliveryMinutes(a), fastestDeliveryMinutes(b)),
            );
        case 'fee':
            return sorted.sort((a, b) =>
                compareNullable(
                    deliveryTerms(a).deliveryFee?.amount ?? null,
                    deliveryTerms(b).deliveryFee?.amount ?? null,
                ),
            );
        case 'name':
            return sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
}

/**
 * Kitchens that cook for **every** selected diet.
 *
 * An *every* rather than a *some*, as the design's chips are: lighting "High protein" and then
 * "Halal" is a person narrowing, and a list that grows when a second chip is pressed reads as a
 * fault. The chips are derived from the list *before* this narrowing, so pressing one never removes
 * another.
 */
export function narrowByDiets(
    kitchens: readonly Kitchen[],
    diets: readonly string[],
): readonly Kitchen[] {
    if (diets.length === 0) return kitchens;
    return kitchens.filter((kitchen) =>
        diets.every((diet) => kitchen.dietClassifications.includes(diet as DietClassification)),
    );
}

/** The design's "Under 30 min" chip: the fastest advertised delivery is half an hour or less. */
export const FAST_DELIVERY_MINUTES = 30;

export function deliversFast(kitchens: readonly Kitchen[]): readonly Kitchen[] {
    return kitchens.filter((kitchen) => {
        const minutes = fastestDeliveryMinutes(kitchen);
        return minutes !== null && minutes <= FAST_DELIVERY_MINUTES;
    });
}

/** Whether any branch publishes opening hours at all — the difference between "closed" and "unknown". */
export function publishesHours(kitchen: Kitchen): boolean {
    return kitchen.branches.some((branch) => branch.isActive && branch.openingHours.length > 0);
}

/** Kitchens with a trading window today, by the hours they published. */
export function openToday(kitchens: readonly Kitchen[], weekday?: number): readonly Kitchen[] {
    return kitchens.filter((kitchen) => hoursToday(kitchen, weekday) !== null);
}

/**
 * Splits `items` into rows of `columns`.
 *
 * The grid is drawn as rows of equal-flex cells rather than as one wrapping row, because a
 * wrapping row with `flex-grow` stretches whatever lands on its last line across the full width —
 * one card twice the width of the others. Rows of `flex-1` cells, padded with empty cells, keep
 * every card the same width on the web and on native alike.
 */
export function toRows<T>(items: readonly T[], columns: number): readonly (readonly T[])[] {
    const size = Math.max(1, columns);
    const rows: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        rows.push(items.slice(index, index + size));
    }
    return rows;
}
