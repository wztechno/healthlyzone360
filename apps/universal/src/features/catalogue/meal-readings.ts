import type { MarketplaceMeal, MealSort } from '@healthy360/api-client/contracts';
import type { RangeValue } from '@healthy360/design-system';
import { minorUnitExponent } from '@healthy360/domain-types';
import { findAmount } from '@healthy360/nutrition';

import { nutrientValue } from '../marketplace/format.ts';
import type { MealRangeKey } from './meal-filters.tsx';

/**
 * Small readings of a meal that the menu grid and the meal page both draw from.
 *
 * Pure, so each arguable choice — which tag a dish wears, when it counts as sold out, how a range
 * the server cannot apply is applied anyway — is something a test can read without rendering.
 */

/** The four orders HealthZone's menu offers, in its order. */
export const MENU_SORTS = ['relevance', 'price', 'protein', 'rating'] as const;
export type MenuSort = (typeof MENU_SORTS)[number];

export function isMenuSort(value: string | undefined): value is MenuSort {
    return value !== undefined && (MENU_SORTS as readonly string[]).includes(value);
}

/** A nutrient the kitchen actually published, rounded — `null` rather than a zero it never wrote. */
export function publishedFigure(meal: MarketplaceMeal, nutrientId: string): number | null {
    return findAmount(meal.nutrition, nutrientId) === null
        ? null
        : nutrientValue(meal.nutrition, nutrientId);
}

/**
 * The one pill a dish wears on its photograph and above its name — HealthZone's `m.tag`.
 *
 * The design's tags are descriptive ("HIGH PROTEIN", "VEGETARIAN"), so the dish's own headline
 * diet classification is the closest real field. `omnivore` is skipped because it describes
 * nothing a shopper filters by; the shelf the kitchen filed the dish under stands in when there is
 * no other classification, and a dish with neither wears no pill rather than an invented one.
 */
export function leadTag(meal: MarketplaceMeal, t: (key: string) => string): string | null {
    const diet = meal.dietClassifications.find((candidate) => candidate !== 'omnivore');
    if (diet !== undefined) return t(`marketplace:diets.${diet}`);
    return meal.publishedCategory?.name ?? null;
}

/**
 * Not orderable only when the kitchen says so for every day it published. An empty availability
 * list is "not published", which is not the same claim, so it never disables Add.
 */
export function isSoldOut(meal: MarketplaceMeal): boolean {
    return meal.availability.length > 0 && meal.availability.every((window) => !window.available);
}

/**
 * Why a dish that {@link isSoldOut} cannot be added — `sold-out` only when a day's portions ran out
 * (`remaining: 0`). A day marked unavailable with no count is a dish not offered that day, and
 * calling that "sold out" claims demand the kitchen never reported.
 */
export function unavailableReason(meal: MarketplaceMeal): 'sold-out' | 'unavailable' {
    return meal.availability.some((window) => window.remaining === 0) ? 'sold-out' : 'unavailable';
}

/* ── what the server cannot filter on ─────────────────────────────────────────────────────────── */

const NUTRIENT_OF: Readonly<Partial<Record<MealRangeKey, string>>> = {
    energy: 'energy',
    protein: 'protein',
    carbohydrate: 'carbohydrate',
    fat: 'fat',
};

function rangeFigure(meal: MarketplaceMeal, key: MealRangeKey): number | null {
    if (key === 'price') {
        return meal.price.amount / 10 ** minorUnitExponent(meal.price.currency);
    }
    if (key === 'preparationMinutes') return meal.preparationMinutes;
    const nutrient = NUTRIENT_OF[key];
    if (nutrient === undefined) return null;
    const amount = findAmount(meal.nutrition, nutrient);
    return amount === null ? null : amount.value;
}

/**
 * The ranges and the order, applied to the meals already fetched.
 *
 * `GET /marketplace/meals` filters on the text, the kitchen, the shelf, the diet, the allergens and
 * a price ceiling — and on nothing else: the energy and macro ranges, the preparation time and the
 * sort never reach the wire (`api/marketplace-repository.ts`). The screen still sends them, so a
 * server that learns them later needs no client change, and applies them here to what has
 * arrived, which is idempotent with a server that already did. A meal that did not publish the
 * figure a bound is set on is left out: "under 500 kcal" is a claim the page cannot make for it.
 */
export function refineMeals(
    meals: readonly MarketplaceMeal[],
    ranges: Readonly<Record<MealRangeKey, RangeValue>>,
    sort: MealSort,
): readonly MarketplaceMeal[] {
    const bounded = (Object.keys(ranges) as MealRangeKey[]).filter(
        (key) => ranges[key].min !== null || ranges[key].max !== null,
    );

    const kept =
        bounded.length === 0
            ? meals
            : meals.filter((meal) =>
                  bounded.every((key) => {
                      const value = rangeFigure(meal, key);
                      if (value === null) return false;
                      const { min, max } = ranges[key];
                      if (min !== null && value < min) return false;
                      if (max !== null && value > max) return false;
                      return true;
                  }),
              );

    switch (sort) {
        case 'price':
            return [...kept].sort((a, b) => a.price.amount - b.price.amount);
        case 'protein':
            return [...kept].sort(
                (a, b) =>
                    (publishedFigure(b, 'protein') ?? -1) - (publishedFigure(a, 'protein') ?? -1),
            );
        case 'rating':
            return [...kept].sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
        default:
            return kept;
    }
}
