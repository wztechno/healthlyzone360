import type {
    ApiFailure,
    PublishableStatus,
    RecipeAdmin,
    RecipeAdminSummary,
} from '@healthy360/api-client/contracts';
import type { KitchenId, RecipeId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { toFailure } from '../../../data/hooks.ts';
import type { RecipeKitchen } from '../../../data/kitchen-admin-hooks.ts';
import {
    pagesInResult,
    useOpenRecipeDraftMutation,
    useRecipeDetails,
    useRecipeKitchensQuery,
    useRecipePageQuery,
    useRetireRecipeMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { displayName } from '../format.ts';
import { useListPage } from '../use-list-page.ts';

/**
 * Everything `/kitchen/recipes` knows that is not a pixel — the recipe half of handoff §4.6.
 *
 * The split is the same one `use-ingredient-list.ts` makes and is worth just as much here: the
 * list's *behaviour* survives the move onto the Catalogue shell untouched while its presentation is
 * rewritten from §4.1. So what moved here moved verbatim — the filter shape the query key is built
 * from, the client-side sort, the page reset, the retire sequence and the lock version it carries,
 * and the draft-opening sequence with the version number its toast quotes. Nothing was improved on
 * the way across.
 *
 * ## Sorting is client-side, and that is stated rather than hidden
 *
 * `RecipeAdminFilter` publishes no sort parameter, so the list sorts the rows it has — within the
 * page. Same limitation, same wording, as the ingredient list, and a real `?sort=` on the listing
 * endpoint makes it a server concern and this paragraph goes away.
 *
 * Two columns are deliberately unsortable: Version state and Allergens both arrive per row and out
 * of order, so ordering by either would sort the rows that had answered and shuffle the rest in
 * underneath as they landed. Their headers still filter through the toolbar's search.
 *
 * ## The counts are over the loaded page, deliberately
 *
 * Shown, Draft, Awaiting review and Missing Arabic are all counted over the page in hand, which is
 * the only set this screen has. That difference is why Shown reads "18 of 306" rather than claiming
 * the three beside it are catalogue-wide.
 *
 * ## The detail read is here, not in three cells
 *
 * {@link useRecipeDetails} reads every row on the page so the version state, the derived allergen
 * label and the immutability that decides whether New draft is offered are all answerable
 * synchronously. That last one is why it has to be here: `rowActions` is a callback, not a
 * component, so it cannot call a query — and an action that appeared a beat after the row did would
 * be a control moving under the pointer.
 */

/**
 * The columns a header menu can order by.
 *
 * Version orders by `currentVersionNumber` — numerically, since lexically v11 sorts between v1 and
 * v2. Version state and Allergens are absent for the reason above.
 */
export type RecipeSortKey = 'reference' | 'name' | 'kitchen' | 'version' | 'status' | 'updatedAt';
export type RecipeSortDirection = 'asc' | 'desc';

export interface RecipeListState {
    /** The rows for the current page, sorted. Never undefined — empty while pending. */
    readonly rows: readonly RecipeAdminSummary[];
    readonly isPending: boolean;
    readonly isFetching: boolean;
    readonly failure: ApiFailure | null;
    readonly refetch: () => void;

    /** The detail behind one row, or `undefined` while it is in flight. */
    readonly detailOf: (row: RecipeAdminSummary) => RecipeAdmin | undefined;

    readonly query: string;
    readonly setQuery: (query: string) => void;
    /** `''` when nothing is being searched for. The value the filter is built from. */
    readonly trimmed: string;
    readonly statuses: readonly PublishableStatus[];
    readonly setStatuses: (statuses: readonly PublishableStatus[]) => void;
    readonly kitchen: string | null;
    readonly setKitchen: (kitchen: string | null) => void;
    /** True when no filter of any kind is in force — the empty state branches on it. */
    readonly isUnfiltered: boolean;
    readonly clearFilters: () => void;
    readonly kitchens: readonly RecipeKitchen[];

    readonly sortKey: RecipeSortKey;
    readonly sortDirection: RecipeSortDirection;
    readonly setSort: (key: RecipeSortKey, direction: RecipeSortDirection) => void;

    readonly page: number;
    readonly setPage: (page: number) => void;
    readonly totalPages: number;
    /** The server's count for the whole filtered set, or `null` before the first answer. */
    readonly total: number | null;
    readonly shown: number;
    readonly draftCount: number;
    /** Rows the store quarantined — a published allergen label a change has since contradicted. */
    readonly reviewCount: number;
    readonly missingArabicCount: number;

    readonly openEditor: (recipeId: string) => void;
    readonly createNew: () => void;

    /**
     * The record the read-only View panel is showing, or `null`.
     *
     * The summary rather than its id, matching the ingredient list: the row already carries most of
     * what the panel draws, and the two fields it does not — the version state and the derived
     * label — are the ones {@link detailOf} already holds.
     */
    readonly viewing: RecipeAdminSummary | null;
    readonly openView: (row: RecipeAdminSummary) => void;
    readonly closeView: () => void;

    /**
     * True when this row's current version cannot be edited in place, so the only way to change it
     * is to open its successor. `false` while the detail is in flight — an action is not offered
     * until it is known to be the right one.
     */
    readonly isImmutable: (row: RecipeAdminSummary) => boolean;
    readonly startDraft: (row: RecipeAdminSummary, onOpened: (version: number) => void) => void;
    readonly draftOpeningFor: RecipeId | null;

    readonly archiving: RecipeAdminSummary | null;
    readonly askToArchive: (row: RecipeAdminSummary) => void;
    readonly cancelArchive: () => void;
    /** Runs the retire at the version the list was showing. `onArchived` carries the row's name. */
    readonly confirmArchive: (onArchived: (name: string) => void) => void;
    readonly isArchivePending: boolean;
    readonly archiveFailure: ApiFailure | null;
}

export function useRecipeList(): RecipeListState {
    const router = useRouter();
    const { locale } = useLocale();

    const [query, setQuery] = useState('');
    const [statuses, setStatuses] = useState<readonly PublishableStatus[]>([]);
    const [kitchen, setKitchen] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState<RecipeSortKey>('name');
    const [sortDirection, setSortDirection] = useState<RecipeSortDirection>('asc');
    const [archiving, setArchiving] = useState<RecipeAdminSummary | null>(null);
    const [viewing, setViewing] = useState<RecipeAdminSummary | null>(null);
    const [draftOpeningFor, setDraftOpeningFor] = useState<RecipeId | null>(null);

    const trimmed = query.trim();
    const filter = useMemo(
        () => ({
            ...(trimmed === '' ? {} : { query: trimmed }),
            ...(statuses.length === 0 ? {} : { statuses }),
            ...(kitchen === null ? {} : { kitchenId: kitchen as KitchenId }),
        }),
        [trimmed, statuses, kitchen],
    );

    const [page, setPage] = useListPage(filter);
    const recipes = useRecipePageQuery(filter, page);
    const kitchens = useRecipeKitchensQuery();
    const retire = useRetireRecipeMutation();
    const openDraft = useOpenRecipeDraftMutation();

    // Left possibly-undefined rather than defaulted to `[]`: `?? []` is a fresh array on every
    // render, which would re-run the sort below whether or not the data changed.
    const rows = recipes.data?.items;
    const total = recipes.data?.totalCount ?? null;
    const totalPages = pagesInResult(recipes.data) ?? 0;

    const sorted = useMemo(() => {
        const factor = sortDirection === 'asc' ? 1 : -1;
        return [...(rows ?? [])].sort((left, right) => {
            if (sortKey === 'reference') return factor * left.slug.localeCompare(right.slug);
            if (sortKey === 'kitchen') {
                return factor * String(left.kitchenId).localeCompare(String(right.kitchenId));
            }
            if (sortKey === 'version') {
                // Numeric, not lexical — the spec's `sortType: 'number'`.
                return factor * (left.currentVersionNumber - right.currentVersionNumber);
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

    // Keyed off the sorted page, so the reads follow the rows actually on screen. The identity of
    // this array is what `useQueries` re-subscribes on, hence the memo.
    const recipeIds = useMemo(() => sorted.map((row) => row.id), [sorted]);
    const details = useRecipeDetails(recipeIds);
    const detailOf = (row: RecipeAdminSummary): RecipeAdmin | undefined => details[String(row.id)];

    const draftCount = sorted.filter((row) => row.meta.status === 'draft').length;
    const reviewCount = sorted.filter((row) => row.meta.status === 'review_required').length;
    const missingArabicCount = sorted.filter(
        (row) => displayName(row.name, locale).isFallback,
    ).length;

    const openEditor = (recipeId: string) => {
        router.push(`/kitchen/recipes/${recipeId}` as never);
    };

    return {
        rows: sorted,
        isPending: recipes.isPending,
        isFetching: recipes.isFetching,
        failure: toFailure(recipes.error),
        refetch: () => {
            void recipes.refetch();
        },

        detailOf,

        query,
        setQuery,
        trimmed,
        statuses,
        setStatuses,
        kitchen,
        setKitchen,
        isUnfiltered: trimmed === '' && statuses.length === 0 && kitchen === null,
        clearFilters: () => {
            setQuery('');
            setStatuses([]);
            setKitchen(null);
        },
        kitchens: kitchens.data ?? [],

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
        shown: sorted.length,
        draftCount,
        reviewCount,
        missingArabicCount,

        openEditor,
        createNew: () => {
            router.push('/kitchen/recipes/new' as never);
        },

        viewing,
        openView: setViewing,
        closeView: () => {
            setViewing(null);
        },

        // A published or retired version is frozen by the contract, so the only way to change it is
        // to open its successor. Offering New draft against a draft that is already open would
        // write a version bump that changed nothing.
        isImmutable: (row) => {
            const status = detailOf(row)?.currentVersion.status;
            return status === 'published' || status === 'retired';
        },
        startDraft: (row, onOpened) => {
            setDraftOpeningFor(row.id);
            openDraft.mutate(
                { recipeId: row.id, request: { lockVersion: row.meta.lockVersion } },
                {
                    onSuccess: (updated) => {
                        onOpened(updated.currentVersion.versionNumber);
                        openEditor(String(row.id));
                    },
                    onSettled: () => {
                        setDraftOpeningFor(null);
                    },
                },
            );
        },
        draftOpeningFor,

        archiving,
        askToArchive: setArchiving,
        cancelArchive: () => {
            setArchiving(null);
        },
        // Retiring *is* the archive: the contract has no `archiveRecipe`, and nothing is deleted
        // because meals, products and cost snapshots still point at the version.
        confirmArchive: (onArchived) => {
            const row = archiving;
            if (row === null) return;
            retire.mutate(
                { recipeId: row.id, request: { lockVersion: row.meta.lockVersion } },
                {
                    onSuccess: () => {
                        setArchiving(null);
                        onArchived(displayName(row.name, locale).value);
                    },
                },
            );
        },
        isArchivePending: retire.isPending,
        archiveFailure: toFailure(retire.error),
    };
}
