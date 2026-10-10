import type { Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import type { AllergenCode } from '@healthy360/domain-types';

import { activeBranches, isoWeekdayToday } from '../storefront-facts.ts';

/**
 * Pure readings of a kitchen's menu that the storefront's tabs are drawn from.
 *
 * Kept out of the components for the reason `storefront-facts.ts` gives: each one is a small,
 * arguable reading of the contract, and a reading that can only be exercised by rendering a screen
 * is one nobody re-reads.
 *
 * ## Every function here assumes the whole menu
 *
 * A shelf count or an allergen tally taken over the first page of a paged list is a claim about the
 * whole kitchen made from part of it — and on the safety tab that is the expensive kind of wrong:
 * "nothing on this menu contains sesame" read off twenty-five of sixty dishes. The storefront loads
 * every page before it draws either (see `kitchen-profile-screen.tsx`), and these helpers are only
 * called once it has.
 */

/** The bucket a listing with no published category falls into. */
export const OTHER_SHELF = 'other';

export interface MenuShelf {
    /** The published-category code, or {@link OTHER_SHELF}. */
    readonly key: string;
    /** The server's localised shelf name; `null` for {@link OTHER_SHELF}, which the caller names. */
    readonly name: string | null;
    readonly count: number;
}

/**
 * The shelves the menu actually has, in the order the kitchen's listing first reaches each one.
 *
 * Derived from the menu rather than from the platform taxonomy: a chip for a shelf this kitchen
 * stocks nothing on is a control whose only answer is an empty grid. Listings the kitchen never
 * filed go to a trailing "other" shelf, so the chips always add up to the "All" count.
 */
export function menuShelves(meals: readonly MarketplaceMeal[]): readonly MenuShelf[] {
    const shelves = new Map<string, { name: string | null; count: number }>();
    let unfiled = 0;

    for (const meal of meals) {
        const category = meal.publishedCategory;
        if (category === null) {
            unfiled += 1;
            continue;
        }
        const shelf = shelves.get(category.code);
        if (shelf === undefined) {
            shelves.set(category.code, { name: category.name, count: 1 });
        } else {
            shelf.count += 1;
        }
    }

    const filed = [...shelves].map(([key, shelf]) => ({ key, ...shelf }));
    return unfiled === 0 ? filed : [...filed, { key: OTHER_SHELF, name: null, count: unfiled }];
}

/** Whether a listing sits on the given shelf. */
export function isOnShelf(meal: MarketplaceMeal, shelf: string): boolean {
    return meal.publishedCategory === null
        ? shelf === OTHER_SHELF
        : meal.publishedCategory.code === shelf;
}

export interface AllergenTally {
    readonly code: AllergenCode;
    /** How many listings declare it, at either containment level. */
    readonly count: number;
}

/**
 * Every allergen the menu declares, with the number of listings declaring it.
 *
 * Most-declared first, so the allergens someone has to work around most often lead the row; ties
 * keep code order so the row does not reshuffle between renders.
 */
export function allergenTally(meals: readonly MarketplaceMeal[]): readonly AllergenTally[] {
    const counts = new Map<AllergenCode, number>();
    for (const meal of meals) {
        for (const code of new Set(meal.allergens)) {
            counts.set(code, (counts.get(code) ?? 0) + 1);
        }
    }
    return [...counts]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** Listings that publish at least one nutrient figure. */
export function withNutrition(meals: readonly MarketplaceMeal[]): number {
    return meals.filter((meal) => meal.nutrition.amounts.length > 0).length;
}

/**
 * The latest same-day order cut-off any active branch publishes for today, `HH:mm`.
 *
 * The latest rather than the earliest for the reason `hoursToday` takes the widest window: the row
 * answers "until when can I still order from this kitchen today". It is a published time, not a
 * countdown — "18 min left" needs the kitchen's time zone resolved through `Intl`, which Hermes does
 * not carry reliably on Android, and a countdown that is wrong is worse than a time that is right.
 */
export function latestCutOffToday(
    kitchen: Kitchen,
    weekday: number = isoWeekdayToday(),
): string | null {
    let latest: string | null = null;
    for (const branch of activeBranches(kitchen)) {
        for (const hours of branch.openingHours) {
            if (hours.weekday !== weekday || hours.orderCutOffAt === null) continue;
            // `HH:mm` is zero-padded and fixed-width, so lexical order is chronological order.
            if (latest === null || hours.orderCutOffAt > latest) latest = hours.orderCutOffAt;
        }
    }
    return latest;
}
