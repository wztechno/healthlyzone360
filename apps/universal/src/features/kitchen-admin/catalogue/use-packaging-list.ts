import type {
    ApiFailure,
    IngredientCategoryAdmin,
    IngredientAdmin,
    PublishableStatus,
} from '@healthy360/api-client/contracts';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useArchiveIngredientMutation,
    usePackagingCategoriesQuery,
    usePackagingPageQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';
import { useListPage } from '../use-list-page.ts';

/**
 * The state behind `/kitchen/packaging`.
 *
 * ## One collection, read from the packaging end
 *
 * Packaging and food share the `ingredients` table again, told apart by the taxonomy: this hook
 * asks for the {@link PACKAGING_CATEGORY_CODE} branch, and `useIngredientList` excludes it. Two
 * lists, one collection, read from opposite ends.
 *
 * It briefly had a table of its own, and the argument for that was a real bug rather than a real
 * difference: the page asked the ingredient endpoint for a category, the code stopped resolving,
 * the filter silently degraded to *no* filter, and a page meant to show thirty-three boxes showed
 * three hundred ingredients. Both directions are now closed at the repository — an inclusion it
 * cannot resolve returns an empty page, an exclusion it cannot resolve is refused — so the failure
 * that justified two tables is no longer expressible against one.
 *
 * ## Still its own hook, and its own row spec
 *
 * Sharing a table is not sharing a question. A box is scanned for what it costs, what it holds and
 * how much of it is thrown away; an ingredient is scanned for what it is made of and what it might
 * trigger. So the columns, the stat cards and the sort keys here stay packaging's own — they read
 * `purchasePrice`, `capacity` and `wastePercent`, which are null on every food row.
 *
 * ## Archive is the only write
 *
 * The same one the ingredient list offers, because it is now literally the same endpoint. There is
 * still no editor route behind `/kitchen/packaging/{item}`; {@link PackagingListState.openEditor}
 * sends a reader to the ingredient editor, which can edit these rows because they are ingredients.
 */

export type PackagingSortKey = 'reference' | 'name' | 'category' | 'unit' | 'purchasePrice';
export type PackagingSortDirection = 'asc' | 'desc';

/**
 * The statuses the Status column offers.
 *
 * The ingredient vocabulary, because these *are* ingredients: `PackagingStatus` was active /
 * inactive / archived and turned out to be the same three states the ingredient table already
 * stored under different names. `review_required` is left out — it is the allergen quarantine, and
 * a box declares no allergens, so no packaging row can ever be in it.
 */
export const PACKAGING_STATUS_FILTERS: readonly PublishableStatus[] = [
    'published',
    'draft',
    'retired',
];

export interface PackagingListState {
    readonly rows: readonly IngredientAdmin[];
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly failure: ApiFailure | null;
    readonly refetch: () => void;

    readonly query: string;
    readonly setQuery: (query: string) => void;
    readonly statuses: readonly PublishableStatus[];
    readonly setStatuses: (statuses: readonly PublishableStatus[]) => void;
    readonly category: string | null;
    readonly setCategory: (category: string | null) => void;
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;
    /**
     * The leaves of the packaging taxonomy — bags, lids, cutlery — and not its root.
     *
     * The leaf, because every row on this page shares one top-level category: that is what makes it
     * this page, and a filter offering it would be a filter that narrows nothing. The Category
     * column hosts these all the same — its own value is the branch, and the cut worth offering
     * under it is the leaf.
     */
    readonly categories: readonly IngredientCategoryAdmin[];
    /**
     * The whole branch, root included — what a *name* lookup needs.
     *
     * The filter above wants the leaves only; a row filed at the root still has to resolve to a
     * name, and the root is not in that list. Same split, and the same reason, as the ingredient
     * list's `categories` / `categoryTree` pair.
     */
    readonly categoryTree: readonly IngredientCategoryAdmin[];

    readonly sortKey: PackagingSortKey;
    readonly sortDirection: PackagingSortDirection;
    readonly setSort: (key: PackagingSortKey, direction: PackagingSortDirection) => void;

    readonly page: number;
    readonly setPage: (page: number) => void;
    readonly totalPages: number;
    /** The server's count for the whole filtered set, or `null` before the first answer. */
    readonly total: number | null;
    readonly shown: number;
    /** How many rows on this page still have no price — the figure this page exists to chase. */
    readonly unpricedCount: number;
    readonly inactiveCount: number;
    readonly missingArabicCount: number;

    readonly openEditor: (itemId: string) => void;
    readonly viewing: IngredientAdmin | null;
    readonly openView: (row: IngredientAdmin) => void;
    readonly closeView: () => void;

