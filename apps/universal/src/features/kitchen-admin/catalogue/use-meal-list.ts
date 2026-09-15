import type {
    AllergenClass,
    ApiFailure,
    MealAdmin,
    PublishableStatus,
} from '@healthy360/api-client/contracts';
import type { AllergenCode, MealType } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useAdminMealPageQuery,
    useAllergenClassesQuery,
    useRetireMealMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';
import { useListPage } from '../use-list-page.ts';

/**
 * Everything `/kitchen/meals` knows that is not a pixel.
 *
 * The same split `use-ingredient-list.ts` makes: the list's behaviour moved here verbatim while its
 * presentation was rewritten from §4.1. The filter shape the query key is built from, the
 * client-side sort, the page reset and the withdraw sequence with its lock version are all the
 * code that shipped, moved rather than improved.
 *
 * ## Withdraw is the archive, and there is no second lifecycle verb here
 *
 * The contract publishes `publishMeal` and `retireMeal`. Only the second is on the list. Publishing
 * makes a meal visible to every consumer surface at once and a quarantined meal cannot be published
 * at all — the server refuses it structurally — so it is a deliberate act with a consequence stated
 * in front of it, and the editor is where that consequence is stated. A row action that put a
 * public listing one press away from a catalogue scan would be the wrong place for it.
 *
 * That is also why the row's destructive action is called Withdraw rather than Archive: nothing is
 * deleted, past orders and price-list entries still point at the row, and the two words must not
 * read as one.
 *
 * ## The second filter axis is the meal type, because that is what the contract publishes
 *
 * `MealAdminFilter` carries `mealTypes`; there is no meal category and no cuisine filter
 * server-side. One type at a time, from a closed vocabulary of four — so nothing has to be derived
 * from the rows in use the way the product categories are.
 *
 * ## Sorting is client-side, and the counts are over the loaded page
 *
 * Both limitations are the ingredient list's, stated there in full. `MealAdminFilter` publishes no
 * sort parameter, so a header sorts the twenty-five rows on the page in hand; `total` is the one
 * number the server sent, which is why Shown reads "18 of 96" and the three figures beside it do
 * not claim to be catalogue-wide.
 */

export type MealSortKey = 'name' | 'category' | 'status' | 'updatedAt';
export type MealSortDirection = 'asc' | 'desc';

export interface MealListState {
    readonly rows: readonly MealAdmin[];
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly failure: ApiFailure | null;
    readonly refetch: () => void;

    readonly query: string;
    readonly setQuery: (query: string) => void;
    readonly statuses: readonly PublishableStatus[];
    readonly setStatuses: (statuses: readonly PublishableStatus[]) => void;
    readonly mealType: MealType | null;
    readonly setMealType: (mealType: MealType | null) => void;
    /**
     * The allergen class the list is narrowed to, or `null`.
     *
     * Narrowed by the server, which resolves the same three bases `DerivedAllergenService` uses —
     * a published recipe version's frozen label first, then the item's own ingredients. A meal's
     * label is derived rather than stored, so there was nothing on the row to filter against
     * client-side and no honest way to narrow a paged list from the page in hand.
     */
    readonly allergen: AllergenCode | null;
    readonly setAllergen: (allergen: AllergenCode | null) => void;
    /** Every class the platform declares — the column filter's value list. */
    readonly allergenClasses: readonly AllergenClass[];
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;

    readonly sortKey: MealSortKey;
    readonly sortDirection: MealSortDirection;
    readonly setSort: (key: MealSortKey, direction: MealSortDirection) => void;

    readonly page: number;
    readonly setPage: (page: number) => void;
    readonly totalPages: number;
    /** The server's count for the whole filtered set, or `null` before the first answer. */
    readonly total: number | null;
    readonly shown: number;
    /** Published, and so visible to every consumer surface. */
    readonly liveCount: number;
    readonly draftCount: number;
    readonly missingArabicCount: number;

    readonly openEditor: (mealId: string) => void;
    readonly createNew: () => void;

    readonly viewing: MealAdmin | null;
    readonly openView: (row: MealAdmin) => void;
    readonly closeView: () => void;

