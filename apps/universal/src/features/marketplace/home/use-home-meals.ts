import type { MarketplaceMeal, MealFilter, PlacedOrder } from '@healthy360/api-client/contracts';
import type { DietClassification } from '@healthy360/domain-types';
import { useEffect } from 'react';

import { mealsFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import type { MealsInfiniteResult } from '../../../data/catalogue-hooks.ts';
import { useMyOrdersQuery } from '../../../data/commerce-hooks.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { narrowed, shownCategory, shownItemTypes } from '../../catalogue/shown-shelves.ts';

/** How many of the collection the front door shows before handing off to the screen that owns it. */
export const POPULAR_COUNT = 4;
/** Rows in the closing rail. Three is what fits beside the offer panel without scrolling it. */
export const RAIL_COUNT = 3;
/** Tiles in "Browse by category" — the design's six across. */
export const CATEGORY_COUNT = 6;

/**
 * Pages of the catalogue the home will walk to count it. A hundred meals a page, so a thousand
 * meals; a marketplace larger than that keeps its tiles but shows no figure under them rather than
 * a count that stopped part-way.
 */
const MAX_PAGES = 10;

/** The listing every storefront home reads: prepared meals, best rated first, a full page at a time. */
export const HOME_MEALS_FILTER: Omit<MealFilter, 'cursor'> = {
    itemTypes: ['meal'],
    sort: 'rating',
    limit: 100,
};

/**
 * Diet classifications a category tile may name. `omnivore` is left out: every meal that is not
 * something narrower is classed as it, so as a shelf it is "everything" under another name.
 */
const TILE_DIETS: readonly DietClassification[] = [
    'vegetarian',
    'vegan',
    'pescatarian',
    'keto',
    'low_carb',
    'high_protein',
    'mediterranean',
    'halal_friendly',
    'gluten_free',
    'dairy_free',
    'nut_free',
];

export type HomeCategory =
    | {
          readonly kind: 'shelf';
          /** The published category's code — what `/meals?category=` filters on. */
          readonly value: string;
          readonly name: string;
          readonly count: number | null;
          readonly imageMeal: MarketplaceMeal | undefined;
      }
    | {
          readonly kind: 'diet';
          readonly value: DietClassification;
          readonly count: number | null;
          readonly imageMeal: MarketplaceMeal | undefined;
      };

export interface HomeRail {
    /** The dish the rail is "because you ordered", or `null` when it is more of the ranking. */
    readonly orderedName: string | null;
    readonly meals: readonly MarketplaceMeal[];
}

export interface HomeMeals {
    readonly query: MealsInfiniteResult;
    /** The grid — the first {@link POPULAR_COUNT} by rating. */
    readonly popular: readonly MarketplaceMeal[];
    /** The rail beside the offer band. Empty when there is nothing past the grid to show. */
    readonly rail: HomeRail;
    /** The dish the hero photograph and its overlay name: the top-rated one. */
    readonly heroMeal: MarketplaceMeal | undefined;
    /** `true` once the walk has stopped — finished, capped or failed — so the tiles can draw. */
    readonly settled: boolean;
    /** Every prepared meal on the marketplace, or `null` until the walk has read the last page. */
    readonly total: number | null;
    /** Kitchens with at least one meal listed, on the same terms as {@link total}. */
    readonly kitchenCount: number | null;
    readonly categories: readonly HomeCategory[];
    /** The signed-in person's most recent order, when there is one. */
    readonly latestOrder: PlacedOrder | undefined;
}

/**
 * The signed-in person's most recent order — the design's "Track order #4821" and "because you
 * ordered …". Disabled for a visitor, who has no order history to read; a failed read is treated
 * as no order rather than surfaced, because both places it feeds have an honest fallback.
 */
function useLatestOrder(): PlacedOrder | undefined {
    const { me } = useSession();
    const orders = useMyOrdersQuery({ limit: 1 }, me !== null);
    return me === null ? undefined : orders.data?.pages[0]?.items[0];
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Meals like the one somebody ordered: sharing its kitchen, a narrower diet, or a meal type —
 * scored in that order of weight, ties broken by the rating ranking the list already carries.
 */
function similarTo(
    ordered: MarketplaceMeal,
    ranked: readonly MarketplaceMeal[],
    exclude: ReadonlySet<string>,
): readonly MarketplaceMeal[] {
    const diets = new Set<DietClassification>(
        ordered.dietClassifications.filter((diet) => diet !== 'omnivore'),
    );
    const types = new Set(ordered.mealTypes);

    return ranked
        .map((meal, rank) => {
            const score =
                (meal.kitchenId === ordered.kitchenId ? 2 : 0) +
                meal.dietClassifications.filter((diet) => diets.has(diet)).length +
                meal.mealTypes.filter((type) => types.has(type)).length;
            return { meal, rank, score };
        })
        .filter(({ meal, score }) => score > 0 && !exclude.has(String(meal.id)))
        .sort((a, b) => b.score - a.score || a.rank - b.rank)
        .slice(0, RAIL_COUNT)
        .map(({ meal }) => meal);
}

/**
 * The one meal listing every storefront home reads, walked to its end.
 *
 * ## Why the whole catalogue
 *
 * The design prints a count under every category tile and "All 48 meals" in the header. The meal
 * listing is a keyset walk and answers `totalCount: null` (`api/marketplace-mappers.ts`), and there
 * is no facets endpoint, so the only true count is one taken over every row. A hundred rows a page
 * makes that one request for a catalogue of today's size, and the same pages feed the hero, the
 * grid and the rail — the ranking is read from the top of the list that is being counted.
 *
 * ## Sorted by rating
 *
 * Rating is what the catalogue can sort on (`MEAL_SORTS`); nothing here takes a measure of demand,
 * which is why the grid is titled for what it is.
 *
 * ## The categories
 *
 * The design's home tiles are the menu's own categories — a tile opens the menu on that shelf. So
 * they are the published shelves the prepared meals sit on (the menu's CATEGORY rail, and a filter
 * the server applies as `category_slug`), largest first, and when there are fewer than six shelves
 * the narrower diets with the most meals fill the row. Meal type is not used: the listing endpoint
 * ignores it, so a meal-type tile opened an unfiltered menu. Each tile has a real count and is
 * pictured by the best-rated dish on it that no earlier tile used.
 *
 * ## The rail
 *
 * For a signed-in person whose latest order names a dish this catalogue lists, the rail is the
 * design's "because you ordered …" — the meals most like it. Otherwise it continues the ranking
 * where the grid stops, and says so.
 */
export interface HomeMealsOptions {
    /**
     * Narrow everything — hero, grid, rail and tiles — to the shown shelves (`shown-shelves.ts`),
     * and hide the diet tiles, which are not shelves. Discover asks for this; `/` and `/customer`
     * do not.
     */
    readonly shownShelvesOnly?: boolean;
}

const SHOWN_SHELF = shownCategory();

/** {@link HOME_MEALS_FILTER} narrowed to the shown shelves. */
const SHOWN_HOME_MEALS_FILTER: Omit<MealFilter, 'cursor'> = {
    ...HOME_MEALS_FILTER,
    itemTypes: shownItemTypes(['meal']),
    ...(SHOWN_SHELF === undefined ? {} : { categorySlug: SHOWN_SHELF }),
};

export function useHomeMeals({ shownShelvesOnly = false }: HomeMealsOptions = {}): HomeMeals {
    const query = useMealsQuery(shownShelvesOnly ? SHOWN_HOME_MEALS_FILTER : HOME_MEALS_FILTER);
    const hideDietTiles = shownShelvesOnly && narrowed;
    const latestOrder = useLatestOrder();

    const pageCount = query.data?.pages.length ?? 0;
    const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = query;
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError && pageCount < MAX_PAGES) {
            void fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, pageCount, fetchNextPage]);

    const complete = query.isSuccess && !hasNextPage;
    const settled = complete || isFetchNextPageError || (query.isSuccess && pageCount >= MAX_PAGES);

    /*
     * Computed every render rather than memoised: a thousand rows filtered a dozen times is cheap,
     * and `query` — which the sections read for their loading and error states — is a fresh object
     * on every render, so a memo keyed on it would never hit.
     */
    const rated = mealsFromPages(query.data?.pages);
    const popular = rated.slice(0, POPULAR_COUNT);
    const shown = new Set(popular.map((meal) => String(meal.id)));

    /* ── categories ── */
    const used = new Set<string>();
    const pictureFor = (matches: (meal: MarketplaceMeal) => boolean) => {
        const shelf = rated.filter(matches);
        const pick = shelf.find((meal) => !used.has(meal.imagePlaceholderId)) ?? shelf[0];
        if (pick !== undefined) used.add(pick.imagePlaceholderId);
        return pick;
    };
    const countOf = (matches: (meal: MarketplaceMeal) => boolean) => rated.filter(matches).length;

    const shelfNames = new Map<string, string>();
    for (const meal of rated) {
        if (meal.publishedCategory !== null && !shelfNames.has(meal.publishedCategory.code)) {
            shelfNames.set(meal.publishedCategory.code, meal.publishedCategory.name);
        }
    }
    const onShelf = (code: string) => (meal: MarketplaceMeal) =>
        meal.publishedCategory?.code === code;
    const shelfTiles: HomeCategory[] = [...shelfNames]
        .map(([code, name]) => ({ code, name, n: countOf(onShelf(code)) }))
        .sort((a, b) => b.n - a.n)
        .slice(0, CATEGORY_COUNT)
        .map(({ code, name, n }) => ({
            kind: 'shelf',
            value: code,
            name,
            count: complete ? n : null,
            imageMeal: pictureFor(onShelf(code)),
        }));
    const dietTiles: HomeCategory[] = TILE_DIETS.map((diet) => ({
        diet,
        n: countOf((meal) => meal.dietClassifications.includes(diet)),
    }))
        .filter(({ n }) => n > 0 && !hideDietTiles)
        .sort((a, b) => b.n - a.n)
        .slice(0, Math.max(0, CATEGORY_COUNT - shelfTiles.length))
        .map(({ diet, n }) => ({
            kind: 'diet',
            value: diet,
            count: complete ? n : null,
            imageMeal: pictureFor((meal) => meal.dietClassifications.includes(diet)),
        }));

    /* ── rail ── */
    const ordered =
        latestOrder === undefined
            ? undefined
            : latestOrder.lines
                  .map((line) => rated.find((meal) => sameName(meal.name, line.name)))
                  .find((meal) => meal !== undefined);
    const similar =
        ordered === undefined
            ? []
            : similarTo(ordered, rated, new Set([...shown, String(ordered.id)]));
    const rail: HomeRail =
        ordered !== undefined && similar.length > 0
            ? { orderedName: ordered.name, meals: similar }
            : {
                  orderedName: null,
                  meals: rated.slice(POPULAR_COUNT, POPULAR_COUNT + RAIL_COUNT),
              };

    return {
        query,
        popular,
        rail,
        heroMeal: rated[0],
        settled,
        total: complete ? rated.length : null,
        kitchenCount: complete ? new Set(rated.map((meal) => meal.kitchenId)).size : null,
        categories: [...shelfTiles, ...dietTiles].slice(0, CATEGORY_COUNT),
        latestOrder,
    };
}