    readonly archiving: IngredientAdmin | null;
    readonly askToArchive: (row: IngredientAdmin) => void;
    readonly cancelArchive: () => void;
    /** Runs the archive at the version the list was showing. `onArchived` carries the row's name. */
    readonly confirmArchive: (onArchived: (name: string) => void) => void;
    readonly isArchivePending: boolean;
    readonly archiveFailure: ApiFailure | null;
}

/** `null` sorts to the end in both directions rather than clustering at one. */
function missingLast<T>(left: T | null, right: T | null, compare: (a: T, b: T) => number): number {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return compare(left, right);
}

export function usePackagingList(): PackagingListState {
    const router = useRouter();
    const { locale } = useLocale();

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [category, setCategory] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<PackagingSortKey>('name');
    const [sortDirection, setSortDirection] = useState<PackagingSortDirection>('asc');
    const [viewing, setViewing] = useState<IngredientAdmin | null>(null);
    const [archiving, setArchiving] = useState<IngredientAdmin | null>(null);

    const trimmed = query.trim();

    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(category === null ? {} : { categoryCode: category }),
        }),
        [trimmed, statuses, category],
    );

    const [page, setPage] = useListPage(filter);
    const packaging = usePackagingPageQuery(filter, page);
    const categories = usePackagingCategoriesQuery();
    const archive = useArchiveIngredientMutation();

    const rows = packaging.data?.items;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;

        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'reference') {
                return missingLast(
                    left.reference,
                    right.reference,
                    (a, b) => factor * a.localeCompare(b),
                );
            }
            if (sortKey === 'category') {
                // The code, not a resolved name: `IngredientAdmin` carries the pair of codes and
                // the screen resolves them against the taxonomy for display. Sorting on the code is
                // stable when a name is edited. It orders nothing on the seeded set — every row is
                // filed under `packaging-disposables` — which is a property of the data rather than
                // of this comparator, and stops being true the moment a kitchen files one anywhere
                // else.
                return factor * left.categoryCode.localeCompare(right.categoryCode, locale);
            }
            if (sortKey === 'unit') {
                return factor * left.measurementUnit.localeCompare(right.measurementUnit);
            }
            if (sortKey === 'purchasePrice') {
                // Numeric, not lexical: lexically 11.00 sorts between 1.90 and 2.00, which is
                // exactly the bug a price column cannot afford.
                return missingLast(
                    left.purchasePrice,
                    right.purchasePrice,
                    (a, b) => factor * (a.amount - b.amount),
                );
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
        isPending: packaging.isPending,
        isFetching: packaging.isFetching,
        failure: toFailure(packaging.error),
        refetch: () => {
            void packaging.refetch();
        },

        query,
        setQuery,
        statuses,
        setStatuses,
        category,
        setCategory,
        isUnfiltered: trimmed === '' && statuses.length === 0 && category === null,
        clearFilters: () => {
            setQuery('');
            setStatuses([]);
            setCategory(null);
        },
        categories: (categories.data ?? []).filter((entry) => entry.parentCode !== null),
        categoryTree: categories.data ?? [],

        sortKey,
        sortDirection,
        setSort: (key, direction) => {
            setSortKey(key);
            setSortDirection(direction);
        },

        page,
        setPage,
        totalPages: pagesInResult(packaging.data) ?? 0,
        total: packaging.data?.totalCount ?? null,
        shown: sorted.length,
        unpricedCount: sorted.filter((row) => row.purchasePrice === null).length,
        // `draft` is what the packaging table called `inactive` — a row recorded but not in use.
        inactiveCount: sorted.filter((row) => row.meta.status === 'draft').length,
        missingArabicCount: sorted.filter((row) => displayName(row.name, locale).isFallback).length,

        // The ingredient editor, which can edit these rows because they *are* ingredients. This
        // used to point at `/kitchen/packaging/{item}`, a route that has never existed.
        openEditor: (itemId) => {
            router.push(`/kitchen/ingredients/${itemId}` as never);
        },
        viewing,
        openView: setViewing,
        closeView: () => {
            setViewing(null);
        },

        archiving,
        askToArchive: setArchiving,
        cancelArchive: () => {
            setArchiving(null);
        },
        confirmArchive: (onArchived) => {
            const row = archiving;
            if (row === null) return;
            archive.mutate(
                {
                    ingredientId: row.id,
                    request: { lockVersion: row.meta.lockVersion },
                },
                {
                    onSuccess: () => {
                        setArchiving(null);
                        onArchived(displayName(row.name, locale).value);
                    },
                },
            );
        },
        isArchivePending: archive.isPending,
        archiveFailure: toFailure(archive.error),
    };
}
