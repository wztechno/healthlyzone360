import type { MarketplaceMeal, MealFilter } from '@healthy360/api-client/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { queryKeys } from '../../data/query-keys.ts';
import { useRepositoryContext } from '../../data/repository-provider.tsx';

/**
 * The menu's shelves, with how many prepared meals sit on each — HealthZone's `CATEGORY` list.
 *
 * ## Why shelves and not meal types
 *
 * The design's categories are Bowls, Salads, Pasta, Wraps, Breakfast, Plates: the shelf a dish is
 * filed under, which is `publishedCategory` on the meal and `category_slug` on
 * `GET /marketplace/meals`. The rail used to list breakfast / lunch / dinner / snack instead, and
 * that filter never reached the wire — the API has no meal-type parameter — so pressing "Lunch"
 * changed the address bar and nothing else. A shelf is a filter the server applies.
 *
 * ## Why the whole catalogue is walked
 *
 * There is no taxonomy or facets endpoint, and the API returns no total count. The only honest way
 * to name the shelves that hold something, and to count them, is to read the prepared-meal listing
 * through. That is done once, at the largest page the API allows, and cached under the catalogue
 * root like every other listing. If the walk is cut short by {@link MAX_PAGES}, the shelves found
 * are still offered but no count is printed: a figure taken over part of the menu is a claim about
 * all of it.
 *
 * The counts describe the whole menu, not the current filter — they are the size of each shelf,
 * which is what the design's list answers, and they do not jump while the grid is narrowed.
 */
export interface MealShelf {
    readonly code: string;
    readonly name: string;
    /** `null` when the walk did not reach the end of the menu. */
    readonly count: number | null;
}

export interface MealShelves {
    readonly shelves: readonly MealShelf[];
    /** Every prepared meal on the marketplace; `null` until known or when the walk was cut short. */
    readonly total: number | null;
}

const WALK: Omit<MealFilter, 'cursor'> = { itemTypes: ['meal'], limit: 100 };

/** Ten pages of a hundred. A marketplace past that wants a facets endpoint, not a longer walk. */
const MAX_PAGES = 10;

interface Walked {
    readonly meals: readonly Pick<MarketplaceMeal, 'publishedCategory'>[];
    readonly complete: boolean;
}

export function shelvesFrom({ meals, complete }: Walked): MealShelves {
    const shelves = new Map<string, { name: string; count: number }>();
    for (const meal of meals) {
        const category = meal.publishedCategory;
        if (category === null) continue;
        const shelf = shelves.get(category.code);
        if (shelf === undefined) shelves.set(category.code, { name: category.name, count: 1 });
        else shelf.count += 1;
    }
    return {
        shelves: [...shelves].map(([code, shelf]) => ({
            code,
            name: shelf.name,
            count: complete ? shelf.count : null,
        })),
        total: complete ? meals.length : null,
    };
}

export function useMealShelves(): MealShelves {
    const { repositories } = useRepositoryContext();

    const walked = useQuery({
        queryKey: [...queryKeys.catalogue.meals(WALK), 'shelves'] as const,
        enabled: repositories !== null,
        queryFn: async (): Promise<Walked> => {
            if (repositories === null) throw new Error('Repositories are not ready.');
            const meals: Pick<MarketplaceMeal, 'publishedCategory'>[] = [];
            let cursor: string | undefined;
            for (let index = 0; index < MAX_PAGES; index += 1) {
                const page = await repositories.marketplace.listMeals({
                    ...WALK,
                    ...(cursor === undefined ? {} : { cursor }),
                });
                // Only the shelf is kept: this is cached and persisted, and a second copy of every
                // meal's nutrition would be the heaviest thing in the store for one field's sake.
                for (const meal of page.items) {
                    meals.push({ publishedCategory: meal.publishedCategory });
                }
                if (page.nextCursor === null) return { meals, complete: true };
                cursor = page.nextCursor;
            }
            return { meals, complete: false };
        },
    });

    return useMemo(
        () => (walked.data === undefined ? { shelves: [], total: null } : shelvesFrom(walked.data)),
        [walked.data],
    );
}