    readonly retiring: MealAdmin | null;
    readonly askToRetire: (row: MealAdmin) => void;
    readonly cancelRetire: () => void;
    /** Runs the withdrawal at the version the list was showing. `onRetired` carries the name. */
    readonly confirmRetire: (onRetired: (name: string) => void) => void;
    readonly isRetirePending: boolean;
    readonly retireFailure: ApiFailure | null;
}

export function useMealList(): MealListState {
    const router = useRouter();
    const { locale } = useLocale();

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [mealType, setMealType] = useState<MealType | null>(null);
    const [allergen, setAllergen] = useState<AllergenCode | null>(null);
    const [sortKey, setSortKey] = useState<MealSortKey>('name');
    const [sortDirection, setSortDirection] = useState<MealSortDirection>('asc');
    const [viewing, setViewing] = useState<MealAdmin | null>(null);
    const [retiring, setRetiring] = useState<MealAdmin | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(mealType === null ? {} : { mealTypes: [mealType] }),
            ...(allergen === null ? {} : { allergenCodes: [allergen] }),
        }),
        [trimmed, statuses, mealType, allergen],
    );

    const [page, setPage] = useListPage(filter);
    const meals = useAdminMealPageQuery(filter, page);
    const allergenClasses = useAllergenClassesQuery();
    const retire = useRetireMealMutation();

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on every
    // render, which would re-run the sort below whether or not the data changed.
    const rows = meals.data?.items;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'category') {
                return (
                    factor *
                    (left.kitchenCategory ?? '').localeCompare(right.kitchenCategory ?? '', locale)
                );
            }
            if (sortKey === 'status') {
                return factor * left.meta.status.localeCompare(right.meta.status);
            }
            if (sortKey === 'updatedAt') {
                return factor * left.meta.updatedAt.localeCompare(right.meta.updatedAt);
            }
            return (
                factor *
                displayName(left.name, locale).value.localeCompare(
                    displayName(right.name, locale).value,
                    locale,
                )
            );
        });
    }, [rows, sortKey, sortDirection, locale]);

    return {
        rows: sorted,
        isPending: meals.isPending,
        isFetching: meals.isFetching,
        failure: toFailure(meals.error),
        refetch: () => {
            void meals.refetch();
        },

        query,
        setQuery,
        statuses,
        setStatuses,
        mealType,
        setMealType,
        allergen,
        setAllergen,
        allergenClasses: allergenClasses.data ?? [],
        isUnfiltered:
            trimmed === '' && statuses.length === 0 && mealType === null && allergen === null,
        clearFilters: () => {
            setQuery('');
            setStatuses([]);
            setMealType(null);
            setAllergen(null);
        },

        sortKey,
        sortDirection,
        setSort: (key, direction) => {
            setSortKey(key);
            setSortDirection(direction);
        },

        page,
        setPage,
        totalPages: pagesInResult(meals.data) ?? 0,
        total: meals.data?.totalCount ?? null,
        shown: sorted.length,
        liveCount: sorted.filter((row) => row.meta.status === 'published').length,
        draftCount: sorted.filter((row) => row.meta.status === 'draft').length,
        missingArabicCount: sorted.filter((row) => displayName(row.name, locale).isFallback).length,

        openEditor: (mealId) => {
            router.push(`/kitchen/meals/${mealId}` as never);
        },
        createNew: () => {
            router.push('/kitchen/meals/new' as never);
        },

        viewing,
        openView: setViewing,
        closeView: () => {
            setViewing(null);
        },

        retiring,
        askToRetire: setRetiring,
        cancelRetire: () => {
            setRetiring(null);
        },
        confirmRetire: (onRetired) => {
            const row = retiring;
            if (row === null) return;
            retire.mutate(
                {
                    mealId: row.id,
                    request: { lockVersion: row.meta.lockVersion },
                },
                {
                    onSuccess: () => {
                        setRetiring(null);
                        onRetired(displayName(row.name, locale).value);
                    },
                },
            );
        },
        isRetirePending: retire.isPending,
        retireFailure: toFailure(retire.error),
    };
}
