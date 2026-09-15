import type { ApiFailure, ProductAdmin, PublishableStatus } from '@healthy360/api-client/contracts';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    useArchiveProductMutation,
    useProductCategoriesQuery,
    useProductPageQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import type { ProductCategory } from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';
import { useListPage } from '../use-list-page.ts';

/**
 * Everything `/kitchen/products` — and `/kitchen/sauces`, and `/kitchen/dressings` — knows that is
 * not a pixel.
 *
 * The same split `use-ingredient-list.ts` makes and for the same reason: the list's *behaviour*
 * survives the move to the Catalogue shell untouched while its presentation is rewritten from §4.1.
 * So what moved here moved verbatim — the filter shape the query key is built from, the
 * client-side sort, the page reset, and the archive sequence with the lock version it carries.
 * Nothing was improved on the way across. A redesign that also quietly changed which version a
 * write is based on is a redesign nobody can review.
 *
 * ## One hook, three pages, and `itemType` is what makes them different
 *
 * Sauces and dressings are products in apparatus — same packs, same channels, same lifecycle — so
 * they are the same rows filtered by kind rather than three hooks. The kind is a *parameter* and
 * not a second hook because it is part of the filter the query key is built from: change it and the
 * page, the categories and the archive target all follow, which is exactly what a parameter is for.
 *
 * ## Sorting is client-side, and that is a stated limitation rather than a hidden one
 *
 * `ProductAdminFilter` publishes no sort parameter, so the list sorts the rows it has. With
 * numbered pages that means *within the page* — press "Product" on page 3 and the twenty-five rows
 * on page 3 reorder, not the catalogue. A real `?sort=` on the listing endpoint makes this a server
 * concern and this comment goes away.
 *
 * ## The counts are over the loaded page, deliberately
 *
 * How many rows are shown of how many, how many are still draft, how many cannot publish for want
 * of an Arabic name, how many have no pack to price — all four are counted over the page in hand,
 * which is the only set this screen has. `total` is the one number the server sent, which is why
 * Shown reads "18 of 240" rather than claiming the three beside it are catalogue-wide.
 */

export type ProductItemType = 'product' | 'sauce' | 'dressing';

/**
 * The columns a header menu can order by.
 *
 * Packs, Channels and Flags are absent on purpose. Each is a *set* rendered as a run, and ordering
 * a set by its first member sorts for reasons no reader can see — the argument `use-recipe-list.ts`
 * records for allergens, and it applies to a channel list identically.
 */
export type ProductSortKey = 'reference' | 'name' | 'category' | 'status' | 'updatedAt';
export type ProductSortDirection = 'asc' | 'desc';

export interface ProductListState {
    /** The rows for the current page, sorted. Never undefined — empty while pending. */
    readonly rows: readonly ProductAdmin[];
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
    /** True when no filter of any kind is in force — the empty state branches on it. */
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;
    /** The codes this family's own rows carry, with how many carry each. */
    readonly categories: readonly ProductCategory[];

    readonly sortKey: ProductSortKey;
    readonly sortDirection: ProductSortDirection;
    readonly setSort: (key: ProductSortKey, direction: ProductSortDirection) => void;

    readonly page: number;
    readonly setPage: (page: number) => void;
    readonly totalPages: number;
    /** The server's count for the whole filtered set, or `null` before the first answer. */
    readonly total: number | null;
    readonly shown: number;
    readonly draftCount: number;
    readonly missingArabicCount: number;
    /** Rows with no pack at all, so nothing on them can be priced. */
    readonly noPackCount: number;

    readonly openEditor: (productId: string) => void;
    readonly createNew: () => void;

    /**
     * The record the read-only View panel is showing, or `null`.
     *
     * The record itself rather than its id: `listProducts` returns whole {@link ProductAdmin}
     * records — packs, channels, flags and all — so re-fetching one row the list is already holding
     * would put a spinner in front of an answer it has.
     */
    readonly viewing: ProductAdmin | null;
    readonly openView: (row: ProductAdmin) => void;
    readonly closeView: () => void;

    readonly archiving: ProductAdmin | null;
    readonly askToArchive: (row: ProductAdmin) => void;
    readonly cancelArchive: () => void;
    /** Runs the archive at the version the list was showing. `onArchived` carries the row's name. */
    readonly confirmArchive: (onArchived: (name: string) => void) => void;
    readonly isArchivePending: boolean;
    readonly archiveFailure: ApiFailure | null;
}

export function useProductList(itemType: ProductItemType, routeBase: string): ProductListState {
    const router = useRouter();
    const { locale } = useLocale();

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [category, setCategory] = useState<string | null>(null);
    // Reference ascending, which is the order the codes were issued in and so the order a
    // kitchen already knows the library by. Sorting by name instead put the list in an order
    // that changes with the language.
    const [sortKey, setSortKey] = useState<ProductSortKey>('reference');
    const [sortDirection, setSortDirection] = useState<ProductSortDirection>('asc');
    const [viewing, setViewing] = useState<ProductAdmin | null>(null);
    const [archiving, setArchiving] = useState<ProductAdmin | null>(null);

    const trimmed = query.trim();

    /*
     * The vocabulary is read before the filter is built, because the filter needs its ids.
     *
     * `/catalogue/items` narrows by `product_category_id`, and the picker's value is a code - so
     * the two have to meet somewhere, and it is here rather than in the request builder so a code
     * with no id resolves to no constraint instead of to a silently unfiltered list.
     */
    const categories = useProductCategoriesQuery(itemType);
    const categoryId = useMemo(
        () => (categories.data ?? []).find((entry) => entry.code === category)?.id ?? null,
        [categories.data, category],
    );

    const filter = useMemo(
        () => ({
            itemType,
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(categoryId === null ? {} : { categoryId }),
        }),
        [itemType, trimmed, statuses, categoryId],
    );

    const [page, setPage] = useListPage(filter);
    const products = useProductPageQuery(filter, page);
    const archive = useArchiveProductMutation();

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on every
    // render, which would re-run the sort below whether or not the data changed.
    const rows = products.data?.items;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'reference') {
                // Missing last in both directions, so the unnumbered rows cluster at the end
                // rather than at whichever end the direction happens to point.
                if (left.reference === null && right.reference === null) return 0;
                if (left.reference === null) return 1;
                if (right.reference === null) return -1;
                return factor * left.reference.localeCompare(right.reference);
            }
            if (sortKey === 'category') {
                return factor * left.categoryCode.localeCompare(right.categoryCode, locale);
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
        isPending: products.isPending,
        isFetching: products.isFetching,
        failure: toFailure(products.error),
        refetch: () => {
            void products.refetch();
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
        categories: categories.data ?? [],

        sortKey,
        sortDirection,
        setSort: (key, direction) => {
            setSortKey(key);
            setSortDirection(direction);
        },

        page,
        setPage,
        totalPages: pagesInResult(products.data) ?? 0,
        total: products.data?.totalCount ?? null,
        shown: sorted.length,
        draftCount: sorted.filter((row) => row.meta.status === 'draft').length,
        missingArabicCount: sorted.filter((row) => displayName(row.name, locale).isFallback).length,
        noPackCount: sorted.filter((row) => row.packVariants.length === 0).length,

        openEditor: (productId) => {
            router.push(`${routeBase}/${productId}` as never);
        },
        createNew: () => {
            router.push(`${routeBase}/new` as never);
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
                    productId: row.id,
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
