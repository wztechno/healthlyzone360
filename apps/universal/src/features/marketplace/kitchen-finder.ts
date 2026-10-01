import type { Kitchen, MealFilter } from '@healthy360/api-client/contracts';
import { DIET_CLASSIFICATIONS } from '@healthy360/domain-types';
import type { DietClassification, KitchenId } from '@healthy360/domain-types';

import { deliveryTerms, fastestDeliveryMinutes, hoursToday } from './storefront-facts.ts';

/**
 * The pure half of the `/kitchens` finder — ordering, narrowing, and which kitchen leads.
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
 * is "cooks for the most of your diets", printed as "2/3" — a count a reader can check against the
 * chips on the card — and it is only offered to someone who has declared a diet.
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

export interface Spotlight {
    readonly kitchen: Kitchen;
    /**
     * Why it leads, which is the only claim its badge may make: it cooks for the most of the
     * shopper's diets (`match`), it is the best rated (`rating`), or nothing (`null`) — simply the
     * first of the list, with no badge.
     */
    readonly reason: 'match' | 'rating' | null;
}

/**
 * The kitchen the canopy panel leads with.
 *
 * The one cooking for the most of the shopper's declared diets, when it cooks for at least one;
 * otherwise the highest-rated kitchen when any has a rating; otherwise the first of the list as it
 * is currently ordered.
 */
export function pickSpotlight(
    kitchens: readonly Kitchen[],
    profileDiets: readonly DietClassification[] = [],
): Spotlight | null {
    if (profileDiets.length > 0) {
        const [best] = sortKitchens(kitchens, 'match', profileDiets);
        if (best !== undefined && matchedDiets(best, profileDiets).length > 0) {
            return { kitchen: best, reason: 'match' };
        }
    }
    const rated = kitchens.filter((kitchen) => kitchen.rating !== null);
    if (rated.length > 0) {
        const [best] = [...rated].sort(byRating);
        if (best !== undefined) return { kitchen: best, reason: 'rating' };
    }
    const first = kitchens[0];
    return first === undefined ? null : { kitchen: first, reason: null };
}

/**
 * The finder's menu preview for one kitchen: its three highest-rated dishes.
 *
 * One function so the card and the spotlight ask with exactly the same filter, and so share one
 * cache entry rather than fetching the same three dishes twice.
 */
export function dishPreviewFilter(kitchenId: KitchenId): Omit<MealFilter, 'cursor'> {
    return { kitchenIds: [kitchenId], itemTypes: ['meal'], sort: 'rating', limit: 3 };
}

/**
 * The two letters on a kitchen's mark. Word initials where the name has words, the first two
 * characters otherwise — "Verdant Kitchen" is VK, "Saffron" is SA.
 */
export function kitchenInitials(name: string): string {
    const words = name
        .trim()
        .split(/\s+/u)
        .filter((word) => /\p{L}/u.test(word));
    if (words.length >= 2) {
        return words
            .slice(0, 2)
            .map((word) => Array.from(word)[0] ?? '')
            .join('')
            .toLocaleUpperCase();
    }
    return Array.from(words[0] ?? name)
        .slice(0, 2)
        .join('')
        .toLocaleUpperCase();
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
