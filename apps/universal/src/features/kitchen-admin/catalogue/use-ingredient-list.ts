import type { AllergenCode } from '@healthy360/domain-types';

import type {
    AllergenClass,
    ApiFailure,
    IngredientAdmin,
    IngredientCategoryAdmin,
    PublishableStatus,
} from '@healthy360/api-client/contracts';
import {
    PACKAGING_CATEGORY_CODE,
    PRODUCT_FAMILY_CATEGORY_CODES,
} from '@healthy360/api-client/contracts';
import type { IngredientReferenceSeries } from '@healthy360/api-client/contracts';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import {
    pagesInResult,
    topLevelCategories,
    useAllergenClassesQuery,
    useArchiveIngredientMutation,
    useIngredientCategoriesQuery,
    useIngredientPageQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';
import { useListPage } from '../use-list-page.ts';
import { useCatalogueFilters } from './use-catalogue-filters.ts';
import { useDestructiveRow } from './use-destructive-row.ts';

/**
 * Everything `/kitchen/ingredients` knows that is not a pixel — handoff §4.6.
 *
 * The split is the point: the list's *behaviour* survives the redesign untouched while its
 * presentation is rewritten from §4.1. So what moved here moved verbatim — the filter shape the
 * query key is built from, the client-side sort with its nulls-last rule, the page reset, the
 * archive sequence and the lock version it carries. Nothing was improved on the way across. A
 * redesign that also quietly changed which version a write is based on is a redesign nobody can
 * review.
 *
 * ## Sorting is the server's, and so it orders the catalogue rather than the page
 *
 * It was client-side while `IngredientAdminFilter` published no sort parameter, and the cost was
 * exactly what that implies: pressing "Name" on page 3 reordered the eighteen rows in front of the
 * reader and left the other three hundred where they were. A header that reorders a page is not a
 * sort of the list, and reads as one — a reader pressing "Unit price" to find the dearest
 * ingredient got the dearest of *these eighteen*.
 *
 * The filter now carries `sort`, `sortDirection` and `sortLanguage`, so the order is decided
 * beside the `COUNT` and the other filters. Two consequences follow. The sort is part of the
 * query key, so changing it is a request rather than a re-render; and it is part of the filter
 * object `useListPage` resets on, so changing it lands on page one — which is right, since every
 * row has just moved and page 3 of the old order names nothing.
 *
 * The language goes with it because the list draws the reader's own name and sorts on what it
 * draws: a catalogue ordered by `name_en` under an Arabic interface is in no order the reader can
 * see.
 *
 * ## The counts are over the loaded page, deliberately
 *
 * How many rows are shown of how many, how many are still draft, how many cannot publish for want
 * of an Arabic name — all three are counted over the page in hand, which is the only set this
 * screen actually has. A total the server has never sent would be a number invented to look
 * informative.
 *
 * There is no `density` here any more. The toolbar's S/M/L set is gone — the list is fixed at the
 * ladder's smallest step — so the state that existed only to join a control to a list had nothing
 * left to join.
 */

/**
 * The columns a header menu can order by — every one the design draws except Allergens.
 *
 * Allergens is left out on purpose: the cell is a *set* rendered as a comma run, and ordering a set
 * alphabetically by its first member sorts "Egg, Mustard" above "Milk" and below "Celery" for
 * reasons no reader can see. Its header still filters through the toolbar's search.
 */
export type IngredientSortKey =
    'reference' | 'name' | 'category' | 'unit' | 'unitPrice' | 'status' | 'updatedAt';
export type IngredientSortDirection = 'asc' | 'desc';

/**
 * The series this list shows, named so the type survives the filter object.
 *
 * Inline, TypeScript widens `'ING-'` to `string` inside an object literal and the filter refuses
 * it — which is the contract doing its job: the field admits the two series the ingredient table is
 * numbered in, and nothing else.
 */
const INGREDIENT_SERIES: IngredientReferenceSeries = 'ING-';

/** One frozen empty page, so "no rows yet" keeps the same identity across renders. */
const NO_ROWS: readonly IngredientAdmin[] = [];

/**
 * Which name column the `name` sort orders by, from the resolved locale.
 *
 * Arabic is the only script with a column of its own; everything else reads the English name, so
 * everything else sorts by it. Matched on the language subtag rather than the whole tag, because
 * the locale that arrives here is `ar-LB` as often as `ar`.
 */
function sortLanguageFor(locale: string): 'en' | 'ar' {
    return locale.toLowerCase().split('-')[0] === 'ar' ? 'ar' : 'en';
}

export interface IngredientListState {
    /** The current page, in the order the request asked for. Empty while pending, never undefined. */
    readonly rows: readonly IngredientAdmin[];
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly failure: ApiFailure | null;
    readonly refetch: () => void;

    readonly query: string;
    readonly setQuery: (query: string) => void;
    /** `''` when nothing is being searched for. The value the filter is built from. */
    readonly trimmed: string;
    readonly statuses: readonly PublishableStatus[];
    readonly setStatuses: (statuses: readonly PublishableStatus[]) => void;
    readonly category: string | null;
    readonly setCategory: (category: string | null) => void;
    /**
     * The allergen class the list is narrowed to, or `null`.
     *
     * One class, not a set. The column asks "show me the rows declaring this", and the endpoint
     * answers exactly that — a union of classes would have to be filtered on the loaded page, which
     * on a list seventeen pages deep narrows the page while the count goes on describing the whole
     * collection. Both containments match, because the column prints both.
     */
    readonly allergen: AllergenCode | null;
    readonly setAllergen: (allergen: AllergenCode | null) => void;
    /** Every class the platform declares — the column filter's value list. */
    readonly allergenClasses: readonly AllergenClass[];
    /** True when no filter of any kind is in force — the empty state branches on it. */
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;
    /**
     * The top level of the tree only. The column filter sends `categoryCode` as the request's
     * `category`, which the server resolves against `ingredient_category_id` — a leaf code there
     * would match nothing, because a sub-categorised row keeps its leaf in a *second* column.
     * Filtering by leaf is a separate request parameter and a separate control.
     *
     * `packaging-disposables` is filtered out below. It *is* a branch of this tree — packaging and
     * food share the table — but offering it here would offer a choice that returns nothing, since
     * the list excludes that branch unconditionally. A filter option that can only ever produce an
     * empty page is worse than no option.
     *
     * `PRODUCT_FAMILY_CATEGORY_CODES` goes for the same reason and by a different route: Sauce,
     * Dressings, Beverage and Bread hold only the `SAC-`/`DRS-`/`PRD-`/`RSL-` rows the v6 import
     * writes beside its sellable lines, and this list keeps the `ING-` series alone. Same empty
     * page, same conclusion.
     */
    readonly categories: readonly IngredientCategoryAdmin[];
    /**
     * The whole tree, both levels — what a name lookup needs. The filter above wants the top level
     * only; a row's *leaf* still has to resolve to a name, and its code is not in that list.
     */
    readonly categoryTree: readonly IngredientCategoryAdmin[];

    readonly sortKey: IngredientSortKey;
    readonly sortDirection: IngredientSortDirection;
    readonly setSort: (key: IngredientSortKey, direction: IngredientSortDirection) => void;

    readonly page: number;
    readonly setPage: (page: number) => void;
    readonly totalPages: number;
    /** The server's count for the whole filtered set, or `null` before the first answer. */
    readonly total: number | null;
    readonly shown: number;
    readonly draftCount: number;
    readonly missingArabicCount: number;
    /** Rows with no unit price on file, so no cost per kilo can resolve downstream. */
    readonly uncostedCount: number;

    readonly openEditor: (ingredientId: string) => void;
    readonly createNew: () => void;

    /**
     * The record the read-only View panel is showing, or `null`.
     *
     * The record itself rather than its id: the list already has every field the panel draws, so
     * re-fetching one row it is holding would put a spinner in front of an answer it already has.
     */
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

export function useIngredientList(): IngredientListState {
    const router = useRouter();
    const { locale } = useLocale();

    const {
        query,
        setQuery,
        trimmed,
        statuses,
        setStatuses,
        isUnfiltered: searchAndStatusUnset,
        clear: clearSearchAndStatus,
    } = useCatalogueFilters();
    const [category, setCategory] = useState<string | null>(null);
    const [allergen, setAllergen] = useState<AllergenCode | null>(null);
    // Reference ascending, which is the order the codes were issued in and so the order a
    // kitchen already knows the library by. Sorting by name instead put the list in an order
    // that changes with the language.
    const [sortKey, setSortKey] = useState<IngredientSortKey>('reference');
    const [sortDirection, setSortDirection] = useState<IngredientSortDirection>('asc');
    const [viewing, setViewing] = useState<IngredientAdmin | null>(null);

    const filter = useMemo(
        () => ({
            /*
             * Food only, always.
             *
             * Packaging shares this table — it is filed under `packaging-disposables` — so the
             * ingredient list has to say what it means rather than take whatever the endpoint
             * returns. Without this the catalogue grows thirty-three rows of bin liners and
             * cutlery, which is exactly the complaint that once got the family moved to a table
             * of its own.
             *
             * Unconditional, and *not* dropped when the reader picks a category: the two
             * constraints are `AND`ed server-side, so a food category narrows within food and a
             * packaging one — which this list's own filter never offers — would correctly return
             * nothing. The repository refuses an exclusion whose code it cannot resolve, so this
             * cannot quietly stop applying.
             */
            excludeCategoryCode: PACKAGING_CATEGORY_CODE,
            /*
             * And everything that is not in the ingredient library's own series.
             *
             * The import writes an ingredient beside every sellable row it brings in — 43 `SAC-`
             * sauces, 19 `DRS-` dressings, 69 `PRD-`/`RSL-` product and resale lines — so a
             * formulation can name one. They belong to the pages that sell them. What is left is
             * the raw-material library, which is what this list is.
             *
             * A whitelist rather than exclusions, because the exclusions kept losing: filing cannot
             * separate the resale twins from real food, and deleting them cannot either — the next
             * import writes them back. A row either carries `ING-` or it does not, and `create` and
             * `fork` both assign one, so nothing a kitchen makes falls out of its own list.
             */
            referenceSeries: INGREDIENT_SERIES,
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(category === null ? {} : { categoryCode: category }),
            ...(allergen === null ? {} : { allergenCodes: [allergen] }),
            sort: sortKey,
            sortDirection,
            sortLanguage: sortLanguageFor(locale),
        }),
        [trimmed, statuses, category, allergen, sortKey, sortDirection, locale],
    );

    const [page, setPage] = useListPage(filter);
    const ingredients = useIngredientPageQuery(filter, page);
    const categories = useIngredientCategoriesQuery();
    const allergenClasses = useAllergenClassesQuery();
    const archive = useDestructiveRow(useArchiveIngredientMutation(), (row: IngredientAdmin) => ({
        ingredientId: row.id,
        request: { lockVersion: row.meta.lockVersion },
    }));

    const rows = ingredients.data?.items;
    const total = ingredients.data?.totalCount ?? null;
    const totalPages = pagesInResult(ingredients.data) ?? 0;

    /*
     * The page as the server ordered it. Frozen empty while there is none, so "no rows yet" keeps
     * one identity across renders — `?? []` would be a fresh array each time, and so a fresh
     * identity for the three counts below and for everything downstream memoising on `rows`.
     */
    const pageRows = rows ?? NO_ROWS;

    const draftCount = pageRows.filter((row) => row.meta.status === 'draft').length;
    const missingArabicCount = pageRows.filter(
        (row) => displayName(row.name, locale).isFallback,
    ).length;
    const uncostedCount = pageRows.filter((row) => row.unitPrice === null).length;

    return {
        rows: pageRows,
        isPending: ingredients.isPending,
        isFetching: ingredients.isFetching,
        failure: toFailure(ingredients.error),
        refetch: () => {
            void ingredients.refetch();
        },

        query,
        setQuery,
        trimmed,
        statuses,
        setStatuses,
        category,
        setCategory,
        allergen,
        setAllergen,
        allergenClasses: allergenClasses.data ?? [],
        isUnfiltered: searchAndStatusUnset && category === null && allergen === null,
        clearFilters: () => {
            clearSearchAndStatus();
            setCategory(null);
            setAllergen(null);
        },
        categories: topLevelCategories(categories.data).filter(
            (entry) =>
                entry.code !== PACKAGING_CATEGORY_CODE &&
                !PRODUCT_FAMILY_CATEGORY_CODES.includes(entry.code),
        ),
        categoryTree: categories.data ?? [],

        sortKey,
        sortDirection,
        setSort: (key, direction) => {
            setSortKey(key);
            setSortDirection(direction);
        },

        page,
        setPage,
        totalPages,
        total,
        shown: pageRows.length,
        draftCount,
        missingArabicCount,
        uncostedCount,

        openEditor: (ingredientId) => {
            router.push(`/kitchen/ingredients/${ingredientId}` as never);
        },
        createNew: () => {
            router.push('/kitchen/ingredients/new' as never);
        },

        viewing,
        openView: setViewing,
        closeView: () => {
            setViewing(null);
        },

        archiving: archive.target,
        askToArchive: archive.ask,
        cancelArchive: archive.cancel,
        confirmArchive: archive.confirm,
        isArchivePending: archive.isPending,
        archiveFailure: archive.failure,
    };
}
